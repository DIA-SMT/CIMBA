import { conRls, sql } from "@cimba/db";
import type { EstadoItemOrden, EstadoOrden, PrioridadVial, TipoProblema } from "@cimba/domain";
import type { Sesion } from "./auth";
import { filtroEnum } from "./consultas";
import { parametrosDesdeJson, type ParametrosCapacidad } from "./capacidad";

/**
 * Consultas del módulo de órdenes de trabajo: el circuito como unidad de
 * planificación, la orden como el papel que viaja a la empresa, y el item
 * como cada bache/tramo concreto.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

// ── Circuitos: el tablero de planificación ───────────────────────────────────

export interface CircuitoResumen {
  id: number;
  codigo: string;
  prioridad: PrioridadVial | null;
  empresaId: number | null;
  empresaNombre: string | null;
  /** Incidentes abiertos (detectado/priorizado/programado/en_ejecucion). */
  pendientes: number;
  /** Reclamos (demandas abiertas) que caen en el circuito. */
  demandasAbiertas: number;
  reparados: number;
  /** Órdenes emitidas o en ejecución ahora mismo. */
  ordenesActivas: number;
  /** Centroide para volar en el mapa. */
  lat: number | null;
  lon: number | null;
}

export async function resumenCircuitos(sesion: Sesion): Promise<CircuitoResumen[]> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select c.id, c.codigo, c.prioridad, c.empresa_id, e.nombre as empresa_nombre,
        (select count(*) from incidentes i where i.circuito_id = c.id
           and i.estado in ('detectado','priorizado','programado','en_ejecucion'))::int as pendientes,
        (select count(*) from demandas d where d.circuito_id = c.id
           and d.estado in ('recibida','en_validacion'))::int as demandas_abiertas,
        (select count(*) from incidentes i where i.circuito_id = c.id
           and i.estado in ('reparado','verificado'))::int as reparados,
        (select count(*) from ordenes_trabajo ot where ot.circuito_id = c.id
           and ot.estado in ('emitida','en_ejecucion'))::int as ordenes_activas,
        st_y(st_centroid(c.geom)) as lat, st_x(st_centroid(c.geom)) as lon
      from circuitos c
      left join empresas e on e.id = c.empresa_id
      order by pendientes desc, c.codigo
    `)) as unknown as Array<Record<string, unknown>>;

    return filas.map((f) => ({
      id: Number(f.id),
      codigo: String(f.codigo),
      prioridad: (f.prioridad as PrioridadVial) ?? null,
      empresaId: f.empresa_id != null ? Number(f.empresa_id) : null,
      empresaNombre: (f.empresa_nombre as string) ?? null,
      pendientes: Number(f.pendientes ?? 0),
      demandasAbiertas: Number(f.demandas_abiertas ?? 0),
      reparados: Number(f.reparados ?? 0),
      ordenesActivas: Number(f.ordenes_activas ?? 0),
      lat: f.lat != null ? Number(f.lat) : null,
      lon: f.lon != null ? Number(f.lon) : null,
    }));
  });
}

// ── Lo pendiente adentro de un circuito (para armar la orden) ───────────────

export interface PendienteCircuito {
  incidenteId: number;
  tipo: TipoProblema;
  estado: string;
  direccion: string | null;
  score: number | null;
  /** Cuántos reclamos hay detrás de este bache (demandas vinculadas). */
  reclamos: number;
  /** De dónde vienen esos reclamos (fuente_demanda, sin repetir): el Director
   *  quiere ver al armar la orden si detrás hay vecinos, el Concejo o la SAT. */
  fuentes: string[];
  superficieM2: number | null;
  detectadoEn: string;
  lat: number;
  lon: number;
  /** Ya está en otra orden activa: no ofrecerlo de nuevo. */
  enOrden: boolean;
}

export async function pendientesEnCircuito(
  sesion: Sesion,
  circuitoId: number,
): Promise<PendienteCircuito[]> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select i.id, i.tipo, i.estado, i.direccion, i.score_prioridad, i.superficie_m2,
             i.detectado_en, st_y(i.geom) as lat, st_x(i.geom) as lon,
             (select count(*) from demanda_incidente di where di.incidente_id = i.id)::int as reclamos,
             coalesce((select array_agg(distinct d.fuente::text)
                       from demanda_incidente di
                       join demandas d on d.id = di.demanda_id
                       where di.incidente_id = i.id), '{}') as fuentes,
             exists (
               select 1 from orden_items oi
               join ordenes_trabajo ot on ot.id = oi.orden_id
               where oi.incidente_id = i.id and oi.estado = 'pendiente'
                 and ot.estado in ('borrador','emitida','en_ejecucion')
             ) as en_orden
      from incidentes i
      where i.circuito_id = ${circuitoId}
        and i.estado in ('detectado','priorizado','programado','en_ejecucion')
        and i.geom is not null
      order by reclamos desc, i.score_prioridad desc nulls last, i.detectado_en
    `)) as unknown as Array<Record<string, unknown>>;

    return filas.map((f) => ({
      incidenteId: Number(f.id),
      tipo: f.tipo as TipoProblema,
      estado: String(f.estado),
      direccion: (f.direccion as string) ?? null,
      score: f.score_prioridad != null ? Number(f.score_prioridad) : null,
      reclamos: Number(f.reclamos ?? 0),
      fuentes: (f.fuentes as string[]) ?? [],
      superficieM2: f.superficie_m2 != null ? Number(f.superficie_m2) : null,
      detectadoEn: String(f.detectado_en),
      lat: Number(f.lat),
      lon: Number(f.lon),
      enOrden: Boolean(f.en_orden),
    }));
  });
}

