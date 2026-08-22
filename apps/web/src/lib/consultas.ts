import { conRls, getDb, sql } from "@cimba/db";
import type { EstadoIncidente, FuenteDemanda, TipoProblema } from "@cimba/domain";
import type { Sesion } from "./auth";
import { puedeVerContacto } from "./auth";

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona });

/**
 * Los <select> de los formularios GET mandan "" al elegir "Todos". Un "" que
 * llega a un cast de enum (''::estado_incidente) revienta la consulta, así que
 * acá cadena vacía es null (= sin filtro).
 */
const filtro = (v?: string | null): string | null => (v ? v : null);

// ── KPIs del centro de comando ──────────────────────────────────────────────

export interface Kpis {
  demandasAbiertas: number;
  demandasSinVincular: number;
  incidentesActivos: number;
  enEjecucion: number;
  reparados30d: number;
  m2Intervenidos: number;
}

export async function obtenerKpis(sesion: Sesion): Promise<Kpis> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select
        (select count(*) from demandas where estado in ('recibida','en_validacion')) as demandas_abiertas,
        (select count(*) from demandas d where d.estado in ('recibida','en_validacion')
           and not exists (select 1 from demanda_incidente di where di.demanda_id = d.id)) as sin_vincular,
        (select count(*) from incidentes where estado in ('detectado','priorizado','programado','en_ejecucion')) as activos,
        (select count(*) from incidentes where estado = 'en_ejecucion') as en_ejecucion,
        (select count(*) from incidentes where estado in ('reparado','verificado')
           and cerrado_en > now() - interval '30 days') as reparados_30d,
        (select coalesce(sum(superficie_m2), 0) from intervenciones where estado = 'finalizada') as m2
    `)) as unknown as Array<Record<string, string | number>>;
    const f = filas[0] ?? {};
    return {
      demandasAbiertas: Number(f.demandas_abiertas ?? 0),
      demandasSinVincular: Number(f.sin_vincular ?? 0),
      incidentesActivos: Number(f.activos ?? 0),
      enEjecucion: Number(f.en_ejecucion ?? 0),
      reparados30d: Number(f.reparados_30d ?? 0),
      m2Intervenidos: Math.round(Number(f.m2 ?? 0)),
    };
  });
}

// ── Demandas ────────────────────────────────────────────────────────────────

export interface DemandaResumen {
  id: number;
  fuente: FuenteDemanda;
  estado: string;
  tipo: TipoProblema | null;
  descripcion: string | null;
  direccion: string | null;
  geocodConfianza: number | null;
  lat: number | null;
  lon: number | null;
  distritoId: number | null;
  creadoEn: string;
  vinculos: number;
  metadata: Record<string, unknown>;
  contacto: Record<string, unknown> | null;
}

/** Filtros de calidad de datos para la bandeja (panel /calidad). */
const FILTROS_CALIDAD: Record<string, ReturnType<typeof sql>> = {
  geocod_baja: sql`and d.geom is not null and coalesce(d.geocod_confianza, 0) < 0.5 and d.estado in ('recibida','en_validacion')`,
  sin_ubicacion: sql`and d.geom is null and d.estado in ('recibida','en_validacion')`,
  sin_fecha: sql`and d.metadata->>'sin_fecha' = 'true' and d.estado in ('recibida','en_validacion')`,
  antiguas: sql`and d.creado_en < now() - interval '365 days' and d.estado in ('recibida','en_validacion')`,
};

export async function listarDemandas(
  sesion: Sesion,
  filtros: { fuente?: string; estado?: string; q?: string; calidad?: string; mes?: string; limite?: number; pagina?: number },
): Promise<{ filas: DemandaResumen[]; total: number }> {
  const verContacto = puedeVerContacto(sesion.rol_cimba);
  const limite = Math.min(filtros.limite ?? 50, 200);
  const offset = ((filtros.pagina ?? 1) - 1) * limite;
  const condCalidad = (filtros.calidad && FILTROS_CALIDAD[filtros.calidad]) || sql``;

  const fuente = filtro(filtros.fuente);
  const estado = filtro(filtros.estado);
  const q = filtro(filtros.q);
  const mes = filtro(filtros.mes);

  return conRls(claims(sesion), async (tx) => {
    const cond = sql`
      where (${fuente}::text is null or d.fuente = (${fuente})::fuente_demanda)
        and (${estado}::text is null or d.estado = (${estado})::estado_demanda)
        and (${q}::text is null
             or d.direccion_normalizada ilike '%' || ${q ?? ""} || '%'
             or d.descripcion ilike '%' || ${q ?? ""} || '%')
        and (${mes}::text is null or to_char(d.creado_en, 'YYYY-MM') = ${mes})
        ${condCalidad}
    `;
    const filas = (await tx.execute(sql`
      select d.id, d.fuente, d.estado, d.tipo, d.descripcion,
             coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
             d.geocod_confianza, st_y(d.geom) as lat, st_x(d.geom) as lon,
             d.distrito_id, d.creado_en, d.metadata,
             ${verContacto ? sql`d.contacto` : sql`null::jsonb`} as contacto,
             (select count(*) from demanda_incidente di where di.demanda_id = d.id) as vinculos
      from demandas d
      ${cond}
      order by d.creado_en desc
      limit ${limite} offset ${offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const total = (await tx.execute(sql`
      select count(*) as n from demandas d ${cond}
    `)) as unknown as Array<{ n: string | number }>;

    return {
      filas: filas.map((f) => ({
        id: Number(f.id),
        fuente: f.fuente as FuenteDemanda,
        estado: String(f.estado),
        tipo: (f.tipo as TipoProblema) ?? null,
        descripcion: (f.descripcion as string) ?? null,
        direccion: (f.direccion as string) ?? null,
        geocodConfianza: f.geocod_confianza != null ? Number(f.geocod_confianza) : null,
        lat: f.lat != null ? Number(f.lat) : null,
        lon: f.lon != null ? Number(f.lon) : null,
        distritoId: f.distrito_id != null ? Number(f.distrito_id) : null,
        creadoEn: String(f.creado_en),
        vinculos: Number(f.vinculos ?? 0),
        metadata: (f.metadata as Record<string, unknown>) ?? {},
        contacto: (f.contacto as Record<string, unknown>) ?? null,
      })),
      total: Number(total[0]?.n ?? 0),
    };
  });
}

