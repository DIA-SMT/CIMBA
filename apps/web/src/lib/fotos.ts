/**
 * Fotos de obra: dónde vive cada imagen y cómo se ve el mismo punto en
 * Street View. Las fotos las suben las cuadrillas desde /campo (antes y
 * después, con GPS y hora); el bucket "fotografias" es público, así que la
 * URL se arma sin firmar nada.
 *
 * Módulo plano (sin "use client"/"server-only"): lo usan ambos lados.
 */

const BASE_STORAGE = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/storage/v1/object/public/fotografias`;

/** URL pública de una foto guardada en Storage, o la externa si vino de otro sistema. */
export function urlFoto(foto: { storagePath: string | null; urlExterna: string | null }): string | null {
  if (foto.urlExterna) return foto.urlExterna;
  if (!foto.storagePath) return null;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  // El path viene de la base (lo escribió subirFoto), pero puede traer espacios
  // o acentos: encodear cada segmento sin romper las barras.
  const ruta = foto.storagePath.split("/").map(encodeURIComponent).join("/");
  return `${BASE_STORAGE}/${ruta}`;
}

/** ¿Está configurada la clave de Google? Sin ella, Street View solo se abre en otra pestaña. */
export const hayStreetViewEmbebido = Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY);

/**
 * Imagen fija de Street View para un punto. Devuelve null si no hay clave
 * configurada — el llamador cae al enlace, que no necesita ninguna.
 *
 * `heading` en grados (0 = norte). Sin heading, Google elige la vista por
 * defecto del panorama más cercano.
 */
export function urlStreetViewEstatico(
  lat: number,
  lon: number,
  opciones: { ancho?: number; alto?: number; heading?: number; fov?: number } = {},
): string | null {
  const clave = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  if (!clave) return null;
  const p = new URLSearchParams({
    size: `${opciones.ancho ?? 640}x${opciones.alto ?? 400}`,
    location: `${lat},${lon}`,
    fov: String(opciones.fov ?? 80),
    // Radio: si no hay panorama exactamente en el punto, busca el más cercano
    // dentro de 60 m en vez de devolver la imagen gris de "sin cobertura".
    radius: "60",
    source: "outdoor",
    return_error_code: "true",
    key: clave,
  });
  if (opciones.heading != null) p.set("heading", String(opciones.heading));
  return `https://maps.googleapis.com/maps/api/streetview?${p.toString()}`;
}

/** Enlace al Street View interactivo (no necesita clave). */
export function linkStreetView(lat: number, lon: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
}
