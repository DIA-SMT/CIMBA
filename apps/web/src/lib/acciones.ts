"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql, type SQL } from "@cimba/db";
import { scorePriorizacion, tipoProblemaSchema, type TipoProblema } from "@cimba/domain";
import { requerirRol, type Sesion } from "./auth";

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona });

// ── Score de prioridad (recalculado en cada evento relevante) ───────────────

async function recalcularScore(tx: { execute: (q: SQL) => Promise<unknown> }, incidenteId: number) {
  const filas = (await tx.execute(sql`
    select i.tipo, i.direccion, i.detectado_en,
           (select count(*) from demanda_incidente di where di.demanda_id is not null and di.incidente_id = i.id) as demandas,
           (select coalesce(sum(coalesce(d.menciones, 0)), 0)
              from demanda_incidente di join demandas d on d.id = di.demanda_id
              where di.incidente_id = i.id) as menciones,
           (select min(d.prioridad_informada)
              from demanda_incidente di join demandas d on d.id = di.demanda_id
              where di.incidente_id = i.id) as prioridad_informada,
           (select count(*) from intervenciones iv
              where iv.incidente_id = i.id and iv.estado = 'finalizada') as previas
    from incidentes i where i.id = ${incidenteId}
  `)) as Array<Record<string, unknown>>;
  const f = filas[0];
  if (!f) return;
  const desglose = scorePriorizacion({
    demandasVinculadas: Number(f.demandas ?? 0),
    menciones: Number(f.menciones ?? 0),
    diasAbierto: Math.max(0, (Date.now() - new Date(String(f.detectado_en)).getTime()) / 86_400_000),
    prioridadInformada: f.prioridad_informada != null ? Number(f.prioridad_informada) : null,
    tipo: (f.tipo as TipoProblema) ?? null,
    intervencionesPrevias: Number(f.previas ?? 0),
    enCorredorPrincipal: /\bavenida\b|\bav\.?\s/i.test(String(f.direccion ?? "")),
  });
  await tx.execute(sql`
    update incidentes set score_prioridad = ${desglose.total},
      metadata = metadata || ${JSON.stringify({ score_desglose: desglose })}::jsonb
    where id = ${incidenteId}
  `);
}

// ── Bandeja de demandas ─────────────────────────────────────────────────────

export async function vincularDemanda(entrada: { demandaId: number; incidenteId: number; confianza?: number }) {
  const sesion = await requerirRol("atencion_ciudadana");
  const datos = z
    .object({ demandaId: z.number().int(), incidenteId: z.number().int(), confianza: z.number().min(0).max(1).optional() })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      insert into demanda_incidente (demanda_id, incidente_id, vinculado_por, automatico, confianza)
      values (${datos.demandaId}, ${datos.incidenteId}, ${sesion.sub}, false, ${datos.confianza ?? null})
      on conflict do nothing
    `);
    await tx.execute(sql`update demandas set estado = 'vinculada' where id = ${datos.demandaId}`);
    await recalcularScore(tx, datos.incidenteId);
  });
  revalidatePath("/demandas");
  revalidatePath("/incidentes");
  return { ok: true };
}

export async function crearIncidenteDesdeDemanda(entrada: { demandaId: number }) {
  const sesion = await requerirRol("atencion_ciudadana");
  const { demandaId } = z.object({ demandaId: z.number().int() }).parse(entrada);

  const incidenteId = await conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      insert into incidentes (tipo, estado, geom, direccion, distrito_id, creado_por, detectado_en)
      select coalesce(d.tipo, 'bache'::tipo_problema), 'detectado', d.geom,
             coalesce(d.direccion_normalizada, d.direccion_texto), d.distrito_id, ${sesion.sub}, d.creado_en
      from demandas d
      where d.id = ${demandaId} and d.geom is not null
      returning id
    `)) as unknown as Array<{ id: number }>;
    const inc = filas[0];
    if (!inc) throw new Error("La demanda no tiene ubicación válida: corregila antes de crear el incidente");
    await tx.execute(sql`
      insert into demanda_incidente (demanda_id, incidente_id, vinculado_por, automatico)
      values (${demandaId}, ${inc.id}, ${sesion.sub}, false)
    `);
    await tx.execute(sql`update demandas set estado = 'vinculada' where id = ${demandaId}`);
    await recalcularScore(tx, inc.id);
    return inc.id;
  });
  revalidatePath("/demandas");
  revalidatePath("/incidentes");
  return { ok: true, incidenteId };
}

