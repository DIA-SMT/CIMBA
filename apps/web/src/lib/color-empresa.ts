/**
 * El color de cada empresa, estable en todas las pantallas.
 *
 * Vivía adentro de mapa-cimba.tsx; salió acá cuando el mapa de órdenes empezó
 * a necesitarlo: la misma contratista tiene que pintarse igual en el mapa
 * grande, en los sectores de licitación y en el mapa de órdenes, o el color
 * deja de significar algo.
 */

/** 12 colores categóricos distinguibles entre sí sobre el fondo oscuro. */
export const PALETA_EMPRESAS = [
  "#4f9cf9", "#f2a33c", "#3ec9a7", "#e06fae", "#b18cff", "#f4dc00",
  "#6fd1e8", "#ef7d54", "#9ecf4a", "#ff8fa3", "#c9b458", "#8f9bff",
] as const;

/**
 * Color estable por hash del nombre: la misma empresa se pinta igual en
 * cualquier sesión y pantalla, sin coordinar nada con el servidor.
 *
 * La MISMA empresa llega con grafías distintas según la fuente: los sectores
 * de licitación traen el slug ("calleri") y los circuitos operativos el nombre
 * completo de la tabla ("CALLERI E HIJOS S.A."). Se hashea solo la primera
 * palabra sin acentos, que coincide con el slug en todas las empresas reales
 * (LÍNEA→linea, INGECO S.A.→ingeco, LECHESI ARECO→lechesi…), para que cada
 * empresa tenga UN color en todas las capas.
 */
export function colorDeEmpresa(nombre: string): string {
  const clave =
    nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase()
      .split(/[\s(]+/)[0] ?? "";
  let h = 5381;
  for (let i = 0; i < clave.length; i++) h = ((h << 5) + h + clave.charCodeAt(i)) | 0;
  return PALETA_EMPRESAS[Math.abs(h) % PALETA_EMPRESAS.length] ?? "#4f9cf9";
}
