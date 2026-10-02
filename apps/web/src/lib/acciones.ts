"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, getDb, sql, type SQL } from "@cimba/db";
import { scorePriorizacion, tipoProblemaSchema, type TipoProblema } from "@cimba/domain";
import { puedeVerContacto, requerirRol, type Sesion } from "./auth";
import { notificarRoles } from "./push";
import { ErrorVisible } from "./errores";
import { campoFechaEjecucion, instanteEjecucion } from "./fecha-ejecucion";

/** Lo único que se acepta subir al bucket público de fotos. */
const TIPOS_FOTO: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

// ── Score de prioridad (recalculado en cada evento relevante) ───────────────

export async function recalcularScore(tx: { execute: (q: SQL) => Promise<unknown> }, incidenteId: number) {
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

/**
 * CIERRE DIRECTO DESDE EL MAPA: vincular el pedido al arreglo que lo resolvió
 * y cerrarlo, en un solo paso, sin ir a la bandeja de Cierres.
 *
 * Las reglas son las MISMAS que las de Cierres, más las del cotejo del mapa:
 *  - Solo Atención Ciudadana (o admin): son los que le responden al vecino.
 *  - Solo pedidos de bacheo pendientes o vinculados. Los derivados a la SAT o
 *    a Ingeniería no se cierran con un bache ("no cierres lo del vecino con el
 *    reclamo derivado", Marcos).
 *  - Solo contra un problema YA reparado o verificado: el botón no existe para
 *    promesas.
 *  - No contra un arreglo ANTERIOR al pedido: eso es el bache que volvió, no la
 *    respuesta a este vecino.
 *  - No contra un problema que alguien ya marcó como "no es el mismo".
 *
 * Devuelve el teléfono y el mail del vecino (solo a quien puede verlos) para
 * abrir WhatsApp o el correo con la respuesta puesta. CIMBA no le manda nada
 * solo: el que envía es el operador.
 */
export async function cerrarPedidoDesdeMapa(entrada: { demandaId: number; incidenteId: number; respuesta?: string }) {
  const sesion = await requerirRol("atencion_ciudadana");
  const datos = z
    .object({
      demandaId: z.number().int().positive(),
      incidenteId: z.number().int().positive(),
      respuesta: z.string().max(1000).optional(),
    })
    .parse(entrada);

  const contacto = await conRls(claims(sesion), async (tx) => {
    const pedidos = (await tx.execute(sql`
      select d.estado::text as estado, coalesce(d.destino::text, 'bacheo') as destino,
             d.creado_en, (d.metadata->>'sin_fecha' = 'true') as sin_fecha,
             coalesce(d.metadata->'no_es_el_mismo', '[]'::jsonb) @> to_jsonb(${datos.incidenteId}::int) as descartado,
             d.contacto
      from demandas d where d.id = ${datos.demandaId}
    `)) as unknown as Array<{
      estado: string; destino: string; creado_en: string; sin_fecha: boolean | null;
      descartado: boolean; contacto: Record<string, unknown> | null;
    }>;
    const p = pedidos[0];
    if (!p) throw new ErrorVisible("El pedido no existe");
    if (!["recibida", "en_validacion", "vinculada"].includes(p.estado)) {
      throw new ErrorVisible("Este pedido ya no está abierto: alguien lo cerró o lo derivó");
    }
    if (p.destino !== "bacheo") {
      throw new ErrorVisible("Los pedidos derivados a la SAT o a Ingeniería no se cierran con un arreglo de bacheo");
    }
    if (p.descartado) {
      throw new ErrorVisible("Alguien ya marcó que ese arreglo no es el de este pedido");
    }

    const problemas = (await tx.execute(sql`
      select estado::text as estado, cerrado_en from incidentes where id = ${datos.incidenteId}
    `)) as unknown as Array<{ estado: string; cerrado_en: string | null }>;
    const pr = problemas[0];
    if (!pr) throw new ErrorVisible("El problema no existe");
    if (!["reparado", "verificado"].includes(pr.estado)) {
      throw new ErrorVisible("Solo se puede cerrar con un problema que ya esté reparado");
    }
    if (!p.sin_fecha && pr.cerrado_en && Date.parse(String(pr.cerrado_en)) < Date.parse(String(p.creado_en))) {
      throw new ErrorVisible("Ese arreglo es anterior al pedido: puede ser el bache que volvió, no la respuesta a este vecino");
    }

    await tx.execute(sql`
      insert into demanda_incidente (demanda_id, incidente_id, vinculado_por, automatico, confianza)
      values (${datos.demandaId}, ${datos.incidenteId}, ${sesion.sub}, false, null)
      on conflict do nothing
    `);
    await tx.execute(sql`
      update demandas set estado = 'cerrada',
        metadata = metadata || jsonb_build_object(
          'cierre', jsonb_build_object(
            'en', now()::text,
            'por', ${sesion.nombre}::text,
            'respuesta', ${datos.respuesta?.trim() || null}::text,
            'via', 'mapa',
            'incidente', ${datos.incidenteId}::int
          )
        )
      where id = ${datos.demandaId}
    `);
    await recalcularScore(tx, datos.incidenteId);
    return p.contacto;
  });

  revalidatePath("/cierres");
  revalidatePath("/demandas");
  revalidatePath("/incidentes");
  const verContacto = puedeVerContacto(sesion.rol_cimba);
  return {
    ok: true,
    telefono: verContacto && typeof contacto?.telefono === "string" ? contacto.telefono : null,
    email: verContacto && typeof contacto?.email === "string" ? contacto.email : null,
  };
}

/**
 * NO ES EL MISMO — lo contrario de vincular, que hasta ahora no existía.
 *
 * Las sugerencias salen por cercanía y tipo, y a 40 metros conviven el bache
 * de la esquina y el de media cuadra: son dos problemas distintos. Quien lo
 * sabe no tenía forma de decirlo. La fila seguía apareciendo cada vez que
 * alguien abría el reclamo, y la próxima persona volvía a dudar exactamente lo
 * mismo — o lo vinculaba mal, que es peor: el reclamo del vecino se cierra con
 * la reparación de OTRO bache y el suyo sigue ahí.
 *
 * Se guarda en la demanda y no en una tabla propia porque es una decisión
 * sobre ESTE reclamo: la lista de incidentes que ya se miraron y se
 * descartaron. Queda la traza de quién lo dijo y cuándo.
 */
export async function noEsElMismo(entrada: { demandaId: number; incidenteId: number; motivo?: string }) {
  const sesion = await requerirRol("atencion_ciudadana");
  const datos = z
    .object({
      demandaId: z.number().int().positive(),
      incidenteId: z.number().int().positive(),
      motivo: z.string().max(300).optional(),
    })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    const r = (await tx.execute(sql`
      update demandas set
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object(
               'no_es_el_mismo',
               coalesce(metadata->'no_es_el_mismo', '[]'::jsonb) || to_jsonb(${datos.incidenteId}::int))
          || jsonb_build_object(
               'no_es_el_mismo_detalle',
               coalesce(metadata->'no_es_el_mismo_detalle', '[]'::jsonb) || jsonb_build_array(
                 jsonb_build_object(
                   'incidente', ${datos.incidenteId}::int,
                   'por', ${sesion.nombre}::text,
                   'en', now()::text,
                   'motivo', ${datos.motivo?.trim() || null}::text)))
      where id = ${datos.demandaId}
      returning id
    `)) as unknown as Array<{ id: number }>;
    if (!r[0]) throw new ErrorVisible("El reclamo no existe");
    /* Si estaba vinculado a ese incidente, el vínculo se deshace: decir "no es
       el mismo" sobre algo que se vinculó por error tiene que poder
       desvincularlo, o la corrección no corrige nada. */
    await tx.execute(sql`
      delete from demanda_incidente
      where demanda_id = ${datos.demandaId} and incidente_id = ${datos.incidenteId}
    `);
    /* Y si ese era su único vínculo, el reclamo vuelve a estar sin vincular:
       dejarlo en 'vinculada' sin vínculo lo esconde de la bandeja de trabajo. */
    await tx.execute(sql`
      update demandas set estado = 'en_validacion'
      where id = ${datos.demandaId} and estado = 'vinculada'
        and not exists (select 1 from demanda_incidente di where di.demanda_id = demandas.id)
    `);
    await recalcularScore(tx, datos.incidenteId);
  });

  revalidatePath(`/demandas/${datos.demandaId}`);
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
    if (!inc) throw new ErrorVisible("La demanda no tiene ubicación válida: corregila antes de crear el incidente");
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
  // Push a las cuadrillas suscriptas (best-effort: nunca bloquea la acción)
  void notificarRoles(["cuadrilla"], {
    titulo: "CIMBA · nueva intervención",
    cuerpo: "Se programó un trabajo para tu cuadrilla. Abrí Campo para verlo.",
    url: "/campo",
    tag: "intervencion-programada",
  }).catch(() => {});
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
  if (!(archivo instanceof File) || archivo.size === 0) throw new ErrorVisible("Falta la foto");
  if (archivo.size > 8 * 1024 * 1024) throw new ErrorVisible("La foto supera 8 MB");
  /**
   * El tipo lo fija el SERVIDOR desde una lista cerrada, no lo que declare el
   * cliente. El bucket "fotografias" es público: un archivo subido con
   * content-type text/html se serviría como página activa desde el origen de
   * Storage del municipio. Es la misma whitelist que ya usaban las otras
   * cuatro acciones que suben fotos; esta se había quedado afuera.
   */
  const extension = TIPOS_FOTO[archivo.type];
  if (!extension) {
    throw new ErrorVisible("La foto tiene que ser una imagen JPG, PNG o WEBP sacada con la cámara");
  }
  const ruta = `intervenciones/${datos.intervencionId}/${datos.momento}-${Date.now()}.${extension}`;

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );
  const subida = await supabase.storage
    .from("fotografias")
    .upload(ruta, Buffer.from(await archivo.arrayBuffer()), {
      // El tipo de la whitelist, no el del cliente.
      contentType: Object.keys(TIPOS_FOTO).find((t) => TIPOS_FOTO[t] === extension),
      upsert: false,
    });
  if (subida.error) throw new ErrorVisible(`Storage: ${subida.error.message}`);

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
  /** Día real del trabajo, 'YYYY-MM-DD'. Sin esto, hoy. Ver fecha-ejecucion.ts. */
  fechaEjecucion?: string;
}) {
  const sesion = await requerirRol("cuadrilla", "planificacion", "supervision");
  const datos = z
    .object({
      intervencionId: z.number().int(),
      superficieM2: z.number().positive().max(99999).optional(),
      observaciones: z.string().max(2000).optional(),
      fechaEjecucion: campoFechaEjecucion,
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
      throw new ErrorVisible("Para finalizar hacen falta la foto de ANTES y la de DESPUÉS");
    }
    /**
     * El trabajo se fecha el día en que SE HIZO, no el día en que se carga.
     * El límite inferior es el inicio de la intervención: cerrarla antes de
     * haberla empezado no existe.
     */
    const iniciada = (await tx.execute(sql`
      select (iniciada_en at time zone 'America/Argentina/Tucuman')::date::text as d
      from intervenciones where id = ${datos.intervencionId}
    `)) as unknown as Array<{ d: string | null }>;
    const cuando = instanteEjecucion(datos.fechaEjecucion, {
      fecha: iniciada[0]?.d ?? null,
      que: "el día en que se inició el trabajo",
    });

    await tx.execute(sql`
      update intervenciones set
        estado = 'finalizada',
        finalizada_en = ${cuando},
        superficie_m2 = coalesce(${datos.superficieM2 ?? null}, superficie_m2),
        observaciones = coalesce(${datos.observaciones ?? null}, observaciones),
        -- Queda escrito que la fecha la puso una persona: un acta con fechas
        -- cargadas a mano tiene que poder distinguirse de una automática.
        metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
          datos.fechaEjecucion
            ? { fecha_manual: { por: sesion.nombre, en: new Date().toISOString(), fecha: datos.fechaEjecucion } }
            : {},
        )}::jsonb
      where id = ${datos.intervencionId} and estado = 'en_curso'
    `);
    await tx.execute(sql`
      update incidentes set estado = 'reparado', cerrado_en = ${cuando}
      where id = (select incidente_id from intervenciones where id = ${datos.intervencionId})
        and estado = 'en_ejecucion'
    `);
  });
  revalidatePath("/campo");
  revalidatePath("/intervenciones");
  revalidatePath("/incidentes");
  return { ok: true };
}

