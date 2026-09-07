/**
 * EL GLOSARIO: la única fuente de verdad de qué significa cada término y qué
 * hace cada botón, en lenguaje de persona. Lo leen las ayudas en pantalla
 * (tooltips y ⓘ), y debería leerlo cualquier texto nuevo antes de inventar
 * otra explicación — "necesito poder explicar muy bien todo" (el Director).
 *
 * Módulo plano, sin "use client"/"server-only": importable desde ambos lados.
 */

export interface Termino {
  titulo: string;
  texto: string;
}

export const GLOSARIO = {
  // ── El semáforo (la clasificación de cada pedido contra el territorio) ──
  sin_atencion: {
    titulo: "Sin atención (rojo)",
    texto:
      "Nadie tocó este pedido todavía: a menos de 40 metros no hay ninguna reparación ni ningún trabajo abierto. Es la deuda real. ¿Por qué 40 metros? Porque la dirección de un reclamo nunca es exacta — «Muñecas al 1400» puede caer en cualquier punto de la cuadra — y media cuadra alcanza para encontrar el trabajo que le corresponde sin confundirlo con el de la esquina.",
  },
  en_cola: {
    titulo: "En cola (naranja)",
    texto:
      "El pedido está comprometido pero la obra no arrancó: a menos de 40 metros hay un problema detectado, priorizado o con orden de trabajo emitida. Va a dejar de ser deuda cuando la cuadrilla lo haga.",
  },
  en_obra: {
    titulo: "En obra (ámbar)",
    texto:
      "Hay una cuadrilla trabajando AHORA a menos de 40 metros de este pedido. Cuando esa intervención se finalice con foto y medidas, el pedido pasa a verde.",
  },
  posible_resuelta: {
    titulo: "Parece resuelto (verde)",
    texto:
      "Hay una reparación registrada DESPUÉS de la fecha del pedido, a menos de 40 metros. Casi seguro ya está solucionado: falta cotejarlo (confirmar que esa obra era la de este pedido) y responderle al vecino. Acá no falta obra, falta cerrar el circuito.",
  },
  cotejo: {
    titulo: "Cotejar",
    texto:
      "Cotejar es decidir si un pedido pendiente ya está cubierto por un trabajo cercano. En el mapa (vista Brecha), al tocar un pedido se dibujan hilos amarillos hacia las reparaciones y obras a menos de 60 metros: si una corresponde, lo VINCULÁS — el pedido deja de contar como deuda y queda listo para responderle al vecino. Si ninguna corresponde, confirmaste brecha real: falta obra. Nada se borra: vincular deja rastro de quién y cuándo.",
  },

  // ── Estados de un PEDIDO (demanda) ──
  recibida: {
    titulo: "Recibida",
    texto: "El pedido entró al sistema (del 147, del Concejo, de redes, o cargado acá) y todavía nadie lo cotejó contra el territorio.",
  },
  en_validacion: {
    titulo: "En validación",
    texto: "Alguien lo está revisando: ubicación dudosa, tipo poco claro o datos por corregir antes de poder cruzarlo.",
  },
  vinculada: {
    titulo: "Vinculado",
    texto: "Ya tiene su problema físico identificado: quedó unido a un incidente. Cuando ese incidente se repare, este pedido aparece en Cierres para responderle al vecino.",
  },
  descartada: {
    titulo: "Descartado",
    texto: "Se decidió que no corresponde trabajarlo (duplicado de otro pedido, error de carga), siempre con motivo y con el nombre de quien lo decidió. No se borra: queda en el historial.",
  },
  fuera_de_alcance: {
    titulo: "Fuera de alcance",
    texto: "No lo resuelve la Dirección de Bacheo: se derivó a la S.A.T. (agua) con nota registrada, o a Ingeniería (ripio). La ficha dice a dónde fue y en qué expediente quedó.",
  },
  cerrada: {
    titulo: "Cerrado (respondido)",
    texto: "El circuito completo: el problema se reparó Y se le respondió al que pidió. La respuesta queda guardada en la ficha del pedido.",
  },
  sin_vincular: {
    titulo: "Sin vincular",
    texto: "Pedidos que todavía no fueron cotejados contra el territorio (están recibidos o en validación). Es la cola de trabajo de la consolidación: el objetivo es llevarla a cero.",
  },

  // ── Estados de un PROBLEMA (incidente) y sus botones ──
  detectado: {
    titulo: "Detectado",
    texto: "El problema físico existe y está confirmado en el mapa, pero todavía no entró en la cola de trabajo.",
  },
  priorizado: {
    titulo: "Priorizado",
    texto: "Ya está en la cola de trabajo, ordenado por su puntaje de prioridad. Es lo que se elige al armar una orden de trabajo.",
  },
  programado: {
    titulo: "Programado",
    texto: "Tiene cuadrilla u orden de trabajo asignada: hay un compromiso concreto de hacerlo. En el semáforo es naranja (en cola).",
  },
  en_ejecucion: {
    titulo: "En ejecución",
    texto: "La cuadrilla está trabajando en este problema ahora. En el semáforo es ámbar (en obra).",
  },
  reparado: {
    titulo: "Reparado",
    texto: "La cuadrilla lo terminó y lo reportó con foto y medidas. Queda esperando que supervisión lo VERIFIQUE.",
  },
  verificado: {
    titulo: "Verificado",
    texto: "Supervisión constató que la reparación está bien hecha. Es el verde definitivo: sale de todas las colas y respalda la respuesta al vecino.",
  },
  desestimado: {
    titulo: "Desestimado",
    texto: "Se decidió no trabajarlo (con motivo registrado). Queda en el historial, no en las colas.",
  },
  priorizar: {
    titulo: "¿Qué hace «Priorizar»?",
    texto:
      "Calcula el puntaje de prioridad del problema (cuánta gente lo pide, cuánto hace que está abierto, qué tan grave es el tipo, si es reincidente y si está en una avenida) y lo pasa de «detectado» a «priorizado»: entra en la cola de trabajo, listo para ser elegido cuando se arme una orden. No manda a nadie a la calle todavía.",
  },
  verificar: {
    titulo: "¿Qué hace «Verificar ✓»?",
    texto:
      "Es el control de calidad final, uno por uno a propósito: supervisión mira la reparación que la cuadrilla reportó (foto, medidas, lugar) y confirma que está bien hecha. El incidente pasa a «verificado» — verde definitivo — y deja de aparecer en las bandejas. Si algo está mal, NO se verifica y se reclama. Verificar en lote invitaría a aprobar sin mirar.",
  },
  programar: {
    titulo: "¿Qué hace «Programar»?",
    texto: "Le asigna una cuadrilla propia a este problema: pasa a «programado» y le aparece a esa cuadrilla en su lista de trabajo. Para las empresas contratistas, el camino es la orden de trabajo.",
  },
} as const satisfies Record<string, Termino>;

export type ClaveGlosario = keyof typeof GLOSARIO;

/** Tooltip de una línea: "Título — texto". Para atributos title=. */
export function ayudaDe(clave: ClaveGlosario): string {
  const t = GLOSARIO[clave];
  return `${t.titulo} — ${t.texto}`;
}
