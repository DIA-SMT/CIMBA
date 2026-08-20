export * from "./tipos";
export * from "./pipeline";
export { crearAdaptadorMock } from "./fuentes/mock";
export { crearAdaptadorAtencionCiudadana, mapearReclamoAc } from "./fuentes/atencion-ciudadana";
export { crearGeocoderNominatim } from "./geocoder/nominatim";
export { mapearTipo } from "./archivos/util";
export { detectarYParsear } from "./archivos/importar";
export type { ResultadoDeteccion } from "./archivos/importar";
