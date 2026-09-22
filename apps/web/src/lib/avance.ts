import { conRls, sql } from "@cimba/db";
import type { Sesion } from "./auth";
import { urlFoto } from "./fotos";
import { numero } from "./formato";
import {
  type Cifra,
  type DatosAvance,
  type DiasVentana,
  type EnCursoProps,
  type EventoAvance,
  type FilaEmpresa,
  type FotoAvance,
  type HechoProps,
  type OrdenActiva,
  type PendienteProps,
  type PuntoSerie,
} from "./avance-tipos";

export { VENTANAS, VENTANA_DEFAULT, ventanaValida } from "./avance-tipos";
export type { DatosAvance, DiasVentana } from "./avance-tipos";

/**
 * AVANCE: la ciudad contada desde lo hecho.
 *
 * El mapa principal responde "¿qué falta y dónde?": la figura son los reclamos
 * pendientes y la ciudad es el fondo. Esta consulta arma la pantalla inversa:
 * la figura es el trabajo ejecutado —cada intervención con su empresa, su
 * superficie y su fecha— y lo que se está haciendo ahora; lo pendiente sigue
 * ahí, como fondo que no se apaga, para que la vista positiva no sea una vista
 * mentirosa.
 *
 * Todo sale de las mismas tablas que el resto del sistema. No hay una cuenta
 * nueva: "m²" son los m² de intervenciones finalizadas, igual que en los KPI
 * del mapa; "pendientes" son los pedidos que cuenta la Brecha. Si dos
 * pantallas dicen cosas distintas es un bug, no una interpretación.
 */

const TZ = "America/Argentina/Tucuman";
type Fila = Record<string, unknown>;

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

/**
 * LA BASE: cada intervención con ubicación en un estado dado, atribuida a su
 * empresa.
 *
 * La atribución tiene dos caminos porque el trabajo entra por dos puertas. Lo
 * mandado por una orden de CIMBA tiene la empresa en la orden. Lo que llegó
 * por planilla, por el SIGOV o por la app de la empresa (la mitad larga del
 * bacheo de la ciudad) trae el nombre escrito a mano en metadata —"GALINDO
 * -1", "INGECO S.A -1", "CALLERI E HIJOS SA (1)"— y se resuelve contra la
 * tabla de empresas por la primera palabra sin acentos, que es el slug. Lo
 * que no matchea con ninguna (un nombre de persona, un "Sin empresa") queda
 * como "Otros": no se inventa y no se esconde.
 *
 * La fecha es la del TRABAJO (finalizada_en), no la de la carga: un bache
 * tapado el lunes que se cargó el jueves cuenta para el lunes.
 */
const baseDe = (estado: "finalizada" | "en_curso") => sql`
  select iv.id,
         coalesce(iv.finalizada_en, iv.iniciada_en, iv.creado_en) as fecha,
         iv.iniciada_en,
         iv.superficie_m2, iv.volumen_m3, iv.tipo_intervencion::text as tipo,
         iv.geom_ejecucion, iv.incidente_id,
         it.orden_id, it.numero,
         coalesce(e_ot.nombre, e_md.nombre) as empresa_nombre,
         coalesce(e_ot.slug, e_md.slug, 'otros') as slug
  from intervenciones iv
  left join lateral (
    select oi.orden_id, ot.numero, ot.empresa_id
    from orden_items oi
    join ordenes_trabajo ot on ot.id = oi.orden_id
    where oi.intervencion_id = iv.id
    order by oi.id
    limit 1
  ) it on true
  left join empresas e_ot on e_ot.id = it.empresa_id
  left join empresas e_md
    on it.empresa_id is null
   and e_md.slug = lower(public.unaccent(split_part(trim(coalesce(iv.metadata->>'contratista', iv.metadata->>'empresa', '')), ' ', 1)))
  where iv.estado = ${estado}
    and iv.geom_ejecucion is not null
`;

/** Lo terminado: es lo que se cuenta como hecho, igual que en el resto del sistema. */
const BASE = baseDe("finalizada");

/** El nombre corto con el que se muestra la empresa: la primera palabra del canónico. */
const EMPRESA_CORTA = sql`coalesce(initcap(split_part(b.empresa_nombre, ' ', 1)), 'Otros')`;

/**
 * Desde cuándo mira la ventana. "Hoy" es desde la medianoche de Tucumán, no
 * "las últimas 24 horas": a las 9 de la mañana un día corrido se lleva puesta
 * media tarde de ayer. Los demás recortes son ventanas corridas, que es lo que
 * se espera de "últimos 30 días". "Todo" no filtra.
 */
function desdeDe(dias: DiasVentana) {
  if (dias === 0) return null;
  if (dias === 1) return sql`(date_trunc('day', now() at time zone ${TZ}) at time zone ${TZ})`;
  return sql`(now() - (${dias} || ' days')::interval)`;
}

