/**
 * Proyección de capacidad de bacheo. Los números son los del Director:
 * una cuadrilla hace en promedio 10 baches por turno (mañana y tarde);
 * de 4 toneladas de mezcla salen ~14 baches chicos o 4 carpetas, por turno.
 *
 * Módulo plano (sin "use client"/"server-only"): lo usan el panel de
 * proyección, el armado de órdenes y Migue. Los parámetros viven en la tabla
 * `parametros` (clave 'capacidad_bacheo') y son editables sin tocar código.
 */

export interface ParametrosCapacidad {
  /** Promedio real por cuadrilla y turno. */
  bachesPorTurno: number;
  /** Turnos por día por defecto (mañana y tarde); cada empresa puede pisarlo. */
  turnosPorDia: number;
  /** Toneladas de mezcla que consume un turno. */
  toneladasPorTurno: number;
  /** De 4 t salen ~14 baches CHICOS: el techo optimista de un turno. */
  bachesChicosPorTurno: number;
  /** …o 4 carpetas (paños completos) en el mismo turno. */
  carpetasPorTurno: number;
}

export const CAPACIDAD_POR_DEFECTO: ParametrosCapacidad = {
  bachesPorTurno: 10,
  turnosPorDia: 2,
  toneladasPorTurno: 4,
  bachesChicosPorTurno: 14,
  carpetasPorTurno: 4,
};

/** Parsea el jsonb de la tabla parametros tolerando claves faltantes. */
export function parametrosDesdeJson(v: Record<string, unknown> | null | undefined): ParametrosCapacidad {
  const n = (x: unknown, def: number) => {
    const num = Number(x);
    return Number.isFinite(num) && num > 0 ? num : def;
  };
  return {
    bachesPorTurno: n(v?.["baches_por_turno"], CAPACIDAD_POR_DEFECTO.bachesPorTurno),
    turnosPorDia: n(v?.["turnos_por_dia"], CAPACIDAD_POR_DEFECTO.turnosPorDia),
    toneladasPorTurno: n(v?.["toneladas_por_turno"], CAPACIDAD_POR_DEFECTO.toneladasPorTurno),
    bachesChicosPorTurno: n(v?.["baches_chicos_por_turno"], CAPACIDAD_POR_DEFECTO.bachesChicosPorTurno),
    carpetasPorTurno: n(v?.["carpetas_por_turno"], CAPACIDAD_POR_DEFECTO.carpetasPorTurno),
  };
}

export interface Proyeccion {
  turnos: number;
  toneladas: number;
  /** Días hábiles con la dotación dada. */
  dias: number;
  /** Con cuántas cuadrillas × turnos/día se calculó. */
  turnosPorDiaTotales: number;
}

/**
 * ¿Cuánto cuesta este lote de trabajo? Los baches van a razón del promedio
 * (10/turno); las carpetas son mucho más caras (4/turno). Un turno mezclado
 * se aproxima sumando fracciones de turno de cada tipo.
 */
export function proyectar(
  trabajo: { baches: number; carpetas: number },
  dotacion: { cuadrillas: number; turnosPorDia?: number },
  p: ParametrosCapacidad = CAPACIDAD_POR_DEFECTO,
): Proyeccion {
  const turnosBaches = trabajo.baches / p.bachesPorTurno;
  const turnosCarpetas = trabajo.carpetas / p.carpetasPorTurno;
  const turnos = turnosBaches + turnosCarpetas;

  const turnosPorDia = Math.max(1, dotacion.turnosPorDia ?? p.turnosPorDia);
  const turnosPorDiaTotales = Math.max(1, dotacion.cuadrillas) * turnosPorDia;

  return {
    turnos: Math.ceil(turnos * 10) / 10,
    toneladas: Math.ceil(turnos * p.toneladasPorTurno * 10) / 10,
    dias: Math.ceil((turnos / turnosPorDiaTotales) * 10) / 10,
    turnosPorDiaTotales,
  };
}
