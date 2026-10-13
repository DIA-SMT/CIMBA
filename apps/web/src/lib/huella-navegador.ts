import { ALTO_HUELLA, ANCHO_HUELLA, huellaDePixeles } from "@cimba/domain";

/**
 * LA HUELLA DE LA FOTO EN EL TELÉFONO, para avisar ANTES de subir que esa foto
 * ya se usó en otro bache ("avisa y deja cargar", Dirección de Bacheo, 12/10).
 *
 * La cuenta es la de @cimba/domain (huella.ts), la misma del servidor; acá
 * solo se achica la foto con el canvas. Todo es best-effort: sin señal, sin
 * canvas o con cualquier error, no hay aviso y la carga sigue como siempre.
 * El que marca al inspector es el servidor, con su propia huella.
 */

export async function huellaEnNavegador(foto: Blob): Promise<string | null> {
  try {
    const bitmap = await createImageBitmap(foto, { imageOrientation: "from-image" });
    const lienzo = document.createElement("canvas");
    lienzo.width = ANCHO_HUELLA;
    lienzo.height = ALTO_HUELLA;
    const ctx = lienzo.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, ANCHO_HUELLA, ALTO_HUELLA);
    bitmap.close();
    return huellaDePixeles(ctx.getImageData(0, 0, ANCHO_HUELLA, ALTO_HUELLA).data, 4);
  } catch {
    return null;
  }
}

export interface AvisoFotoRepetida {
  /** Día del trabajo donde ya se usó, 'YYYY-MM-DD'. */
  fecha: string | null;
  /** Dónde, solo si es un trabajo de la misma empresa. */
  direccion: string | null;
}

/** La huella de la foto y, si ya se usó en otro bache, dónde y cuándo. */
export async function revisarFoto(
  foto: Blob,
): Promise<{ huella: string | null; usada: AvisoFotoRepetida | null }> {
  const huella = await huellaEnNavegador(foto);
  if (!huella) return { huella: null, usada: null };
  try {
    const r = await fetch(`/api/empresa/foto-repetida?h=${huella}`, { cache: "no-store" });
    if (!r.ok) return { huella, usada: null };
    const j = (await r.json()) as { repetida?: boolean; fecha?: string | null; direccion?: string | null };
    return { huella, usada: j.repetida ? { fecha: j.fecha ?? null, direccion: j.direccion ?? null } : null };
  } catch {
    return { huella, usada: null };
  }
}
