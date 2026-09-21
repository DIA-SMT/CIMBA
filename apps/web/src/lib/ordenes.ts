import { conRls, sql, getDb } from "@cimba/db";
import { entraEnOrden, type TipoOrden } from "@cimba/domain";
import type { EstadoItemOrden, EstadoOrden, PrioridadVial, TipoProblema } from "@cimba/domain";
import type { Sesion } from "./auth";
import { puedeVerContacto } from "./auth";
import { filtroEnum } from "./consultas";
import { urlFoto } from "./fotos";
import { toneladasDe, volumenDe } from "./medicion";
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

/** Las cuatro formas de delimitar el trabajo, más el colector para lo pluvial. */
export type AmbitoOrden = "distrito" | "circuito" | "corredor" | "barrio" | "colector" | "zona";

/**
 * El WHERE de cada ámbito. El corredor y el barrio no tienen columna propia en
 * incidentes, así que se resuelven contra su geometría: el corredor por
 * cercanía (es una línea) y el barrio por contención (es un polígono).
 */
function filtroAmbito(ambito: AmbitoOrden, refId: number) {
  if (ambito === "circuito") return sql`i.circuito_id = ${refId}`;
  if (ambito === "distrito") return sql`i.distrito_id = ${refId}`;
  if (ambito === "barrio") {
    return sql`exists (select 1 from barrios b where b.id = ${refId} and st_contains(b.geom, i.geom))`;
  }
  if (ambito === "corredor") {
    return sql`exists (
      select 1 from corredores c
      where c.id = ${refId} and st_dwithin(c.geom::geography, i.geom::geography, 30)
    )`;
  }
  /* La zona del contrato de bacheo integral: contención pura, como el barrio.
     Son polígonos grandes y fijos — uno por empresa — así que acá no hay
     tolerancia de metros que valga. */
  if (ambito === "zona") {
    return sql`exists (
      select 1 from zonas_bacheo z where z.id = ${refId} and st_contains(z.geom, i.geom)
    )`;
  }
  // El colector agrupa imbornales, no incidentes de calzada: no aporta
  // pendientes de bacheo y la orden se arma con la lista de bocas.
  return sql`false`;
}

/**
 * Los incidentes abiertos dentro de un ámbito. El ámbito ya no es solo el
 * circuito: Leo pidió poder armar la orden por distrito, circuito, corredor o
 * barrio — "son esas cuatro alternativas". El corredor filtra por cercanía
 * (30 m) porque es una línea, no un polígono con incidentes adentro.
 */
export interface PendientesDelAmbito {
  pendientes: PendienteCircuito[];
  /**
   * Lo que hay en la zona y NO entra en esta orden, contado por tipo. No se
   * esconde: se cuenta y se dice. Sacar 59 pérdidas de agua de la lista sin
   * avisar sería cambiar un problema (ofrecer lo que no corresponde) por otro
   * peor (que el Director no sepa que están ahí).
   */
  fueraDeAlcance: Array<{ tipo: TipoProblema; n: number }>;
}