/**
 * Pedido de un ciudadano cargado por el personal: la carga presencial o
 * telefónica de un vecino (mostrador, 147 derivado, llamado directo). Entra
 * como demanda con fuente 'carga_manual', canal 'presencial' y el
 * área/distrito en metadata.
 */
export async function crearDemandaCiudadano(formData: FormData) {
  // atencion_ciudadana incluida: es justamente quien atiende al vecino en
  // mostrador y por teléfono.
  const sesion = await requerirRol("funcionario", "planificacion", "supervision", "atencion_ciudadana");
  const datos = z
    .object({
      lat: z.coerce.number().min(-27.2).max(-26.4),
      lon: z.coerce.number().min(-65.6).max(-64.9),
      tipo: tipoProblemaSchema,
      descripcion: z.string().min(5).max(2000),
      direccion: z.string().min(3).max(300),
      solicitante: z.string().min(3).max(200),
      area: z.string().min(2).max(200),
      desdeGps: z.coerce.boolean().optional(),
    })
    .parse({
      lat: formData.get("lat"),
      lon: formData.get("lon"),
      tipo: formData.get("tipo"),
      descripcion: formData.get("descripcion"),
      direccion: formData.get("direccion"),
      solicitante: formData.get("solicitante"),
      area: formData.get("area"),
      desdeGps: formData.get("desdeGps") || undefined,
    });

  /**
   * LAS FOTOS DEL VECINO. Hasta acá el pedido presencial era solo texto: el
   * vecino llegaba al mostrador con la foto en el teléfono y no había dónde
   * ponerla. Dos, porque una sola rara vez alcanza — la del pozo de cerca y la
   * de la cuadra para ubicarlo.
   *
   * Opcionales a propósito: el pedido por teléfono no tiene foto y no por eso
   * vale menos. Y el tipo lo fija el servidor desde una whitelist, no el
   * cliente: el bucket es público y un .html con content-type text/html se
   * serviría como página activa desde el origen de Storage municipal.
   */
  const fotos: File[] = [];
  for (const clave of ["foto1", "foto2"]) {
    const f = formData.get(clave);
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > 8 * 1024 * 1024) throw new ErrorVisible("Cada foto tiene que pesar menos de 8 MB");
    if (!TIPOS_FOTO[f.type]) throw new ErrorVisible("Las fotos tienen que ser imágenes (JPG, PNG o WEBP)");
    fotos.push(f);
  }

  const metadata = {
    origen: "pedido_ciudadano",
    canal: "presencial",
    area: datos.area,
    desde_gps: datos.desdeGps ?? false,
  };
  const id = await conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      insert into demandas (fuente, tipo, descripcion, direccion_texto, geom, geocod_confianza,
                            solicitante, creado_por, metadata)
      values ('carga_manual', ${datos.tipo}, ${datos.descripcion}, ${datos.direccion},
              st_setsrid(st_makepoint(${datos.lon}, ${datos.lat}), 4326), 1.0,
              ${datos.solicitante}, ${sesion.sub}, ${JSON.stringify(metadata)}::jsonb)
      returning id
    `)) as unknown as Array<{ id: number }>;
    return filas[0]?.id;
  });

  /**
   * Las fotos van DESPUÉS del insert y fuera de la transacción: necesitan el
   * id de la demanda para colgarse de ella, y si Storage falla el pedido del
   * vecino ya quedó registrado igual. Perder la foto es malo; perder el
   * reclamo entero porque no se pudo subir una imagen es peor.
   */
  if (id != null && fotos.length > 0) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      );
      for (const [i, foto] of fotos.entries()) {
        const ruta = `ciudadano/${id}/${Date.now()}-${i}.${TIPOS_FOTO[foto.type]}`;
        const subida = await supabase.storage
          .from("fotografias")
          .upload(ruta, Buffer.from(await foto.arrayBuffer()), { contentType: foto.type, upsert: false });
        if (subida.error) continue;
        await getDb().execute(sql`
          insert into fotografias (demanda_id, momento, storage_path, geom, tomada_en)
          values (${id}, 'antes', ${ruta},
                  st_setsrid(st_makepoint(${datos.lon}, ${datos.lat}), 4326), now())
        `);
      }
    } catch {
      // el pedido ya está registrado: la foto se puede volver a subir después
    }
  }

  revalidatePath("/demandas");
  return { ok: true, id, fotos: fotos.length };
}

/**
 * Corrección de ubicación arrastrando el punto en el mapa (el reemplazo del
 * ajuste manual que se hacía en QGIS). Deja constancia en metadata y sube la
 * confianza a 1.0: la puso una persona mirando el mapa.
 */
export async function corregirUbicacionDemanda(entrada: {
  demandaId: number;
  lat: number;
  lon: number;
  direccion?: string;
}) {
  const sesion = await requerirRol("atencion_ciudadana", "planificacion", "informacion_estrategica");
  const datos = z
    .object({
      demandaId: z.number().int().positive(),
      lat: z.number().min(-27.2).max(-26.4),
      lon: z.number().min(-65.6).max(-64.9),
      direccion: z.string().min(3).max(300).optional(),
    })
    .parse(entrada);

  const marca = JSON.stringify({
    ubicacion_corregida: true,
    ubicacion_corregida_en: new Date().toISOString(),
  });
  await conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      update demandas set
        geom = st_setsrid(st_makepoint(${datos.lon}, ${datos.lat}), 4326),
        geocod_confianza = 1.0,
        direccion_normalizada = coalesce(${datos.direccion ?? null}, direccion_normalizada),
        /**
         * Las TRES pertenencias territoriales se recalculan, igual que hace la
         * corrección por lote (acciones-pines.ts). Antes solo se anulaba el
         * distrito: el reclamo se movía de lugar pero seguía contando en el
         * barrio y el circuito viejos, así que la deuda por territorio, la
         * asignación de circuito y el parte diario lo sumaban donde ya no
         * estaba. Se calculan acá y no dejándolas en NULL para el trigger: el
         * resultado no depende del orden en que corran. Y se usan las funciones
         * distrito_de/circuito_de/barrio_de (migración 0031) en vez de
         * st_contains, que rechaza el punto que cae justo sobre el límite —
         * el bache de la avenida que separa dos distritos quedaba sin ninguno.
         */
        distrito_id = distrito_de(st_setsrid(st_makepoint(${datos.lon}, ${datos.lat}), 4326)),
        circuito_id = circuito_de(st_setsrid(st_makepoint(${datos.lon}, ${datos.lat}), 4326)),
        barrio_id = barrio_de(st_setsrid(st_makepoint(${datos.lon}, ${datos.lat}), 4326)),
        metadata = metadata || ${marca}::jsonb
      where id = ${datos.demandaId}
      returning id
    `)) as unknown as Array<{ id: number }>;
    // Con RLS efectivo un update sin permiso matchea 0 filas: nunca "ok" falso.
    if (filas.length === 0) throw new ErrorVisible("No se pudo actualizar la demanda (no existe o sin permiso).");
  });
  revalidatePath(`/demandas/${datos.demandaId}`);
  revalidatePath("/demandas");
  revalidatePath("/mapa");
  return { ok: true };
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