export async function obtenerDemanda(sesion: Sesion, id: number): Promise<DemandaResumen | null> {
  const verContacto = puedeVerContacto(sesion.rol_cimba);
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select d.id, d.fuente, d.estado, d.tipo, d.descripcion,
             coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
             d.geocod_confianza, st_y(d.geom) as lat, st_x(d.geom) as lon,
             d.distrito_id, d.creado_en, d.metadata,
             ${verContacto ? sql`d.contacto` : sql`null::jsonb`} as contacto,
             (select count(*) from demanda_incidente di where di.demanda_id = d.id) as vinculos
      from demandas d where d.id = ${id}
    `)) as unknown as Array<Record<string, unknown>>;
    const f = filas[0];
    if (!f) return null;
    return {
      id: Number(f.id),
      fuente: f.fuente as FuenteDemanda,
      estado: String(f.estado),
      tipo: (f.tipo as TipoProblema) ?? null,
      descripcion: (f.descripcion as string) ?? null,
      direccion: (f.direccion as string) ?? null,
      geocodConfianza: f.geocod_confianza != null ? Number(f.geocod_confianza) : null,
      lat: f.lat != null ? Number(f.lat) : null,
      lon: f.lon != null ? Number(f.lon) : null,
      distritoId: f.distrito_id != null ? Number(f.distrito_id) : null,
      creadoEn: String(f.creado_en),
      vinculos: Number(f.vinculos ?? 0),
      metadata: (f.metadata as Record<string, unknown>) ?? {},
      contacto: (f.contacto as Record<string, unknown>) ?? null,
    };
  });
}

export interface SugerenciaIncidente {
  incidenteId: number;
  distanciaM: number;
  mismoTipo: boolean;
  esReincidencia: boolean;
  score: number;
  estado: EstadoIncidente;
  tipo: TipoProblema;
  direccion: string | null;
  demandasVinculadas: number;
}

export async function sugerenciasParaDemanda(
  sesion: Sesion,
  demandaId: number,
): Promise<SugerenciaIncidente[]> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select s.incidente_id, s.distancia_m, s.mismo_tipo, s.es_reincidencia, s.score,
             i.estado, i.tipo, i.direccion,
             (select count(*) from demanda_incidente di where di.incidente_id = i.id) as demandas
      from demandas d,
           lateral sugerir_incidente(d.geom, coalesce(d.tipo, 'bache'::tipo_problema), d.creado_en) s
      join incidentes i on i.id = s.incidente_id
      where d.id = ${demandaId} and d.geom is not null
      order by s.score desc
      limit 8
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => ({
      incidenteId: Number(f.incidente_id),
      distanciaM: Number(f.distancia_m),
      mismoTipo: Boolean(f.mismo_tipo),
      esReincidencia: Boolean(f.es_reincidencia),
      score: Number(f.score),
      estado: f.estado as EstadoIncidente,
      tipo: f.tipo as TipoProblema,
      direccion: (f.direccion as string) ?? null,
      demandasVinculadas: Number(f.demandas ?? 0),
    }));
  });
}

// ── Incidentes ──────────────────────────────────────────────────────────────

export interface IncidenteResumen {
  id: number;
  tipo: TipoProblema;
  estado: EstadoIncidente;
  direccion: string | null;
  lat: number;
  lon: number;
  distritoId: number | null;
  scorePrioridad: number | null;
  superficieM2: number | null;
  demandas: number;
  intervenciones: number;
  detectadoEn: string;
  cerradoEn: string | null;
}

export async function listarIncidentes(
  sesion: Sesion,
  filtros: { estado?: string; tipo?: string; q?: string; limite?: number; pagina?: number; orden?: "prioridad" | "fecha" },
): Promise<{ filas: IncidenteResumen[]; total: number }> {
  const limite = Math.min(filtros.limite ?? 50, 200);
  const offset = ((filtros.pagina ?? 1) - 1) * limite;
  const estado = filtro(filtros.estado);
  const tipo = filtro(filtros.tipo);
  const q = filtro(filtros.q);
  return conRls(claims(sesion), async (tx) => {
    const cond = sql`
      where (${estado}::text is null or i.estado = (${estado})::estado_incidente)
        and (${tipo}::text is null or i.tipo = (${tipo})::tipo_problema)
        and (${q}::text is null or i.direccion ilike '%' || ${q ?? ""} || '%')
    `;
    const orden =
      filtros.orden === "fecha"
        ? sql`order by i.detectado_en desc`
        : sql`order by i.score_prioridad desc nulls last, i.detectado_en desc`;
    const filas = (await tx.execute(sql`
      select i.id, i.tipo, i.estado, i.direccion, st_y(i.geom) as lat, st_x(i.geom) as lon,
             i.distrito_id, i.score_prioridad, i.superficie_m2, i.detectado_en, i.cerrado_en,
             (select count(*) from demanda_incidente di where di.incidente_id = i.id) as demandas,
             (select count(*) from intervenciones iv where iv.incidente_id = i.id) as intervenciones
      from incidentes i
      ${cond} ${orden}
      limit ${limite} offset ${offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const total = (await tx.execute(sql`select count(*) as n from incidentes i ${cond}`)) as unknown as Array<{
      n: string | number;
    }>;
    return {
      filas: filas.map((f) => ({
        id: Number(f.id),
        tipo: f.tipo as TipoProblema,
        estado: f.estado as EstadoIncidente,
        direccion: (f.direccion as string) ?? null,
        lat: Number(f.lat),
        lon: Number(f.lon),
        distritoId: f.distrito_id != null ? Number(f.distrito_id) : null,
        scorePrioridad: f.score_prioridad != null ? Number(f.score_prioridad) : null,
        superficieM2: f.superficie_m2 != null ? Number(f.superficie_m2) : null,
        demandas: Number(f.demandas ?? 0),
        intervenciones: Number(f.intervenciones ?? 0),
        detectadoEn: String(f.detectado_en),
        cerradoEn: f.cerrado_en != null ? String(f.cerrado_en) : null,
      })),
      total: Number(total[0]?.n ?? 0),
    };
  });
}