const cifraDe = (f: Fila, p: string): Cifra => ({
  n: Number(f[`${p}_n`] ?? 0),
  m2: Number(f[`${p}_m2`] ?? 0),
  toneladas: Number(f[`${p}_t`] ?? 0),
});

const texto = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const punto = (f: Fila) => ({ type: "Point" as const, coordinates: [Number(f.lon), Number(f.lat)] });

/** "CALLERI E HIJOS S.A." → "Calleri": el nombre corto de una empresa, en TS. */
function corto(nombre: string): string {
  const palabra = nombre.trim().split(/[\s(]+/)[0] ?? nombre;
  return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
}

/**
 * Las 26 semanas completas, con ceros donde no hubo nada: la serie que sale
 * de la base solo trae las semanas con trabajo, y un gráfico que se salta
 * semanas miente sobre el ritmo.
 */
function completarSerie(filas: Fila[], hoy: string): PuntoSerie[] {
  const porSemana = new Map(filas.map((f) => [String(f.semana), { n: Number(f.n), m2: Number(f.m2) }]));
  const base = new Date(`${hoy}T12:00:00Z`);
  const lunes = new Date(base.getTime() - ((base.getUTCDay() + 6) % 7) * 86_400_000);
  const serie: PuntoSerie[] = [];
  for (let i = 25; i >= 0; i--) {
    const clave = new Date(lunes.getTime() - i * 7 * 86_400_000).toISOString().slice(0, 10);
    const v = porSemana.get(clave);
    serie.push({ semana: clave, n: v?.n ?? 0, m2: v?.m2 ?? 0 });
  }
  return serie;
}

const ETIQUETA_DESCARTE: Record<string, string> = {
  no_encontrado: "no encontrado",
  no_ejecutable: "no ejecutable",
  ya_resuelto: "ya resuelto",
  rechazado: "rechazado",
};

/**
 * Un movimiento interpretado pero todavía no redactado: lo que hace falta para
 * juntar varios iguales en una línea y después escribir la frase.
 */
interface Movimiento {
  id: string;
  en: string;
  tipo: EventoAvance["tipo"];
  /** Los que comparten clave y están cerca en el tiempo se cuentan juntos. */
  clave: string;
  actor: string;
  empresa: string | null;
  empresaOrden: string | null;
  nro: string | null;
  ordenId: number | null;
  lugares: string[];
  m2: number;
  n: number;
  lon: number | null;
  lat: number | null;
  /** Para los descartes: qué se dijo del bache (no encontrado, ya resuelto…). */
  etiqueta: string | null;
  /** Para las cargas sueltas: si la informó la empresa o la cargó el municipio. */
  deEmpresa: boolean;
  /** Frase ya cerrada, para los movimientos que no se agrupan (órdenes). */
  fija: string | null;
}

/**
 * DE LA AUDITORÍA A UN MOVIMIENTO. El feed viejo mostraba "CALLERI E HIJOS
 * S.A.: insert en orden_items", que es lo que dice la base, no lo que pasó.
 * Acá cada movimiento de TRABAJO se interpreta —quién, qué, en qué orden,
 * dónde, cuánto— y lo que no es trabajo (entrar al sistema, un aviso) o no
 * tiene una lectura clara devuelve null y no aparece.
 *
 * El actor empresa se muestra por su nombre corto, que es el mismo que pinta
 * el mapa. Los actores del municipio, por su nombre de perfil.
 */
function interpretar(f: Fila): Movimiento | null {
  const entidad = String(f.entidad);
  const accion = String(f.accion);
  const rol = texto(f.actor_rol);
  const actorCrudo = texto(f.actor_nombre) ?? "Alguien";
  const actor = rol === "empresa" ? corto(actorCrudo) : actorCrudo;
  const empresaOrden = texto(f.orden_empresa);
  const empresa = rol === "empresa" ? actor : empresaOrden;
  const nro = texto(f.orden_numero) ?? texto(f.numero_diff);
  const ordenId = num(f.orden_id);
  const antes = texto(f.estado_antes);
  const despues = texto(f.estado_despues);
  const lugar = texto(f.lugar) ?? texto(f.direccion_diff);
  const m2 = num(f.m2) ?? 0;

  const mov = (tipo: Movimiento["tipo"], extra: Partial<Movimiento> = {}): Movimiento => ({
    id: String(f.id),
    en: String(f.en),
    tipo,
    clave: `${tipo}|${actor}|${ordenId ?? ""}|${extra.etiqueta ?? ""}`,
    actor,
    empresa,
    empresaOrden,
    nro,
    ordenId,
    lugares: lugar ? [lugar] : [],
    m2: m2 > 0 ? m2 : 0,
    n: 1,
    lon: num(f.lon),
    lat: num(f.lat),
    etiqueta: null,
    deEmpresa: rol === "empresa",
    fija: null,
    ...extra,
  });
  /* Las órdenes no se agrupan: cada una es una noticia. La clave lleva el id. */
  const deOrden = (frase: string) => mov("orden", { fija: frase, clave: `orden|${String(f.id)}` });

  if (entidad === "orden_items") {
    if (accion === "insert") {
      if (despues === "propuesto") return mov("propuesto");
      return mov("orden", { fija: `${actor} agregó un bache a ${nro ?? "una orden"}`, clave: `agrego|${actor}|${ordenId ?? ""}` });
    }
    if (accion === "update") {
      if (antes === "propuesto" && rol !== "empresa" && (despues === "pendiente" || despues === "hecho")) return mov("validado");
      if (antes === "propuesto" && despues === "rechazado") return mov("descartado", { etiqueta: "rechazado" });
      if (despues === "hecho" && antes !== "hecho") return mov("hecho");
      if (despues && despues !== antes && ETIQUETA_DESCARTE[despues]) return mov("descartado", { etiqueta: ETIQUETA_DESCARTE[despues]! });
      return null;
    }
    return null;
  }

  if (entidad === "orden_item" && accion === "medidas_corregidas") return mov("corregido");

  if (entidad === "ordenes_trabajo" && accion === "update") {
    const a = empresaOrden ? ` a ${empresaOrden}` : "";
    const de = empresaOrden ? ` de ${empresaOrden}` : "";
    if (f.cierre_manual === true) return deOrden(`${actor} cerró ${nro ?? "una orden"}`);
    if (f.reasignada === true) return deOrden(`${actor} pasó ${nro ?? "una orden"}${a}`);
    if (despues !== antes) {
      if (despues === "emitida") return deOrden(`${actor} emitió ${nro ?? "una orden"}${a}`);
      if (despues === "en_ejecucion") return deOrden(`${nro ?? "Una orden"}${de} entró en ejecución`);
      if (despues === "completada") return deOrden(`Se completó ${nro ?? "una orden"}${de}`);
      if (despues === "anulada") return deOrden(`${actor} anuló ${nro ?? "una orden"}`);
    }
    return null;
  }

  if (entidad === "intervenciones") {
    if (accion === "insert" && f.en_orden !== true) return mov("carga");
    if (accion === "update" && despues === "finalizada" && antes && antes !== "finalizada") {
      return mov("hecho", { clave: `obra|${actor}` });
    }
    return null;
  }

  if (entidad === "incidentes" && accion === "update" && despues === "verificado" && antes !== "verificado") {
    return mov("verificado");
  }

  if (entidad === "demandas" && f.cierre_vecino === true) return mov("vecino");

  return null;
}

/** Hasta cuánto tiempo entre dos movimientos iguales para contarlos juntos. */
const VENTANA_AGRUPAR_MS = 45 * 60_000;

/**
 * JUNTAR LO REPETIDO. Una empresa que carga siete propuestos en veinte minutos
 * es UNA noticia —"Calleri propuso 7 baches en OT-2026-0006"—, no siete
 * líneas idénticas que tapan todo lo demás. Se agrupan los consecutivos con la
 * misma clave (mismo tipo, mismo actor, misma orden) a menos de 45 minutos.
 */
function agrupar(movs: Movimiento[]): Movimiento[] {
  const salida: Movimiento[] = [];
  for (const m of movs) {
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.clave === m.clave && Date.parse(ultimo.en) - Date.parse(m.en) < VENTANA_AGRUPAR_MS) {
      ultimo.n += m.n;
      ultimo.m2 += m.m2;
      ultimo.lugares.push(...m.lugares);
      continue;
    }
    salida.push({ ...m, lugares: [...m.lugares] });
  }
  return salida;
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : `${numero(n)} ${varios}`);

