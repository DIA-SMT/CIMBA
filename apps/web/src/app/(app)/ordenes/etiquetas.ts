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

/**
 * EL SEMÁFORO, no una paleta propia. Estos dos mapas eran hex crudos con el
 * azul #3987e5 que salió de circulación como color de estado: la misma orden
 * se veía azul en el tablero y naranja en el mapa, y encima el hex no seguía
 * al tema (los cinco colores estaban calibrados para el claro y en el oscuro
 * quedaban apagados).
 *
 * El mapeo es el del ciclo real: emitida = está en la cola de la empresa
 * (naranja), en ejecución = la cuadrilla está en la calle (ámbar), completada
 * = hecho (verde). Borrador y anulada son gris porque no son trabajo vivo.
 *
 * Como ahora son tokens `var(--…)`, el truco de concatenar alfa (`${color}22`)
 * dejó de funcionar: para el fondo va color-mix al 14%, que es el valor que ya
 * usaba incidentes/[id]. Si agregás un estado nuevo, sale de acá — no escribas
 * un var() suelto en una pantalla.
 */
export const COLOR_ESTADO_ORDEN: Record<EstadoOrden, string> = {
  borrador: "var(--color-inactivo)",
  emitida: "var(--color-en-cola)",
  en_ejecucion: "var(--color-en-obra)",
  completada: "var(--color-hecho)",
  anulada: "var(--color-inactivo)",
};

/** El fondo tenue de un chip pintado con un token del semáforo. 14% es el
 *  valor que ya estaba escrito en incidentes/[id]: uno solo en todo el
 *  producto, o el mismo chip se ve distinto en dos pantallas. */
export const fondoTenue = (color: string) => `color-mix(in srgb, ${color} 14%, transparent)`;

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
// Tokens CSS (no hex): estos colores se usan como TEXTO sobre paneles y el
// amarillo pleno desaparece en tema claro; el token flipea solo. Igual que
// COLOR_ESTADO_ORDEN y COLOR_ESTADO_ITEM, que también pasaron a tokens: para
// el fondo tenue de un chip se usa fondoTenue(), nunca `${color}22`.
export const COLOR_PRIORIDAD: Record<PrioridadVial, string> = {
  primaria: "var(--color-encurso)",
  secundaria: "var(--color-amarillo)",
  terciaria: "var(--color-texto-2)",
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
  propuesto: "Propuesto por la empresa",
  rechazado: "Rechazado",
  ya_resuelto: "Ya estaba resuelto",
};

export const COLOR_ESTADO_ITEM: Record<EstadoItemOrden, string> = {
  pendiente: "var(--color-en-cola)",
  hecho: "var(--color-hecho)",
  no_encontrado: "var(--color-inactivo)",
  // El amarillo de marca: lo propuesto por la empresa todavía NO es trabajo
  // encargado, así que no puede tomar un paso del semáforo — está esperando
  // que una persona lo valide.
  propuesto: "var(--color-amarillo)",
  rechazado: "var(--color-inactivo)",
  /**
   * Verde apagado y no verde pleno: "ya estaba resuelto" cierra el item pero
   * NO es trabajo que la empresa hizo ni que se certifique, así que no puede
   * verse igual que "Hecho". Gris tampoco: gris significa desestimado, y esto
   * sí resolvió el problema del vecino.
   * OJO: este mismo color está en el portal (app/empresa/orden/[id]/page.tsx),
   * porque la empresa y el Director tienen que ver lo mismo. Se cambian juntos.
   */
  ya_resuelto: "color-mix(in srgb, var(--color-hecho) 65%, var(--color-inactivo))",
};
