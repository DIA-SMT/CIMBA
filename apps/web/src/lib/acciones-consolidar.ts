"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { tipoProblemaSchema } from "@cimba/domain";
import { requerirRol, type Sesion } from "./auth";

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

export interface ResultadoConsolidacion {
  vinculadasAExistentes: number;
  gruposDetectados: number;
  incidentesCreados: number;
  demandasAgrupadas: number;
  gruposPendientes: number;
  scoresActualizados: number;
}

/**
 * Consolidación automática: el corazón de "unificar y cotejar".
 *
 * Solo actúa donde las reglas del dominio permiten auto-vincular
 * (geocodificación confiable ≥ 0.75, mismo tipo, ≤ 25 m). Todo lo dudoso
 * queda en la bandeja para revisión humana (con asistencia de IA por demanda).
 *
 *  A. Demandas sueltas → incidentes ABIERTOS existentes (más cercano).
 *  B. Demandas sueltas entre sí → clusters DBSCAN → un incidente por grupo.
 *  C. Recalcula el score de prioridad de todos los incidentes tocados.
 */
export async function consolidarAutomaticamente(): Promise<ResultadoConsolidacion> {
  const sesion = await requerirRol("atencion_ciudadana", "planificacion");
  const MAX_GRUPOS_POR_CORRIDA = 250;

  return conRls(claims(sesion), async (tx) => {
    // ── A. Vincular al incidente abierto más cercano ─────────────────────────
    const vinculadas = (await tx.execute(sql`
      with candidatas as (
        select distinct on (d.id) d.id as demanda_id, i.id as incidente_id
        from demandas d
        join incidentes i
          on i.estado in ('detectado','priorizado','programado','en_ejecucion')
         and i.tipo = d.tipo
         and st_dwithin(i.geom::geography, d.geom::geography, 25)
        where d.estado = 'recibida'
          and d.geom is not null
          and d.tipo is not null
          and coalesce(d.geocod_confianza, 0) >= 0.75
          and not exists (select 1 from demanda_incidente di where di.demanda_id = d.id)
        order by d.id, st_distance(i.geom::geography, d.geom::geography)
      ),
      insertadas as (
        insert into demanda_incidente (demanda_id, incidente_id, vinculado_por, automatico, confianza)
        select demanda_id, incidente_id, ${sesion.sub}, true, 0.9 from candidatas
        on conflict do nothing
        returning demanda_id, incidente_id
      ),
      marcadas as (
        update demandas set estado = 'vinculada'
        where id in (select demanda_id from insertadas)
        returning id
      )
      select
        (select count(*) from insertadas) as vinculadas,
        array(select distinct incidente_id from insertadas) as incidentes
    `)) as unknown as Array<{ vinculadas: string | number; incidentes: number[] }>;
    const pasoA = vinculadas[0];
    const idsTocadosA: number[] = (pasoA?.incidentes ?? []).map(Number);

    // ── B. Agrupar demandas sueltas entre sí (DBSCAN 25 m por tipo) ──────────
    const grupos = (await tx.execute(sql`
      with libres as (
        select d.id, d.tipo, d.geom, d.creado_en,
               coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
               st_clusterdbscan(st_transform(d.geom, 3857), eps := 25, minpoints := 2)
                 over (partition by d.tipo) as grupo
        from demandas d
        where d.estado = 'recibida'
          and d.geom is not null
          and d.tipo is not null
          and coalesce(d.geocod_confianza, 0) >= 0.75
          and not exists (select 1 from demanda_incidente di where di.demanda_id = d.id)
      )
      select tipo, grupo,
             st_x(st_centroid(st_collect(geom))) as lon,
             st_y(st_centroid(st_collect(geom))) as lat,
             min(creado_en) as primera,
             (array_agg(direccion order by creado_en))[1] as direccion,
             array_agg(id order by creado_en) as demanda_ids
      from libres
      where grupo is not null
      group by tipo, grupo
      order by count(*) desc
    `)) as unknown as Array<{
      tipo: string;
      lon: number;
      lat: number;
      primera: string;
      direccion: string | null;
      demanda_ids: number[];
    }>;

    const aProcesar = grupos.slice(0, MAX_GRUPOS_POR_CORRIDA);
    let incidentesCreados = 0;
    let demandasAgrupadas = 0;
    const idsTocadosB: number[] = [];

    for (const g of aProcesar) {
      const ids = g.demanda_ids.map(Number);
      const nuevo = (await tx.execute(sql`
        insert into incidentes (tipo, estado, geom, direccion, detectado_en, creado_por, metadata)
        values (
          ${g.tipo}::tipo_problema, 'detectado',
          st_setsrid(st_makepoint(${g.lon}, ${g.lat}), 4326),
          ${g.direccion}, ${g.primera}::timestamptz, ${sesion.sub},
          ${JSON.stringify({ origen: "consolidacion_automatica", demandas_agrupadas: ids.length })}::jsonb
        ) returning id
      `)) as unknown as Array<{ id: number }>;
      const incidenteId = nuevo[0]?.id;
      if (!incidenteId) continue;
      // arrays via jsonb: postgres.js por la vía unsafe() no serializa arrays JS
      await tx.execute(sql`
        insert into demanda_incidente (demanda_id, incidente_id, vinculado_por, automatico, confianza)
        select value::bigint, ${incidenteId}, ${sesion.sub}, true, 0.85
        from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)
        on conflict do nothing
      `);
      await tx.execute(sql`
        update demandas set estado = 'vinculada'
        where id in (select value::bigint from jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
      `);
      incidentesCreados++;
      demandasAgrupadas += ids.length;
      idsTocadosB.push(incidenteId);
    }

    // ── C. Recalcular score (misma fórmula que packages/domain) ─────────────
    const tocados = [...new Set([...idsTocadosA, ...idsTocadosB])];
    if (tocados.length > 0) {
      await tx.execute(sql`
        update incidentes i set score_prioridad = sub.score
        from (
          select i2.id,
            round(least(100,
              least(35, 12 * log(2.0, 1 + c.demandas + 0.5 * c.menciones))
              + least(20, extract(epoch from (now() - i2.detectado_en)) / 86400.0 / 60.0 * 20)
              + 25 * (0.7 * case i2.tipo
                  when 'hundimiento' then 1.0 when 'perdida_agua' then 0.9
                  when 'bache' then 0.85 when 'sumidero' then 0.7
                  when 'tapa_registro' then 0.7 when 'pavimento_deteriorado' then 0.6
                  when 'fisura' then 0.4 else 0.3 end
                + 0.3 * coalesce((5 - c.prio_min) / 4.0, 0))
              + least(12, c.previas * 6)
              + case when i2.direccion ~* 'avenida|\\mav\\.?\\M' then 8 else 0 end
            )::numeric, 2) as score
          from incidentes i2
          cross join lateral (
            select
              (select count(*) from demanda_incidente di where di.incidente_id = i2.id) as demandas,
              (select coalesce(sum(coalesce(d.menciones,0)),0) from demanda_incidente di
                 join demandas d on d.id = di.demanda_id where di.incidente_id = i2.id) as menciones,
              (select min(d.prioridad_informada) from demanda_incidente di
                 join demandas d on d.id = di.demanda_id where di.incidente_id = i2.id) as prio_min,
              (select count(*) from intervenciones iv
                 where iv.incidente_id = i2.id and iv.estado = 'finalizada') as previas
          ) c
          where i2.id in (select value::bigint from jsonb_array_elements_text(${JSON.stringify(tocados)}::jsonb))
        ) sub
        where i.id = sub.id
      `);
    }

    revalidatePath("/demandas");
    revalidatePath("/incidentes");
    revalidatePath("/calidad");
    revalidatePath("/mapa");

    return {
      vinculadasAExistentes: Number(pasoA?.vinculadas ?? 0),
      gruposDetectados: grupos.length,
      incidentesCreados,
      demandasAgrupadas,
      gruposPendientes: Math.max(0, grupos.length - aProcesar.length),
      scoresActualizados: tocados.length,
    };
  });
}


