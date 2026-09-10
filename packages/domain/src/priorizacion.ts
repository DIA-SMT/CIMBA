import type { TipoProblema } from "./tipos";

/**
 * Score de priorización de incidentes (0–100).
 * Determinístico y explicable: cada factor devuelve su aporte para poder
 * mostrarle al operador POR QUÉ un incidente está arriba en la cola.
 */

export interface FactoresPriorizacion {
  /** Cantidad de demandas vinculadas al incidente. */
  demandasVinculadas: number;
  /** Suma de menciones/reiteraciones informadas por las fuentes. */
  menciones: number;
  /** Días desde la detección. */
  diasAbierto: number;
  /** Máxima prioridad informada por una fuente (1 = máxima, 5 = mínima). */
  prioridadInformada: number | null;
  tipo: TipoProblema | null;
  /** Cantidad de intervenciones previas sobre el mismo incidente (reincidencia). */
  intervencionesPrevias: number;
  /** true si está sobre un corredor principal (avenida, troncal de colectivos). */
  enCorredorPrincipal: boolean;
}

const PESO_TIPO: Record<TipoProblema, number> = {
  hundimiento: 1.0,
  perdida_agua: 0.9,
  bache: 0.85,
  // La bocacalle rota es un bache en el punto de mayor exposición: la cruzan
  // todos los giros y ahí es donde se rompen las cubiertas.
  bocacalle_rota: 0.85,
  // La cuadra completa ya no es un bache: es la señal de que ese tramo pide
  // obra estructural, y pesa como el peor de los casos localizados.
  cuadra_completa: 0.75,
  sumidero: 0.7,
  cuneta_rota: 0.65,
  tapa_registro: 0.7,
  pavimento_deteriorado: 0.6,
  fisura: 0.4,
  otro: 0.3,
};

export interface DesgloseScore {
  demanda: number;
  antiguedad: number;
  severidad: number;
  reincidencia: number;
  corredor: number;
  total: number;
}

export function scorePriorizacion(f: FactoresPriorizacion): DesgloseScore {
  // Presión de demanda (hasta 35): saturación logarítmica — 1 demanda ≠ 0,
  // 10 demandas no valen 10 veces más.
  const presion = f.demandasVinculadas + 0.5 * f.menciones;
  const demanda = Math.min(35, 12 * Math.log2(1 + presion));

  // Antigüedad (hasta 20): crece lineal hasta 60 días.
  const antiguedad = Math.min(20, (f.diasAbierto / 60) * 20);

  // Severidad por tipo + prioridad informada (hasta 25)
  const pesoTipo = f.tipo ? PESO_TIPO[f.tipo] : 0.5;
  const bonoInformada = f.prioridadInformada ? (5 - f.prioridadInformada) / 4 : 0; // 1→1, 5→0
  const severidad = 25 * (0.7 * pesoTipo + 0.3 * bonoInformada);

  // Reincidencia (hasta 12): un pozo que volvió a abrirse es señal estructural.
  const reincidencia = Math.min(12, f.intervencionesPrevias * 6);

  // Corredor principal (8)
  const corredor = f.enCorredorPrincipal ? 8 : 0;

  const total = Math.round(Math.min(100, demanda + antiguedad + severidad + reincidencia + corredor) * 100) / 100;
  return { demanda, antiguedad, severidad, reincidencia, corredor, total };
}
