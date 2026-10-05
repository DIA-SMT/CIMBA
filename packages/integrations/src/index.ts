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
/* El que hay que usar: consulta primero el callejero municipal y recién
   después OSM. Ver geocoder/callejero.ts. */
export { crearGeocoder } from "./geocoder/callejero";
export {
  DESENLACES,
  ESTADO_AC,
  ESTADO_POR_DESENLACE,
  MOTIVO_AC,
  OFICINA_OBRAS_VIALES,
  REPARTICION_OBRAS_PUBLICAS,
  REPARTICION_OBRAS_VIALES,
  REPARTICIONES_QUE_CIERRAN,
  cerrarReclamoAc,
  conexionAcDesdeEntorno,
  modoCierreAc,
  planificarCierreAc,
} from "./fuentes/cierre-ac";
export type {
  ConexionAc,
  Desenlace,
  MovimientoAc,
  PedidoCierreAc,
  PlanCierreAc,
  ResultadoCierreAc,
  SentenciaPlan,
} from "./fuentes/cierre-ac";
export { mapearTipo } from "./archivos/util";
export { detectarYParsear } from "./archivos/importar";
export type { ResultadoDeteccion } from "./archivos/importar";
export { mapearFilasConsolidado } from "./archivos/consolidado";
export type { FilaConsolidado } from "./archivos/consolidado";
export {
  mapearLoteEmpresas,
  traerPuntosGas,
  normalizarEmpresa,
  urlFotoDrive,
  idDriveDesdeUrl,
  SISTEMA_EMPRESAS,
} from "./fuentes/bacheo-empresas";
export type { LoteEmpresas, FotoEmpresa, PuntoGas } from "./fuentes/bacheo-empresas";
export { sincronizarEmpresas, DEPLOY_CARGA_POR_DEFECTO } from "./fuentes/sincronizar-empresas";
export type { ResumenSincronizacion } from "./fuentes/sincronizar-empresas";