/** La frase final de un movimiento (o de un grupo), con la orden y los m² si los hay. */
function redactar(m: Movimiento): EventoAvance {
  const enOrden = m.nro ? ` en ${m.nro}` : "";
  const conM2 = m.m2 > 0 ? ` · ${numero(Math.round(m.m2 * 10) / 10)} m²` : "";
  const por = m.empresaOrden ? ` por ${m.empresaOrden}` : "";
  let frase: string;
  switch (m.tipo) {
    case "propuesto":
      frase = `${m.actor} propuso ${plural(m.n, "un bache", "baches")}${enOrden}${conM2}`;
      break;
    case "hecho":
      frase =
        m.clave.startsWith("obra|")
          ? `${m.actor} dio por terminada ${plural(m.n, "una obra", "obras")}${conM2}`
          : `${m.actor} reportó ${plural(m.n, "un bache hecho", "baches hechos")}${enOrden}${conM2}`;
      break;
    case "validado":
      frase = `${m.actor} validó ${plural(m.n, "un bache propuesto", "baches propuestos")}${por}${enOrden}`;
      break;
    case "descartado":
      frase =
        m.etiqueta === "rechazado"
          ? `${m.actor} rechazó ${plural(m.n, "un bache propuesto", "baches propuestos")}${enOrden}`
          : `${m.actor} marcó ${plural(m.n, "un bache", "baches")} como ${m.etiqueta ?? "no ejecutable"}${enOrden}`;
      break;
    case "corregido":
      frase = `${m.actor} corrigió las medidas de ${plural(m.n, "un bache", "baches")}${enOrden}`;
      break;
    case "carga":
      frase = m.deEmpresa
        ? `${m.actor} informó ${plural(m.n, "un trabajo", "trabajos")} sin orden${conM2}`
        : `${m.actor} cargó ${plural(m.n, "un trabajo terminado", "trabajos terminados")}${conM2}`;
      break;
    case "verificado":
      frase = `${m.actor} verificó ${plural(m.n, "una reparación", "reparaciones")}`;
      break;
    case "vecino":
      frase = `${m.actor} le avisó a ${plural(m.n, "un vecino", "vecinos")} que su pedido quedó resuelto`;
      break;
    default:
      frase = m.fija ?? `${m.actor} actualizó una orden`;
  }
  const [primero, ...resto] = m.lugares;
  return {
    id: m.id,
    en: m.en,
    tipo: m.tipo,
    frase,
    empresa: m.empresa,
    lugar: primero ? (resto.length > 0 ? `${primero} y ${numero(resto.length)} más` : primero) : null,
    lon: m.lon,
    lat: m.lat,
    ordenId: m.ordenId,
  };
}

