import {
  filtrarFotosNuevas,
  filtrarNovedades,
  guardarFotosExternas,
  ingestarDemandas,
  ingestarIntervenciones,
  registrarSyncRun,
} from "../pipeline";
import { mapearLoteEmpresas, SISTEMA_EMPRESAS, traerPuntosGas } from "./bacheo-empresas";

export const DEPLOY_CARGA_POR_DEFECTO =
  "AKfycbyg4YeRe884Lvah-1SDBCBggTvvHBcsdONzTshppQJSCpEz8V8CY6l5trnrkTn5q_uC";

export interface ResumenSincronizacion {
  filas: number;
  trabajosNuevos: number;
  trabajosActualizados: number;
  deteccionesNuevas: number;
  fotosNuevas: number;
  sinCambios: number;
  errores: number;
  sospechosos: Array<{ id: string; m2: number; direccion: string }>;
  huboNovedades: boolean;
}

/**
 * Una pasada de sincronización de la planilla de las empresas.
 *
 * Separada del CLI para que el runner la pueda llamar en loop sin levantar un
 * proceso por corrida. Nunca lanza por datos malos: los problemas de una fila
 * quedan contados en el resumen y el resto entra igual.
 */
export async function sincronizarEmpresas(
  deploymentId = process.env.CIMBA_GAS_BACHEO_DEPLOY ?? DEPLOY_CARGA_POR_DEFECTO,
): Promise<ResumenSincronizacion> {
  const crudos = await traerPuntosGas(deploymentId);
  const lote = mapearLoteEmpresas(crudos);

  // Descartar primero lo ya guardado: tres consultas en vez de una por fila.
  const nIv = await filtrarNovedades(SISTEMA_EMPRESAS, "intervencion", lote.intervenciones);
  const nDe = await filtrarNovedades(SISTEMA_EMPRESAS, "demanda", lote.demandas);
  const nFo = await filtrarFotosNuevas(lote.fotos);

  const resumen: ResumenSincronizacion = {
    filas: crudos.length,
    trabajosNuevos: 0,
    trabajosActualizados: 0,
    deteccionesNuevas: 0,
    fotosNuevas: 0,
    sinCambios: nIv.sinCambios + nDe.sinCambios,
    errores: 0,
    sospechosos: lote.sospechosos,
    huboNovedades: false,
  };

  if (nIv.novedades.length === 0 && nDe.novedades.length === 0 && nFo.nuevas.length === 0) {
    return resumen;
  }
  resumen.huboNovedades = true;

  const ri = await ingestarIntervenciones(SISTEMA_EMPRESAS, nIv.novedades);
  const rd = await ingestarDemandas(SISTEMA_EMPRESAS, nDe.novedades);
  const rf = await guardarFotosExternas(SISTEMA_EMPRESAS, nFo.nuevas);

  resumen.trabajosNuevos = ri.insertados;
  resumen.trabajosActualizados = ri.actualizados + rd.actualizados;
  resumen.deteccionesNuevas = rd.insertados;
  resumen.fotosNuevas = rf.insertadas;
  resumen.errores = ri.errores.length + rd.errores.length;

  await registrarSyncRun(
    {
      sistema: SISTEMA_EMPRESAS,
      leidos: ri.leidos + rd.leidos,
      insertados: ri.insertados + rd.insertados,
      actualizados: ri.actualizados + rd.actualizados,
      sinCambios: resumen.sinCambios,
      errores: [...ri.errores, ...rd.errores],
    },
    null,
    {
      filas: crudos.length,
      fotosNuevas: rf.insertadas,
      descartadas: lote.descartados.length,
      superficiesNoCreibles: lote.sospechosos.length,
    },
  );

  return resumen;
}