export async function pendientesEnAmbito(
  sesion: Sesion,
  ambito: AmbitoOrden,
  refId: number,
  tipoOrden: TipoOrden = "bacheo",
): Promise<PendientesDelAmbito> {
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
      where ${filtroAmbito(ambito, refId)}
        and i.estado in ('detectado','priorizado','programado','en_ejecucion')
        and i.geom is not null
      order by reclamos desc, i.score_prioridad desc nulls last, i.detectado_en
    `)) as unknown as Array<Record<string, unknown>>;

    const todos = filas.map((f) => ({
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

    /**
     * EL TIPO DE ORDEN MANDA. Antes este filtro no existía y una orden de
     * bacheo ofrecía exactamente lo mismo que una de imbornales: todo lo
     * abierto de la zona. Por eso las pérdidas de agua y las tapas de registro
     * —que son de la SAT— aparecían listas para mandárselas a una contratista
     * que no puede resolverlas.
     */
    const pendientes = todos.filter((p) => entraEnOrden(tipoOrden, p.tipo));
    const cuenta = new Map<TipoProblema, number>();
    for (const p of todos) {
      if (entraEnOrden(tipoOrden, p.tipo)) continue;
      cuenta.set(p.tipo, (cuenta.get(p.tipo) ?? 0) + 1);
    }
    return {
      pendientes,
      fueraDeAlcance: [...cuenta.entries()]
        .map(([tipo, n]) => ({ tipo, n }))
        .sort((a, b) => b.n - a.n),
    };
  });
}

/**
 * Cuántos pedidos ROJOS limpios del circuito esperan relevamiento — la misma
 * condición exacta que relevarCircuito (acciones-ordenes.ts): si cambia una,
 * cambia la otra, o el botón promete un número y releva otro.
 */
export async function rojasRelevablesEnCircuito(sesion: Sesion, circuitoId: number): Promise<number> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select count(*)::int as n
      from demandas d
      join circuitos c on c.id = ${circuitoId} and st_contains(c.geom, d.geom)
      where d.estado in ('recibida', 'en_validacion')
        and d.geom is not null
        and coalesce(d.destino::text, 'bacheo') = 'bacheo'
        and coalesce(d.geocod_confianza, 0) >= 0.75
        and d.tipo is not null
        and not exists (
          select 1 from incidentes i
          where st_dwithin(i.geom::geography, d.geom::geography, 40)
            and (i.estado in ('detectado','priorizado','programado','en_ejecucion')
                 or (i.estado in ('reparado','verificado')
                     and (d.metadata->>'sin_fecha' = 'true' or i.cerrado_en >= d.creado_en)))
        )
    `)) as unknown as Array<{ n: number }>;
    return Number(filas[0]?.n ?? 0);
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
  /**
   * POR DÓNDE SE DEFINIÓ. El listado mostraba una columna "Circuito" que para
   * la mayoría decía "—", porque la mayoría de las órdenes no se arman por
   * circuito sino por distrito o barrio. Mismo arreglo que ya tenían el
   * detalle y la hoja impresa: acá faltaba, y es la pantalla por la que se
   * entra a todo.
   */
  ambito: AmbitoOrden;
  ambitoNombre: string | null;
  /** TODOS los items de la orden, incluido lo que la empresa propuso y
   *  todavía no se validó. Casi nunca es lo que hay que mostrar. */
  items: number;
  /**
   * EL TRABAJO ENCARGADO: los items menos lo propuesto sin validar y lo
   * rechazado. Es el denominador del avance en TODAS las pantallas.
   *
   * Existía solo en el detalle, calculado en TypeScript, mientras el listado
   * dividía por `items`: la misma orden decía "8 de 13" en la lista y "8 de
   * 10" adentro, sin nada que explicara la diferencia.
   */
  enPlan: number;
  /** Los que ya no están pendientes: hechos + no encontrados + ya resueltos.
   *  Es lo que hace avanzar la barra — con solo `hechos`, una orden cerrada
   *  con dos "no encontrado" se quedaba en 80% para siempre. */
  cerrados: number;
  hechos: number;
  m2Reportados: number;
  /** Toneladas de asfalto: la unidad con la que se certifica el pago. Sale del
   *  volumen (columna generada) por la densidad de la mezcla, 2,4 t/m³. */
  tnReportadas: number;
  emitidaEn: string | null;
  venceEn: string | null;
  creadoEn: string;
  /**
   * ORDEN ABIERTA: se emitió sin lista de puntos. La empresa barre la zona y
   * carga los baches que encuentra. No se cierra sola —si no, el primer bache
   * reportado la cerraría— y por eso hay que poder distinguirla en pantalla.
   */
  abierta: boolean;
}

/**
 * El nombre del ámbito según cuál sea. Una sola función para el listado y el
 * detalle: si cada uno lo resolviera por su cuenta, la lista y la ficha de la
 * misma orden podrían terminar diciendo cosas distintas.
 */
function nombreDelAmbito(f: Record<string, unknown>): string | null {
  switch ((f.ambito as AmbitoOrden) ?? "circuito") {
    case "distrito":
      return f.distrito_id != null ? String(f.distrito_id) : null;
    case "barrio":
      return (f.barrio_nombre as string) ?? null;
    case "corredor":
      return (f.corredor_nombre as string) ?? null;
    case "zona":
      return (f.zona_nombre as string) ?? null;
    case "colector":
      return (f.colector as string) ?? null;
    default:
      return (f.circuito_codigo as string) ?? null;
  }
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
             ot.ambito, ot.distrito_id, ot.colector, ot.metadata,
             b.nombre as barrio_nombre, co.nombre as corredor_nombre, z.nombre as zona_nombre,
             (select count(*) from orden_items oi where oi.orden_id = ot.id)::int as items,
             (select count(*) from orden_items oi where oi.orden_id = ot.id
                and oi.estado not in ('propuesto','rechazado'))::int as en_plan,
             (select count(*) from orden_items oi where oi.orden_id = ot.id
                and oi.estado in ('hecho','no_encontrado','ya_resuelto','no_ejecutable'))::int as cerrados,
             (select count(*) from orden_items oi where oi.orden_id = ot.id and oi.estado = 'hecho')::int as hechos,
             (select round(coalesce(sum(oi.superficie_m2), 0))::int from orden_items oi
                where oi.orden_id = ot.id and oi.estado = 'hecho') as m2,
             -- Toneladas: volumen × densidad de la mezcla (2,4 t/m³). El
             -- volumen ya es columna generada, así que esto no duplica dato.
             (select round(coalesce(sum(oi.volumen_m3), 0) * 2.4, 2) from orden_items oi
                where oi.orden_id = ot.id and oi.estado = 'hecho') as tn
      from ordenes_trabajo ot
      join empresas e on e.id = ot.empresa_id
      left join circuitos c on c.id = ot.circuito_id
      left join barrios b on b.id = ot.barrio_id
      left join corredores co on co.id = ot.corredor_id
      left join zonas_bacheo z on z.id = ot.zona_id
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
      ambito: ((f.ambito as AmbitoOrden) ?? "circuito"),
      ambitoNombre: nombreDelAmbito(f),
      items: Number(f.items ?? 0),
      enPlan: Number(f.en_plan ?? 0),
      cerrados: Number(f.cerrados ?? 0),
      hechos: Number(f.hechos ?? 0),
      m2Reportados: Number(f.m2 ?? 0),
      tnReportadas: Number(f.tn ?? 0),
      emitidaEn: f.emitida_en != null ? String(f.emitida_en) : null,
      venceEn: f.vence_en != null ? String(f.vence_en) : null,
      creadoEn: String(f.creado_en),
      abierta: esAbierta(f.metadata),
    }));
  });
}