export async function descartarDemanda(entrada: { demandaId: number; motivo: string }) {
  const sesion = await requerirRol("atencion_ciudadana");
  const datos = z.object({ demandaId: z.number().int(), motivo: z.string().min(3) }).parse(entrada);
  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      update demandas set estado = 'descartada',
        metadata = metadata || ${JSON.stringify({ motivo_descarte: datos.motivo })}::jsonb
      where id = ${datos.demandaId}
    `);
  });
  revalidatePath("/demandas");
  return { ok: true };
}

// ── Planificación ───────────────────────────────────────────────────────────

export async function priorizarIncidente(entrada: { incidenteId: number }) {
  const sesion = await requerirRol("planificacion");
  const { incidenteId } = z.object({ incidenteId: z.number().int() }).parse(entrada);
  await conRls(claims(sesion), async (tx) => {
    await recalcularScore(tx, incidenteId);
    await tx.execute(sql`
      update incidentes set estado = 'priorizado' where id = ${incidenteId} and estado = 'detectado'
    `);
  });
  revalidatePath("/incidentes");
  return { ok: true };
}

export async function programarIntervencion(entrada: { incidenteId: number; cuadrillaId: number }) {
  const sesion = await requerirRol("planificacion");
  const datos = z.object({ incidenteId: z.number().int(), cuadrillaId: z.number().int() }).parse(entrada);
  const intervencionId = await conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      insert into intervenciones (incidente_id, cuadrilla_id, estado)
      values (${datos.incidenteId}, ${datos.cuadrillaId}, 'asignada')
      returning id
    `)) as unknown as Array<{ id: number }>;
    await tx.execute(sql`
      update incidentes set estado = 'programado'
      where id = ${datos.incidenteId} and estado in ('detectado','priorizado')
    `);
    return filas[0]?.id;
  });
  revalidatePath("/incidentes");
  revalidatePath("/intervenciones");
  revalidatePath("/campo");
  return { ok: true, intervencionId };
}

// ── Campo (cuadrilla) ───────────────────────────────────────────────────────

export async function iniciarIntervencion(entrada: { intervencionId: number; lat?: number; lon?: number }) {
  const sesion = await requerirRol("cuadrilla", "planificacion", "supervision");
  const datos = z
    .object({ intervencionId: z.number().int(), lat: z.number().optional(), lon: z.number().optional() })
    .parse(entrada);
  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      update intervenciones set
        estado = 'en_curso',
        iniciada_en = coalesce(iniciada_en, now()),
        ejecutada_por = ${sesion.sub},
        geom_ejecucion = case
          when ${datos.lat ?? null}::float8 is not null
          then st_setsrid(st_makepoint(${datos.lon ?? null}, ${datos.lat ?? null}), 4326)
          else geom_ejecucion end
      where id = ${datos.intervencionId} and estado = 'asignada'
    `);
    await tx.execute(sql`
      update incidentes set estado = 'en_ejecucion'
      where id = (select incidente_id from intervenciones where id = ${datos.intervencionId})
        and estado in ('programado','priorizado','detectado')
    `);
  });
  revalidatePath("/campo");
  revalidatePath("/intervenciones");
  return { ok: true };
}

export async function subirFoto(formData: FormData) {
  const sesion = await requerirRol("cuadrilla", "planificacion", "supervision");
  const datos = z
    .object({
      intervencionId: z.coerce.number().int(),
      momento: z.enum(["antes", "durante", "despues"]),
      lat: z.coerce.number().optional(),
      lon: z.coerce.number().optional(),
    })
    .parse({
      intervencionId: formData.get("intervencionId"),
      momento: formData.get("momento"),
      lat: formData.get("lat") ?? undefined,
      lon: formData.get("lon") ?? undefined,
    });
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) throw new Error("Falta la foto");
  if (archivo.size > 8 * 1024 * 1024) throw new Error("La foto supera 8 MB");

  const extension = archivo.type === "image/png" ? "png" : "jpg";
  const ruta = `intervenciones/${datos.intervencionId}/${datos.momento}-${Date.now()}.${extension}`;

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );
  const subida = await supabase.storage
    .from("fotografias")
    .upload(ruta, Buffer.from(await archivo.arrayBuffer()), { contentType: archivo.type, upsert: false });
  if (subida.error) throw new Error(`Storage: ${subida.error.message}`);

  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      insert into fotografias (intervencion_id, momento, storage_path, geom, tomada_en)
      values (
        ${datos.intervencionId}, ${datos.momento}, ${ruta},
        case when ${datos.lat ?? null}::float8 is not null
             then st_setsrid(st_makepoint(${datos.lon ?? null}, ${datos.lat ?? null}), 4326)
             else null end,
        now()
      )
    `);
  });
  revalidatePath("/campo");
  return { ok: true, ruta };
}