// ── Empresas: la oferta ──────────────────────────────────────────────────────

export interface EmpresaResumen {
  id: number;
  nombre: string;
  slug: string;
  cuadrillas: number;
  turnosPorDia: number;
  porZona: boolean;
  activa: boolean;
  tieneClave: boolean;
  /** Carga actual: items pendientes en órdenes activas. */
  itemsPendientes: number;
  ordenesActivas: number;
  circuitosAsignados: string[];
}

export async function listarEmpresas(sesion: Sesion): Promise<EmpresaResumen[]> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select e.id, e.nombre, e.slug, e.cuadrillas, e.activa,
             (e.clave_hash is not null) as tiene_clave,
             coalesce((e.metadata->>'turnos_por_dia')::int, 2) as turnos_por_dia,
             coalesce((e.metadata->>'por_zona')::boolean, false) as por_zona,
             (select count(*) from orden_items oi
                join ordenes_trabajo ot on ot.id = oi.orden_id
                where ot.empresa_id = e.id and oi.estado = 'pendiente'
                  and ot.estado in ('emitida','en_ejecucion'))::int as items_pendientes,
             (select count(*) from ordenes_trabajo ot
                where ot.empresa_id = e.id and ot.estado in ('emitida','en_ejecucion'))::int as ordenes_activas,
             coalesce((select array_agg(c.codigo order by c.codigo) from circuitos c where c.empresa_id = e.id),
                      '{}') as circuitos
      from empresas e
      order by e.activa desc, e.cuadrillas desc, e.nombre
    `)) as unknown as Array<Record<string, unknown>>;

    return filas.map((f) => ({
      id: Number(f.id),
      nombre: String(f.nombre),
      slug: String(f.slug),
      cuadrillas: Number(f.cuadrillas ?? 1),
      turnosPorDia: Number(f.turnos_por_dia ?? 2),
      porZona: Boolean(f.por_zona),
      activa: Boolean(f.activa),
      tieneClave: Boolean(f.tiene_clave),
      itemsPendientes: Number(f.items_pendientes ?? 0),
      ordenesActivas: Number(f.ordenes_activas ?? 0),
      circuitosAsignados: (f.circuitos as string[]) ?? [],
    }));
  });
}

// ── Órdenes ──────────────────────────────────────────────────────────────────

export interface OrdenResumen {
  id: number;
  numero: string;
  estado: EstadoOrden;
  prioridad: PrioridadVial;
  titulo: string | null;
  empresaId: number;
  empresaNombre: string;
  circuitoCodigo: string | null;
  items: number;
  hechos: number;
  m2Reportados: number;
  emitidaEn: string | null;
  venceEn: string | null;
  creadoEn: string;
}

export async function listarOrdenes(
  sesion: Sesion,
  filtros: { estado?: string; empresaId?: number } = {},
): Promise<OrdenResumen[]> {
  const estado = filtros.estado || null;
  const empresaId = filtros.empresaId ?? null;
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select ot.id, ot.numero, ot.estado, ot.prioridad, ot.titulo, ot.empresa_id,
             e.nombre as empresa_nombre, c.codigo as circuito_codigo,
             ot.emitida_en, ot.vence_en::text as vence_en, ot.creado_en,
             (select count(*) from orden_items oi where oi.orden_id = ot.id)::int as items,
             (select count(*) from orden_items oi where oi.orden_id = ot.id and oi.estado = 'hecho')::int as hechos,
             (select round(coalesce(sum(oi.superficie_m2), 0))::int from orden_items oi
                where oi.orden_id = ot.id and oi.estado = 'hecho') as m2
      from ordenes_trabajo ot
      join empresas e on e.id = ot.empresa_id
      left join circuitos c on c.id = ot.circuito_id
      where (${estado}::text is null or ot.estado = (${estado})::estado_orden)
        and (${empresaId}::bigint is null or ot.empresa_id = ${empresaId})
      order by ot.creado_en desc
      limit 200
    `)) as unknown as Array<Record<string, unknown>>;

    return filas.map((f) => ({
      id: Number(f.id),
      numero: String(f.numero),
      estado: f.estado as EstadoOrden,
      prioridad: f.prioridad as PrioridadVial,
      titulo: (f.titulo as string) ?? null,
      empresaId: Number(f.empresa_id),
      empresaNombre: String(f.empresa_nombre),
      circuitoCodigo: (f.circuito_codigo as string) ?? null,
      items: Number(f.items ?? 0),
      hechos: Number(f.hechos ?? 0),
      m2Reportados: Number(f.m2 ?? 0),
      emitidaEn: f.emitida_en != null ? String(f.emitida_en) : null,
      venceEn: f.vence_en != null ? String(f.vence_en) : null,
      creadoEn: String(f.creado_en),
    }));
  });
}