/** La marca que deja crearOrden cuando la orden nace sin puntos. */
function esAbierta(metadata: unknown): boolean {
  return (metadata as { orden_abierta?: unknown } | null)?.orden_abierta === true;
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
  /** Ya entró en un acta de medición firmada: certificado, no se corrige. */
  actaId: number | null;
  /** Modalidad del protocolo DOV con la que se certifica (planificado, extendido…). */
  tipoObra: string | null;
  superficieM2: number | null;
  intervencionId: number | null;
  /** Cómo se resolvió (bacheo / pano_hormigon / carpeta / enripiado); null si no se reportó. */
  tipoIntervencion: string | null;
  /** propuesto/validación/foto_propuesta y demás rastros del item. */
  metadata: Record<string, unknown>;
  reportadoEn: string | null;
  observaciones: string | null;
  reclamos: number;
  lat: number | null;
  lon: number | null;
  fotos: Array<{ momento: string; storagePath: string | null; urlExterna: string | null }>;
}

export interface OrdenDetalle extends OrdenResumen {
  circuitoId: number | null;
  /**
   * POR DÓNDE SE DEFINIÓ la orden: lo que el Director eligió en el paso "2 ·
   * Por dónde se define". La hoja impresa decía siempre "Circuito: —" porque
   * solo miraba `circuitoCodigo`, y una orden armada por distrito o por barrio
   * —que son la mayoría— salía a la calle sin decir de qué distrito era. El
   * capataz recibía un papel con siete direcciones y ninguna referencia de
   * zona.
   */
  ambito: AmbitoOrden;
  /** El nombre del ámbito elegido: "12", "Néstor Kirchner", "C-14"… */
  ambitoNombre: string | null;
  indicaciones: string | null;
  /** N° de contrato o decreto que respalda la orden (va en la hoja impresa). */
  contratoDecreto: string | null;
  cerradaEn: string | null;
  itemsDetalle: ItemOrden[];
}

