import type { TipoIntervencion } from "@cimba/domain";

/**
 * Etiquetas del tipo de intervención para el detalle de la orden. Módulo plano
 * (sin "use client"): lo comparten la página server y la isla del select.
 * Vive acá y no en ../etiquetas.ts porque solo este detalle lo usa por ahora.
 */
export const ETIQUETA_TIPO_INTERVENCION: Record<TipoIntervencion, string> = {
  bacheo: "Bacheo",
  pano_hormigon: "Paño de hormigón",
  carpeta: "Carpeta",
  enripiado: "Enripiado",
};
