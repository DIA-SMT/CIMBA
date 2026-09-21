import { getDb, sql } from "@cimba/db";
import type { Geocoder, OpcionesGeocod, PrecisionGeocod, Punto, ResultadoGeocod } from "@cimba/domain";
import { CONFIANZA_POR_PRECISION } from "@cimba/domain";
import { crearGeocoderNominatim } from "./nominatim";

/**
 * EL GEOCODIFICADOR DE CIMBA: primero lo que el municipio sabe, después OSM.
 *
 * ── POR QUÉ ──────────────────────────────────────────────────────────────────
 *
 * OpenStreetMap no tiene la altura de la mayoría de las calles de San Miguel
 * de Tucumán. Cuando no la tiene, Nominatim devuelve los TRAMOS de la calle y
 * hay que elegir uno: así "Colombia 4500" y "Colombia 4576" —media cuadra en
 * la realidad— terminaron a 3,2 km.
 *
 * Pero el municipio SÍ sabe dónde está Colombia al 4500. Tiene más de tres mil
 * puntos con calle y altura, y buena parte son coordenadas tomadas con el
 * teléfono parado arriba del bache. La vista `callejero_municipal` los junta y
 * `ubicar_altura()` interpola sobre ellos (migraciones 0025-0027).
 *
 * ── CUÁNTO MEJORA, MEDIDO ────────────────────────────────────────────────────
 *
 * Escondiendo cada uno de los 936 puntos de campo y pidiéndole al callejero
 * que lo adivinara con los otros, el error mediano fue de 10 metros, y de 3
 * metros cuando la altura está encerrada entre dos conocidas cercanas. Sobre
 * las 1.255 direcciones distintas que hay hoy en el sistema, contesta la mitad
 * — y 478 con nivel "exacta". La otra mitad sigue yendo a OSM: cuando no sabe,
 * el callejero se calla en vez de inventar.
 *
 * ── EL SEGUNDO USO, QUE NO ES MENOR ──────────────────────────────────────────
 *
 * Aun cuando el callejero no alcanza para dar la respuesta, sirve para ELEGIR
 * entre los tramos que devuelve OSM: se le pasa su mejor estimación como punto
 * de referencia y Nominatim deja de elegir el primero de la lista.
 */

interface FilaCallejero {
  lon: number;
  lat: number;
  nivel: PrecisionGeocod | null;
  delta: number;
  apoyo: number;
}

/** "Colombia 4576" → { calle: "Colombia", altura: 4576 }. Sin altura, null. */
function partirAltura(direccion: string): { calle: string; altura: number } | null {
  const m = /^(.*?)[\s,]+(\d{1,5})\s*$/.exec(direccion.trim());
  if (!m?.[1] || !m[2]) return null;
  const altura = Number(m[2]);
  if (!Number.isFinite(altura) || altura <= 0) return null;
  return { calle: m[1].trim(), altura };
}

/**
 * "Matheu y Buenos Aires" → las dos calles. Una de cada cinco direcciones del
 * sistema es un cruce, no una altura: 720 de 3.281 pedidos.
 */
function partirEsquina(direccion: string): { a: string; b: string } | null {
  const limpio = direccion.trim().replace(/\s+(esq\.?|esquina)\s+/gi, " y ");
  const m = /^(.{3,})\s+y\s+(.{3,})$/i.exec(limpio) ?? /^(.{3,})\s*[/&]\s*(.{3,})$/.exec(limpio);
  if (!m?.[1] || !m[2]) return null;
  return { a: m[1].trim(), b: m[2].trim() };
}

/** Lo que sabe el municipio sobre esa altura de esa calle, o sobre ese cruce. */
async function consultarCallejero(direccion: string): Promise<FilaCallejero | null> {
  const db = getDb();
  const partes = partirAltura(direccion);
  if (partes) {
    const filas = (await db.execute(sql`
      select lon, lat, nivel, delta, apoyo from ubicar_altura(${partes.calle}, ${partes.altura})
    `)) as unknown as FilaCallejero[];
    const f = filas[0];
    if (f && f.nivel != null) return { ...f, lon: Number(f.lon), lat: Number(f.lat) };
    return null;
  }

  const esquina = partirEsquina(direccion);
  if (esquina) {
    const filas = (await db.execute(sql`
      select lon, lat, nivel, separacion from ubicar_esquina(${esquina.a}, ${esquina.b})
    `)) as unknown as Array<{ lon: number; lat: number; nivel: PrecisionGeocod; separacion: number }>;
    const f = filas[0];
    if (f && f.nivel != null) {
      return { lon: Number(f.lon), lat: Number(f.lat), nivel: f.nivel, delta: Number(f.separacion), apoyo: 0 };
    }
  }
  return null;
}

function comoResultado(f: FilaCallejero): ResultadoGeocod {
  return {
    punto: { lat: f.lat, lon: f.lon },
    confianza: CONFIANZA_POR_PRECISION[f.nivel as PrecisionGeocod],
    precision: f.nivel as PrecisionGeocod,
    proveedor: "callejero_municipal",
    direccionResuelta: null,
  };
}

export function crearGeocoder(): Geocoder {
  const osm = crearGeocoderNominatim();
  return {
    async geocodificar(direccion: string, opciones?: OpcionesGeocod): Promise<ResultadoGeocod | null> {
      let municipal: FilaCallejero | null = null;
      try {
        municipal = await consultarCallejero(direccion);
      } catch {
        /* El callejero es una mejora, no una dependencia: si la vista no está
           o la consulta falla, la geocodificación tiene que seguir andando. */
      }

      // Dato propio y preciso: no hace falta molestar a OSM (ni esperar su
      // segundo de rate limit).
      if (municipal && municipal.nivel === "exacta") return comoResultado(municipal);

      /**
       * El punto de referencia para desempatar los tramos de OSM. Gana el que
       * venga de afuera —quien está cargando una orden sabe en qué zona
       * está— y si no hay, sirve la estimación municipal aunque sea de calle.
       */
      const cerca: Punto | undefined =
        opciones?.cerca ?? (municipal ? { lat: municipal.lat, lon: municipal.lon } : undefined);

      let deOsm: ResultadoGeocod | null = null;
      try {
        deOsm = await osm.geocodificar(direccion, { ...opciones, cerca });
      } catch {
        /* Nominatim caído o sin red: si el callejero tenía algo, se usa eso. */
      }

      // OSM encontró la puerta: es lo más preciso que hay.
      if (deOsm && deOsm.precision === "exacta") return deOsm;
      /* Empate a nivel "calle": gana el municipal. El de OSM es un tramo de una
         calle que puede tener tres kilómetros; el municipal está interpolado
         entre dos alturas conocidas y cae en la cuadra. */
      if (municipal) return comoResultado(municipal);
      return deOsm;
    },
  };
}