export async function obtenerOrden(sesion: Sesion, id: number): Promise<OrdenDetalle | null> {
  // La RLS está escrita pero hoy no se aplica (la app corre como dueño de
  // las tablas): el enforcement de que un ejecutor (empresa contratista o
  // cuadrilla propia) solo vea SUS órdenes tiene que estar acá, o
  // /empresa/orden/[id] es un IDOR.
  const empresaEjecutora = await empresaDelEjecutor(sesion);
  return conRls(claims(sesion), async (tx) => {
    const cab = (await tx.execute(sql`
      select ot.*, ot.vence_en::text as vence_en_txt, e.nombre as empresa_nombre, c.codigo as circuito_codigo,
             b.nombre as barrio_nombre, co.nombre as corredor_nombre, z.nombre as zona_nombre
      from ordenes_trabajo ot
      join empresas e on e.id = ot.empresa_id
      left join circuitos c on c.id = ot.circuito_id
      -- Para que la hoja impresa pueda decir de qué distrito/barrio/corredor
      -- es la orden y no un "Circuito: —" que no informa nada.
      left join barrios b on b.id = ot.barrio_id
      left join corredores co on co.id = ot.corredor_id
      left join zonas_bacheo z on z.id = ot.zona_id
      where ot.id = ${id}
        ${
          empresaEjecutora != null
            ? sql`and ot.empresa_id = ${empresaEjecutora} and ot.estado <> 'borrador'`
            : sql``
        }
    `)) as unknown as Array<Record<string, unknown>>;
    const o = cab[0];
    if (!o) return null;

    /**
     * st_centroid() y no `oi.geom` pelado: un item puede ser un TRAMO, y un
     * tramo se guarda como LINESTRING (migración 0017), no como punto. ST_Y()
     * sobre una línea no devuelve null — tira `Argument to ST_Y() must have
     * type POINT` y se lleva puesta la página entera. El Director armaba una
     * orden con un tramo de avenida, la abría, y veía un error de servidor sin
     * nada que le dijera qué item lo había causado; la orden quedaba en
     * borrador para siempre porque nunca llegaba al botón de emitir.
     *
     * El centroide de un punto ES el punto, así que para los items puntuales
     * —que son casi todos— no cambia nada; para un tramo da el medio de la
     * línea, que es donde corresponde plantar el marcador.
     *
     * Ojo: el mismo st_y(oi.geom) estaba en otros cinco lugares (el reporte de
     * la empresa, el cierre, la exportación). Se arreglaron todos juntos: con
     * uno solo sin tocar, el tramo se podía ver pero no reportar.
     */
    const items = (await tx.execute(sql`
      select oi.*, st_y(st_centroid(oi.geom)) as lat, st_x(st_centroid(oi.geom)) as lon,
             (select v.tipo_intervencion::text from intervenciones v where v.id = oi.intervencion_id) as tipo_intervencion,
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
      actaId: f.acta_id != null ? Number(f.acta_id) : null,
      tipoObra: (f.tipo_obra as string) ?? null,
      superficieM2: f.superficie_m2 != null ? Number(f.superficie_m2) : null,
      intervencionId: f.intervencion_id != null ? Number(f.intervencion_id) : null,
      tipoIntervencion: (f.tipo_intervencion as string) ?? null,
      metadata: (f.metadata as Record<string, unknown>) ?? {},
      reportadoEn: f.reportado_en != null ? String(f.reportado_en) : null,
      observaciones: (f.observaciones as string) ?? null,
      reclamos: Number(f.reclamos ?? 0),
      lat: f.lat != null ? Number(f.lat) : null,
      lon: f.lon != null ? Number(f.lon) : null,
      fotos: f.intervencion_id != null ? (fotosPorIv.get(Number(f.intervencion_id)) ?? []) : [],
    }));

    const hechos = itemsDetalle.filter((i) => i.estado === "hecho").length;
    // Mismas dos definiciones que listarOrdenes, o las dos pantallas vuelven
    // a mostrar números distintos de la misma orden.
    const enPlan = itemsDetalle.filter(
      (i) => i.estado !== "propuesto" && i.estado !== "rechazado",
    ).length;
    const cerrados = itemsDetalle.filter((i) =>
      ["hecho", "no_encontrado", "ya_resuelto", "no_ejecutable"].includes(i.estado),
    ).length;
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
      ambito: ((o.ambito as AmbitoOrden) ?? "circuito"),
      /**
       * El nombre según el ámbito, resuelto acá y no en la pantalla: la hoja
       * impresa y la cabecera tienen que decir lo mismo, y si cada una lo
       * arma por su cuenta terminan divergiendo. El distrito no tiene tabla de
       * nombres —son 20 numerados— así que su "nombre" es el número.
       */
      ambitoNombre:
        ((): string | null => {
          switch ((o.ambito as AmbitoOrden) ?? "circuito") {
            case "distrito":
              return o.distrito_id != null ? String(o.distrito_id) : null;
            case "barrio":
              return (o.barrio_nombre as string) ?? null;
            case "corredor":
              return (o.corredor_nombre as string) ?? null;
            case "zona":
              return (o.zona_nombre as string) ?? null;
            case "colector":
              return (o.colector as string) ?? null;
            default:
              return (o.circuito_codigo as string) ?? null;
          }
        })(),
      indicaciones: (o.indicaciones as string) ?? null,
      // La cabecera selecciona ot.*: la columna ya viene, solo faltaba mapearla.
      contratoDecreto: (o.contrato_decreto as string) ?? null,
      items: itemsDetalle.length,
      enPlan,
      cerrados,
      hechos,
      m2Reportados: Math.round(itemsDetalle.reduce((a, i) => a + (i.superficieM2 ?? 0), 0)),
      // Ídem el listado: toneladas = Σ(superficie × espesor/100) × 2,4. Se suma
      // item por item y no sobre el total, porque cada bache tiene su espesor.
      tnReportadas: toneladasDe(
        itemsDetalle.reduce(
          (a, i) => a + volumenDe(i.superficieM2 ?? 0, i.espesorCm ?? 0),
          0,
        ),
      ),
      abierta: esAbierta(o.metadata),
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

/** Slug de la empresa que representa a las cuadrillas propias del municipio. */
const SLUG_ADMINISTRACION = "administracion";

/**
 * La empresa que EJECUTA con esta sesión, o null si la sesión no es un
 * ejecutor (staff). Es LA pieza de la unificación Campo ↔ Órdenes:
 *  - rol empresa   → su propia empresa (del JWT, fijada al loguear por slug);
 *  - rol cuadrilla → la empresa "Administración (cuadrillas propias)": las
 *    cuadrillas municipales son un ejecutor más y reportan por el mismo
 *    portal y las mismas acciones que las contratistas.
 * Como la RLS está escrita pero NO se aplica, todo filtro de propiedad de
 * órdenes/items debe salir de acá — nunca de un parámetro del cliente.
 */
export async function empresaDelEjecutor(sesion: Sesion): Promise<number | null> {
  if (sesion.rol_cimba === "empresa") return sesion.id_empresa ?? null;
  if (sesion.rol_cimba === "cuadrilla") {
    if (sesion.id_empresa) return sesion.id_empresa;
    // JWT viejo sin empresa: se resuelve por slug (consulta puntual).
    const filas = (await getDb().execute(sql`
      select id from empresas where slug = ${SLUG_ADMINISTRACION} and activa
    `)) as unknown as Array<{ id: number }>;
    return filas[0] ? Number(filas[0].id) : null;
  }
  return null;
}

/**
 * Las órdenes de la empresa del portal /empresa. El staff (vista espejo)
 * puede pasar cualquier `empresaId`; para los EJECUTORES (rol empresa y
 * rol cuadrilla) el parámetro se IGNORA y manda empresaDelEjecutor — la
 * RLS está escrita pero no se aplica, así que esta línea es el único
 * filtro real entre contratistas.
 */
export async function ordenesDeEmpresa(sesion: Sesion, empresaId?: number): Promise<OrdenResumen[]> {
  const efectiva = (await empresaDelEjecutor(sesion)) ?? empresaId;
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
  /** Cómo se resolvió: el tipo_intervencion (bacheo/pano_hormigon/carpeta/enripiado)
   *  de la última intervención finalizada del incidente — para que el cierre le
   *  diga al vecino si fue bacheo o cambio de paño. */
  tipoIntervencion: string | null;
  fotosDespues: number;
  /** URLs públicas de las fotos (antes/después) para armar la respuesta al vecino. */
  fotos: Array<{ momento: string; url: string }>;
  /** Punto del incidente reparado, para verificar la dirección en el mini-mapa antes de responder. */
  lat: number | null;
  lon: number | null;
  /**
   * Con quién se puede hablar. Solo los reclamos de Atención Ciudadana lo
   * traen (los de archivo — HCD, secretarías, redes, SAT — entraron por
   * planilla y no tienen a nadie detrás): sin esto, la bandeja no distingue
   * un cierre que se le puede avisar a una persona de uno que solo queda
   * registrado, y son dos cosas distintas.
   */
  contacto: { nombre?: string; telefono?: string; email?: string } | null;
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
  const verContacto = puedeVerContacto(sesion.rol_cimba);
  const fuente = filtroEnum(filtros.fuente, FUENTES_DEMANDA);
  const tipo = filtroEnum(filtros.tipo, TIPOS_PROBLEMA);
  const destino = filtroEnum(filtros.destino, ["bacheo", "sat", "ingenieria"]);
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select d.id as demanda_id, d.fuente, d.tipo, d.destino, d.contacto,
             coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
             d.creado_en, i.id as incidente_id, i.cerrado_en,
             st_y(i.geom) as lat, st_x(i.geom) as lon,
             (select round(sum(v.superficie_m2))::int from intervenciones v
                where v.incidente_id = i.id and v.estado = 'finalizada') as m2,
             (select v.tipo_intervencion::text from intervenciones v
                where v.incidente_id = i.id and v.estado = 'finalizada'
                  and v.tipo_intervencion is not null
                order by v.finalizada_en desc nulls last, v.id desc
                limit 1) as tipo_intervencion,
             (select count(*) from fotografias fo
                join intervenciones v on v.id = fo.intervencion_id
                where v.incidente_id = i.id and fo.momento = 'despues')::int as fotos_despues,
             -- Las fotos en sí (antes y después, las 2 más recientes de cada
             -- momento): la respuesta al vecino puede llevar el link directo
             -- al trabajo — "que tenga la foto del antes y después".
             (select json_agg(x) from (
                select fo.momento, fo.url_externa, fo.storage_path
                from fotografias fo
                join intervenciones v on v.id = fo.intervencion_id
                where v.incidente_id = i.id and fo.momento in ('antes','despues')
                order by fo.momento, fo.tomada_en desc nulls last
                limit 4
              ) x) as fotos_detalle
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
      tipoIntervencion: (f.tipo_intervencion as string) ?? null,
      fotosDespues: Number(f.fotos_despues ?? 0),
      fotos: (Array.isArray(f.fotos_detalle) ? (f.fotos_detalle as Array<Record<string, unknown>>) : [])
        .map((x) => ({
          momento: String(x.momento),
          url: urlFoto({
            urlExterna: (x.url_externa as string) ?? null,
            storagePath: (x.storage_path as string) ?? null,
          }),
        }))
        .filter((x): x is { momento: string; url: string } => x.url != null),
      lat: f.lat != null ? Number(f.lat) : null,
      lon: f.lon != null ? Number(f.lon) : null,
      /**
       * El contacto del vecino solo para quien puede verlo. La bandeja de
       * cierres la miran más roles de los que pueden cerrar (supervisión,
       * planificación, información estratégica entran a mirar), y el nombre y
       * el teléfono de una persona no son parte del tablero: el mismo
       * criterio que ya aplican listarDemandas y la ficha del reclamo.
       */
      contacto: verContacto ? ((f.contacto as DemandaParaCerrar["contacto"]) ?? null) : null,
    }));
  });
}

// ── Deuda por territorio (barrios y circuitos pintados como los distritos) ───

export interface DeudaTerritorial {
  id: number;
  nombre: string;
  abiertas: number;
  sinAtencion: number;
  /** 0..1: proporción de pedidos abiertos sin ninguna reparación cerca. */
  pct: number;
}

/**
 * El mismo "se pinta por deuda" de los distritos, para barrios y circuitos —
 * "podemos hacer lo mismo para circuito de trabajo y para barrios; eso le va
 * a hacer feliz a la doctora". Cruce de 40 m idéntico al de la brecha.
 */
export async function deudaPorTerritorio(
  sesion: Sesion,
  nivel: "barrio" | "circuito",
): Promise<DeudaTerritorial[]> {
  const columna = nivel === "barrio" ? sql`barrio_id` : sql`circuito_id`;
  const tabla = nivel === "barrio" ? sql`barrios` : sql`circuitos`;
  const nombre = nivel === "barrio" ? sql`t.nombre` : sql`t.codigo`;
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      with d as (
        select ${columna} as tid,
          exists (
            select 1 from incidentes i
            where i.estado in ('reparado','verificado')
              and st_dwithin(i.geom::geography, demandas.geom::geography, 40)
          ) as atendida
        from demandas
        where estado in ('recibida','en_validacion') and geom is not null and ${columna} is not null
      )
      select t.id, ${nombre} as nombre,
             count(d.tid)::int as abiertas,
             count(*) filter (where not d.atendida)::int as sin_atencion
      from ${tabla} t
      join d on d.tid = t.id
      group by t.id, ${nombre}
      having count(d.tid) > 0
    `)) as unknown as Array<Record<string, unknown>>;

    return filas.map((f) => {
      const abiertas = Number(f.abiertas ?? 0);
      const sinAtencion = Number(f.sin_atencion ?? 0);
      return {
        id: Number(f.id),
        nombre: String(f.nombre),
        abiertas,
        sinAtencion,
        pct: abiertas > 0 ? sinAtencion / abiertas : 0,
      };
    });
  });
}

