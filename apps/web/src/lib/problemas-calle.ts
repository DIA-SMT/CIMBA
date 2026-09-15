import type { TipoProblema } from "@cimba/domain";

/**
 * LO QUE LA CUADRILLA ENCUENTRA Y NO ES UN BACHE.
 *
 * Hasta la revisión del 12/09 el portal tenía un solo verbo: reportar hecho.
 * Cuando la cuadrilla llegaba a un punto y se encontraba con una pérdida de
 * agua, las dos salidas disponibles mentían:
 *
 *   "No lo encontré"   → falso: lo encontró, y encontró algo peor.
 *   "Reportar hecho"   → peor: inventa m², cobra un bacheo que no existió y
 *                        cierra un reclamo que en la calle sigue abierto.
 *
 * Así que el capataz elegía la menos mala y el dato se perdía. Este vocabulario
 * es la tercera salida. Sale del protocolo de la Dirección de Bacheo y de las
 * categorías que ya usaba la app de la Dirección (la de las referencias de
 * colores), más "pérdida de líquidos cloacales", que la app no distinguía de la
 * pérdida de agua y es otro reclamo, otra cuadrilla y otra repartición.
 *
 * Se parten en dos familias porque de la familia depende qué pasa después:
 *
 *   sat          no lo arregla Bacheo. Va a la SAT. Lo único que podemos hacer
 *                es dejar constancia con foto para el informe (y, con UOCRA o
 *                INGECO, ejecutar la pérdida de agua si se asigna esa tarea).
 *   tratamiento  sí es nuestro, pero no se arregla bacheando: el paño hay que
 *                cambiarlo, el tramo hay que repavimentarlo, o la calle es de
 *                ripio y nunca fue asfalto.
 *
 * `tipoProblema` es a qué se RECLASIFICA el problema en el vocabulario que ya
 * habla toda la app. Donde no hay equivalente honesto va en null y el dato
 * queda en `requiere`: preferimos no traducir antes que traducir mal.
 */

export type FamiliaProblema = "sat" | "tratamiento";

export interface MotivoCalle {
  valor: string;
  etiqueta: string;
  familia: FamiliaProblema;
  /** El tipo del vocabulario de CIMBA, cuando existe uno que diga lo mismo. */
  tipoProblema: TipoProblema | null;
  /** Una línea que explique qué va a pasar con esto. La lee el capataz. */
  consecuencia: string;
}

export const MOTIVOS_CALLE: MotivoCalle[] = [
  {
    valor: "perdida_agua",
    etiqueta: "Pérdida de agua",
    familia: "sat",
    tipoProblema: "perdida_agua",
    consecuencia: "Va a la SAT. Tu foto es la prueba para el informe.",
  },
  {
    valor: "perdida_cloacal",
    etiqueta: "Pérdida de líquidos cloacales",
    familia: "sat",
    tipoProblema: "perdida_cloacal",
    consecuencia: "Va a la SAT. Tu foto es la prueba para el informe.",
  },
  {
    valor: "tapa_cloaca",
    etiqueta: "Tapa de cloaca rota",
    familia: "sat",
    tipoProblema: "tapa_registro",
    consecuencia: "Va a la SAT. Tu foto es la prueba para el informe.",
  },
  {
    valor: "imbornal",
    etiqueta: "Imbornal obstruido",
    familia: "sat",
    tipoProblema: "sumidero",
    consecuencia: "Va a Hidráulica. Tu foto es la prueba para el informe.",
  },
  {
    valor: "pano_hormigon",
    etiqueta: "Hay que cambiar el paño de hormigón",
    familia: "tratamiento",
    tipoProblema: null,
    consecuencia: "Vuelve a Bacheo para programarlo como cambio de paño.",
  },
  {
    valor: "carpeta",
    etiqueta: "Necesita carpeta (repavimentación)",
    familia: "tratamiento",
    // El vocabulario ya tenía la señal exacta: "ese tramo no se arregla
    // bacheando". Es literalmente lo que el capataz está diciendo.
    tipoProblema: "cuadra_completa",
    consecuencia: "Vuelve a Bacheo: el tramo ya no se arregla bacheando.",
  },
  {
    valor: "enripiado",
    etiqueta: "Es calle de ripio (enripiado)",
    familia: "tratamiento",
    tipoProblema: null,
    consecuencia: "Corrige nuestra capa de tipo de calle: nunca fue asfalto.",
  },
];

export const MOTIVO_POR_VALOR = new Map(MOTIVOS_CALLE.map((m) => [m.valor, m]));

/** Los valores válidos, para el `z.enum` de las acciones del servidor. */
export const VALORES_MOTIVO = MOTIVOS_CALLE.map((m) => m.valor) as [string, ...string[]];

export const etiquetaMotivo = (valor: string) =>
  MOTIVO_POR_VALOR.get(valor)?.etiqueta ?? valor;

export const ETIQUETA_FAMILIA: Record<FamiliaProblema, string> = {
  sat: "No lo arregla Bacheo",
  tratamiento: "Es nuestro, pero no es un bache",
};
