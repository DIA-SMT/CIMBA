import {
  filtrarFotosNuevas,
  filtrarNovedades,
  guardarFotosExternas,
  ingestarIntervenciones,
  registrarSyncRun,
} from "../pipeline";
import { mapearLoteSigov, SISTEMA_SIGOV, traerSigov } from "./sigov-mysql";

export interface ResumenSigov {
  obras: number;
  nuevas: number;
  actualizadas: number;
  fotosNuevas: number;
  sinCambios: number;
  errores: number;
  canceladas: number;
  posiblesDuplicados: number;
  sinGeo: number;
  sospechosos: Array<{ id: string; m2: number; direccion: string }>;
  huboNovedades: boolean;
}

/**
 * Una pasada de sincronización de SIGOV Obras Viales.
 *
 * Todas las obras entran como intervención, incluso las que todavía no se
 * ejecutaron: en SIGOV una obra nace ya asignada a una licitación, así que no
 * hay una etapa de "pedido sin dueño" que justifique cargarla como demanda.
 */
export async function sincronizarSigov(): Promise<ResumenSigov> {
  const { obras, fotos } = await traerSigov();
  const lote = mapearLoteSigov(obras, fotos);

  const nIv = await filtrarNovedades(SISTEMA_SIGOV, "intervencion", lote.intervenciones);
  const nFo = await filtrarFotosNuevas(lote.fotos);

  const resumen: ResumenSigov = {
    obras: obras.length,
    nuevas: 0,
    actualizadas: 0,
    fotosNuevas: 0,
    sinCambios: nIv.sinCambios,
    errores: 0,
    canceladas: lote.canceladas,
    posiblesDuplicados: lote.posiblesDuplicados,
    sinGeo: lote.sinGeo,
    sospechosos: lote.sospechosos,
    huboNovedades: false,
  };

  if (nIv.novedades.length === 0 && nFo.nuevas.length === 0) return resumen;
  resumen.huboNovedades = true;

  const ri = await ingestarIntervenciones(SISTEMA_SIGOV, nIv.novedades);
  // Las fotos van después: necesitan que la obra exista para colgarse de ella.
  const rf = await guardarFotosExternas(SISTEMA_SIGOV, nFo.nuevas);

  resumen.nuevas = ri.insertados;
  resumen.actualizadas = ri.actualizados;
  resumen.fotosNuevas = rf.insertadas;
  resumen.errores = ri.errores.length;

  await registrarSyncRun(
    {
      sistema: SISTEMA_SIGOV,
      leidos: ri.leidos,
      insertados: ri.insertados,
      actualizados: ri.actualizados,
      sinCambios: nIv.sinCambios,
      errores: ri.errores,
    },
    null,
    {
      obras: obras.length,
      fotosNuevas: rf.insertadas,
      fotosSinDestino: rf.sinIntervencion,
      canceladas: lote.canceladas,
      posiblesDuplicados: lote.posiblesDuplicados,
      superficiesNoCreibles: lote.sospechosos.length,
    },
  );

  return resumen;
}