// ── Órdenes de la red pluvial ────────────────────────────────────────────────

export interface ImbornalPendiente {
  id: number;
  ident: string | null;
  direccion: string | null;
  tipo: string | null;
  estado: string | null;
  observaciones: string | null;
  lat: number;
  lon: number;
  enOrden: boolean;
}

/**
 * Las bocas de tormenta de un colector, peor estado primero. Leo quiere darles
 * orden de trabajo igual que a los baches: "si cobran adicional por las tapas
 * y la limpieza de imbornales, entonces yo sí quiero registrar su trabajo".
 */
export async function imbornalesEnColector(sesion: Sesion, colector: string): Promise<ImbornalPendiente[]> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select im.id, im.ident, im.direccion, im.tipo, im.estado::text, im.observaciones,
             st_y(im.geom) as lat, st_x(im.geom) as lon,
             exists (
               select 1 from orden_items oi
               join ordenes_trabajo ot on ot.id = oi.orden_id
               where (oi.metadata->>'imbornal_id')::bigint = im.id
                 and oi.estado = 'pendiente'
                 and ot.estado in ('borrador','emitida','en_ejecucion')
             ) as en_orden
      from imbornales im
      where im.colector = ${colector}
      order by case im.estado
                 when 'colapsado' then 0 when 'grave' then 1
                 when 'moderado' then 2 when 'leve' then 3 else 4 end,
               im.ident
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => ({
      id: Number(f.id),
      ident: (f.ident as string) ?? null,
      direccion: (f.direccion as string) ?? null,
      tipo: (f.tipo as string) ?? null,
      estado: (f.estado as string) ?? null,
      observaciones: (f.observaciones as string) ?? null,
      lat: Number(f.lat),
      lon: Number(f.lon),
      enOrden: Boolean(f.en_orden),
    }));
  });
}

