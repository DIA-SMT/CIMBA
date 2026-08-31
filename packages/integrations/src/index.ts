export * from "./tipos";
export * from "./pipeline";
export { crearAdaptadorMock } from "./fuentes/mock";
export {
  crearAdaptadorAtencionCiudadana,
  mapearReclamoAc,
  CATEGORIA_CALLES_AC,
  TIPOS_PAVIMENTO_AC,
} from "./fuentes/atencion-ciudadana";
export type { AdaptadorAc, OpcionesBarridoAc } from "./fuentes/atencion-ciudadana";
export { crearGeocoderNominatim } from "./geocoder/nominatim";
export { mapearTipo } from "./archivos/util";
export { detectarYParsear } from "./archivos/importar";
export type { ResultadoDeteccion } from "./archivos/importar";
export { mapearFilasConsolidado } from "./archivos/consolidado";
export type { FilaConsolidado } from "./archivos/consolidado";
