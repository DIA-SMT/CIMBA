/**
 * LAS OBRAS DEL SIGOV, EN TRES ESTADOS Y DOS MATERIALES.
 *
 * SIGOV maneja nueve estados administrativos —relevada, imputada, autorizada,
 * en ejecución, ejecutada, en proceso de certificación, certificada,
 * liquidada, finalizada— y CIMBA los mostraba tal cual. Para quien mira el
 * mapa eso son nueve colores que hay que aprenderse, y la diferencia entre
 * "liquidada" y "certificada" no cambia nada en la calle: las dos son un paño
 * de hormigón ya colocado.
 *
 * "Sería bueno que estas categorías aparezcan agrupadas de esta manera" —
 * Dirección de Bacheo, 12/09, con los tres grupos y sus colores. Son los
 * mismos tres que ya usa el resto del sistema para el trabajo propio, así que
 * el mapa deja de tener dos vocabularios.
 */

export const GRUPOS_SIGOV = ["planificada", "en_ejecucion", "finalizada"] as const;
export type GrupoSigov = (typeof GRUPOS_SIGOV)[number];

export const ETIQUETA_GRUPO_SIGOV: Record<GrupoSigov, string> = {
  planificada: "Planificada",
  en_ejecucion: "En ejecución",
  finalizada: "Finalizada",
};

/**
 * Los colores los eligió la Dirección: amarillo, rojo, verde. No se cambian
 * por gusto — "prestemos atención a los colores que usan, dado que ellos saben
 * más de la nomenclatura de colores que le gusta a la doctora" (12/09).
 */
export const COLOR_GRUPO_SIGOV: Record<GrupoSigov, string> = {
  planificada: "#f4c000",
  en_ejecucion: "#e03131",
  finalizada: "#199e70",
};

/**
 * De los nueve estados de SIGOV a los tres grupos. "EN_PROCESO_SAF" viene en
 * la lista que dio la Dirección pero no aparece en los datos de hoy: se mapea
 * igual, porque el día que aparezca tiene que caer en su grupo y no en el
 * cajón de "planificada por defecto" sin que nadie lo note.
 */
const POR_ESTADO: Record<string, GrupoSigov> = {
  RELEVADA: "planificada",
  EN_PROCESO_SAF: "planificada",
  IMPUTADA: "planificada",
  AUTORIZADA: "planificada",

  EN_EJECUCION: "en_ejecucion",
  EJECUTADA: "en_ejecucion",

  EN_PROCESO_CERTIFICACION: "finalizada",
  CERTIFICADA: "finalizada",
  OT_APROBADA: "finalizada",
  LIQUIDADA: "finalizada",
  PAGADA: "finalizada",
  FINALIZADA: "finalizada",
};

/**
 * El grupo de un estado de SIGOV. Un estado desconocido cae en "planificada":
 * es el grupo que no afirma nada sobre la calle. Decir "finalizada" sobre algo
 * que no sabemos sería pintar de verde una obra que quizás no se hizo.
 */
export function grupoSigov(estadoSigov: string | null | undefined): GrupoSigov {
  if (!estadoSigov) return "planificada";
  return POR_ESTADO[estadoSigov.toUpperCase().replace(/\s+/g, "_")] ?? "planificada";
}

/**
 * DE QUÉ ES LA OBRA. Las licitaciones no lo distinguen —las 18 terminan en
 * "-A"— pero el tipo de intervención sí, y es el dato honesto: un paño de
 * hormigón es hormigón y una carpeta es asfalto. Hoy son 412 y 60.
 */
export const MATERIALES_SIGOV = ["hormigon", "asfalto"] as const;
export type MaterialSigov = (typeof MATERIALES_SIGOV)[number];

export const ETIQUETA_MATERIAL_SIGOV: Record<MaterialSigov, string> = {
  hormigon: "Hormigón",
  asfalto: "Asfalto",
};

export function materialSigov(tipoIntervencion: string | null | undefined): MaterialSigov {
  return tipoIntervencion === "carpeta" ? "asfalto" : "hormigon";
}