export interface ItemOrden {
  id: number;
  incidenteId: number | null;
  direccion: string | null;
  tipoTrabajo: string;
  estado: EstadoItemOrden;
  anchoM: number | null;
  largoM: number | null;
  espesorCm: number | null;
  superficieM2: number | null;
  intervencionId: number | null;
  reportadoEn: string | null;
  observaciones: string | null;
  reclamos: number;
  lat: number | null;
  lon: number | null;
  fotos: Array<{ momento: string; storagePath: string | null; urlExterna: string | null }>;
}

export interface OrdenDetalle extends OrdenResumen {
  circuitoId: number | null;
  indicaciones: string | null;
  cerradaEn: string | null;
  itemsDetalle: ItemOrden[];
}

export async function obtenerOrden(sesion: Sesion, id: number): Promise<OrdenDetalle | null> {
  return conRls(claims(sesion), async (tx) => {
    const cab = (await tx.execute(sql`
      select ot.*, ot.vence_en::text as vence_en_txt, e.nombre as empresa_nombre, c.codigo as circuito_codigo
      from ordenes_trabajo ot
      join empresas e on e.id = ot.empresa_id
      left join circuitos c on c.id = ot.circuito_id
      where ot.id = ${id}
        ${
          // La RLS está escrita pero hoy no se aplica (la app corre como dueño
          // de las tablas): el enforcement de que una empresa solo vea SUS
          // órdenes tiene que estar acá, o /empresa/orden/[id] es un IDOR.
          sesion.rol_cimba === "empresa"
            ? sql`and ot.empresa_id = ${sesion.id_empresa ?? -1} and ot.estado <> 'borrador'`
            : sql``
        }
    `)) as unknown as Array<Record<string, unknown>>;
    const o = cab[0];
    if (!o) return null;

    const items = (await tx.execute(sql`
      select oi.*, st_y(oi.geom) as lat, st_x(oi.geom) as lon,
        coalesce((select count(*) from demanda_incidente di where di.incidente_id = oi.incidente_id), 0)::int as reclamos
      from orden_items oi
      where oi.orden_id = ${id}
      order by oi.id
    `)) as unknown as Array<Record<string, unknown>>;

    // Fotos de las intervenciones reportadas, en una sola consulta.
    const idsIv = items.map((i) => i.intervencion_id).filter((x) => x != null);
    const fotos =
      idsIv.length > 0
        ? ((await tx.execute(sql`
            select intervencion_id, momento, storage_path, url_externa
            from fotografias where intervencion_id = any(${sql`array[${sql.join(idsIv.map((x) => sql`${x}`), sql`, `)}]::bigint[]`})
            order by tomada_en
          `)) as unknown as Array<Record<string, unknown>>)
        : [];
    const fotosPorIv = new Map<number, ItemOrden["fotos"]>();
    for (const f of fotos) {
      const k = Number(f.intervencion_id);
      const lista = fotosPorIv.get(k) ?? [];
      lista.push({
        momento: String(f.momento),
        storagePath: (f.storage_path as string) ?? null,
        urlExterna: (f.url_externa as string) ?? null,
      });
      fotosPorIv.set(k, lista);
    }

    const itemsDetalle: ItemOrden[] = items.map((f) => ({
      id: Number(f.id),
      incidenteId: f.incidente_id != null ? Number(f.incidente_id) : null,
      direccion: (f.direccion as string) ?? null,
      tipoTrabajo: String(f.tipo_trabajo),
      estado: f.estado as EstadoItemOrden,
      anchoM: f.ancho_m != null ? Number(f.ancho_m) : null,
      largoM: f.largo_m != null ? Number(f.largo_m) : null,
      espesorCm: f.espesor_cm != null ? Number(f.espesor_cm) : null,
      superficieM2: f.superficie_m2 != null ? Number(f.superficie_m2) : null,
      intervencionId: f.intervencion_id != null ? Number(f.intervencion_id) : null,
      reportadoEn: f.reportado_en != null ? String(f.reportado_en) : null,
      observaciones: (f.observaciones as string) ?? null,
      reclamos: Number(f.reclamos ?? 0),
      lat: f.lat != null ? Number(f.lat) : null,
      lon: f.lon != null ? Number(f.lon) : null,
      fotos: f.intervencion_id != null ? (fotosPorIv.get(Number(f.intervencion_id)) ?? []) : [],
    }));

    const hechos = itemsDetalle.filter((i) => i.estado === "hecho").length;
    return {
      id: Number(o.id),
      numero: String(o.numero),
      estado: o.estado as EstadoOrden,
      prioridad: o.prioridad as PrioridadVial,
      titulo: (o.titulo as string) ?? null,
      empresaId: Number(o.empresa_id),
      empresaNombre: String(o.empresa_nombre),
      circuitoId: o.circuito_id != null ? Number(o.circuito_id) : null,
      circuitoCodigo: (o.circuito_codigo as string) ?? null,
      indicaciones: (o.indicaciones as string) ?? null,
      items: itemsDetalle.length,
      hechos,
      m2Reportados: Math.round(itemsDetalle.reduce((a, i) => a + (i.superficieM2 ?? 0), 0)),
      emitidaEn: o.emitida_en != null ? String(o.emitida_en) : null,
      // vence_en es una columna date pura: viene ya como "YYYY-MM-DD" (::text),
      // no como el Date-a-medianoche-UTC que String() corrompería un día.
      venceEn: (o.vence_en_txt as string) ?? null,
      cerradaEn: o.cerrada_en != null ? String(o.cerrada_en) : null,
      creadoEn: String(o.creado_en),
      itemsDetalle,
    };
  });
}