// ── Cotejo retroactivo: cerrar pedidos que ya fueron resueltos ───────────────

export interface ResultadoCotejo {
  cerradas: number;
  candidatasRestantes: number;
}

/**
 * El otro lado de la brecha: pedidos abiertos cuyo lugar YA fue reparado
 * DESPUÉS del pedido (o el pedido no tiene fecha confiable). Los vincula al
 * incidente reparado más cercano (≤ 25 m, tipo compatible, geocodificación
 * ≥ 0.75) y los marca vinculados. No borra nada: queda auditoría, el vínculo
 * lleva automatico=true y metadata.cotejo_retroactivo para poder revisarlo.
 * Lo que no cumple los umbrales queda para revisión humana en la bandeja.
 */
export async function cotejarConReparados(opciones?: { ampliado?: boolean }): Promise<ResultadoCotejo> {
  const sesion = await requerirRol("atencion_ciudadana", "planificacion", "supervision");
  // Modo ampliado: incluye pedidos sin etiqueta de confianza de geocodificación
  // (consolidado histórico de QGIS). Sigue exigiendo ≤ 25 m, tipo compatible y
  // reparación posterior — la cercanía es en sí una señal fuerte. El vínculo
  // queda con confianza menor (0.7) para poder distinguirlo después.
  const ampliado = opciones?.ampliado === true;
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      with candidatas as (
        select distinct on (d.id) d.id as demanda_id, i.id as incidente_id
        from demandas d
        join incidentes i
          on i.estado in ('reparado','verificado')
         and st_dwithin(i.geom::geography, d.geom::geography, 25)
         and (d.tipo is null or i.tipo = d.tipo
                        or (d.tipo in ('bache','pavimento_deteriorado','hundimiento','fisura')
                            and i.tipo in ('bache','pavimento_deteriorado','hundimiento','fisura')))
         and (d.metadata->>'sin_fecha' = 'true' or i.cerrado_en >= d.creado_en)
        where d.estado in ('recibida','en_validacion')
          and d.geom is not null
          and coalesce(d.geocod_confianza, ${ampliado ? 1 : 0}) >= 0.75
          and not exists (select 1 from demanda_incidente di where di.demanda_id = d.id)
        order by d.id, st_distance(i.geom::geography, d.geom::geography)
      ),
      insertadas as (
        insert into demanda_incidente (demanda_id, incidente_id, vinculado_por, automatico, confianza)
        select demanda_id, incidente_id, ${sesion.sub}, true, ${ampliado ? 0.7 : 0.85} from candidatas
        on conflict do nothing
        returning demanda_id
      ),
      marcadas as (
        update demandas set estado = 'vinculada',
          metadata = metadata || '{"cotejo_retroactivo": true}'::jsonb
        where id in (select demanda_id from insertadas)
        returning id
      )
      select (select count(*) from marcadas)::int as cerradas
    `)) as unknown as Array<{ cerradas: number | string }>;

    revalidatePath("/brecha");
    revalidatePath("/demandas");
    revalidatePath("/calidad");
    revalidatePath("/mapa");
    return { cerradas: Number(filas[0]?.cerradas ?? 0), candidatasRestantes: 0 };
  });
}

// ── Importar archivo desde la app ────────────────────────────────────────────

export async function importarArchivo(formData: FormData) {
  const sesion = await requerirRol("atencion_ciudadana", "planificacion", "informacion_estrategica");
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) throw new Error("Falta el archivo");
  if (archivo.size > 8 * 1024 * 1024) throw new Error("El archivo supera 8 MB");

  const { detectarYParsear, ingestarDemandas, ingestarIntervenciones, registrarSyncRun } =
    await import("@cimba/integrations");

  const contenido = Buffer.from(await archivo.arrayBuffer());
  const deteccion = await detectarYParsear(archivo.name, contenido);

  const resultados: string[] = [];
  if (deteccion.demandas.length > 0) {
    const r = await ingestarDemandas(deteccion.sistema, deteccion.demandas);
    await registrarSyncRun(r, null);
    resultados.push(
      `${r.leidos} demandas leídas: ${r.insertados} nuevas, ${r.actualizados} actualizadas, ${r.sinCambios} sin cambios, ${r.errores.length} errores`,
    );
  }
  if (deteccion.intervenciones.length > 0) {
    const r = await ingestarIntervenciones(deteccion.sistema, deteccion.intervenciones);
    await registrarSyncRun(r, null);
    resultados.push(
      `${r.leidos} intervenciones leídas: ${r.insertados} nuevas, ${r.actualizados} actualizadas, ${r.sinCambios} sin cambios, ${r.errores.length} errores`,
    );
  }

  revalidatePath("/mapa");
  revalidatePath("/demandas");
  void sesion;
  return { ok: true, formato: deteccion.descripcion, resultados };
}

/**
 * Importa un GeoPackage del consolidado de QGIS parseado EN EL NAVEGADOR
 * (sql.js): el server action recibe filas planas, nunca el binario, así el
 * .gpkg funciona en la web sin SQLite nativo en Vercel.
 */
export async function importarConsolidadoWeb(entrada: { archivo: string; filas: unknown }) {
  const sesion = await requerirRol("atencion_ciudadana", "planificacion", "informacion_estrategica");
  const datos = z
    .object({
      archivo: z.string().min(1).max(200),
      filas: z
        .array(
          z.object({
            id: z.union([z.number(), z.string()]),
            tipo: z.string().nullable(),
            ubicacion: z.string().nullable(),
            lat: z.number().nullable(),
            lon: z.number().nullable(),
            fuente: z.string(),
          }),
        )
        .min(1)
        // Con ~3 consultas secuenciales por fila, más que esto no entra en los
        // 60 s de Vercel: para archivos más grandes está la CLI local.
        .max(5000, "El GPKG tiene más de 5.000 filas: importalo con la CLI local (pnpm ingest:archivos)."),
    })
    .parse(entrada);

  // Una fila sin ID o sin FUENTE no aborta el lote: se omite y se informa.
  const validas = datos.filas.filter((f) => String(f.id).trim() !== "" && f.fuente.trim() !== "");
  const omitidas = datos.filas.length - validas.length;
  if (validas.length === 0) throw new Error("Ninguna fila tiene ID y FUENTE: no hay nada para importar.");

  const { mapearFilasConsolidado, ingestarDemandas, registrarSyncRun } = await import("@cimba/integrations");
  const demandas = mapearFilasConsolidado(validas, datos.archivo);
  const r = await ingestarDemandas("consolidado", demandas);
  await registrarSyncRun(r, null);

  revalidatePath("/mapa");
  revalidatePath("/demandas");
  void sesion;
  return {
    ok: true,
    formato: `GeoPackage consolidado (${datos.archivo})`,
    resultados: [
      `${r.leidos} demandas leídas: ${r.insertados} nuevas, ${r.actualizados} actualizadas, ${r.sinCambios} sin cambios, ${r.errores.length} errores`,
      ...(omitidas > 0 ? [`${omitidas} filas omitidas por no tener ID o FUENTE`] : []),
    ],
  };
}

// ── Carga manual de una demanda ──────────────────────────────────────────────

export async function crearDemandaManual(entrada: {
  lat: number;
  lon: number;
  tipo: string;
  descripcion: string;
  direccion: string;
}) {
  const sesion = await requerirRol("atencion_ciudadana", "informacion_estrategica", "planificacion");
  const datos = z
    .object({
      lat: z.number().min(-27.2).max(-26.4),
      lon: z.number().min(-65.6).max(-64.9),
      tipo: tipoProblemaSchema,
      descripcion: z.string().min(5).max(2000),
      direccion: z.string().min(3).max(300),
    })
    .parse(entrada);

  const id = await conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      insert into demandas (fuente, tipo, descripcion, direccion_texto, geom, geocod_confianza, creado_por)
      values ('carga_manual', ${datos.tipo}, ${datos.descripcion}, ${datos.direccion},
              st_setsrid(st_makepoint(${datos.lon}, ${datos.lat}), 4326), 1.0, ${sesion.sub})
      returning id
    `)) as unknown as Array<{ id: number }>;
    return filas[0]?.id;
  });
  revalidatePath("/demandas");
  revalidatePath("/mapa");
  return { ok: true, id };
}
