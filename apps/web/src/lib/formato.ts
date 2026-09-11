import type { EstadoIncidente, FuenteDemanda, TipoProblema } from "@cimba/domain";

export const ETIQUETA_FUENTE: Record<FuenteDemanda, string> = {
  atencion_ciudadana: "Atención Ciudadana",
  hcd: "Concejo Deliberante",
  redes_sociales: "Redes / DIE",
  secretaria: "Secretarías",
  bachia: "BachIA",
  cuadrilla: "Cuadrilla",
  carga_manual: "Carga manual",
  sat: "SAT (Aguas)",
};

export const ETIQUETA_TIPO: Record<TipoProblema, string> = {
  bache: "Bache",
  pavimento_deteriorado: "Pavimento deteriorado",
  hundimiento: "Hundimiento",
  fisura: "Fisura",
  sumidero: "Sumidero",
  tapa_registro: "Tapa de registro",
  perdida_agua: "Pérdida de agua",
  bocacalle_rota: "Bocacalle rota",
  cuneta_rota: "Cuneta rota",
  cuadra_completa: "Cuadra completa",
  otro: "Otro",
};

export const ETIQUETA_ESTADO_INCIDENTE: Record<EstadoIncidente, string> = {
  detectado: "Detectado",
  priorizado: "Priorizado",
  programado: "Programado",
  en_ejecucion: "En ejecución",
  reparado: "Reparado",
  verificado: "Verificado",
  desestimado: "Desestimado",
};

export const ETIQUETA_ESTADO_DEMANDA: Record<string, string> = {
  recibida: "Recibida",
  en_validacion: "En validación",
  vinculada: "Vinculada",
  descartada: "Descartada",
  fuera_de_alcance: "Fuera de alcance",
  cerrada: "Cerrada (respondida)",
};

/**
 * EL SEMÁFORO — un único lenguaje de color para el estado, en cuatro pasos que
 * cuentan el avance hacia resuelto:
 *   rojo    sin atención  nadie lo tocó
 *   naranja en cola       comprometido: hay orden emitida / incidente programado, pero no arrancó
 *   ámbar   en obra       la cuadrilla está trabajando
 *   verde   resuelto      reparado o verificado (o "parece resuelto" en la brecha)
 *   gris    desestimado o sin dato
 *
 * Este módulo es PLANO: lo importan server components y clientes por igual, así
 * que no puede leer el tema. Para el HTML el color viaja como CSS custom
 * property y el navegador resuelve el juego solo (globals.css las redefine en
 * el bloque de tema claro). Para el canvas de MapLibre, que no entiende var(),
 * están los hex crudos por tema en SEMAFORO_HEX.
 *
 * El ámbar de acá NO es el amarillo de marca #F4DC00 (--color-amarillo), que
 * queda reservado para afordancias de interacción: círculo del analizador de
 * zona, hilos de cotejo, anillo de selección.
 */
export const SEMAFORO = {
  sin_atencion: "var(--color-sin-atencion)",
  en_cola: "var(--color-en-cola)",
  en_obra: "var(--color-en-obra)",
  resuelto: "var(--color-hecho)",
  inactivo: "var(--color-inactivo)",
} as const;

export type PasoSemaforo = keyof typeof SEMAFORO;

export type TemaSemaforo = "claro" | "oscuro";

/**
 * Los mismos cinco pasos en hex crudo, un juego por tema: para MapLibre y para
 * cualquier lugar que concatene alfa sobre el color (`${color}22` no funciona
 * con var()). El juego claro está validado sobre el blanco de positron; el
 * oscuro, sobre dark-matter.
 */
export const SEMAFORO_HEX = {
  claro: {
    sin_atencion: "#d42d20",
    en_cola: "#e8590c",
    en_obra: "#c08a00",
    resuelto: "#15803d",
    inactivo: "#6b7280",
  },
  oscuro: {
    sin_atencion: "#ff453a",
    en_cola: "#ff8c1a",
    en_obra: "#ffc233",
    resuelto: "#21b95c",
    inactivo: "#9ca3af",
  },
} as const satisfies Record<TemaSemaforo, Record<PasoSemaforo, string>>;

/** El juego de hex del tema. Quien pinta el canvas ya resolvió el tema con
 *  usarTemaMapa(): acá llega hecho. */
export function semaforoHex(tema: TemaSemaforo): Record<PasoSemaforo, string> {
  return SEMAFORO_HEX[tema];
}

/**
 * Macro-estados en tres pasos: el agrupador viejo, que sigue vivo porque lo
 * consumen las expresiones de pintado del mapa y los filtros por macro. El azul
 * salió de circulación como color de estado (un estado "abierto" pintado de
 * azul no dice nada), así que las cuatro claves quedan remapeadas al semáforo:
 * abierto → rojo (sin atención), en_curso → ámbar (en obra), resuelto → verde,
 * inactivo → gris. Siguen siendo hex crudo del juego claro (el tema por defecto
 * de la app) porque MapLibre no resuelve var(): para HTML conviene SEMAFORO, y
 * para el canvas SEMAFORO_HEX[tema].
 */