export async function datosAvance(sesion: Sesion, dias: DiasVentana): Promise<DatosAvance> {
  const desde = desdeDe(dias);
  const enVentana = desde ? sql`b.fecha >= ${desde}` : sql`true`;
  const diaLocal = sql`(b.fecha at time zone ${TZ})::date`;
  // El feed nombra a quien hizo cada cosa: misma regla que /actividad.
  const conFeed = ["admin", "planificacion"].includes(sesion.rol_cimba);

  /**
   * Las consultas se despachan JUNTAS: postgres.js las encadena por la misma
   * conexión (pipelining) y se ahorra las idas y vueltas al servidor. En serie
   * tardaban ~2,8 s desde la oficina; es la portada, y la portada no puede
   * hacer esperar tres segundos.
   */
  return conRls(claims(sesion), async (tx) => {
    const qHechos = tx.execute(sql`
      select b.id,
             to_char(b.fecha at time zone ${TZ}, 'YYYY-MM-DD') as fecha,
             (${diaLocal} - date '2026-01-01')::int as dia,
             ${EMPRESA_CORTA} as empresa,
             b.superficie_m2::float as m2,
             round(b.volumen_m3 * 2.4, 2)::float as toneladas,
             case when b.orden_id is null then 'archivo' else 'orden' end as fuente,
             b.numero as orden, b.orden_id, i.direccion, b.tipo,
             (b.fecha >= now() - interval '48 hours') as reciente,
             fo.storage_path, fo.url_externa,
             st_x(st_centroid(b.geom_ejecucion))::float as lon,
             st_y(st_centroid(b.geom_ejecucion))::float as lat
      from (${BASE}) b
      left join incidentes i on i.id = b.incidente_id
      left join lateral (
        select f.storage_path, f.url_externa
        from fotografias f
        where f.intervencion_id = b.id and f.momento = 'despues'
        order by f.tomada_en desc nulls last
        limit 1
      ) fo on true
      where ${enVentana}
      order by b.fecha
    `);

    /**
     * EL AHORA: las obras empezadas y no terminadas —paños de hormigón,
     * carpetas— vengan de donde vengan. No dependen de la ventana: una obra en
     * curso está en curso hoy, la hayan empezado ayer o hace un mes (y si hace
     * un mes que figura así, que se vea es justamente el punto).
     */
    const qEnCurso = tx.execute(sql`
      select b.id, ${EMPRESA_CORTA} as empresa,
             b.superficie_m2::float as m2, b.tipo,
             to_char(b.iniciada_en at time zone ${TZ}, 'YYYY-MM-DD') as iniciada,
             i.direccion,
             st_x(st_centroid(b.geom_ejecucion))::float as lon,
             st_y(st_centroid(b.geom_ejecucion))::float as lat
      from (${baseDe("en_curso")}) b
      left join incidentes i on i.id = b.incidente_id
      order by b.superficie_m2 desc nulls last
    `);

    /**
     * EL FONDO QUE NO SE APAGA: los pedidos de bacheo que esperan, con
     * ubicación. Es exactamente el conjunto que dibuja el mapa de la Brecha
     * como "en cola", así que el número de acá y el de allá son el mismo.
     */
    const qPendientes = tx.execute(sql`
      select d.id,
             to_char(d.creado_en at time zone ${TZ}, 'YYYY-MM-DD') as fecha,
             coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
             st_x(st_centroid(d.geom))::float as lon,
             st_y(st_centroid(d.geom))::float as lat
      from demandas d
      where d.estado in ('recibida', 'en_validacion')
        and d.geom is not null
        and coalesce(d.destino::text, 'bacheo') = 'bacheo'
    `);

    /**
     * LAS ÓRDENES ACTIVAS: emitidas o en ejecución, con su área REAL —la
     * envolvente de sus items, con 50 m de margen— y no el ámbito nominal. Una
     * orden "del distrito 9" pintaría medio distrito; la envolvente de sus 112
     * baches pinta las cuadras donde de verdad está la cuadrilla. Una orden
     * con un solo item queda como un círculo de 50 m.
     */
    const qOrdenes = tx.execute(sql`
      select ot.id, ot.numero, ot.estado::text as estado, ot.tipo::text as tipo,
             initcap(split_part(e.nombre, ' ', 1)) as empresa,
             count(oi.id)::int as items,
             count(oi.id) filter (where oi.estado = 'hecho')::int as hechos,
             to_char(max(oi.reportado_en) at time zone ${TZ}, 'YYYY-MM-DD') as ultimo,
             case when count(oi.geom) > 0 then
               st_asgeojson(st_simplify(
                 st_buffer(st_concavehull(st_collect(oi.geom), 0.5, false)::geography, 50)::geometry,
                 0.00005))::json
             end as area
      from ordenes_trabajo ot
      join empresas e on e.id = ot.empresa_id
      left join orden_items oi on oi.orden_id = ot.id
      where ot.estado in ('emitida', 'en_ejecucion')
      group by ot.id, ot.numero, ot.estado, ot.tipo, e.nombre, ot.emitida_en
      order by max(oi.reportado_en) desc nulls last, ot.emitida_en desc
    `);

    /**
     * Las cifras de lo hecho, todas en una pasada sobre la misma base. `ref`
     * va a la izquierda del join para que, aun con la base vacía, salga una
     * fila con ceros y no ninguna. "Otros" no cuenta como empresa.
     */
    const qCifras = tx.execute(sql`
      with b as (${BASE}),
           ref as (select (now() at time zone ${TZ})::date as hoy)
      select
        count(b.id) filter (where ${enVentana})::int as v_n,
        round(coalesce(sum(b.superficie_m2) filter (where ${enVentana}), 0))::int as v_m2,
        round(coalesce(sum(b.volumen_m3) filter (where ${enVentana}), 0) * 2.4)::int as v_t,
        count(distinct b.slug) filter (where ${enVentana} and b.slug <> 'otros')::int as v_empresas,

        count(b.id) filter (where ${diaLocal} = ref.hoy)::int as h_n,
        round(coalesce(sum(b.superficie_m2) filter (where ${diaLocal} = ref.hoy), 0))::int as h_m2,
        round(coalesce(sum(b.volumen_m3) filter (where ${diaLocal} = ref.hoy), 0) * 2.4)::int as h_t,

        count(b.id) filter (where ${diaLocal} = ref.hoy - 1)::int as a_n,
        round(coalesce(sum(b.superficie_m2) filter (where ${diaLocal} = ref.hoy - 1), 0))::int as a_m2,
        round(coalesce(sum(b.volumen_m3) filter (where ${diaLocal} = ref.hoy - 1), 0) * 2.4)::int as a_t,

        count(b.id) filter (where b.fecha >= now() - interval '7 days')::int as s_n,
        round(coalesce(sum(b.superficie_m2) filter (where b.fecha >= now() - interval '7 days'), 0))::int as s_m2,
        round(coalesce(sum(b.volumen_m3) filter (where b.fecha >= now() - interval '7 days'), 0) * 2.4)::int as s_t,

        count(b.id) filter (where b.fecha >= now() - interval '30 days')::int as m_n,
        round(coalesce(sum(b.superficie_m2) filter (where b.fecha >= now() - interval '30 days'), 0))::int as m_m2,
        round(coalesce(sum(b.volumen_m3) filter (where b.fecha >= now() - interval '30 days'), 0) * 2.4)::int as m_t,

        count(b.id)::int as t_n,
        round(coalesce(sum(b.superficie_m2), 0))::int as t_m2,
        round(coalesce(sum(b.volumen_m3), 0) * 2.4)::int as t_t,
        to_char(min(b.fecha) at time zone ${TZ}, 'YYYY-MM-DD') as t_desde,

        to_char(ref.hoy, 'YYYY-MM-DD') as hoy,
        (ref.hoy - date '2026-01-01')::int as hoy_dia,
        ${desde ? sql`to_char(${desde} at time zone ${TZ}, 'YYYY-MM-DD')` : sql`null::text`} as v_desde,
        ${desde ? sql`((${desde} at time zone ${TZ})::date - date '2026-01-01')::int` : sql`null::int`} as v_desde_dia
      from ref
      left join b on true
      group by ref.hoy
    `);

    /* Lo que pasa ahora y lo que falta: números chicos, consultas directas. */
    const qResto = tx.execute(sql`
      select
        (select count(*) from intervenciones where estado = 'en_curso' and geom_ejecucion is not null)::int as ec_n,
        (select round(coalesce(sum(superficie_m2), 0)) from intervenciones where estado = 'en_curso' and geom_ejecucion is not null)::int as ec_m2,
        (select count(*) from ordenes_trabajo where estado in ('emitida', 'en_ejecucion'))::int as ordenes_activas,
        (select count(*) from demandas d
          where d.estado in ('recibida', 'en_validacion') and d.geom is not null
            and coalesce(d.destino::text, 'bacheo') = 'bacheo')::int as pedidos,
        (select count(*) from incidentes
          where estado in ('detectado', 'priorizado', 'programado', 'en_ejecucion'))::int as incidentes,
        (select count(*) from intervenciones where estado = 'asignada')::int as as_n,
        (select round(coalesce(sum(superficie_m2), 0)) from intervenciones where estado = 'asignada')::int as as_m2
    `);

    const qPorEmpresa = tx.execute(sql`
      select ${EMPRESA_CORTA} as empresa,
             count(*)::int as n,
             round(coalesce(sum(b.superficie_m2), 0))::int as m2,
             round(coalesce(sum(b.volumen_m3), 0) * 2.4)::int as toneladas,
             to_char(max(b.fecha) at time zone ${TZ}, 'YYYY-MM-DD') as ultimo
      from (${BASE}) b
      where ${enVentana}
      group by 1
      order by 3 desc, 2 desc
    `);

    /* El ritmo: m² por semana en las últimas 26, siempre las mismas 26 sin
       importar la ventana, para que el contexto no se mueva con el filtro. */
    const qSerie = tx.execute(sql`
      select to_char(date_trunc('week', b.fecha at time zone ${TZ})::date, 'YYYY-MM-DD') as semana,
             count(*)::int as n,
             round(coalesce(sum(b.superficie_m2), 0))::int as m2
      from (${BASE}) b
      where b.fecha >= (date_trunc('week', now() at time zone ${TZ}) - interval '25 weeks') at time zone ${TZ}
      group by 1
      order by 1
    `);

    /**
     * PASANDO AHORA, materia prima: los movimientos de la última semana sobre
     * las tablas de TRABAJO, hechos por una persona (lo automático entra
     * aparte, agregado). Se traen con la orden, la empresa y el LUGAR del
     * registro vivo, para que cada línea del feed pueda ir al mapa. La frase
     * se arma en fraseDe(); lo que no tiene lectura clara se descarta ahí, por
     * eso se piden más filas de las que se muestran.
     */
    const qFeed = conFeed
      ? tx.execute(sql`
      select a.id, a.entidad, a.entidad_id, a.accion,
             to_char(a.ocurrido_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as en,
             p.nombre as actor_nombre, p.rol::text as actor_rol,
             a.diff->'antes'->>'estado' as estado_antes,
             coalesce(a.diff->'despues'->>'estado', case when a.accion = 'insert' then a.diff->>'estado' end) as estado_despues,
             coalesce(a.diff->>'direccion', a.diff->'despues'->>'direccion') as direccion_diff,
             nullif(coalesce(a.diff->>'superficie_m2', a.diff->'despues'->>'superficie_m2'), '')::numeric as m2,
             coalesce(a.diff->>'numero', a.diff->'despues'->>'numero') as numero_diff,
             (a.entidad = 'ordenes_trabajo'
               and (a.diff->'despues'->'metadata' ? 'cierre_manual')
               and not coalesce(a.diff->'antes'->'metadata' ? 'cierre_manual', false)) as cierre_manual,
             (a.entidad = 'ordenes_trabajo'
               and coalesce(jsonb_array_length(a.diff->'despues'->'metadata'->'reasignaciones'), 0)
                 > coalesce(jsonb_array_length(a.diff->'antes'->'metadata'->'reasignaciones'), 0)) as reasignada,
             (a.entidad = 'demandas'
               and (a.diff->'despues'->'metadata' ? 'cierre')
               and not coalesce(a.diff->'antes'->'metadata' ? 'cierre', false)) as cierre_vecino,
             (a.entidad = 'intervenciones'
               and exists (select 1 from orden_items x where x.intervencion_id = a.entidad_id)) as en_orden,
             ot.id as orden_id, ot.numero as orden_numero,
             initcap(split_part(e.nombre, ' ', 1)) as orden_empresa,
             coalesce(oi.direccion, i_it.direccion, i_iv.direccion, inc.direccion,
                      d.direccion_normalizada, d.direccion_texto) as lugar,
             st_x(st_centroid(coalesce(oi.geom, iv.geom_ejecucion, inc.geom, d.geom)))::float as lon,
             st_y(st_centroid(coalesce(oi.geom, iv.geom_ejecucion, inc.geom, d.geom)))::float as lat
      from auditoria a
      left join perfiles p on p.id = a.actor
      left join orden_items oi on a.entidad in ('orden_items', 'orden_item') and oi.id = a.entidad_id
      left join incidentes i_it on i_it.id = oi.incidente_id
      left join intervenciones iv on a.entidad = 'intervenciones' and iv.id = a.entidad_id
      left join incidentes i_iv on i_iv.id = iv.incidente_id
      left join incidentes inc on a.entidad = 'incidentes' and inc.id = a.entidad_id
      left join demandas d on a.entidad = 'demandas' and d.id = a.entidad_id
      left join ordenes_trabajo ot
        on ot.id = coalesce(oi.orden_id, case when a.entidad = 'ordenes_trabajo' then a.entidad_id end)
      left join empresas e on e.id = ot.empresa_id
      where a.ocurrido_en > now() - interval '7 days'
        and a.actor is not null
        and a.entidad in ('orden_items', 'orden_item', 'ordenes_trabajo', 'intervenciones', 'incidentes', 'demandas')
      order by a.ocurrido_en desc
      limit 150
    `)
      : Promise.resolve([] as unknown[]);

    /**
     * Lo automático, agregado: las tandas de trabajos que entran por la
     * sincronización con la app de las empresas o por un archivo. Una tanda
     * de 231 baches es una noticia de avance; 231 líneas no lo son.
     */
    const qSync = conFeed
      ? tx.execute(sql`
      select to_char(max(a.ocurrido_en) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as en,
             count(*)::int as n,
             mode() within group (order by initcap(split_part(trim(coalesce(iv.metadata->>'contratista', iv.metadata->>'empresa', '')), ' ', 1))) as empresa
      from auditoria a
      left join intervenciones iv on iv.id = a.entidad_id
      where a.entidad = 'intervenciones' and a.accion = 'insert' and a.actor is null
        and a.ocurrido_en > now() - interval '7 days'
      group by date_trunc('hour', a.ocurrido_en)
      order by 1 desc
      limit 5
    `)
      : Promise.resolve([] as unknown[]);

    /* Las últimas fotos del "después", con su lugar: la prueba, y un atajo al mapa. */
    const qFotos = tx.execute(sql`
      select fo.url_externa, fo.storage_path, i.direccion, iv.id as intervencion_id,
             nullif(coalesce(initcap(split_part(e.nombre, ' ', 1)),
                             initcap(split_part(trim(coalesce(iv.metadata->>'contratista', iv.metadata->>'empresa', '')), ' ', 1))), '') as empresa,
             st_x(st_centroid(iv.geom_ejecucion))::float as lon,
             st_y(st_centroid(iv.geom_ejecucion))::float as lat
      from fotografias fo
      join intervenciones iv on iv.id = fo.intervencion_id
      left join incidentes i on i.id = iv.incidente_id
      left join lateral (
        select ot.empresa_id from orden_items oi join ordenes_trabajo ot on ot.id = oi.orden_id
        where oi.intervencion_id = iv.id limit 1
      ) it on true
      left join empresas e on e.id = it.empresa_id
      where fo.momento = 'despues'
      order by fo.tomada_en desc nulls last
      limit 6
    `);

    const [hechos, enCurso, pendientes, ordenes, filasCifras, filasResto, porEmpresa, serie, feedCrudo, sync, fotos] =
      (await Promise.all([
        qHechos,
        qEnCurso,
        qPendientes,
        qOrdenes,
        qCifras,
        qResto,
        qPorEmpresa,
        qSerie,
        qFeed,
        qSync,
        qFotos,
      ])) as unknown as [Fila[], Fila[], Fila[], Fila[], Fila[], Fila[], Fila[], Fila[], Fila[], Fila[], Fila[]];
    const cifras = filasCifras[0] ?? {};
    const resto = filasResto[0] ?? {};

    const hoy = String(cifras.hoy ?? new Date().toISOString().slice(0, 10));

    const ordenesLista: OrdenActiva[] = ordenes.map((o) => ({
      id: Number(o.id),
      numero: String(o.numero),
      estado: String(o.estado),
      tipo: String(o.tipo),
      empresa: String(o.empresa),
      items: Number(o.items),
      hechos: Number(o.hechos),
      ultimo: texto(o.ultimo),
    }));

    const feed: EventoAvance[] = [
      ...agrupar(feedCrudo.map(interpretar).filter((m): m is Movimiento => m != null)).map(redactar),
      ...sync.map(
        (s, i): EventoAvance => ({
          id: `sync-${i}`,
          en: String(s.en),
          tipo: "sync",
          frase: `Entraron ${numero(Number(s.n))} trabajos ${texto(s.empresa) ? `de ${String(s.empresa)}` : "de las planillas"} por sincronización`,
          empresa: texto(s.empresa),
          lugar: null,
          lon: null,
          lat: null,
          ordenId: null,
        }),
      ),
    ]
      .sort((a, b) => (a.en < b.en ? 1 : a.en > b.en ? -1 : 0))
      .slice(0, 12);

    return {
      generadoEn: new Date().toISOString(),
      hoy,
      hoyDia: Number(cifras.hoy_dia ?? 0),
      ventana: {
        dias,
        desde: texto(cifras.v_desde),
        desdeDia: cifras.v_desde_dia == null ? null : Number(cifras.v_desde_dia),
      },
      hechos: {
        type: "FeatureCollection",
        features: hechos.map((f) => ({
          type: "Feature" as const,
          geometry: punto(f),
          properties: {
            id: Number(f.id),
            fecha: String(f.fecha),
            dia: Number(f.dia),
            empresa: String(f.empresa),
            m2: num(f.m2),
            toneladas: num(f.toneladas),
            fuente: f.fuente === "orden" ? "orden" : "archivo",
            orden: texto(f.orden),
            ordenId: num(f.orden_id),
            direccion: texto(f.direccion),
            foto: urlFoto({ storagePath: texto(f.storage_path), urlExterna: texto(f.url_externa) }),
            tipo: texto(f.tipo),
            reciente: Boolean(f.reciente),
          } satisfies HechoProps,
        })),
      },
      enCurso: {
        type: "FeatureCollection",
        features: enCurso.map((f) => ({
          type: "Feature" as const,
          geometry: punto(f),
          properties: {
            id: Number(f.id),
            empresa: String(f.empresa),
            m2: num(f.m2),
            tipo: texto(f.tipo),
            iniciada: texto(f.iniciada),
            direccion: texto(f.direccion),
          } satisfies EnCursoProps,
        })),
      },
      pendientes: {
        type: "FeatureCollection",
        features: pendientes.map((f) => ({
          type: "Feature" as const,
          geometry: punto(f),
          properties: {
            id: Number(f.id),
            fecha: String(f.fecha),
            direccion: texto(f.direccion),
          } satisfies PendienteProps,
        })),
      },
      areas: {
        type: "FeatureCollection",
        features: ordenes
          .filter((o) => o.area != null)
          .map((o, i) => ({
            type: "Feature" as const,
            geometry: o.area as DatosAvance["areas"]["features"][number]["geometry"],
            properties: ordenesLista.find((x) => x.id === Number(o.id)) ?? ordenesLista[i]!,
          })),
      },
      ordenes: ordenesLista,
      cifras: {
        ventana: { ...cifraDe(cifras, "v"), empresas: Number(cifras.v_empresas ?? 0) },
        hoy: cifraDe(cifras, "h"),
        ayer: cifraDe(cifras, "a"),
        semana: cifraDe(cifras, "s"),
        mes: cifraDe(cifras, "m"),
        total: { ...cifraDe(cifras, "t"), desde: texto(cifras.t_desde) },
        ahora: {
          obras: Number(resto.ec_n ?? 0),
          m2: Number(resto.ec_m2 ?? 0),
          ordenesActivas: Number(resto.ordenes_activas ?? 0),
        },
        pendientes: {
          pedidos: Number(resto.pedidos ?? 0),
          incidentes: Number(resto.incidentes ?? 0),
          asignadas: Number(resto.as_n ?? 0),
          asignadasM2: Number(resto.as_m2 ?? 0),
        },
      },
      porEmpresa: porEmpresa.map(
        (f): FilaEmpresa => ({
          empresa: String(f.empresa),
          n: Number(f.n),
          m2: Number(f.m2),
          toneladas: Number(f.toneladas),
          ultimo: texto(f.ultimo),
        }),
      ),
      serie: completarSerie(serie, hoy),
      feed,
      fotos: fotos
        .map(
          (f): FotoAvance => ({
            url: urlFoto({ storagePath: texto(f.storage_path), urlExterna: texto(f.url_externa) }) ?? "",
            direccion: texto(f.direccion),
            empresa: texto(f.empresa),
            lon: num(f.lon),
            lat: num(f.lat),
            intervencionId: num(f.intervencion_id),
          }),
        )
        .filter((f) => f.url !== ""),
    };
  });
}