// ── Intervenciones ──────────────────────────────────────────────────────────

export interface IntervencionResumen {
  id: number;
  incidenteId: number;
  estado: string;
  cuadrilla: string | null;
  tipo: TipoProblema | null;
  direccion: string | null;
  lat: number | null;
  lon: number | null;
  iniciadaEn: string | null;
  finalizadaEn: string | null;
  superficieM2: number | null;
  fotos: number;
  metadata: Record<string, unknown>;
}

export async function listarIntervenciones(
  sesion: Sesion,
  filtros: { estado?: string; ejecutor?: string; q?: string; limite?: number; pagina?: number },
): Promise<{ filas: IntervencionResumen[]; total: number }> {
  const limite = Math.min(filtros.limite ?? 50, 200);
  const offset = ((filtros.pagina ?? 1) - 1) * limite;
  const estado = filtro(filtros.estado);
  const ejecutor = filtro(filtros.ejecutor);
  const q = filtro(filtros.q);
  return conRls(claims(sesion), async (tx) => {
    const cond = sql`
      where (${estado}::text is null or iv.estado = (${estado})::estado_intervencion)
        and (${q}::text is null or i.direccion ilike '%' || ${q ?? ""} || '%')
        and (${ejecutor}::text is null
             or coalesce((select cu.nombre from cuadrillas cu where cu.id = iv.cuadrilla_id),
                         iv.metadata->>'contratista',
                         'Sin asignar') = ${ejecutor})
    `;
    const filas = (await tx.execute(sql`
      select iv.id, iv.incidente_id, iv.estado, c.nombre as cuadrilla,
             i.direccion, i.tipo,
             st_y(coalesce(iv.geom_ejecucion, i.geom)) as lat,
             st_x(coalesce(iv.geom_ejecucion, i.geom)) as lon,
             iv.iniciada_en, iv.finalizada_en, iv.superficie_m2, iv.metadata,
             (select count(*) from fotografias fo where fo.intervencion_id = iv.id) as fotos
      from intervenciones iv
      join incidentes i on i.id = iv.incidente_id
      left join cuadrillas c on c.id = iv.cuadrilla_id
      ${cond}
      order by coalesce(iv.finalizada_en, iv.iniciada_en, iv.creado_en) desc
      limit ${limite} offset ${offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const total = (await tx.execute(sql`
      select count(*) as n from intervenciones iv join incidentes i on i.id = iv.incidente_id ${cond}
    `)) as unknown as Array<{
      n: string | number;
    }>;
    return {
      filas: filas.map((f) => ({
        id: Number(f.id),
        incidenteId: Number(f.incidente_id),
        estado: String(f.estado),
        cuadrilla: (f.cuadrilla as string) ?? null,
        tipo: (f.tipo as TipoProblema) ?? null,
        direccion: (f.direccion as string) ?? null,
        lat: f.lat != null ? Number(f.lat) : null,
        lon: f.lon != null ? Number(f.lon) : null,
        iniciadaEn: f.iniciada_en != null ? String(f.iniciada_en) : null,
        finalizadaEn: f.finalizada_en != null ? String(f.finalizada_en) : null,
        superficieM2: f.superficie_m2 != null ? Number(f.superficie_m2) : null,
        fotos: Number(f.fotos ?? 0),
        metadata: (f.metadata as Record<string, unknown>) ?? {},
      })),
      total: Number(total[0]?.n ?? 0),
    };
  });
}

/** Panorama de intervenciones para la cabecera visual de la página. */
export interface ResumenIntervenciones {
  total: number;
  finalizadas: number;
  enCurso: number;
  asignadas: number;
  m2: number;
  contratadas: number;
  municipales: number;
}

export async function resumenIntervenciones(sesion: Sesion): Promise<ResumenIntervenciones> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select count(*) as total,
             count(*) filter (where estado = 'finalizada') as finalizadas,
             count(*) filter (where estado = 'en_curso') as en_curso,
             count(*) filter (where estado = 'asignada') as asignadas,
             coalesce(sum(superficie_m2) filter (where estado = 'finalizada'), 0) as m2,
             count(*) filter (where (metadata->>'contratista' is not null or metadata->>'obra_id' is not null)
                                and estado <> 'anulada') as contratadas,
             count(*) filter (where metadata->>'contratista' is null and metadata->>'obra_id' is null
                                and estado <> 'anulada') as municipales
      from intervenciones
    `)) as unknown as Array<Record<string, string | number>>;
    const f = filas[0] ?? {};
    return {
      total: Number(f.total ?? 0),
      finalizadas: Number(f.finalizadas ?? 0),
      enCurso: Number(f.en_curso ?? 0),
      asignadas: Number(f.asignadas ?? 0),
      m2: Math.round(Number(f.m2 ?? 0)),
      contratadas: Number(f.contratadas ?? 0),
      municipales: Number(f.municipales ?? 0),
    };
  });
}