export const COLOR_MACRO = {
  abierto: SEMAFORO_HEX.claro.sin_atencion,
  en_curso: SEMAFORO_HEX.claro.en_obra,
  resuelto: SEMAFORO_HEX.claro.resuelto,
  inactivo: SEMAFORO_HEX.claro.inactivo,
} as const;

export function macroDeEstado(estado: EstadoIncidente): keyof typeof COLOR_MACRO {
  if (estado === "reparado" || estado === "verificado") return "resuelto";
  if (estado === "programado" || estado === "en_ejecucion") return "en_curso";
  if (estado === "desestimado") return "inactivo";
  return "abierto";
}

/** El paso del semáforo de un estado, con los cuatro pasos completos: a
 *  diferencia del macro, separa programado (comprometido, en cola) de
 *  en_ejecucion (la cuadrilla ya está en la calle). */
export function pasoDeEstado(estado: EstadoIncidente): PasoSemaforo {
  if (estado === "reparado" || estado === "verificado") return "resuelto";
  if (estado === "en_ejecucion") return "en_obra";
  if (estado === "programado") return "en_cola";
  if (estado === "desestimado") return "inactivo";
  return "sin_atencion";
}

/**
 * El paso del semáforo de una DEMANDA (el pedido del vecino), que es otra
 * entidad que el incidente y tiene sus propios estados.
 *
 * Existe porque el mapeo estaba escrito a mano en los chips de /demandas y el
 * badge de la tabla, tres filas más abajo, hablaba un idioma propio: la misma
 * palabra ("Vinculada") salía ámbar arriba y celeste abajo, y los cuatro
 * finales distintos del reclamo — cerrada, descartada, fuera de alcance — se
 * veían todos con el mismo gris. Un estado se pinta desde acá o no se pinta.
 *
 * "Vinculada" es ámbar y no verde a propósito: que el pedido ya tenga un
 * problema del territorio detrás significa que alguien lo está trabajando,
 * no que el bache esté tapado.
 */
export function pasoDeEstadoDemanda(estado: string): PasoSemaforo {
  if (estado === "cerrada") return "resuelto";
  if (estado === "vinculada") return "en_obra";
  if (estado === "en_validacion") return "en_cola";
  if (estado === "recibida") return "sin_atencion";
  // descartada, fuera_de_alcance y cualquier estado nuevo: salió de la cola.
  return "inactivo";
}

/** Del macro que viaja en las features del mapa (properties.macro) al paso del
 *  semáforo. El macro ya perdió la distinción programado/en_ejecucion, así que
 *  en_curso cae en ámbar: para los cuatro pasos hay que partir del estado. */
export function pasoDeMacro(macro: string): PasoSemaforo {
  if (macro === "resuelto") return "resuelto";
  if (macro === "en_curso") return "en_obra";
  if (macro === "inactivo") return "inactivo";
  return "sin_atencion";
}

/** La clasificación de brecha ya nombra los pasos del semáforo — solo
 *  "posible_resuelta" tiene otro nombre porque es un verde con reservas: el
 *  cotejo dice que hay obra cerca, nadie cerró el circuito. */
export function pasoDeBrecha(brecha: string | null | undefined): PasoSemaforo {
  if (brecha === "posible_resuelta") return "resuelto";
  if (brecha === "en_obra") return "en_obra";
  if (brecha === "en_cola") return "en_cola";
  if (brecha === "sin_atencion") return "sin_atencion";
  return "inactivo";
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  // Una fecha date pura ("2026-09-14") la interpreta `new Date` como medianoche
  // UTC, y en Argentina (UTC−3) eso cae en el día anterior: se mostraría 13/09.
  // Anclándola al mediodía local, el día que se ve es el que dice el dato.
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(soloFecha ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(d);
}

/** Hoy en zona local, como "YYYY-MM-DD": para comparar contra fechas date puras. */
export function hoyISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * ¿La orden se pasó de fecha? Estaba escrito tres veces —el portal, la tarjeta
 * de la lista y la tabla del staff— y el detalle de la orden ni siquiera lo
 * miraba: imprimía "Vence el 05/09/26" en gris chico el 11/9, como si fuera
 * futuro.
 *
 * vence_en es una fecha SIN hora ("YYYY-MM-DD"), así que se compara como texto
 * contra el hoy LOCAL. Con toISOString(), a la noche argentina (UTC−3) el
 * "hoy" ya sería el día siguiente y una orden que vence hoy aparecería
 * vencida.
 */
export const estaVencida = (o: { venceEn: string | null; estado: string }): boolean =>
  o.venceEn != null && (o.estado === "emitida" || o.estado === "en_ejecucion") && o.venceEn < hoyISO();

/** Vence hoy: último día, todavía no es deuda. Va en las DOS pantallas que
 *  muestran la fecha o en ninguna — si no, la lista dice "Vence el 11/09/26"
 *  en gris y el detalle "Vence HOY", que es el bug que se está arreglando. */
export const venceHoy = (o: { venceEn: string | null; estado: string }): boolean =>
  o.venceEn != null && (o.estado === "emitida" || o.estado === "en_ejecucion") && o.venceEn === hoyISO();

export function numero(n: number): string {
  return new Intl.NumberFormat("es-AR").format(n);
}