/** Los colectores con imbornales relevados, con cuántos están en mal estado. */
export async function colectoresConImbornales(
  sesion: Sesion,
): Promise<Array<{ colector: string; total: number; malos: number }>> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select colector, count(*)::int as total,
             count(*) filter (where estado in ('grave','colapsado'))::int as malos
      from imbornales where colector is not null
      group by colector order by malos desc, total desc
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => ({
      colector: String(f.colector),
      total: Number(f.total),
      malos: Number(f.malos),
    }));
  });
}

/**
 * Qué empresas pueden recibir cada tipo de orden. Una empresa sin tipos
 * declarados queda habilitada para todo: dar de alta una contratista nueva no
 * la deja muda hasta que alguien la configure.
 */
export async function empresasParaTipo(
  sesion: Sesion,
  tipo: string,
): Promise<Array<{ id: number; nombre: string; contrato: string | null }>> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select e.id, e.nombre, e.contrato
      from empresas e
      where e.activa
        and (
          not exists (select 1 from empresa_tipos_orden t where t.empresa_id = e.id)
          or exists (select 1 from empresa_tipos_orden t
                     where t.empresa_id = e.id and t.tipo::text = ${tipo})
        )
      order by e.nombre
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => ({
      id: Number(f.id),
      nombre: String(f.nombre),
      contrato: (f.contrato as string) ?? null,
    }));
  });
}

export interface OpcionAmbito {
  id: number;
  etiqueta: string;
  pendientes: number;
  /**
   * QUÉ EMPRESAS TRABAJAN ACÁ, según las zonas del contrato de bacheo integral.
   *
   * Un distrito casi nunca cae entero en una sola zona: el 9 es 66% de
   * CALLERI, 31% de UOCRA y 3% de INGECO-1. Por eso no es una empresa sino una
   * lista, ordenada por cuánto del ámbito le toca a cada una, y por eso el
   * porcentaje viaja: "casi todo tuyo" y "un pedacito tuyo" son decisiones
   * distintas para quien arma la orden.
   *
   * Vacío significa dos cosas distintas y las dos son válidas: el ámbito no
   * pisa ninguna zona, o la empresa que lo va a hacer no trabaja por zonas
   * (Administración cubre toda la ciudad; las contratistas de SIGOV van por
   * obra). Por eso esto NO filtra: informa.
   */
  empresas: Array<{ empresaId: number | null; nombre: string; pct: number }>;
  /** Solo corredores: jerarquía vial (1 = troncal) e índice de priorización. */
  nivel?: number | null;
  ipi?: number | null;
}