/**
 * Historia completa de un incidente: el problema, todos los pedidos que lo
 * originaron y todos los trabajos que lo atendieron. Es la vista que responde
 * "¿qué se pidió y qué se hizo acá?" para un punto concreto.
 */
export interface HistoriaIncidente {
  id: number;
  tipo: TipoProblema;
  estado: EstadoIncidente;
  direccion: string | null;
  lat: number | null;
  lon: number | null;
  scorePrioridad: number | null;
  superficieM2: number | null;
  detectadoEn: string;
  cerradoEn: string | null;
  demandas: Array<{
    id: number;
    fuente: FuenteDemanda;
    estado: string;
    descripcion: string | null;
    direccion: string | null;
    creadoEn: string;
    sinFecha: boolean;
    automatico: boolean;
    confianza: number | null;
  }>;
  intervenciones: Array<{
    id: number;
    estado: string;
    ejecutor: string;
    contratada: boolean;
    deCuadrilla: boolean;
    iniciadaEn: string | null;
    finalizadaEn: string | null;
    superficieM2: number | null;
    fotos: number;
  }>;
}

export async function obtenerHistoriaIncidente(sesion: Sesion, id: number): Promise<HistoriaIncidente | null> {
  return conRls(claims(sesion), async (tx) => {
    const inc = (await tx.execute(sql`
      select i.id, i.tipo, i.estado, i.direccion, st_y(i.geom) as lat, st_x(i.geom) as lon,
             i.score_prioridad, i.superficie_m2, i.detectado_en, i.cerrado_en
      from incidentes i where i.id = ${id}
    `)) as unknown as Array<Record<string, unknown>>;
    const f = inc[0];
    if (!f) return null;

    const dems = (await tx.execute(sql`
      select d.id, d.fuente, d.estado, d.descripcion,
             coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
             d.creado_en, d.metadata->>'sin_fecha' as sin_fecha, di.automatico, di.confianza
      from demanda_incidente di
      join demandas d on d.id = di.demanda_id
      where di.incidente_id = ${id}
      order by d.creado_en asc
    `)) as unknown as Array<Record<string, unknown>>;

    const ivs = (await tx.execute(sql`
      select iv.id, iv.estado,
             coalesce(c.nombre, iv.metadata->>'contratista', 'Sin asignar') as ejecutor,
             (iv.metadata->>'contratista' is not null or iv.metadata->>'obra_id' is not null) as contratada,
             (iv.cuadrilla_id is not null) as de_cuadrilla,
             iv.iniciada_en, iv.finalizada_en, iv.superficie_m2,
             (select count(*) from fotografias fo where fo.intervencion_id = iv.id) as fotos
      from intervenciones iv
      left join cuadrillas c on c.id = iv.cuadrilla_id
      where iv.incidente_id = ${id}
      order by coalesce(iv.iniciada_en, iv.finalizada_en, iv.creado_en) asc
    `)) as unknown as Array<Record<string, unknown>>;

    return {
      id: Number(f.id),
      tipo: f.tipo as TipoProblema,
      estado: f.estado as EstadoIncidente,
      direccion: (f.direccion as string) ?? null,
      lat: f.lat != null ? Number(f.lat) : null,
      lon: f.lon != null ? Number(f.lon) : null,
      scorePrioridad: f.score_prioridad != null ? Number(f.score_prioridad) : null,
      superficieM2: f.superficie_m2 != null ? Number(f.superficie_m2) : null,
      detectadoEn: String(f.detectado_en),
      cerradoEn: f.cerrado_en != null ? String(f.cerrado_en) : null,
      demandas: dems.map((d) => ({
        id: Number(d.id),
        fuente: d.fuente as FuenteDemanda,
        estado: String(d.estado),
        descripcion: (d.descripcion as string) ?? null,
        direccion: (d.direccion as string) ?? null,
        creadoEn: String(d.creado_en),
        sinFecha: d.sin_fecha === "true",
        automatico: Boolean(d.automatico),
        confianza: d.confianza != null ? Number(d.confianza) : null,
      })),
      intervenciones: ivs.map((v) => ({
        id: Number(v.id),
        estado: String(v.estado),
        ejecutor: String(v.ejecutor),
        contratada: Boolean(v.contratada),
        deCuadrilla: Boolean(v.de_cuadrilla),
        iniciadaEn: v.iniciada_en != null ? String(v.iniciada_en) : null,
        finalizadaEn: v.finalizada_en != null ? String(v.finalizada_en) : null,
        superficieM2: v.superficie_m2 != null ? Number(v.superficie_m2) : null,
        fotos: Number(v.fotos ?? 0),
      })),
    };
  });
}

