import { conRls, sql } from "@cimba/db";
import { MUESTREO_MINIMO_PCT } from "@cimba/domain";
import type { Sesion } from "./auth";

/**
 * CERTIFICACIÓN Y CONTROL DE CALIDAD
 *
 * Dos regímenes del protocolo de la DOV que hoy no viven en ningún sistema:
 *
 * 1. CONTROL POST-EJECUCIÓN por muestreo aleatorio, sobre baches ya cerrados:
 *      24 h  · nivel respecto del pavimento, terminación de bordes y sellado
 *      30 d  · adherencia, fisuración temprana y asentamiento
 *      90 d  · chequeo aleatorio del 10% de los baches del período
 *      6 m   · chequeo aleatorio del 10% de los baches del período
 *    Aplica a las empresas Y a las cuadrillas propias.
 *
 * 2. ACTA DE MEDICIÓN CONJUNTA: sin acta firmada, lo que informa la
 *    contratista no se certifica a los fines del pago. Arranca midiendo el
 *    100% de los puntos las primeras cuatro semanas, después pasa a muestreo
 *    de al menos el 20%, y vuelve al 100% si se detecta más de 5% de
 *    desviación entre lo informado y lo medido.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

export const REGIMEN = {
  semanasMedicionTotal: 4,
  muestreoMinimoPct: MUESTREO_MINIMO_PCT,
  desviacionQueObligaTotal: 5,
  muestreoDiferidoPct: 10,
} as const;

export const VENTANA_INSPECCION: Record<string, { desde: string; hasta: string; mira: string }> = {
  "24h": { desde: "24 hours", hasta: "7 days", mira: "nivel respecto del pavimento, terminación de bordes y sellado" },
  "30d": { desde: "30 days", hasta: "45 days", mira: "adherencia, fisuración temprana y asentamiento" },
  "90d": { desde: "90 days", hasta: "120 days", mira: "chequeo aleatorio del 10% del período" },
  "6m": { desde: "6 months", hasta: "7 months", mira: "chequeo aleatorio del 10% del período" },
};

export interface InspeccionPendiente {
  intervencionId: number;
  ordenItemId: number | null;
  momento: "24h" | "30d" | "90d" | "6m";
  direccion: string | null;
  ejecutor: string | null;
  superficieM2: number | null;
  finalizadaEn: string;
  diasDesde: number;
  lat: number | null;
  lon: number | null;
}

/**
 * Qué toca inspeccionar. No hay tabla de tareas programadas: la cola se
 * deriva de la fecha de cada reparación y de lo que YA se inspeccionó. Para
 * los chequeos diferidos (90 días y 6 meses) el protocolo pide el 10% del
 * período: el sorteo se hace por el id de la intervención, así es estable
 * (no cambia de una consulta a otra) y auditable (cualquiera lo reproduce).
 */
