import { getDb, sql } from "@cimba/db";
import type { Punto, ResultadoGeocod } from "@cimba/domain";
import { CONFIANZA_POR_PRECISION, dentroDeSMT } from "@cimba/domain";

/**
 * LAS ESQUINAS, PREGUNTADAS COMO ESQUINAS.
 *
 * "Estoy teniendo problemas con las cargas de intersecciones: Piedras y San
 * Luis, que en Google Maps sí lo toma así; Eudoro Aráoz y Chacabuco tampoco"
 * (13/10). Dos fallas que se sumaban:
 *
 * - El callejero municipal ubica un cruce con los puntos que ya conoce de cada
 *   calle, y esos puntos están cargados con el nombre que puso cada uno:
 *   "PIEDRAS" (21), "LAS PIEDRAS" (86), "COMBATE DE LAS PIEDRAS" (0). Con
 *   "Piedras y San Luis" buscaba entre los 21 y no encontraba el cruce; San
 *   Luis tiene 4 puntos y Chacabuco 7, que no alcanzan.
 * - Nominatim no entiende los cruces: con dos nombres de calle devuelve un
 *   tramo cualquiera de una de las dos, a veces a kilómetros.
 *
 * OpenStreetMap tiene el trazado de cada calle con su nombre: el cruce es el
 * punto donde las dos líneas se tocan. Las calles se bajaron una vez a la
 * tabla calles_osm (migración 0039, scripts/cargar-calles-osm.mjs) y el cruce
 * se calcula acá, en la base, en unos 60 ms y sin depender de un servicio
 * externo: el servidor público de OSM estaba saturado justo cuando se probó.
 */

/** Nodos a menos de esto son el mismo cruce (una avenida con dos manos). */
const MISMO_CRUCE_M = 80;

/** Palabras que dicen qué clase de calle es y no cuál. */
const TIPOS = new Set(["av", "avda", "avd", "avenida", "pje", "psje", "pasaje", "calle", "bv", "boulevard", "bulevar"]);
/** Artículos y títulos: se saltean al buscar por la palabra que identifica la calle. */
const MENORES = new Set(["de", "del", "la", "las", "los", "el", "y", "gral", "general", "dr", "doctor", "cnel", "coronel", "pte", "presidente", "combate", "santa", "san"]);

/**
 * El nombre como se guarda en calles_osm.nombre_norm: sin tildes, en
 * minúscula y sin "avenida", "pasaje"… TIENE que ser igual a normalizar() de
 * scripts/cargar-calles-osm.mjs, o lo que escribe la gente no encuentra la
 * calle.
 */
export function normalizarCalle(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !TIPOS.has(w))
    .join(" ");
}

/**
 * Las formas de buscar una calle por su nombre, de la más estricta a la más
 * suelta: todas las palabras en orden ("eudoro.*araoz"), y si no, la palabra
 * que la identifica ("piedras" encuentra "Las Piedras" aunque se haya escrito
 * "Combate de Las Piedras"). Son expresiones contra el nombre normalizado.
 */
export function patronesCalle(nombre: string): string[] {
  const ws = normalizarCalle(nombre).split(" ").filter(Boolean);
  if (ws.length === 0) return [];
  const todas = ws.join(".*");
  const clave = [...ws].reverse().find((w) => !MENORES.has(w) && w.length >= 3);
  return [...new Set([todas, ...(clave ? [clave] : [])])];
}

const metros = (a: Punto, b: Punto) => {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371000;
};

/**
 * El cruce de dos calles según OSM, o null si no lo encuentra. Con varios
 * cruces posibles (dos calles que se cortan más de una vez, o un nombre que
 * coincide con más de una calle) gana el más cercano a la referencia; sin
 * referencia, se devuelve el primero pero como aproximado, para que se pida
 * correr el pin.
 */
export async function ubicarCruceOsm(a: string, b: string, cerca?: Punto): Promise<ResultadoGeocod | null> {
  const pa = patronesCalle(a);
  const pb = patronesCalle(b);
  const db = getDb();

  /* De la combinación más estricta a la más suelta; corta en la primera que
     encuentra algo. */
  let puntos: Array<{ lat: number; lon: number; na: string; nb: string }> = [];
  for (const x of pa) {
    for (const y of pb) {
      puntos = (await db.execute(sql`
        with a as (select geom, nombre from calles_osm where nombre_norm ~ ${x}),
             b as (select geom, nombre from calles_osm where nombre_norm ~ ${y})
        select st_y(p.geom) as lat, st_x(p.geom) as lon, a.nombre as na, b.nombre as nb
        from a join b on st_intersects(a.geom, b.geom),
        lateral st_dump(st_intersection(a.geom, b.geom)) p
        where geometrytype(p.geom) = 'POINT'
        limit 50
      `)) as unknown as typeof puntos;
      if (puntos.length > 0) break;
    }
    if (puntos.length > 0) break;
  }
  const nodos = puntos
    .map((p) => ({ lat: Number(p.lat), lon: Number(p.lon) }))
    .filter((p) => dentroDeSMT(p));
  if (nodos.length === 0) return null;

  // Los puntos que son el mismo cruce (las dos manos de una avenida) se juntan.
  const grupos: Punto[][] = [];
  for (const n of nodos) {
    const g = grupos.find((x) => metros(x[0]!, n) <= MISMO_CRUCE_M);
    if (g) g.push(n);
    else grupos.push([n]);
  }
  const centros = grupos.map((g) => ({
    lat: g.reduce((s, p) => s + p.lat, 0) / g.length,
    lon: g.reduce((s, p) => s + p.lon, 0) / g.length,
  }));
  const elegido = cerca ? [...centros].sort((x, y) => metros(cerca, x) - metros(cerca, y))[0]! : centros[0]!;
  const precision = centros.length === 1 || cerca ? "exacta" : "calle";
  const primero = puntos[0]!;

  return {
    punto: elegido,
    confianza: CONFIANZA_POR_PRECISION[precision],
    precision,
    proveedor: "osm_cruce",
    direccionResuelta: `${primero.na} y ${primero.nb}`,
  };
}