/** Ejecutores (cuadrillas municipales + contratistas SIGOV) con conteo, para filtrar. */
export async function listarEjecutores(sesion: Sesion): Promise<Array<{ nombre: string; n: number }>> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select coalesce(c.nombre, iv.metadata->>'contratista', 'Sin asignar') as nombre, count(*)::int as n
      from intervenciones iv
      left join cuadrillas c on c.id = iv.cuadrilla_id
      group by 1 order by 2 desc
    `)) as unknown as Array<{ nombre: string; n: number }>;
    return filas.map((f) => ({ nombre: f.nombre, n: Number(f.n) }));
  });
}

export async function listarCuadrillas(sesion: Sesion): Promise<Array<{ id: number; nombre: string }>> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(
      sql`select id, nombre from cuadrillas where activa order by nombre`,
    )) as unknown as Array<{ id: number; nombre: string }>;
    return filas.map((f) => ({ id: Number(f.id), nombre: f.nombre }));
  });
}

// ── Calidad de datos ────────────────────────────────────────────────────────

export interface EstadisticasCalidad {
  sinVincular: number;
  vinculables: number;
  /** De las vinculables, cuántas consolidaría una corrida AHORA (corroboradas:
   *  incidente abierto a ≤25 m del mismo tipo, u otro pedido apto a ≤25 m). */
  consolidables: number;
  geocodBaja: number;
  sinUbicacion: number;
  sinFecha: number;
  antiguas: number;
  vinculadas: number;
  autoVinculadas: number;
}

export async function estadisticasCalidad(sesion: Sesion): Promise<EstadisticasCalidad> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select
        (select count(*) from demandas d where d.estado in ('recibida','en_validacion')
           and not exists (select 1 from demanda_incidente di where di.demanda_id = d.id)) as sin_vincular,
        (select count(*) from demandas d where d.estado = 'recibida' and d.geom is not null
           and d.tipo is not null and coalesce(d.geocod_confianza,0) >= 0.75
           and not exists (select 1 from demanda_incidente di where di.demanda_id = d.id)) as vinculables,
        (select count(*) from demandas d where d.geom is not null
           and coalesce(d.geocod_confianza,0) < 0.5 and d.estado in ('recibida','en_validacion')) as geocod_baja,
        (select count(*) from demandas d where d.geom is null
           and d.estado in ('recibida','en_validacion')) as sin_ubicacion,
        (select count(*) from demandas d where d.metadata->>'sin_fecha' = 'true'
           and d.estado in ('recibida','en_validacion')) as sin_fecha,
        (select count(*) from demandas d where d.creado_en < now() - interval '365 days'
           and d.estado in ('recibida','en_validacion')) as antiguas,
        (select count(*) from demandas d where d.estado = 'vinculada') as vinculadas,
        (select count(*) from demanda_incidente di where di.automatico) as auto_vinculadas,
        (with aptas as (
           select d.id, d.tipo, d.geom from demandas d
           where d.estado = 'recibida' and d.geom is not null and d.tipo is not null
             and coalesce(d.geocod_confianza,0) >= 0.75
             and not exists (select 1 from demanda_incidente di where di.demanda_id = d.id)
         )
         select count(*) from aptas a
         where exists (select 1 from incidentes i
                       where i.estado in ('detectado','priorizado','programado','en_ejecucion')
                         and i.tipo = a.tipo
                         and st_dwithin(i.geom::geography, a.geom::geography, 25))
            or exists (select 1 from aptas b
                       where b.id <> a.id and b.tipo = a.tipo
                         -- mismo criterio que el DBSCAN de la consolidación: eps 25 en 3857
                         and st_dwithin(st_transform(b.geom, 3857), st_transform(a.geom, 3857), 25))) as consolidables
    `)) as unknown as Array<Record<string, string | number>>;
    const f = filas[0] ?? {};
    return {
      sinVincular: Number(f.sin_vincular ?? 0),
      vinculables: Number(f.vinculables ?? 0),
      consolidables: Number(f.consolidables ?? 0),
      geocodBaja: Number(f.geocod_baja ?? 0),
      sinUbicacion: Number(f.sin_ubicacion ?? 0),
      sinFecha: Number(f.sin_fecha ?? 0),
      antiguas: Number(f.antiguas ?? 0),
      vinculadas: Number(f.vinculadas ?? 0),
      autoVinculadas: Number(f.auto_vinculadas ?? 0),
    };
  });
}

