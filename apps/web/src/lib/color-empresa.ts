/**
 * El color de cada empresa, estable en todas las pantallas.
 *
 * Vivía adentro de mapa-cimba.tsx; salió acá cuando el mapa de órdenes empezó
 * a necesitarlo: la misma contratista tiene que pintarse igual en el mapa
 * grande, en los sectores de licitación, en el mapa de órdenes y en Avance, o
 * el color deja de significar algo.
 */

/** 14 colores categóricos distinguibles entre sí sobre el fondo oscuro. */
export const PALETA_EMPRESAS = [
  "#4f9cf9", "#f2a33c", "#3ec9a7", "#e06fae", "#b18cff", "#f4dc00",
  "#6fd1e8", "#ef7d54", "#9ecf4a", "#ff8fa3", "#c9b458", "#8f9bff",
  "#d4a373", "#9aa3b2",
] as const;

/**
 * COLORES FIJOS para las empresas conocidas.
 *
 * El hash repartía 13 empresas en 12 colores y chocaban de a pares: Calleri
 * con Sercovial, Galindo con Antonelli, Línea con Administración, Luxury con
 * Lechesi. En el mapa de órdenes era un detalle; en Avance, donde el color ES
 * la respuesta a "¿de quién es esta cuadra?", dos empresas del mismo color
 * hacen el mapa ilegible.
 *
 * La tabla se indexa por la misma clave que hashea colorDeEmpresa —la primera
 * palabra sin acentos, que coincide con el slug— así que una empresa se pinta
 * igual venga como "CALLERI E HIJOS S.A.", "calleri" o "CALLERI E HIJOS SA (1)".
 * Las que no están acá siguen por hash.
 *
 * Administración lleva el amarillo de la marca: son las cuadrillas propias del
 * municipio, y que se distingan de las contratistas es parte del mensaje.
 */
export const COLOR_FIJO_EMPRESA: Record<string, string> = {
  administracion: "#f4dc00",
  proycon: "#f2a33c",
  ingeco: "#3ec9a7",
  galindo: "#4f9cf9",
  calleri: "#b18cff",
  antonelli: "#e06fae",
  linea: "#9ecf4a",
  lechesi: "#ef7d54",
  baronetto: "#6fd1e8",
  sercovial: "#ff8fa3",
  luxury: "#c9b458",
  contratuc: "#8f9bff",
  uocra: "#d4a373",
  /* Lo que no se pudo atribuir a ninguna empresa registrada: gris, para que
     no compita con las que sí. */
  otros: "#9aa3b2",
};

/**
 * La clave con la que se identifica a una empresa venga con la grafía que
 * venga: la primera palabra, sin acentos, en minúsculas.
 *
 * La MISMA empresa llega con grafías distintas según la fuente: los sectores
 * de licitación traen el slug ("calleri"), los circuitos operativos el nombre
 * completo de la tabla ("CALLERI E HIJOS S.A.") y las planillas cualquier
 * cosa ("CALLERI E HIJOS SA (1)"). La primera palabra coincide con el slug en
 * todas las empresas reales (LÍNEA→linea, INGECO S.A.→ingeco, LECHESI
 * ARECO→lechesi…).
 */
export function claveDeEmpresa(nombre: string): string {
  return (
    nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase()
      .split(/[\s(]+/)[0] ?? ""
  );
}

/**
 * Color estable por empresa: fijo si es una de las conocidas, y si no por hash
 * del nombre —la misma empresa se pinta igual en cualquier sesión y pantalla,
 * sin coordinar nada con el servidor.
 */
export function colorDeEmpresa(nombre: string): string {
  const clave = claveDeEmpresa(nombre);
  const fijo = COLOR_FIJO_EMPRESA[clave];
  if (fijo) return fijo;
  let h = 5381;
  for (let i = 0; i < clave.length; i++) h = ((h << 5) + h + clave.charCodeAt(i)) | 0;
  return PALETA_EMPRESAS[Math.abs(h) % PALETA_EMPRESAS.length] ?? "#4f9cf9";
}

/**
 * La paleta se eligió para el fondo oscuro. Sobre blanco (la columna en tema
 * claro, el plano Voyager) el amarillo, el lima, el celeste claro y el caqui
 * se lavan: el mismo color, un tono más oscuro, solo cuando el tema es claro.
 * La identidad no cambia —sigue siendo "el amarillo de Administración"—, solo
 * se lee.
 */
const EN_CLARO: Record<string, string> = {
  "#f4dc00": "#a89400",
  "#9ecf4a": "#5f8f1f",
  "#6fd1e8": "#1f95b8",
  "#c9b458": "#8a7a2a",
  "#3ec9a7": "#17987a",
  "#ff8fa3": "#d9506f",
  "#d4a373": "#a3703f",
  "#9aa3b2": "#6b7280",
};

export function colorDeEmpresaEn(nombre: string, tema: "claro" | "oscuro"): string {
  const color = colorDeEmpresa(nombre);
  return tema === "claro" ? (EN_CLARO[color] ?? color) : color;
}
