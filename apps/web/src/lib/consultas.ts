import { conRls, getDb, sql } from "@cimba/db";
import type { EstadoIncidente, FuenteDemanda, TipoProblema } from "@cimba/domain";
import type { Sesion } from "./auth";
import { puedeVerContacto } from "./auth";

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona });

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
  filtros: { fuente?: string; estado?: string; q?: string; calidad?: string; limite?: number; pagina?: number },
): Promise<{ filas: DemandaResumen[]; total: number }> {
  const verContacto = puedeVerContacto(sesion.rol_cimba);
  const limite = Math.min(filtros.limite ?? 50, 200);
  const offset = ((filtros.pagina ?? 1) - 1) * limite;
  const condCalidad = (filtros.calidad && FILTROS_CALIDAD[filtros.calidad]) || sql``;

  return conRls(claims(sesion), async (tx) => {
    const cond = sql`
      where (${filtros.fuente ?? null}::text is null or d.fuente = (${filtros.fuente ?? null})::fuente_demanda)
        and (${filtros.estado ?? null}::text is null or d.estado = (${filtros.estado ?? null})::estado_demanda)
        and (${filtros.q ?? null}::text is null
             or d.direccion_normalizada ilike '%' || ${filtros.q ?? ""} || '%'
             or d.descripcion ilike '%' || ${filtros.q ?? ""} || '%')
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
  filtros: { estado?: string; tipo?: string; limite?: number; pagina?: number; orden?: "prioridad" | "fecha" },
): Promise<{ filas: IncidenteResumen[]; total: number }> {
  const limite = Math.min(filtros.limite ?? 50, 200);
  const offset = ((filtros.pagina ?? 1) - 1) * limite;
  return conRls(claims(sesion), async (tx) => {
    const cond = sql`
      where (${filtros.estado ?? null}::text is null or i.estado = (${filtros.estado ?? null})::estado_incidente)
        and (${filtros.tipo ?? null}::text is null or i.tipo = (${filtros.tipo ?? null})::tipo_problema)
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
  direccion: string | null;
  iniciadaEn: string | null;
  finalizadaEn: string | null;
  superficieM2: number | null;
  fotos: number;
  metadata: Record<string, unknown>;
}

export async function listarIntervenciones(
  sesion: Sesion,
  filtros: { estado?: string; ejecutor?: string; limite?: number; pagina?: number },
): Promise<{ filas: IntervencionResumen[]; total: number }> {
  const limite = Math.min(filtros.limite ?? 50, 200);
  const offset = ((filtros.pagina ?? 1) - 1) * limite;
  return conRls(claims(sesion), async (tx) => {
    const cond = sql`
      where (${filtros.estado ?? null}::text is null or iv.estado = (${filtros.estado ?? null})::estado_intervencion)
        and (${filtros.ejecutor ?? null}::text is null
             or coalesce((select cu.nombre from cuadrillas cu where cu.id = iv.cuadrilla_id),
                         iv.metadata->>'contratista',
                         'Sin asignar') = ${filtros.ejecutor ?? null})
    `;
    const filas = (await tx.execute(sql`
      select iv.id, iv.incidente_id, iv.estado, c.nombre as cuadrilla,
             i.direccion, iv.iniciada_en, iv.finalizada_en, iv.superficie_m2, iv.metadata,
             (select count(*) from fotografias fo where fo.intervencion_id = iv.id) as fotos
      from intervenciones iv
      join incidentes i on i.id = iv.incidente_id
      left join cuadrillas c on c.id = iv.cuadrilla_id
      ${cond}
      order by coalesce(iv.finalizada_en, iv.iniciada_en, iv.creado_en) desc
      limit ${limite} offset ${offset}
    `)) as unknown as Array<Record<string, unknown>>;
    const total = (await tx.execute(sql`select count(*) as n from intervenciones iv ${cond}`)) as unknown as Array<{
      n: string | number;
    }>;
    return {
      filas: filas.map((f) => ({
        id: Number(f.id),
        incidenteId: Number(f.incidente_id),
        estado: String(f.estado),
        cuadrilla: (f.cuadrilla as string) ?? null,
        direccion: (f.direccion as string) ?? null,
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
        (select count(*) from demanda_incidente di where di.automatico) as auto_vinculadas
    `)) as unknown as Array<Record<string, string | number>>;
    const f = filas[0] ?? {};
    return {
      sinVincular: Number(f.sin_vincular ?? 0),
      vinculables: Number(f.vinculables ?? 0),
      geocodBaja: Number(f.geocod_baja ?? 0),
      sinUbicacion: Number(f.sin_ubicacion ?? 0),
      sinFecha: Number(f.sin_fecha ?? 0),
      antiguas: Number(f.antiguas ?? 0),
      vinculadas: Number(f.vinculadas ?? 0),
      autoVinculadas: Number(f.auto_vinculadas ?? 0),
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
             i.detectado_en, st_x(i.geom) as lon, st_y(i.geom) as lat,
             i.metadata->>'origen' as origen,
             (select count(*) from demanda_incidente di where di.incidente_id = i.id) as demandas
      from incidentes i
    `)) as unknown as Array<Record<string, unknown>>;

    const demandas = (await tx.execute(sql`
      select d.id, d.fuente, d.tipo, d.estado, d.geocod_confianza,
             coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
             d.creado_en, st_x(d.geom) as lon, st_y(d.geom) as lat
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
            creado_en: String(f.creado_en),
          },
        })),
      ),
    };
  });
}