/**
 * DESHACER UNA VERIFICACIÓN.
 *
 * "Si verifiqué algo que no corresponde, que pueda cancelarlo" — pedido de la
 * Dirección de Bacheo (12/09). Verificar era un camino de una sola dirección:
 * un clic de más sobre la fila equivocada dejaba el bache marcado como
 * controlado en campo para siempre, y 'verificado' es el único estado que el
 * resto del sistema trata como intocable (finalizarIntervencion y
 * marcarYaResuelto lo respetan explícitamente).
 *
 * Vuelve a 'reparado', que es de donde vino: el trabajo sigue hecho, lo que se
 * deshace es el control. El motivo queda en metadata y el cambio de estado lo
 * registra el trigger auditar(), así que "quién lo desverificó y por qué" se
 * puede contestar.
 */
export async function desverificarIncidente(entrada: { incidenteId: number; motivo: string }) {
  const sesion = await requerirRol("supervision");
  const datos = z
    .object({ incidenteId: z.number().int().positive(), motivo: z.string().min(3).max(500) })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    const r = (await tx.execute(sql`
      update incidentes set estado = 'reparado',
        metadata = metadata || ${JSON.stringify({
          verificacion_deshecha: {
            por: sesion.nombre,
            en: new Date().toISOString(),
            motivo: datos.motivo,
          },
        })}::jsonb
      where id = ${datos.incidenteId} and estado = 'verificado'
      returning id
    `)) as unknown as Array<{ id: number }>;
    if (!r[0]) throw new ErrorVisible("Este incidente no está verificado");
  });
  revalidatePath("/incidentes");
  revalidatePath("/calidad");
  return { ok: true };
}