export async function finalizarIntervencion(entrada: {
  intervencionId: number;
  superficieM2?: number;
  observaciones?: string;
}) {
  const sesion = await requerirRol("cuadrilla", "planificacion", "supervision");
  const datos = z
    .object({
      intervencionId: z.number().int(),
      superficieM2: z.number().positive().max(99999).optional(),
      observaciones: z.string().max(2000).optional(),
    })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    // Regla del vertical: no se cierra sin foto de antes y de después.
    const fotos = (await tx.execute(sql`
      select
        count(*) filter (where momento = 'antes') as antes,
        count(*) filter (where momento = 'despues') as despues
      from fotografias where intervencion_id = ${datos.intervencionId}
    `)) as unknown as Array<{ antes: string | number; despues: string | number }>;
    const f = fotos[0];
    if (!f || Number(f.antes) === 0 || Number(f.despues) === 0) {
      throw new Error("Para finalizar hacen falta la foto de ANTES y la de DESPUÉS");
    }
    await tx.execute(sql`
      update intervenciones set
        estado = 'finalizada',
        finalizada_en = now(),
        superficie_m2 = coalesce(${datos.superficieM2 ?? null}, superficie_m2),
        observaciones = coalesce(${datos.observaciones ?? null}, observaciones)
      where id = ${datos.intervencionId} and estado = 'en_curso'
    `);
    await tx.execute(sql`
      update incidentes set estado = 'reparado', cerrado_en = now()
      where id = (select incidente_id from intervenciones where id = ${datos.intervencionId})
        and estado = 'en_ejecucion'
    `);
  });
  revalidatePath("/campo");
  revalidatePath("/intervenciones");
  revalidatePath("/incidentes");
  return { ok: true };
}

// ── Formulario HCD ──────────────────────────────────────────────────────────

export async function crearDemandaHcd(entrada: {
  lat: number;
  lon: number;
  tipo: string;
  descripcion: string;
  direccion: string;
  solicitante: string;
  prioridad?: number;
}) {
  const sesion = await requerirRol("hcd");
  const datos = z
    .object({
      lat: z.number().min(-27.2).max(-26.4),
      lon: z.number().min(-65.6).max(-64.9),
      tipo: tipoProblemaSchema,
      descripcion: z.string().min(5).max(2000),
      direccion: z.string().min(3).max(300),
      solicitante: z.string().min(3).max(200),
      prioridad: z.number().int().min(1).max(5).optional(),
    })
    .parse(entrada);

  const id = await conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      insert into demandas (fuente, tipo, descripcion, direccion_texto, geom, geocod_confianza,
                            solicitante, prioridad_informada, creado_por)
      values ('hcd', ${datos.tipo}, ${datos.descripcion}, ${datos.direccion},
              st_setsrid(st_makepoint(${datos.lon}, ${datos.lat}), 4326), 1.0,
              ${datos.solicitante}, ${datos.prioridad ?? null}, ${sesion.sub})
      returning id
    `)) as unknown as Array<{ id: number }>;
    return filas[0]?.id;
  });
  revalidatePath("/demandas");
  return { ok: true, id };
}

// ── Supervisión ─────────────────────────────────────────────────────────────

export async function verificarIncidente(entrada: { incidenteId: number }) {
  const sesion = await requerirRol("supervision");
  const { incidenteId } = z.object({ incidenteId: z.number().int() }).parse(entrada);
  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      update incidentes set estado = 'verificado' where id = ${incidenteId} and estado = 'reparado'
    `);
  });
  revalidatePath("/incidentes");
  return { ok: true };
}

export async function corregirUbicacionDemanda(entrada: { demandaId: number; lat: number; lon: number }) {
  const sesion = await requerirRol("atencion_ciudadana");
  const datos = z
    .object({
      demandaId: z.number().int(),
      lat: z.number().min(-27.2).max(-26.4),
      lon: z.number().min(-65.6).max(-64.9),
    })
    .parse(entrada);
  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      update demandas set
        geom = st_setsrid(st_makepoint(${datos.lon}, ${datos.lat}), 4326),
        geocod_confianza = 1.0,
        distrito_id = null, -- el trigger la recalcula
        metadata = metadata || '{"ubicacion_corregida_manualmente": true}'::jsonb
      where id = ${datos.demandaId}
    `);
  });
  revalidatePath("/demandas");
  return { ok: true };
}