// ── Brecha: lo pedido vs. lo hecho ──────────────────────────────────────────

export interface EstadisticasBrecha {
  totalAbiertas: number;
  yaResueltasProbable: number;
  enCola: number;
  brechaReal: number;
  reincidencias: number;
  sinUbicacion: number;
  cotejablesAhora: number;
  cotejablesAmpliado: number;
  trabajoTotal: number;
  trabajoSinPedido: number;
  m2Total: number;
  yaVinculadas: number;
  porFuente: Array<{ fuente: string; abiertas: number; atendidas: number }>;
  porTipo: Array<{ tipo: string; abiertas: number; sinNadaCerca: number }>;
  mensual: Array<{ mes: string; pedidos: number; hechos: number }>;
  topDeuda: Array<{
    direccion: string;
    pedidos: number;
    fuentes: string[];
    desde: string | null;
    lat: number;
    lon: number;
  }>;
}

/**
 * La medición central del sistema: qué parte de lo que se pide está atendida.
 * Clasificación de cada demanda abierta con ubicación (radio 40 m):
 *  - ya_resuelta_probable: hay reparación POSTERIOR al pedido (o el pedido no
 *    tiene fecha confiable) → falta cerrar el circuito, no falta obra.
 *  - en_cola: hay un incidente abierto cerca → está en proceso.
 *  - brecha_real: no hay nada cerca → nadie la tocó.
 *  - reincidencia: la reparación fue ANTERIOR al pedido → el problema volvió.
 */