/**
 * Las órdenes de la empresa del portal /empresa. El staff (vista espejo)
 * puede pasar cualquier `empresaId`; para el rol empresa el parámetro se
 * IGNORA y siempre manda sesion.id_empresa — la RLS está escrita pero no
 * se aplica, así que esta línea es el único filtro real entre contratistas.
 */
export async function ordenesDeEmpresa(sesion: Sesion, empresaId?: number): Promise<OrdenResumen[]> {
  const efectiva = sesion.rol_cimba === "empresa" ? sesion.id_empresa : empresaId;
  if (!efectiva) return [];
  const ordenes = await listarOrdenes(sesion, { empresaId: efectiva });
  // El borrador es planificación interna: el formulario promete "la empresa no
  // la ve hasta que la emitas", y la vista espejo muestra lo mismo que ve la
  // empresa. obtenerOrden ya lo excluía; sin esta línea el listado lo filtraba.
  return ordenes.filter((o) => o.estado !== "borrador");
}

// ── Parámetros de capacidad ──────────────────────────────────────────────────

export async function obtenerCapacidad(sesion: Sesion): Promise<ParametrosCapacidad> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select valor from parametros where clave = 'capacidad_bacheo'
    `)) as unknown as Array<{ valor: Record<string, unknown> }>;
    return parametrosDesdeJson(filas[0]?.valor);
  });
}

// ── Demandas listas para cerrar desde Atención Ciudadana ────────────────────

export interface DemandaParaCerrar {
  demandaId: number;
  fuente: string;
  tipo: TipoProblema | null;
  /** Quién lo resuelve (bacheo | sat | ingenieria): el trigger de la base lo clasifica. */
  destino: string | null;
  direccion: string | null;
  creadoEn: string;
  incidenteId: number;
  cerradoEn: string | null;
  m2: number | null;
  fotosDespues: number;
  /** Punto del incidente reparado, para verificar la dirección en el mini-mapa antes de responder. */
  lat: number | null;
  lon: number | null;
}

/**
 * Demandas vinculadas a un incidente YA reparado que todavía no se cerraron:
 * la reparación existe, falta responderle al vecino. Es la bandeja de cierre
 * de Atención Ciudadana.
 *
 * Los filtros son null-safe (mismo patrón que listarDemandas en consultas.ts):
 * el "" de un <select> en "Todos" se vuelve null y no filtra nada.
 */
export async function demandasParaCerrar(
  sesion: Sesion,
  filtros: { fuente?: string; tipo?: string; destino?: string } = {},
): Promise<DemandaParaCerrar[]> {
  // Contra lista cerrada: un valor inventado en la URL no puede reventar el
  // cast de enum y tirar /cierres a 500 — se ignora y listo.
  const { FUENTES_DEMANDA, TIPOS_PROBLEMA } = await import("@cimba/domain");
  const fuente = filtroEnum(filtros.fuente, FUENTES_DEMANDA);
  const tipo = filtroEnum(filtros.tipo, TIPOS_PROBLEMA);
  const destino = filtroEnum(filtros.destino, ["bacheo", "sat", "ingenieria"]);
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select d.id as demanda_id, d.fuente, d.tipo, d.destino,
             coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
             d.creado_en, i.id as incidente_id, i.cerrado_en,
             st_y(i.geom) as lat, st_x(i.geom) as lon,
             (select round(sum(v.superficie_m2))::int from intervenciones v
                where v.incidente_id = i.id and v.estado = 'finalizada') as m2,
             (select count(*) from fotografias fo
                join intervenciones v on v.id = fo.intervencion_id
                where v.incidente_id = i.id and fo.momento = 'despues')::int as fotos_despues
      from demandas d
      join demanda_incidente di on di.demanda_id = d.id
      join incidentes i on i.id = di.incidente_id
      where d.estado in ('recibida','en_validacion','vinculada')
        and i.estado in ('reparado','verificado')
        and (${fuente}::text is null or d.fuente = (${fuente})::fuente_demanda)
        and (${tipo}::text is null or d.tipo = (${tipo})::tipo_problema)
        and (${destino}::text is null or d.destino = (${destino})::destino_resolucion)
      order by i.cerrado_en desc nulls last
      limit 500
    `)) as unknown as Array<Record<string, unknown>>;

    return filas.map((f) => ({
      demandaId: Number(f.demanda_id),
      fuente: String(f.fuente),
      tipo: (f.tipo as TipoProblema) ?? null,
      destino: (f.destino as string) ?? null,
      direccion: (f.direccion as string) ?? null,
      creadoEn: String(f.creado_en),
      incidenteId: Number(f.incidente_id),
      cerradoEn: f.cerrado_en != null ? String(f.cerrado_en) : null,
      m2: f.m2 != null ? Number(f.m2) : null,
      fotosDespues: Number(f.fotos_despues ?? 0),
      lat: f.lat != null ? Number(f.lat) : null,
      lon: f.lon != null ? Number(f.lon) : null,
    }));
  });
}
