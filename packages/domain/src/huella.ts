/**
 * LA HUELLA DE UNA FOTO: la cuenta, en un solo lugar.
 *
 * "¿Puede saltar una alarma por fotos duplicadas?" (Dirección de Bacheo,
 * 12/10/2026). Comparar archivos no sirve: la misma foto reenviada por
 * WhatsApp o recomprimida por el teléfono es otro archivo, byte por byte. La
 * huella resume cómo se VE la imagen (dHash): la foto achicada a 144×128 se
 * parte en una grilla de 9×8 bloques, se promedia el gris de cada bloque y se
 * anota, renglón por renglón, si cada bloque es más claro que el de su
 * derecha — 64 bits.
 *
 * La cuenta vive acá y no en el servidor porque la hacen DOS lados: el
 * teléfono de la empresa (para avisar antes de subir) y el servidor (para
 * marcar al inspector). Con el mismo achique y el mismo promedio, las dos dan
 * casi lo mismo: medido sobre fotos reales, 0 a 4 bits de diferencia. Con el
 * achique de cada librería directo a 9×8 la diferencia llegaba a 18.
 */

/** El tamaño al que se achica la foto antes de promediar los bloques. */
export const ANCHO_HUELLA = 144;
export const ALTO_HUELLA = 128;

/**
 * Hasta cuántos bits distintos se considera LA MISMA foto. Medido el 12/10
 * sobre las 450 fotos de trabajos del portal: la misma imagen recomprimida
 * (1.280 px calidad 80, u 800 px calidad 55 como WhatsApp) queda entre 0 y 4;
 * la del teléfono contra la del servidor, entre 0 y 4; entre fotos de baches
 * distintos —100.958 pares— la más parecida está a 9, y casi todas a más de
 * 13. Las tres repetidas de verdad que había estaban a 0.
 */
export const BITS_FOTO_REPETIDA = 6;

/**
 * La huella de una imagen YA achicada a 144×128, como texto de 64 "0"/"1"
 * (así se castea a bit(64) en la base). `pixeles` son los canales intercalados
 * —RGB o RGBA— fila por fila. Null si el tamaño no es el esperado.
 */
export function huellaDePixeles(pixeles: ArrayLike<number>, canales: number): string | null {
  if (canales < 3 || pixeles.length < ANCHO_HUELLA * ALTO_HUELLA * canales) return null;
  const lado = ANCHO_HUELLA / 9; // 16 px por bloque
  const celdas = new Array<number>(72).fill(0);
  for (let y = 0; y < ALTO_HUELLA; y++) {
    for (let x = 0; x < ANCHO_HUELLA; x++) {
      const i = (y * ANCHO_HUELLA + x) * canales;
      const gris = 0.299 * pixeles[i]! + 0.587 * pixeles[i + 1]! + 0.114 * pixeles[i + 2]!;
      celdas[Math.floor(y / lado) * 9 + Math.floor(x / lado)]! += gris;
    }
  }
  let bits = "";
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) bits += celdas[y * 9 + x]! > celdas[y * 9 + x + 1]! ? "1" : "0";
  }
  return bits;
}

/** Cuántos bits distintos hay entre dos huellas (64 si alguna no es válida). */
export function distanciaHuellas(a: string, b: string): number {
  if (a.length !== 64 || b.length !== 64) return 64;
  let n = 0;
  for (let i = 0; i < 64; i++) if (a[i] !== b[i]) n++;
  return n;
}

/** ¿Una huella es válida? 64 caracteres, solo ceros y unos. */
export const esHuella = (h: unknown): h is string => typeof h === "string" && /^[01]{64}$/.test(h);