export async function inspeccionesPendientes(sesion: Sesion, limite = 120): Promise<InspeccionPendiente[]> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      with reparaciones as (
        select iv.id, iv.finalizada_en, iv.superficie_m2, iv.geom_ejecucion,
               oi.id as item_id, oi.direccion,
               coalesce(e.nombre, iv.metadata->>'contratista') as ejecutor
        from intervenciones iv
        left join orden_items oi on oi.intervencion_id = iv.id
        left join ordenes_trabajo ot on ot.id = oi.orden_id
        left join empresas e on e.id = ot.empresa_id
        where iv.estado = 'finalizada' and iv.finalizada_en is not null
          and coalesce(iv.tipo_intervencion::text, 'bacheo') = 'bacheo'
      ),
      debidas as (
        select r.*, m.momento
        from reparaciones r
        cross join lateral (values
          ('24h', interval '24 hours', interval '7 days',  true),
          ('30d', interval '30 days',  interval '45 days', true),
          ('90d', interval '90 days',  interval '120 days', (r.id % 10) = 0),
          ('6m',  interval '6 months', interval '7 months', (r.id % 10) = 3)
        ) as m(momento, desde, hasta, entra_en_muestra)
        where m.entra_en_muestra
          and now() >= r.finalizada_en + m.desde
          and now() <= r.finalizada_en + m.hasta
      )
      select d.id, d.item_id, d.momento, d.direccion, d.ejecutor, d.superficie_m2,
             d.finalizada_en,
             extract(day from now() - d.finalizada_en)::int as dias,
             st_y(d.geom_ejecucion) as lat, st_x(d.geom_ejecucion) as lon
      from debidas d
      where not exists (
        select 1 from inspecciones_calidad ic
        where ic.intervencion_id = d.id and ic.momento::text = d.momento
      )
      order by d.finalizada_en
      limit ${limite}
    `)) as unknown as Array<Record<string, unknown>>;

    return filas.map((f) => ({
      intervencionId: Number(f.id),
      ordenItemId: f.item_id != null ? Number(f.item_id) : null,
      momento: String(f.momento) as InspeccionPendiente["momento"],
      direccion: (f.direccion as string) ?? null,
      ejecutor: (f.ejecutor as string) ?? null,
      superficieM2: f.superficie_m2 != null ? Number(f.superficie_m2) : null,
      finalizadaEn: String(f.finalizada_en),
      diasDesde: Number(f.dias ?? 0),
      lat: f.lat != null ? Number(f.lat) : null,
      lon: f.lon != null ? Number(f.lon) : null,
    }));
  });
}

/**
 * Cuántas inspecciones se deben por momento. Va aparte de la cola porque la
 * cola viene topeada: mostrar el largo de la página como si fuera el total
 * le mentiría al inspector sobre cuánto le falta.
 */
export async function conteoInspecciones(sesion: Sesion): Promise<Record<string, number>> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      with reparaciones as (
        select iv.id, iv.finalizada_en
        from intervenciones iv
        where iv.estado = 'finalizada' and iv.finalizada_en is not null
          and coalesce(iv.tipo_intervencion::text, 'bacheo') = 'bacheo'
      ),
      debidas as (
        select r.id, m.momento
        from reparaciones r
        cross join lateral (values
          ('24h', interval '24 hours', interval '7 days',  true),
          ('30d', interval '30 days',  interval '45 days', true),
          ('90d', interval '90 days',  interval '120 days', (r.id % 10) = 0),
          ('6m',  interval '6 months', interval '7 months', (r.id % 10) = 3)
        ) as m(momento, desde, hasta, entra_en_muestra)
        where m.entra_en_muestra
          and now() >= r.finalizada_en + m.desde
          and now() <= r.finalizada_en + m.hasta
      )
      select d.momento, count(*)::int as n
      from debidas d
      where not exists (
        select 1 from inspecciones_calidad ic
        where ic.intervencion_id = d.id and ic.momento::text = d.momento
      )
      group by d.momento
    `)) as unknown as Array<{ momento: string; n: number }>;
    return Object.fromEntries(filas.map((f) => [f.momento, Number(f.n)]));
  });
}

/**
 * QUÉ PUEDE ENTRAR EN UN ACTA: el trabajo hecho, que todavía no está en
 * ninguna y que tiene la foto del DESPUÉS. La foto es la evidencia sobre la que
 * se mide en el acta conjunta. Un trabajo cargado desde una planilla (Ingeco,
 * septiembre de 2026) entra hecho pero sin foto, y no se certifica hasta que la
 * empresa la suba desde su portal.
 *
 * Al 13/10/2026 los 391 hechos sin acta tenían todos su foto del después: la
 * regla no cambió nada de lo que ya estaba cargado.
 *
 * Es el mismo fragmento en todas las consultas que dicen "sin certificar"
 * (supervisión, la empresa y la firma del acta). Si cambia acá, cambia en
 * todas; usa el alias `oi` de orden_items.
 */
export const CERTIFICABLE = sql`(oi.estado = 'hecho' and oi.acta_id is null and exists (
  select 1 from fotografias f_acta
  where f_acta.intervencion_id = oi.intervencion_id and f_acta.momento = 'despues'))`;

/** Hecho y sin acta, pero sin la foto del después: le falta completarlo a la empresa. */
export const FALTA_FOTO = sql`(oi.estado = 'hecho' and oi.acta_id is null and not exists (
  select 1 from fotografias f_acta
  where f_acta.intervencion_id = oi.intervencion_id and f_acta.momento = 'despues'))`;

