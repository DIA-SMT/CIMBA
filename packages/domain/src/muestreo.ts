/**
 * EL SORTEO DE LA MUESTRA DEL ACTA DE MEDICIÓN.
 *
 * El protocolo de la DOV: las primeras cuatro semanas se mide el 100% de los
 * puntos; después alcanza con un muestreo ALEATORIO de al menos el 20%; y si
 * aparece más de 5% de desviación entre lo informado y lo medido, se vuelve a
 * medir todo.
 *
 * "Aleatorio" no puede querer decir "los que elija el inspector": así no es
 * muestra, es selección. Y tampoco puede ser un sorteo que cambie cada vez que
 * se abre la pantalla, porque nadie podría verificarlo después. Por eso el
 * sorteo es DETERMINÍSTICO: cada punto recibe un número que sale de su id y de
 * una semilla (el día del acta y la empresa), y se miden los de número más
 * bajo. Cualquiera con los mismos datos llega a la misma muestra — ante el
 * Tribunal de Cuentas, eso es lo que la hace defendible.
 */

/** Porcentaje mínimo de puntos a medir en régimen de muestreo. */
export const MUESTREO_MINIMO_PCT = 20;

/** Un número de 32 bits que sale del texto (FNV-1a): estable y bien repartido. */
function numeroDe(texto: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Cuántos puntos hay que medir de `total` con un porcentaje dado (al menos uno). */
export const puntosAMedir = (total: number, pct = MUESTREO_MINIMO_PCT): number =>
  total <= 0 ? 0 : Math.max(1, Math.ceil((total * pct) / 100));

/**
 * Los puntos que salen sorteados para medir, de los que entran en el acta.
 * `semilla` es el día del acta y la empresa ("2026-10-13:3"): el mismo día y la
 * misma empresa dan siempre la misma muestra sobre los mismos puntos.
 */
export function sortearMuestra(ids: readonly number[], semilla: string, pct = MUESTREO_MINIMO_PCT): number[] {
  const cuantos = puntosAMedir(ids.length, pct);
  return [...new Set(ids)]
    .map((id) => ({ id, n: numeroDe(`${semilla}:${id}`) }))
    .sort((a, b) => a.n - b.n || a.id - b.id)
    .slice(0, cuantos)
    .map((x) => x.id);
}

/**
 * La desviación entre lo informado y lo medido, en porcentaje y en valor
 * absoluto: medir de menos y medir de más son el mismo problema de
 * confiabilidad del dato. Se calcula SOLO sobre los puntos medidos.
 */
export function desviacionPct(medidos: ReadonlyArray<{ informado: number; medido: number }>): number {
  const informado = medidos.reduce((s, m) => s + m.informado, 0);
  const medido = medidos.reduce((s, m) => s + m.medido, 0);
  if (informado <= 0) return medido > 0 ? 100 : 0;
  return Math.round((Math.abs(medido - informado) / informado) * 10000) / 100;
}
