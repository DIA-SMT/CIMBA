import type { Punto } from "./tipos";

/**
 * Interfaz de geocodificación. Las implementaciones viven en
 * packages/integrations (Nominatim para desarrollo; queda abierto el
 * geocodificador definitivo: Nominatim propio o callejero municipal).
 *
 * Reglas:
 *  - SIEMPRE server-side. Nunca desde el navegador.
 *  - SIEMPRE detrás de geocode_cache (clave: claveDireccion()).
 *  - Toda respuesta lleva confianza 0..1; debajo del umbral → revisión manual.
 *  - Toda respuesta lleva PRECISIÓN, y la precisión no se adivina: la dice el
 *    proveedor. Ver PrecisionGeocod.
 */

/**
 * QUÉ TAN CERCA ESTÁ EL PUNTO DE LA DIRECCIÓN QUE SE PIDIÓ.
 *
 * No es lo mismo "Sarmiento 1200" —OSM tiene esa puerta y devuelve el punto de
 * la puerta— que "Colombia 4576", que OSM no tiene: ahí el geocodificador
 * devuelve LA CALLE, y una calle de San Miguel de Tucumán puede tener tres
 * kilómetros. El sistema trataba las dos respuestas igual y guardaba la
 * segunda como si fuera una dirección: "Colombia 4500" y "Colombia 4576"
 * quedaron a 3,2 km una de otra, en tramos distintos de la misma calle.
 *
 *  - exacta:      el proveedor encontró la altura. El punto es la puerta.
 *  - calle:       encontró la calle pero NO la altura. El punto está sobre esa
 *                 calle y en ningún lugar en particular: hay que corregirlo a
 *                 mano antes de mandar a nadie.
 *  - aproximada:  ni siquiera eso (un barrio, una zona, un nombre suelto).
 */
export const PRECISIONES_GEOCOD = ["exacta", "calle", "aproximada"] as const;
export type PrecisionGeocod = (typeof PRECISIONES_GEOCOD)[number];

/**
 * La confianza sigue siendo el número con el que trabaja el resto del sistema
 * (el umbral de revisión manual es 0,75), pero ahora sale de la precisión y no
 * de una heurística sobre el `type` de OSM. Esa heurística marcaba 0,55 a
 * "Muñecas 2500" —que es una escuela con altura exacta— y el mismo 0,55 a
 * "Colombia 4576", que es un tramo de calle al azar: dos cosas muy distintas
 * con la misma nota.
 */
export const CONFIANZA_POR_PRECISION: Record<PrecisionGeocod, number> = {
  exacta: 0.85,
  calle: 0.5,
  aproximada: 0.35,
};

export interface ResultadoGeocod {
  punto: Punto;
  confianza: number;
  precision: PrecisionGeocod;
  proveedor: string;
  direccionResuelta: string | null;
}

export interface OpcionesGeocod {
  /**
   * Punto de referencia para desempatar. Cuando el proveedor devuelve varios
   * tramos de la misma calle, se elige el más cercano a esto. Quien carga una
   * orden está cargando direcciones de UNA zona, así que el tramo anterior ya
   * ubicado es una referencia mucho mejor que "el primero que vino".
   */
  cerca?: Punto;
}

export interface Geocoder {
  geocodificar(direccion: string, opciones?: OpcionesGeocod): Promise<ResultadoGeocod | null>;
}
