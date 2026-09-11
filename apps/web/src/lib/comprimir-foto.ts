/**
 * COMPRESIÓN DE FOTOS EN EL TELÉFONO, ANTES DE SUBIR.
 *
 * No es una optimización: sin esto la carga NO FUNCIONA en producción. Las
 * fotos viajan en una server action, o sea dentro del request de la función
 * serverless, y Vercel corta el body en 4,5 MB — un límite de plataforma que
 * el `bodySizeLimit` de next.config no puede levantar. Una foto de celular
 * pesa entre 3 y 8 MB y el formulario manda ANTES + DESPUÉS juntas: en la
 * notebook anda y en la calle revienta, después de que el capataz esperó la
 * subida entera con datos móviles.
 *
 * Comprimir acá arregla las dos cosas a la vez: entra holgado en el límite y
 * sube en segundos en vez de minutos. 1.600 px de lado mayor es de sobra para
 * lo que la foto tiene que probar (que el bache está tapado y cómo quedó el
 * borde); el original de 4.000 px solo agrega espera.
 *
 * Regla de oro: ante cualquier problema devuelve el archivo ORIGINAL. Una
 * foto grande que quizá falle es mejor que ninguna foto.
 */

/** Arriba de esto no hay ganancia visible y sí mucho peso. */
const LADO_MAX = 1600;
const CALIDAD = 0.75;
/** Abajo de esto ya entra cómoda: no vale la pena recodificar. */
const YA_ES_CHICA = 600 * 1024;

export interface FotoComprimida {
  archivo: File;
  /** Bytes originales y finales, para poder decirle al capataz qué pasó. */
  antes: number;
  despues: number;
}

export async function comprimirFoto(original: File): Promise<FotoComprimida> {
  const sinCambio = { archivo: original, antes: original.size, despues: original.size };
  if (!original.type.startsWith("image/")) return sinCambio;
  if (original.size <= YA_ES_CHICA) return sinCambio;

  try {
    /**
     * imageOrientation "from-image" aplica la rotación del EXIF al decodificar.
     * Sin eso, las fotos sacadas en vertical con algunos Android se guardaban
     * acostadas: el canvas dibuja los píxeles crudos y la etiqueta de
     * orientación se pierde al recodificar.
     */
    const bitmap = await createImageBitmap(original, { imageOrientation: "from-image" });
    const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext("2d");
    if (!ctx) return sinCambio;
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      lienzo.toBlob(resolve, "image/jpeg", CALIDAD),
    );
    // Si la recodificación no achicó nada (una foto ya optimizada, un PNG de
    // pantalla), se queda el original: recomprimir de gusto solo pierde
    // calidad.
    if (!blob || blob.size >= original.size) return sinCambio;

    const nombre = original.name.replace(/\.[^.]+$/, "") + ".jpg";
    return {
      archivo: new File([blob], nombre, { type: "image/jpeg", lastModified: Date.now() }),
      antes: original.size,
      despues: blob.size,
    };
  } catch {
    // Navegador viejo sin createImageBitmap, canvas bloqueado, memoria: da
    // igual el motivo, se sube la original.
    return sinCambio;
  }
}

/** "4,2 MB" / "380 KB" — para mostrar lo que se ahorró sin hacer cuentas. */
export const pesoCorto = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`
    : `${Math.round(bytes / 1024)} KB`;