export async function estadisticasBrecha(sesion: Sesion): Promise<EstadisticasBrecha> {
  return conRls(claims(sesion), async (tx) => {
    const cobertura = (await tx.execute(sql`
      with d as (
        select d.id, d.geom, d.creado_en, d.fuente, d.tipo, d.geocod_confianza,
               (d.metadata->>'sin_fecha' is null) as fecha_confiable
        from demandas d
        where d.estado in ('recibida','en_validacion') and d.geom is not null
      ), cruce as (
        select d.*,
          exists (select 1 from incidentes i
                  where i.estado in ('reparado','verificado')
                    and st_dwithin(i.geom::geography, d.geom::geography, 40)) as hay_reparacion,
          exists (select 1 from incidentes i
                  where i.estado in ('reparado','verificado')
                    and st_dwithin(i.geom::geography, d.geom::geography, 40)
                    and (not d.fecha_confiable or i.cerrado_en >= d.creado_en)) as reparacion_posterior,
          exists (select 1 from incidentes i
                  where i.estado in ('detectado','priorizado','programado','en_ejecucion')
                    and st_dwithin(i.geom::geography, d.geom::geography, 40)) as incidente_abierto,
          exists (select 1 from incidentes i
                  where i.estado in ('reparado','verificado')
                    and st_dwithin(i.geom::geography, d.geom::geography, 25)
                    and (d.tipo is null or i.tipo = d.tipo
                        or (d.tipo in ('bache','pavimento_deteriorado','hundimiento','fisura')
                            and i.tipo in ('bache','pavimento_deteriorado','hundimiento','fisura')))
                    and (not d.fecha_confiable or i.cerrado_en >= d.creado_en)) as cotejable
        from d
      )
      select
        count(*)::int as total,
        count(*) filter (where reparacion_posterior)::int as ya_resueltas,
        count(*) filter (where hay_reparacion and not reparacion_posterior)::int as reincidencias,
        count(*) filter (where not hay_reparacion and incidente_abierto)::int as en_cola,
        count(*) filter (where not hay_reparacion and not incidente_abierto)::int as brecha_real,
        count(*) filter (where cotejable and coalesce(geocod_confianza, 0) >= 0.75)::int as cotejables,
        count(*) filter (where cotejable)::int as cotejables_ampliado
      from cruce
    `)) as unknown as Array<Record<string, number | string>>;
    const c = cobertura[0] ?? {};

    const globales = (await tx.execute(sql`
      select
        (select count(*)::int from demandas
          where estado in ('recibida','en_validacion') and geom is null) as sin_ubicacion,
        (select count(*)::int from demandas where estado = 'vinculada') as vinculadas,
        (select count(*)::int from incidentes where estado in ('reparado','verificado')) as trabajo_total,
        (select count(*)::int from incidentes i where i.estado in ('reparado','verificado')
          and not exists (select 1 from demandas d where d.geom is not null
            and st_dwithin(d.geom::geography, i.geom::geography, 40))) as trabajo_sin_pedido,
        (select round(coalesce(sum(superficie_m2), 0))::int from intervenciones
          where estado = 'finalizada') as m2
    `)) as unknown as Array<Record<string, number | string>>;
    const g = globales[0] ?? {};

    const porFuente = (await tx.execute(sql`
      select d.fuente, count(*)::int as abiertas,
        count(*) filter (where exists (select 1 from incidentes i
          where i.estado in ('reparado','verificado')
            and st_dwithin(i.geom::geography, d.geom::geography, 40)))::int as atendidas
      from demandas d
      where d.estado in ('recibida','en_validacion') and d.geom is not null
      group by 1 order by 2 desc
    `)) as unknown as Array<{ fuente: string; abiertas: number; atendidas: number }>;

    const porTipo = (await tx.execute(sql`
      select d.tipo, count(*)::int as abiertas,
        count(*) filter (where not exists (select 1 from incidentes i
          where st_dwithin(i.geom::geography, d.geom::geography, 40)))::int as sin_nada
      from demandas d
      where d.estado in ('recibida','en_validacion') and d.geom is not null and d.tipo is not null
      group by 1 order by 3 desc
    `)) as unknown as Array<{ tipo: string; abiertas: number; sin_nada: number }>;

    const mensual = (await tx.execute(sql`
      select to_char(mes, 'YYYY-MM') as mes, sum(pedidos)::int as pedidos, sum(hechos)::int as hechos
      from (
        select date_trunc('month', creado_en) as mes, count(*) as pedidos, 0 as hechos
        from demandas where metadata->>'sin_fecha' is null group by 1
        union all
        select date_trunc('month', finalizada_en), 0, count(*)
        from intervenciones where finalizada_en is not null group by 1
      ) t
      group by mes order by mes desc limit 18
    `)) as unknown as Array<{ mes: string; pedidos: number; hechos: number }>;

    const topDeuda = (await tx.execute(sql`
      with sueltas as (
        select coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
               d.id, d.geom, d.creado_en, d.fuente,
               (d.metadata->>'sin_fecha' is null) as fecha_confiable
        from demandas d
        where d.estado in ('recibida','en_validacion') and d.geom is not null
          and not exists (select 1 from incidentes i
            where st_dwithin(i.geom::geography, d.geom::geography, 40))
      )
      select direccion, count(*)::int as pedidos,
             array_agg(distinct fuente) as fuentes,
             (min(creado_en) filter (where fecha_confiable))::date as desde,
             (array_agg(st_y(geom) order by creado_en))[1] as lat,
             (array_agg(st_x(geom) order by creado_en))[1] as lon
      from sueltas
      where direccion is not null
      group by 1
      order by 2 desc, 4 asc nulls last
      limit 12
    `)) as unknown as Array<Record<string, unknown>>;

    return {
      totalAbiertas: Number(c.total ?? 0),
      yaResueltasProbable: Number(c.ya_resueltas ?? 0),
      enCola: Number(c.en_cola ?? 0),
      brechaReal: Number(c.brecha_real ?? 0),
      reincidencias: Number(c.reincidencias ?? 0),
      cotejablesAhora: Number(c.cotejables ?? 0),
      cotejablesAmpliado: Number(c.cotejables_ampliado ?? 0),
      sinUbicacion: Number(g.sin_ubicacion ?? 0),
      yaVinculadas: Number(g.vinculadas ?? 0),
      trabajoTotal: Number(g.trabajo_total ?? 0),
      trabajoSinPedido: Number(g.trabajo_sin_pedido ?? 0),
      m2Total: Number(g.m2 ?? 0),
      porFuente: porFuente.map((f) => ({
        fuente: f.fuente,
        abiertas: Number(f.abiertas),
        atendidas: Number(f.atendidas),
      })),
      porTipo: porTipo.map((f) => ({
        tipo: f.tipo,
        abiertas: Number(f.abiertas),
        sinNadaCerca: Number(f.sin_nada),
      })),
      mensual: mensual.reverse().map((m) => ({
        mes: m.mes,
        pedidos: Number(m.pedidos),
        hechos: Number(m.hechos),
      })),
      topDeuda: topDeuda.map((t) => ({
        direccion: String(t.direccion),
        pedidos: Number(t.pedidos),
        fuentes: (t.fuentes as string[]) ?? [],
        desde: t.desde != null ? String(t.desde) : null,
        lat: Number(t.lat),
        lon: Number(t.lon),
      })),
    };
  });
}

