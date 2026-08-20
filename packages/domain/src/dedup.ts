import { similitudDireccion } from "./direcciones";
import { distanciaMetros } from "./geo";
import type { Punto, TipoProblema } from "./tipos";

/**
 * Deduplicación CIMBA: agrupa demandas de fuentes DISTINTAS sobre el mismo
 * problema físico. No confundir con las "reiteraciones" de Atención Ciudadana
 * (mismo reclamo, mismo circuito), que viajan como metadato de la demanda.
 */

export interface ConfigDedup {
  /** Radio máximo de emparejamiento en metros. */
  radioMetros: number;
  /** Score mínimo para sugerir la vinculación a revisión humana. */
  umbralSugerencia: number;
  /** Score mínimo para vincular automáticamente. */
  umbralAutomatico: number;
  /** Confianza de geocodificación mínima de AMBOS puntos para permitir auto-vínculo. */
  confianzaMinimaAuto: number;
  /** Días tras el cierre de un incidente en los que una demanda cuenta como reincidencia. */
  ventanaReincidenciaDias: number;
}

export const CONFIG_DEDUP_DEFAULT: ConfigDedup = {
  radioMetros: 40,
  umbralSugerencia: 0.5,
  umbralAutomatico: 0.85,
  confianzaMinimaAuto: 0.75,
  ventanaReincidenciaDias: 90,
};

/** Compatibilidad entre tipos de problema (1 = mismo fenómeno, 0 = incompatibles). */
const COMPATIBILIDAD: Partial<Record<TipoProblema, Partial<Record<TipoProblema, number>>>> = {
  bache: { bache: 1, pavimento_deteriorado: 0.8, hundimiento: 0.6, fisura: 0.5, perdida_agua: 0.4 },
  pavimento_deteriorado: { pavimento_deteriorado: 1, bache: 0.8, fisura: 0.7, hundimiento: 0.6 },
  hundimiento: { hundimiento: 1, bache: 0.6, pavimento_deteriorado: 0.6, perdida_agua: 0.7, tapa_registro: 0.5 },
  fisura: { fisura: 1, pavimento_deteriorado: 0.7, bache: 0.5 },
  sumidero: { sumidero: 1, tapa_registro: 0.5 },
  tapa_registro: { tapa_registro: 1, sumidero: 0.5, hundimiento: 0.5 },
  perdida_agua: { perdida_agua: 1, hundimiento: 0.7, bache: 0.4 },
  otro: { otro: 0.5 },
};

export function compatibilidadTipos(a: TipoProblema | null, b: TipoProblema | null): number {
  if (!a || !b) return 0.5; // sin tipo declarado: neutral
  return COMPATIBILIDAD[a]?.[b] ?? 0.2;
}

export interface CandidatoDedup {
  punto: Punto;
  tipo: TipoProblema | null;
  direccion: string | null;
  /** Estado del incidente candidato. */
  abierto: boolean;
  cerradoEn: Date | null;
}

export interface DemandaAComparar {
  punto: Punto;
  tipo: TipoProblema | null;
  direccion: string | null;
  geocodConfianza: number | null;
  fecha: Date;
}

export interface ResultadoDedup {
  score: number;
  distanciaMetros: number;
  esReincidencia: boolean;
  sugerible: boolean;
  autoVinculable: boolean;
  motivoBloqueoAuto: string | null;
}

export function evaluarDuplicado(
  demanda: DemandaAComparar,
  candidato: CandidatoDedup,
  candidatoConfianza: number | null = null,
  config: ConfigDedup = CONFIG_DEDUP_DEFAULT,
): ResultadoDedup {
  const dist = distanciaMetros(demanda.punto, candidato.punto);

  // Ventana temporal: incidente abierto, o cerrado hace poco (reincidencia)
  let vigente = candidato.abierto;
  let esReincidencia = false;
  if (!vigente && candidato.cerradoEn) {
    const dias = (demanda.fecha.getTime() - candidato.cerradoEn.getTime()) / 86_400_000;
    if (dias >= 0 && dias <= config.ventanaReincidenciaDias) {
      vigente = true;
      esReincidencia = true;
    }
  }

  if (!vigente || dist > config.radioMetros) {
    return {
      score: 0,
      distanciaMetros: dist,
      esReincidencia: false,
      sugerible: false,
      autoVinculable: false,
      motivoBloqueoAuto: null,
    };
  }

  // Componentes del score
  const scoreDistancia = Math.exp(-dist / (config.radioMetros / 2)); // 1 en el punto, ~0.13 en el borde
  const scoreTipo = compatibilidadTipos(demanda.tipo, candidato.tipo);
  const scoreDireccion =
    demanda.direccion && candidato.direccion
      ? similitudDireccion(demanda.direccion, candidato.direccion)
      : 0.5;

  const score = 0.5 * scoreDistancia + 0.25 * scoreTipo + 0.25 * scoreDireccion;

  // Regla dura: geocodificación de baja confianza jamás auto-vincula.
  // Dos demandas mal geocodificadas pueden caer a 40 m sin ser el mismo pozo.
  let motivoBloqueoAuto: string | null = null;
  const confDemanda = demanda.geocodConfianza ?? 0;
  const confCandidato = candidatoConfianza ?? 1; // incidentes validados a mano cuentan como confiables
  if (confDemanda < config.confianzaMinimaAuto) {
    motivoBloqueoAuto = `geocod_confianza de la demanda (${confDemanda.toFixed(2)}) por debajo de ${config.confianzaMinimaAuto}`;
  } else if (confCandidato < config.confianzaMinimaAuto) {
    motivoBloqueoAuto = `geocod_confianza del incidente (${confCandidato.toFixed(2)}) por debajo de ${config.confianzaMinimaAuto}`;
  }

  return {
    score,
    distanciaMetros: dist,
    esReincidencia,
    sugerible: score >= config.umbralSugerencia,
    autoVinculable: score >= config.umbralAutomatico && motivoBloqueoAuto === null,
    motivoBloqueoAuto,
  };
}
