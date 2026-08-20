/**
 * Normalización de direcciones de San Miguel de Tucumán.
 *
 * Los alias provienen de los reportes de calidad de geocodificación reales:
 * "Cris Alvarez" no lo reconoce ningún geocodificador — es Crisóstomo Álvarez.
 */

const ABREVIATURAS: Array<[RegExp, string]> = [
  [/\bAVDA\b\.?/gi, "Avenida"],
  [/\bAV\b\.?/gi, "Avenida"],
  [/\bPJE\b\.?/gi, "Pasaje"],
  [/\bPSJE\b\.?/gi, "Pasaje"],
  [/\bGRAL\b\.?/gi, "General"],
  [/\bCNEL\b\.?/gi, "Coronel"],
  [/\bTTE\b\.?/gi, "Teniente"],
  [/\bSTA\b\.?/gi, "Santa"],
  [/\bSTO\b\.?/gi, "Santo"],
  [/\bB°\s?/gi, "Barrio "],
  [/\bBo\.\s?/gi, "Barrio "],
  [/\bESQ\b\.?/gi, "esquina"],
  [/\be\/\s?/gi, "entre "],
];

/** Alias de calles que los geocodificadores no reconocen (detectados en datos reales). */
const ALIAS_CALLES: Array<[RegExp, string]> = [
  [/\bCris[oó]?s?t?\.?\s+Alvarez\b/gi, "Crisóstomo Álvarez"],
  [/\bCris\s+Alvarez\b/gi, "Crisóstomo Álvarez"],
  [/\bavlem\b/gi, "Alem"],
  [/\bF\.?\s+Ameguino\b/gi, "Florentino Ameghino"],
  [/\bfrancis?co?\s+de\s+aguirre\b/gi, "Francisco de Aguirre"],
  [/\bMarcos?\s+Avellaneda\b/gi, "Marco Avellaneda"],
  [/\bSgto\.?\s+Cabral\b/gi, "Sargento Cabral"],
  [/\bJ\.?\s?J\.?\s+Passo\b/gi, "Juan José Paso"],
  [/\bJJ\s+Passo\b/gi, "Juan José Paso"],
  [/\bSantiago\b(?!\s+del)/gi, "Santiago del Estero"],
];

export function normalizarDireccion(cruda: string): string {
  let d = cruda.trim().replace(/\s+/g, " ");
  for (const [re, rep] of ABREVIATURAS) d = d.replace(re, rep);
  for (const [re, rep] of ALIAS_CALLES) d = d.replace(re, rep);
  // Capitalización tipo título preservando conectores
  d = d
    .toLowerCase()
    .split(" ")
    .map((w) => {
      if (["y", "e", "de", "del", "la", "las", "los", "entre", "esquina", "al"].includes(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
  return d.charAt(0).toUpperCase() + d.slice(1);
}

/** Clave canónica para comparación/caché: sin acentos, minúsculas, sin ruido. */
export function claveDireccion(direccion: string): string {
  return normalizarDireccion(direccion)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Similitud de Sørensen–Dice sobre bigramas (equivalente práctico a pg_trgm). */
export function similitudDireccion(a: string, b: string): number {
  const ka = claveDireccion(a);
  const kb = claveDireccion(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const bigramas = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      m.set(bg, (m.get(bg) ?? 0) + 1);
    }
    return m;
  };
  const ma = bigramas(ka);
  const mb = bigramas(kb);
  let inter = 0;
  let total = 0;
  for (const [bg, n] of ma) {
    inter += Math.min(n, mb.get(bg) ?? 0);
    total += n;
  }
  for (const n of mb.values()) total += n;
  return total === 0 ? 0 : (2 * inter) / total;
}
