/**
 * Las fotos de un bache propuesto no viven en `fotografias` sino en el metadata
 * del item: la del "antes" en `foto_propuesta`, la del "después" (cuando la
 * cuadrilla ya lo tapó) en `ya_ejecutado.foto_despues`. Estos dos lectores los
 * usan tanto la pantalla de la Dirección como la del portal de empresa, para
 * que las dos miren el mismo lugar.
 */

/** Ruta en el servidor de la foto del "antes" que mandó la cuadrilla al proponer. */
export function fotoPropuestaAntes(metadata: Record<string, unknown>): string | null {
  return typeof metadata.foto_propuesta === "string" ? metadata.foto_propuesta : null;
}

/** Ruta de la foto del "después", si el propuesto venía ya tapado. */
export function fotoPropuestaDespues(metadata: Record<string, unknown>): string | null {
  const y = metadata.ya_ejecutado as { foto_despues?: unknown } | undefined;
  return typeof y?.foto_despues === "string" ? y.foto_despues : null;
}