/**
 * Las opciones de cada ámbito con cuánto trabajo pendiente tienen. El número
 * es lo que hace elegible una opción: sin él, elegir "barrio" es adivinar.
 */
export async function opcionesAmbito(sesion: Sesion, ambito: AmbitoOrden): Promise<OpcionAmbito[]> {
  if (ambito === "circuito" || ambito === "colector") return [];
  return conRls(claims(sesion), async (tx) => {
    const consulta =
      ambito === "distrito"
        ? sql`
            select d.id, 'Distrito ' || d.id as etiqueta,
                   (select count(*) from incidentes i where i.distrito_id = d.id
                      and i.estado in ('detectado','priorizado','programado','en_ejecucion'))::int as pendientes,
                   (select coalesce(json_agg(json_build_object(
                        'empresaId', z.empresa_id, 'nombre', coalesce(e.nombre, z.empresa),
                        'pct', round(100 * st_area(st_intersection(st_makevalid(d.geom), st_makevalid(z.geom)))
                                     / nullif(st_area(st_makevalid(d.geom)), 0))
                      ) order by st_area(st_intersection(st_makevalid(d.geom), st_makevalid(z.geom))) desc), '[]'::json)
                      from zonas_bacheo z left join empresas e on e.id = z.empresa_id
                      where st_intersects(d.geom, z.geom)
                        and st_area(st_intersection(st_makevalid(d.geom), st_makevalid(z.geom)))
                            > 0.05 * st_area(st_makevalid(d.geom))) as empresas
            from distritos d order by d.id`
        : ambito === "zona"
          ? sql`
            select z.id,
                   z.nombre || coalesce(' · ' || z.empresa, '') as etiqueta,
                   (select count(*) from incidentes i
                      where i.estado in ('detectado','priorizado','programado','en_ejecucion')
                        and i.geom is not null and st_contains(z.geom, i.geom))::int as pendientes,
                   (select coalesce(json_agg(json_build_object(
                      'empresaId', z.empresa_id, 'nombre', coalesce(e2.nombre, z.empresa), 'pct', 100
                    )), '[]'::json) from empresas e2 where e2.id = z.empresa_id) as empresas
            from zonas_bacheo z order by z.nombre`
        : ambito === "barrio"
          ? sql`
            select b.id, b.nombre as etiqueta,
                   (select count(*) from incidentes i
                      where i.estado in ('detectado','priorizado','programado','en_ejecucion')
                        and i.geom is not null and st_contains(b.geom, i.geom))::int as pendientes,
                   (select coalesce(json_agg(json_build_object(
                        'empresaId', z.empresa_id, 'nombre', coalesce(e.nombre, z.empresa),
                        'pct', round(100 * st_area(st_intersection(st_makevalid(b.geom), st_makevalid(z.geom)))
                                     / nullif(st_area(st_makevalid(b.geom)), 0))
                      ) order by st_area(st_intersection(st_makevalid(b.geom), st_makevalid(z.geom))) desc), '[]'::json)
                      from zonas_bacheo z left join empresas e on e.id = z.empresa_id
                      where st_intersects(b.geom, z.geom)
                        and st_area(st_intersection(st_makevalid(b.geom), st_makevalid(z.geom)))
                            > 0.05 * st_area(st_makevalid(b.geom))) as empresas
            from barrios b order by b.nombre`
          : sql`
            /* Los MISMOS corredores que lista el IPI, y con sus datos: el
               Director pidió "que aparezcan todos los del filtro del IPI"
               para poder dar tramos de guía a recorrer. El nivel y el índice
               son lo que le permite elegir cuál: sin eso son 149 nombres de
               calle en una lista. */
            select c.id,
                   c.nombre || coalesce(' · ' || s.sector, '') as etiqueta,
                   c.nivel, c.ipi,
                   (select count(*) from incidentes i
                      where i.estado in ('detectado','priorizado','programado','en_ejecucion')
                        and i.geom is not null
                        and st_dwithin(c.geom::geography, i.geom::geography, 30))::int as pendientes,
                   (select coalesce(json_agg(json_build_object(
                        'empresaId', z.empresa_id, 'nombre', coalesce(e.nombre, z.empresa),
                        'pct', round(100 * st_length(st_intersection(c.geom, st_makevalid(z.geom))::geography)
                                     / nullif(st_length(c.geom::geography), 0))
                      ) order by st_length(st_intersection(c.geom, st_makevalid(z.geom))) desc), '[]'::json)
                      from zonas_bacheo z left join empresas e on e.id = z.empresa_id
                      where st_intersects(c.geom, z.geom)
                        and st_length(st_intersection(c.geom, st_makevalid(z.geom))::geography)
                            > 0.05 * st_length(c.geom::geography)) as empresas
            from corredores c
            left join sectores_licitacion s on s.id = c.sector_id
            order by c.nivel, c.nombre`;

    const filas = (await tx.execute(consulta)) as unknown as Array<Record<string, unknown>>;
    /**
     * TODOS los ámbitos, tengan o no pendientes. Acá había un
     * `.filter((o) => o.pendientes > 0)` y escondía la mitad del territorio:
     * `pendientes` cuenta INCIDENTES, y un incidente solo existe después de
     * consolidar los reclamos. Con 2.700 reclamos todavía sin consolidar, un
     * distrito con 35 pedidos reales figuraba en cero y directamente no
     * aparecía en la lista — el Director elegía un distrito que sabía cargado
     * de reclamos y el selector se lo negaba, sin decirle por qué.
     *
     * Pedido explícito de la Dirección de Bacheo (14/09): que estén los 20
     * distritos, todos los barrios y todos los circuitos, al menos hasta que
     * esté la conexión con Atención Ciudadana. Un ámbito en cero es
     * información —"acá no hay nada cargado"— y no un motivo para ocultarlo.
     */
    return filas.map((f) => ({
      id: Number(f.id),
      etiqueta: String(f.etiqueta),
      pendientes: Number(f.pendientes ?? 0),
      nivel: f.nivel != null ? Number(f.nivel) : null,
      ipi: f.ipi != null ? Number(f.ipi) : null,
      /**
       * Se suman las zonas de una MISMA empresa. INGECO tiene dos por contrato
       * (Centro-Este y SE), así que el distrito 10 salía diciendo "INGECO S.A.
       * 55%, INGECO S.A. 45%" — dos veces la misma empresa, como si fueran
       * rivales repartiéndose el distrito. Para la pregunta que esto contesta
       * —"¿a quién se lo doy?"— son la misma: INGECO S.A. 100%.
       */
      empresas: Object.values(
        ((f.empresas as Array<{ empresaId: number | null; nombre: string | null; pct: number | null }>) ?? [])
          .filter((e) => e.nombre)
          .reduce<Record<string, { empresaId: number | null; nombre: string; pct: number }>>((acc, e) => {
            const clave = e.empresaId != null ? `id:${e.empresaId}` : `n:${e.nombre}`;
            const previo = acc[clave];
            if (previo) previo.pct += Number(e.pct ?? 0);
            else {
              acc[clave] = {
                empresaId: e.empresaId != null ? Number(e.empresaId) : null,
                nombre: String(e.nombre),
                pct: Number(e.pct ?? 0),
              };
            }
            return acc;
          }, {}),
      ).sort((a, b) => b.pct - a.pct),
    }));
  });
}

