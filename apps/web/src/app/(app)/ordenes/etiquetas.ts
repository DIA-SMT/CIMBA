import type { EstadoItemOrden, EstadoOrden, PrioridadVial } from "@cimba/domain";

/**
 * Etiquetas y colores del módulo de órdenes. Módulo plano (sin "use client"):
 * lo comparten las páginas server y las islas cliente del tablero.
 */

export const ETIQUETA_ESTADO_ORDEN: Record<EstadoOrden, string> = {
  borrador: "Borrador",
  emitida: "Emitida",
  en_ejecucion: "En ejecución",
  completada: "Completada",
  anulada: "Anulada",
};

/** Misma paleta funcional del mapa: la orden emitida es "pedido", la que se
 * trabaja es "en curso", la completada es "hecho". */
export const COLOR_ESTADO_ORDEN: Record<EstadoOrden, string> = {
  borrador: "#8b94a3",
  emitida: "#3987e5",
  en_ejecucion: "#d95926",
  completada: "#199e70",
  anulada: "#6b7280",
};

export const ETIQUETA_PRIORIDAD: Record<PrioridadVial, string> = {
  primaria: "Primaria",
  secundaria: "Secundaria",
  terciaria: "Terciaria",
};

/**
 * Misma semántica que el mapa y el portal de empresas: la primaria ARDE
 * (naranja de "en curso"), la secundaria es amarilla, la terciaria espera.
 * Antes acá primaria era amarilla y secundaria celeste — el mismo dato se
 * pintaba con colores opuestos según la pantalla.
 */
export const COLOR_PRIORIDAD: Record<PrioridadVial, string> = {
  primaria: "#d95926",
  secundaria: "#f4dc00",
  terciaria: "#8fa3bf",
};

export const ETIQUETA_TIPO_TRABAJO: Record<string, string> = {
  bache: "Bache",
  carpeta: "Carpeta",
  tramo: "Tramo",
};

export const ETIQUETA_ESTADO_ITEM: Record<EstadoItemOrden, string> = {
  pendiente: "Pendiente",
  hecho: "Hecho",
  no_encontrado: "No encontrado",
};

export const COLOR_ESTADO_ITEM: Record<EstadoItemOrden, string> = {
  pendiente: "#3987e5",
  hecho: "#199e70",
  no_encontrado: "#8b94a3",
};
