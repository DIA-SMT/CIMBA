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
 */
export interface ResultadoGeocod {
  punto: Punto;
  confianza: number;
  proveedor: string;
  direccionResuelta: string | null;
}

export interface Geocoder {
  geocodificar(direccion: string): Promise<ResultadoGeocod | null>;
}