export interface RegimenEmpresa {
  empresaId: number;
  empresa: string;
  /** 'total' mientras esté en las primeras semanas o venga de una desviación alta. */
  modalidad: "total" | "muestreo";
  motivo: string;
  itemsSinCertificar: number;
  m2SinCertificar: number;
  /** Toneladas de asfalto sin certificar: la unidad con la que se paga. */
  tnSinCertificar: number;
  /** Hechos que no entran al acta porque les falta la foto del después. */
  itemsFaltaFoto: number;
  tnFaltaFoto: number;
  ultimaActa: string | null;
  ultimaDesviacion: number | null;
}

/**
 * En qué régimen de medición está cada ejecutor y cuánto tiene sin certificar.
 * Es la respuesta a "¿esto se puede pagar?": lo que no pasó por acta no se
 * certifica, por más que esté cargado y con foto.
 */
export async function regimenPorEmpresa(sesion: Sesion): Promise<RegimenEmpresa[]> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select e.id, e.nombre,
        (select count(*) from orden_items oi
          join ordenes_trabajo ot on ot.id = oi.orden_id
          where ot.empresa_id = e.id and ${CERTIFICABLE})::int as sin_certificar,
        coalesce((select sum(oi.superficie_m2) from orden_items oi
          join ordenes_trabajo ot on ot.id = oi.orden_id
          where ot.empresa_id = e.id and ${CERTIFICABLE}), 0) as m2_sin,
        /* La tonelada es la unidad con la que se firma el acta: volumen
           (columna generada) por la densidad de la mezcla, 2,4 t/m³. */
        coalesce((select sum(oi.volumen_m3) * 2.4 from orden_items oi
          join ordenes_trabajo ot on ot.id = oi.orden_id
          where ot.empresa_id = e.id and ${CERTIFICABLE}), 0) as tn_sin,
        (select count(*) from orden_items oi
          join ordenes_trabajo ot on ot.id = oi.orden_id
          where ot.empresa_id = e.id and ${FALTA_FOTO})::int as falta_foto,
        coalesce((select sum(oi.volumen_m3) * 2.4 from orden_items oi
          join ordenes_trabajo ot on ot.id = oi.orden_id
          where ot.empresa_id = e.id and ${FALTA_FOTO}), 0) as tn_falta_foto,
        (select max(a.fecha) from actas_medicion a
          where a.empresa_id = e.id and a.estado = 'firmada') as ultima_acta,
        (select min(a.fecha) from actas_medicion a
          where a.empresa_id = e.id and a.estado = 'firmada') as primera_acta,
        (select a.desviacion_pct from actas_medicion a
          where a.empresa_id = e.id and a.estado = 'firmada'
          order by a.fecha desc limit 1) as ultima_desviacion
      from empresas e
      where e.activa
      order by e.nombre
    `)) as unknown as Array<Record<string, unknown>>;

    return filas.map((f) => {
      const primera = f.primera_acta ? new Date(String(f.primera_acta)) : null;
      const desviacion = f.ultima_desviacion != null ? Number(f.ultima_desviacion) : null;
      const semanas = primera ? (Date.now() - primera.getTime()) / (7 * 24 * 3600 * 1000) : 0;

      let modalidad: "total" | "muestreo" = "total";
      let motivo: string;
      if (!primera) {
        motivo = `todavía no hay actas firmadas: se mide el 100% las primeras ${REGIMEN.semanasMedicionTotal} semanas`;
      } else if (desviacion != null && desviacion > REGIMEN.desviacionQueObligaTotal) {
        motivo = `la última acta dio ${desviacion.toFixed(1)}% de desviación (más de ${REGIMEN.desviacionQueObligaTotal}%): vuelve a medición total`;
      } else if (semanas < REGIMEN.semanasMedicionTotal) {
        motivo = `arrancó hace ${Math.floor(semanas)} semanas: medición total hasta la cuarta`;
      } else {
        modalidad = "muestreo";
        motivo = `régimen normal: muestreo aleatorio de al menos ${REGIMEN.muestreoMinimoPct}% de los puntos`;
      }

      return {
        empresaId: Number(f.id),
        empresa: String(f.nombre),
        modalidad,
        motivo,
        itemsSinCertificar: Number(f.sin_certificar ?? 0),
        m2SinCertificar: Number(f.m2_sin ?? 0),
        tnSinCertificar: Number(f.tn_sin ?? 0),
        itemsFaltaFoto: Number(f.falta_foto ?? 0),
        tnFaltaFoto: Number(f.tn_falta_foto ?? 0),
        ultimaActa: f.ultima_acta != null ? String(f.ultima_acta) : null,
        ultimaDesviacion: desviacion,
      };
    });
  });
}

export interface ActaResumen {
  id: number;
  numero: string;
  empresa: string;
  fecha: string;
  estado: string;
  modalidad: string;
  puntosInformados: number;
  puntosMedidos: number;
  m2Informados: number;
  m2Medidos: number;
  desviacionPct: number | null;
}

export async function listarActas(sesion: Sesion, limite = 40): Promise<ActaResumen[]> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select a.id, a.numero, e.nombre as empresa, a.fecha, a.estado::text, a.modalidad,
             a.puntos_informados, a.puntos_medidos, a.m2_informados, a.m2_medidos, a.desviacion_pct
      from actas_medicion a join empresas e on e.id = a.empresa_id
      order by a.fecha desc, a.id desc limit ${limite}
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => ({
      id: Number(f.id),
      numero: String(f.numero),
      empresa: String(f.empresa),
      fecha: String(f.fecha),
      estado: String(f.estado),
      modalidad: String(f.modalidad),
      puntosInformados: Number(f.puntos_informados ?? 0),
      puntosMedidos: Number(f.puntos_medidos ?? 0),
      m2Informados: Number(f.m2_informados ?? 0),
      m2Medidos: Number(f.m2_medidos ?? 0),
      desviacionPct: f.desviacion_pct != null ? Number(f.desviacion_pct) : null,
    }));
  });
}

// ── El acta de medición: lo que entra y cómo quedó ───────────────────────────

/** Un punto que cargó la empresa y todavía no pasó por acta. */
export interface PuntoParaActa {
  itemId: number;
  ordenId: number;
  ordenNumero: string;
  direccion: string | null;
  reportadoEn: string | null;
  anchoM: number | null;
  largoM: number | null;
  espesorCm: number | null;
  /** Lo que informó la empresa: es lo que se contrasta con lo medido. */
  m2Informado: number;
  /** Ya lo revisó un inspector en «Control de lo cargado». */
  revisado: boolean;
  fotos: Array<{ momento: string; storagePath: string | null; urlExterna: string | null }>;
  lat: number | null;
  lon: number | null;
}

/**
 * Los puntos de una empresa en condiciones de entrar en un acta: hechos,
 * sin acta y vigentes (lo dado de baja ya no está "hecho"). Del más viejo al
 * más nuevo, orden por orden: es como se recorre en la calle.
 */
export async function puntosParaActa(sesion: Sesion, empresaId: number): Promise<PuntoParaActa[]> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select oi.id, oi.orden_id, ot.numero, oi.direccion, oi.reportado_en,
             oi.ancho_m, oi.largo_m, oi.espesor_cm, coalesce(oi.superficie_m2, 0) as m2,
             (oi.metadata ? 'control') as revisado,
             st_y(st_centroid(oi.geom)) as lat, st_x(st_centroid(oi.geom)) as lon,
             coalesce((
               select json_agg(json_build_object(
                        'momento', f.momento, 'storagePath', f.storage_path, 'urlExterna', f.url_externa)
                      order by f.momento)
               from fotografias f where f.intervencion_id = oi.intervencion_id
             ), '[]'::json) as fotos
      from orden_items oi
      join ordenes_trabajo ot on ot.id = oi.orden_id
      where ot.empresa_id = ${empresaId}
        and ${CERTIFICABLE}
      order by ot.numero, oi.reportado_en nulls last, oi.id
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => ({
      itemId: Number(f.id),
      ordenId: Number(f.orden_id),
      ordenNumero: String(f.numero),
      direccion: (f.direccion as string) ?? null,
      reportadoEn: f.reportado_en != null ? new Date(String(f.reportado_en)).toISOString() : null,
      anchoM: f.ancho_m != null ? Number(f.ancho_m) : null,
      largoM: f.largo_m != null ? Number(f.largo_m) : null,
      espesorCm: f.espesor_cm != null ? Number(f.espesor_cm) : null,
      m2Informado: Number(f.m2 ?? 0),
      revisado: Boolean(f.revisado),
      fotos: (f.fotos as PuntoParaActa["fotos"]) ?? [],
      lat: f.lat != null ? Number(f.lat) : null,
      lon: f.lon != null ? Number(f.lon) : null,
    }));
  });
}

export interface ActaDetalle extends ActaResumen {
  empresaId: number;
  observaciones: string | null;
  firmaInspector: string | null;
  firmaContratista: string | null;
  firmadaEn: string | null;
  creadaPor: string | null;
  items: Array<{
    itemId: number | null;
    ordenNumero: string | null;
    direccion: string | null;
    reportadoEn: string | null;
    m2Informado: number | null;
    /** Null: no salió sorteado y se certifica lo informado. */
    m2Medido: number | null;
  }>;
}

/** El acta firmada, con su detalle congelado: es lo que se imprime. */
export async function obtenerActa(sesion: Sesion, id: number): Promise<ActaDetalle | null> {
  return conRls(claims(sesion), async (tx) => {
    const cab = ((await tx.execute(sql`
      select a.id, a.numero, a.empresa_id, e.nombre as empresa, a.fecha::text as fecha, a.estado::text,
             a.modalidad, a.puntos_informados, a.puntos_medidos, a.m2_informados, a.m2_medidos,
             a.desviacion_pct, a.observaciones, a.firma_inspector, a.firma_contratista, a.firmada_en,
             p.nombre as creada_por
      from actas_medicion a
      join empresas e on e.id = a.empresa_id
      left join perfiles p on p.id = a.creada_por
      where a.id = ${id}
    `)) as unknown as Array<Record<string, unknown>>)[0];
    if (!cab) return null;
    const items = (await tx.execute(sql`
      select ai.orden_item_id, ot.numero, ai.direccion, oi.reportado_en, ai.m2_informado, ai.m2_medido
      from acta_items ai
      left join orden_items oi on oi.id = ai.orden_item_id
      left join ordenes_trabajo ot on ot.id = oi.orden_id
      where ai.acta_id = ${id}
      order by ot.numero nulls last, oi.reportado_en nulls last, ai.id
    `)) as unknown as Array<Record<string, unknown>>;
    return {
      id: Number(cab.id),
      numero: String(cab.numero),
      empresaId: Number(cab.empresa_id),
      empresa: String(cab.empresa),
      fecha: String(cab.fecha),
      estado: String(cab.estado),
      modalidad: String(cab.modalidad),
      puntosInformados: Number(cab.puntos_informados ?? 0),
      puntosMedidos: Number(cab.puntos_medidos ?? 0),
      m2Informados: Number(cab.m2_informados ?? 0),
      m2Medidos: Number(cab.m2_medidos ?? 0),
      desviacionPct: cab.desviacion_pct != null ? Number(cab.desviacion_pct) : null,
      observaciones: (cab.observaciones as string) ?? null,
      firmaInspector: (cab.firma_inspector as string) ?? null,
      firmaContratista: (cab.firma_contratista as string) ?? null,
      firmadaEn: cab.firmada_en != null ? new Date(String(cab.firmada_en)).toISOString() : null,
      creadaPor: (cab.creada_por as string) ?? null,
      items: items.map((i) => ({
        itemId: i.orden_item_id != null ? Number(i.orden_item_id) : null,
        ordenNumero: (i.numero as string) ?? null,
        direccion: (i.direccion as string) ?? null,
        reportadoEn: i.reportado_en != null ? new Date(String(i.reportado_en)).toISOString() : null,
        m2Informado: i.m2_informado != null ? Number(i.m2_informado) : null,
        m2Medido: i.m2_medido != null ? Number(i.m2_medido) : null,
      })),
    };
  });
}