// ── GeoJSON para el mapa único ──────────────────────────────────────────────

type Feature = { type: "Feature"; geometry: { type: "Point"; coordinates: [number, number] }; properties: Record<string, unknown> };
const coleccion = (features: Feature[]) => ({ type: "FeatureCollection" as const, features });

export async function geodata(sesion: Sesion) {
  return conRls(claims(sesion), async (tx) => {
    const incidentes = (await tx.execute(sql`
      select i.id, i.tipo, i.estado, i.direccion, i.score_prioridad, i.superficie_m2,
             i.detectado_en, i.cerrado_en, st_x(i.geom) as lon, st_y(i.geom) as lat,
             i.metadata->>'origen' as origen,
             (select count(*) from demanda_incidente di where di.incidente_id = i.id) as demandas
      from incidentes i
    `)) as unknown as Array<Record<string, unknown>>;

    const demandas = (await tx.execute(sql`
      select d.id, d.fuente, d.tipo, d.estado, d.geocod_confianza,
             coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
             d.creado_en, (d.metadata->>'sin_fecha' = 'true') as sin_fecha,
             st_x(d.geom) as lon, st_y(d.geom) as lat,
             case
               when d.estado not in ('recibida','en_validacion') then 'atendida'
               when exists (select 1 from incidentes i
                 where i.estado in ('reparado','verificado')
                   and st_dwithin(i.geom::geography, d.geom::geography, 40)
                   and (d.metadata->>'sin_fecha' = 'true' or i.cerrado_en >= d.creado_en))
                 then 'posible_resuelta'
               when exists (select 1 from incidentes i
                 where i.estado in ('detectado','priorizado','programado','en_ejecucion')
                   and st_dwithin(i.geom::geography, d.geom::geography, 40))
                 then 'en_cola'
               else 'sin_atencion'
             end as brecha
      from demandas d
      where d.geom is not null
    `)) as unknown as Array<Record<string, unknown>>;

    const macro = (estado: string) =>
      estado === "reparado" || estado === "verificado"
        ? "resuelto"
        : estado === "programado" || estado === "en_ejecucion"
          ? "en_curso"
          : estado === "desestimado"
            ? "inactivo"
            : "abierto";

    return {
      incidentes: coleccion(
        incidentes.map((f) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [Number(f.lon), Number(f.lat)] },
          properties: {
            id: Number(f.id),
            tipo: String(f.tipo),
            estado: String(f.estado),
            macro: macro(String(f.estado)),
            direccion: (f.direccion as string) ?? null,
            score: f.score_prioridad != null ? Number(f.score_prioridad) : null,
            m2: f.superficie_m2 != null ? Number(f.superficie_m2) : null,
            demandas: Number(f.demandas ?? 0),
            origen: (f.origen as string) ?? "cimba",
            detectado_en: String(f.detectado_en),
            cerrado_en: f.cerrado_en != null ? String(f.cerrado_en) : null,
          },
        })),
      ),
      demandas: coleccion(
        demandas.map((f) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates: [Number(f.lon), Number(f.lat)] },
          properties: {
            id: Number(f.id),
            fuente: String(f.fuente),
            tipo: f.tipo != null ? String(f.tipo) : null,
            estado: String(f.estado),
            confianza: f.geocod_confianza != null ? Number(f.geocod_confianza) : null,
            direccion: (f.direccion as string) ?? null,
            brecha: String(f.brecha),
            sin_fecha: Boolean(f.sin_fecha),
            creado_en: String(f.creado_en),
          },
        })),
      ),
    };
  });
}
