import { createHash } from "node:crypto";
import { getDb, sql } from "@cimba/db";
import type { DemandaNormalizada, IntervencionNormalizada } from "@cimba/domain";
import type { ResultadoIngesta } from "./tipos";

/**
 * Pipeline de ingesta: normalizado → staging → promoción.
 * Idempotente vía external_ref.payload_hash: re-importar el mismo archivo o
 * re-consultar la misma API no duplica ni pisa datos sin cambios.
 */

function hashPayload(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function geomSql(punto: { lat: number; lon: number } | null) {
  return punto
    ? sql`st_setsrid(st_makepoint(${punto.lon}, ${punto.lat}), 4326)`
    : sql`null`;
}

/**
 * postgres.js por la vía `unsafe()` (que usa drizzle en db.execute) no
 * serializa objetos Date: hay que pasar ISO strings (Postgres castea solo).
 */
function fechaParam(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function describirError(e: unknown): string {
  const partes: string[] = [];
  let actual: unknown = e;
  while (actual instanceof Error) {
    partes.push(actual.message.split("\n")[0] ?? actual.message);
    actual = actual.cause;
  }
  return partes.length > 0 ? partes[partes.length - 1]! : String(e);
}

export async function ingestarDemandas(
  sistema: string,
  demandas: DemandaNormalizada[],
): Promise<ResultadoIngesta> {
  const db = getDb();
  const r: ResultadoIngesta = {
    sistema,
    leidos: demandas.length,
    insertados: 0,
    actualizados: 0,
    sinCambios: 0,
    errores: [],
  };

  for (const d of demandas) {
    const hash = hashPayload(d);
    try {
      await db.execute(sql`
        insert into staging.registros (sistema, entidad, id_remoto, payload, payload_hash)
        values (${sistema}, 'demanda', ${d.idRemoto}, ${JSON.stringify(d)}::jsonb, ${hash})
        on conflict do nothing
      `);

      const existente = (await db.execute(sql`
        select id_local, payload_hash from external_ref
        where sistema = ${sistema} and entidad_local = 'demanda' and id_remoto = ${d.idRemoto}
      `)) as unknown as Array<{ id_local: number; payload_hash: string }>;

      if (existente.length > 0 && existente[0]) {
        if (existente[0].payload_hash === hash) {
          r.sinCambios++;
          continue;
        }
        // Una ubicación corregida a mano en el mapa NUNCA se pisa con la del
        // archivo: la corrección humana gana sobre cualquier re-importación.
        await db.execute(sql`
          update demandas set
            tipo = ${d.tipo},
            descripcion = ${d.descripcion},
            direccion_texto = ${d.direccionTexto},
            direccion_normalizada = case
              when metadata->>'ubicacion_corregida' = 'true' then direccion_normalizada
              else ${d.direccionNormalizada} end,
            geocod_confianza = case
              when metadata->>'ubicacion_corregida' = 'true' then geocod_confianza
              else ${d.geocodConfianza} end,
            geom = case
              when metadata->>'ubicacion_corregida' = 'true' then geom
              else ${geomSql(d.punto)} end,
            solicitante = ${d.solicitante},
            prioridad_informada = ${d.prioridadInformada},
            menciones = ${d.menciones},
            url_origen = ${d.urlOrigen},
            contacto = ${JSON.stringify(d.contacto)}::jsonb,
            metadata = ${JSON.stringify(d.metadata)}::jsonb ||
              case when metadata->>'ubicacion_corregida' = 'true'
                   then jsonb_build_object(
                          'ubicacion_corregida', metadata->'ubicacion_corregida',
                          'ubicacion_corregida_en', metadata->'ubicacion_corregida_en')
                   else '{}'::jsonb end
          where id = ${existente[0].id_local}
        `);
        await db.execute(sql`
          update external_ref set payload_hash = ${hash}, sincronizado_en = now()
          where sistema = ${sistema} and entidad_local = 'demanda' and id_remoto = ${d.idRemoto}
        `);
        r.actualizados++;
      } else {
        const insertado = (await db.execute(sql`
          insert into demandas (
            fuente, estado, tipo, descripcion, direccion_texto, direccion_normalizada,
            geocod_confianza, geom, distrito_id, contacto, solicitante,
            prioridad_informada, menciones, url_origen, creado_en, metadata
          ) values (
            ${d.fuente}, 'recibida', ${d.tipo}, ${d.descripcion}, ${d.direccionTexto},
            ${d.direccionNormalizada}, ${d.geocodConfianza}, ${geomSql(d.punto)},
            ${d.distritoId}, ${JSON.stringify(d.contacto)}::jsonb, ${d.solicitante},
            ${d.prioridadInformada}, ${d.menciones}, ${d.urlOrigen},
            coalesce(${fechaParam(d.creadoEn)}::timestamptz, now()), ${JSON.stringify(d.metadata)}::jsonb
          ) returning id
        `)) as unknown as Array<{ id: number }>;
        const nuevo = insertado[0];
        if (!nuevo) throw new Error("insert de demanda no devolvió id");
        await db.execute(sql`
          insert into external_ref (sistema, entidad_local, id_local, id_remoto, payload_hash)
          values (${sistema}, 'demanda', ${nuevo.id}, ${d.idRemoto}, ${hash})
        `);
        r.insertados++;
      }
    } catch (e) {
      r.errores.push({ idRemoto: d.idRemoto, error: describirError(e) });
    }
  }
  return r;
}

/**
 * Las intervenciones históricas (planillas de bacheo, obras SIGOV) llegan sin
 * incidente: se les crea uno con el estado coherente (reparado si la
 * intervención terminó) para conservar el modelo demanda→incidente→intervención.
 */
export async function ingestarIntervenciones(
  sistema: string,
  intervenciones: IntervencionNormalizada[],
): Promise<ResultadoIngesta> {
  const db = getDb();
  const r: ResultadoIngesta = {
    sistema,
    leidos: intervenciones.length,
    insertados: 0,
    actualizados: 0,
    sinCambios: 0,
    errores: [],
  };

  for (const iv of intervenciones) {
    const hash = hashPayload(iv);
    try {
      if (!iv.punto) {
        r.errores.push({ idRemoto: iv.idRemoto, error: "sin coordenadas válidas" });
        continue;
      }
      await db.execute(sql`
        insert into staging.registros (sistema, entidad, id_remoto, payload, payload_hash)
        values (${sistema}, 'intervencion', ${iv.idRemoto}, ${JSON.stringify(iv)}::jsonb, ${hash})
        on conflict do nothing
      `);

      const existente = (await db.execute(sql`
        select id_local, payload_hash from external_ref
        where sistema = ${sistema} and entidad_local = 'intervencion' and id_remoto = ${iv.idRemoto}
      `)) as unknown as Array<{ id_local: number; payload_hash: string }>;

      if (existente.length > 0 && existente[0]) {
        if (existente[0].payload_hash === hash) {
          r.sinCambios++;
          continue;
        }
        await db.execute(sql`
          update intervenciones set
            estado = ${iv.estado},
            iniciada_en = ${fechaParam(iv.iniciadaEn)}::timestamptz,
            finalizada_en = ${fechaParam(iv.finalizadaEn)}::timestamptz,
            superficie_m2 = ${iv.superficieM2},
            materiales = ${JSON.stringify(iv.materiales)}::jsonb,
            observaciones = ${iv.observaciones},
            metadata = ${JSON.stringify(iv.metadata)}::jsonb
          where id = ${existente[0].id_local}
        `);
        await db.execute(sql`
          update external_ref set payload_hash = ${hash}, sincronizado_en = now()
          where sistema = ${sistema} and entidad_local = 'intervencion' and id_remoto = ${iv.idRemoto}
        `);
        r.actualizados++;
      } else {
        const estadoIncidente =
          iv.estado === "finalizada" ? "reparado" : iv.estado === "en_curso" ? "en_ejecucion" : "programado";
        const incidente = (await db.execute(sql`
          insert into incidentes (tipo, estado, geom, direccion, superficie_m2, detectado_en, cerrado_en, metadata)
          values (
            ${iv.tipo}, ${estadoIncidente},
            st_setsrid(st_makepoint(${iv.punto.lon}, ${iv.punto.lat}), 4326),
            ${iv.direccionTexto}, ${iv.superficieM2},
            coalesce(${fechaParam(iv.iniciadaEn)}::timestamptz, now()),
            ${fechaParam(iv.estado === "finalizada" ? iv.finalizadaEn : null)}::timestamptz,
            ${JSON.stringify({ origen: sistema, geocod_confianza: iv.geocodConfianza })}::jsonb
          ) returning id
        `)) as unknown as Array<{ id: number }>;
        const inc = incidente[0];
        if (!inc) throw new Error("insert de incidente no devolvió id");

        const intervencion = (await db.execute(sql`
          insert into intervenciones (
            incidente_id, estado, geom_ejecucion, iniciada_en, finalizada_en,
            superficie_m2, materiales, observaciones, metadata
          ) values (
            ${inc.id}, ${iv.estado},
            st_setsrid(st_makepoint(${iv.punto.lon}, ${iv.punto.lat}), 4326),
            ${fechaParam(iv.iniciadaEn)}::timestamptz, ${fechaParam(iv.finalizadaEn)}::timestamptz, ${iv.superficieM2},
            ${JSON.stringify(iv.materiales)}::jsonb, ${iv.observaciones},
            ${JSON.stringify(iv.metadata)}::jsonb
          ) returning id
        `)) as unknown as Array<{ id: number }>;
        const nuevaIv = intervencion[0];
        if (!nuevaIv) throw new Error("insert de intervención no devolvió id");

        await db.execute(sql`
          insert into external_ref (sistema, entidad_local, id_local, id_remoto, payload_hash) values
          (${sistema}, 'intervencion', ${nuevaIv.id}, ${iv.idRemoto}, ${hash}),
          (${sistema}, 'incidente', ${inc.id}, ${iv.idRemoto}, ${hash})
        `);
        r.insertados++;
      }
    } catch (e) {
      r.errores.push({ idRemoto: iv.idRemoto, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return r;
}

export async function registrarSyncRun(
  r: ResultadoIngesta,
  desde: Date | null,
  /** Datos propios de la fuente (p. ej. hasta qué id llegó el barrido). */
  extra: Record<string, unknown> = {},
): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    insert into sync_runs (sistema, desde, hasta, leidos, insertados, actualizados, errores, detalle, finalizado_en)
    values (
      ${r.sistema}, ${fechaParam(desde)}::timestamptz, now(), ${r.leidos}, ${r.insertados}, ${r.actualizados},
      ${r.errores.length},
      ${JSON.stringify({ sinCambios: r.sinCambios, errores: r.errores.slice(0, 50), ...extra })}::jsonb,
      now()
    )
  `);
}

/**
 * Cursor del barrido de Atención Ciudadana: el mayor id_reclamo ya importado.
 * Sale de external_ref, que el pipeline llena por cada demanda promovida, así
 * que no hay estado extra que mantener sincronizado.
 *
 * Las demandas que entraron por archivo también dejaron su id_reclamo acá, así
 * que el barrido arranca donde terminó el export del Director (113362) en vez
 * de repetir histórico. `respaldo` solo se usa si external_ref está vacío.
 */
export async function cursorAtencionCiudadana(respaldo: number): Promise<number> {
  const filas = (await getDb().execute(sql`
    select
      (select max(case when id_remoto ~ '^[0-9]+$' then id_remoto::bigint end)
         from external_ref
        where sistema = 'atencion_ciudadana' and entidad_local = 'demanda') as importado,
      (select max(case when detalle->>'hastaId' ~ '^[0-9]+$'
                       then (detalle->>'hastaId')::bigint end)
         from sync_runs
        where sistema = 'atencion_ciudadana') as barrido
  `)) as unknown as Array<{ importado: string | number | null; barrido: string | number | null }>;
  const f = filas[0];
  // El máximo de los dos: un tramo entero puede no tener ni un reclamo de
  // pavimento, y mirando solo lo importado el cursor se quedaría clavado ahí,
  // repitiendo esos mismos ids en cada corrida del cron.
  return Math.max(
    f?.importado != null ? Number(f.importado) : respaldo,
    f?.barrido != null ? Number(f.barrido) : respaldo,
  );
}

/**
 * Fotos que viven en un sistema externo (hoy: Google Drive, de la app de las
 * empresas). No se descargan: se referencia la URL, que es pública y además
 * sirve miniaturas. Bajar 1.900 fotos para volver a subirlas a Storage costaría
 * varios GB sin ganar nada mientras la app de Google siga siendo la de carga.
 *
 * Idempotente por (intervencion_id, momento, url_externa): re-sincronizar no
 * duplica. La tabla no tiene índice único sobre eso, así que se comprueba antes
 * de insertar en vez de apoyarse en un ON CONFLICT que no existe.
 */
export async function guardarFotosExternas(
  sistema: string,
  fotos: Array<{
    idRemotoIntervencion: string;
    momento: "antes" | "durante" | "despues";
    urlExterna: string;
    lat: number | null;
    lon: number | null;
    tomadaEn: Date | null;
  }>,
): Promise<{ insertadas: number; yaEstaban: number; sinIntervencion: number }> {
  const db = getDb();
  const r = { insertadas: 0, yaEstaban: 0, sinIntervencion: 0 };

  for (const f of fotos) {
    /**
     * La misma fila de origen pudo entrar como intervención (hubo obra) o como
     * demanda (fue una detección). La tabla admite las dos: colgar la foto de
     * la demanda es lo que evita perder la evidencia de las pérdidas de agua y
     * las tapas rotas, que es justamente donde la foto más prueba.
     */
    const ref = (await db.execute(sql`
      select entidad_local, id_local from external_ref
      where sistema = ${sistema} and id_remoto = ${f.idRemotoIntervencion}
        and entidad_local in ('intervencion', 'demanda')
      order by case entidad_local when 'intervencion' then 0 else 1 end
      limit 1
    `)) as unknown as Array<{ entidad_local: string; id_local: number }>;
    const destino = ref[0];
    if (!destino) {
      r.sinIntervencion++;
      continue;
    }
    const esIv = destino.entidad_local === "intervencion";

    const previa = (await db.execute(sql`
      select id from fotografias
      where url_externa = ${f.urlExterna}
        and ${esIv ? sql`intervencion_id = ${destino.id_local}` : sql`demanda_id = ${destino.id_local}`}
    `)) as unknown as Array<{ id: number }>;
    if (previa.length > 0) {
      r.yaEstaban++;
      continue;
    }

    await db.execute(sql`
      insert into fotografias (intervencion_id, demanda_id, momento, url_externa, geom, tomada_en)
      values (
        ${esIv ? destino.id_local : null}, ${esIv ? null : destino.id_local},
        ${f.momento}, ${f.urlExterna},
        ${f.lat != null && f.lon != null
          ? sql`st_setsrid(st_makepoint(${f.lon}, ${f.lat}), 4326)`
          : sql`null`},
        ${fechaParam(f.tomadaEn)}::timestamptz
      )
    `);
    r.insertadas++;
  }
  return r;
}

/**
 * Descarta de un lote lo que ya está guardado sin cambios, comparando el hash
 * del payload contra external_ref en UNA sola consulta.
 *
 * Sin esto, una sincronización periódica de la planilla de empresas hace 1.038
 * viajes a la base solo para descubrir que no cambió nada: ~8 minutos por
 * corrida. Filtrando antes, una corrida sin novedades no escribe ni consulta
 * fila por fila, y el intervalo de 15 minutos deja de ser apretado.
 *
 * El hash tiene que calcularse igual que en la ingesta o todo parecería nuevo.
 */
export async function filtrarNovedades<T extends { idRemoto: string }>(
  sistema: string,
  entidad: "demanda" | "intervencion",
  items: T[],
): Promise<{ novedades: T[]; sinCambios: number }> {
  if (items.length === 0) return { novedades: [], sinCambios: 0 };
  const filas = (await getDb().execute(sql`
    select id_remoto, payload_hash from external_ref
    where sistema = ${sistema} and entidad_local = ${entidad}
  `)) as unknown as Array<{ id_remoto: string; payload_hash: string | null }>;

  const conocidos = new Map(filas.map((f) => [f.id_remoto, f.payload_hash]));
  const novedades = items.filter((i) => conocidos.get(i.idRemoto) !== hashPayload(i));
  return { novedades, sinCambios: items.length - novedades.length };
}

/**
 * Igual que arriba pero para las fotos externas, que no pasan por external_ref:
 * se comparan por URL, que es única por archivo de Drive.
 */
export async function filtrarFotosNuevas<T extends { urlExterna: string }>(
  fotos: T[],
): Promise<{ nuevas: T[]; yaEstaban: number }> {
  if (fotos.length === 0) return { nuevas: [], yaEstaban: 0 };
  const filas = (await getDb().execute(sql`
    select url_externa from fotografias where url_externa is not null
  `)) as unknown as Array<{ url_externa: string }>;
  const conocidas = new Set(filas.map((f) => f.url_externa));
  const nuevas = fotos.filter((f) => !conocidas.has(f.urlExterna));
  return { nuevas, yaEstaban: fotos.length - nuevas.length };
}