/**
 * Cuántas órdenes activas se pasaron de fecha. Consulta propia y no un
 * `.filter()` sobre listarOrdenes porque esa tiene `limit 200`: contar del
 * array daría un número distinto al del parte diario en cuanto haya más de
 * doscientas órdenes, y el KPI existe justamente para que no haya dos cifras
 * de lo mismo.
 *
 * La comparación es contra la fecha LOCAL calculada en Postgres
 * (America/Argentina/Tucuman): vence_en es un date sin hora, y con `now()` en
 * UTC una orden que vence hoy aparecería vencida desde las 21:00 de ayer.
 */
export async function contarOrdenesVencidas(sesion: Sesion): Promise<number> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select count(*)::int as n
      from ordenes_trabajo ot
      where ot.estado in ('emitida', 'en_ejecucion')
        and ot.vence_en is not null
        and ot.vence_en < (now() at time zone 'America/Argentina/Tucuman')::date
    `)) as unknown as Array<{ n: number }>;
    return Number(filas[0]?.n ?? 0);
  });
}

/**
 * Vive acá y NO en acciones-ordenes.ts porque ese archivo es "use server":
 * cualquier export suyo es una server action que el cliente puede invocar, y
 * esta función recibe la sesión como argumento — publicarla habría dejado que
 * el navegador dijera quién es. Acá adentro es una consulta común, llamada
 * desde un server component que ya resolvió la sesión.
 *
 * El historial de correcciones de un item: quién tocó qué y por qué. Sale de
 * `auditoria`, que ya venía registrando todo por trigger — no hace falta una
 * tabla nueva para contestar "esto lo cambió alguien, ¿quién?".
 */
export async function historialItem(
  sesion: Sesion,
  itemId: number,
): Promise<Array<{ accion: string; cuando: string; por: string | null; motivo: string | null; antes: unknown; despues: unknown }>> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select a.accion, a.ocurrido_en, a.diff, p.nombre as actor_nombre
      from auditoria a
      left join perfiles p on p.id = a.actor
      where a.entidad in ('orden_item', 'orden_items') and a.entidad_id = ${itemId}
        and a.accion <> 'insert'
      order by a.ocurrido_en desc
      limit 50
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => {
      const diff = (f.diff ?? {}) as Record<string, unknown>;
      return {
        accion: String(f.accion),
        cuando: String(f.ocurrido_en),
        por: (diff.por as string) ?? (f.actor_nombre as string) ?? null,
        motivo: (diff.motivo as string) ?? null,
        antes: diff.antes ?? null,
        despues: diff.despues ?? null,
      };
    });
  });
}
