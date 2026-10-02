/**
 * Vocabulario del tablero de avisos. Se importa desde el server component y
 * desde las islas cliente, así que acá no entra nada de servidor: solo datos.
 */

export type EventoAviso =
  | "orden_emitida"
  | "orden_vencida"
  | "item_propuesto"
  | "aviso_general"
  | "cierres_pendientes"
  | "pulso_diario"
  | "item_validado"
  | "item_rechazado"
  | "orden_reasignada"
  | "orden_cerrada";

export interface Destinatario {
  id: number;
  evento: EventoAviso;
  canal: "push" | "email" | "telegram";
  destino: string;
  etiqueta: string | null;
  activo: boolean;
}

/** Roles internos que pueden recibir push. Afuera quedan empresa, lectura y hcd. */
export const ROLES_PUSH = [
  "admin",
  "planificacion",
  "supervision",
  "atencion_ciudadana",
  "informacion_estrategica",
  "cuadrilla",
  "funcionario",
] as const;

/**
 * Los destinos elegibles para push: los roles internos MÁS "empresa", que no
 * es un rol sino un lugar: los teléfonos de la contratista dueña de la orden
 * que dispara el evento. Se resuelve en notificarEvento con el empresaId.
 */
export const DESTINOS_PUSH = [...ROLES_PUSH, "empresa"] as const;

export const ETIQUETA_ROL: Record<string, string> = {
  empresa: "La empresa de la orden",
  admin: "Administración",
  planificacion: "Planificación",
  supervision: "Supervisión",
  atencion_ciudadana: "Atención Ciudadana",
  informacion_estrategica: "Información Estratégica",
  cuadrilla: "Cuadrillas",
  funcionario: "Funcionarios",
};

/** Las cuatro tarjetas, en el orden en que se cuentan. */
export const EVENTOS: Array<{ evento: EventoAviso; titulo: string; dispara: string }> = [
  {
    evento: "orden_emitida",
    titulo: "Orden emitida",
    dispara: "Se dispara cada vez que se emite una orden de trabajo a una empresa contratista.",
  },
  {
    evento: "orden_vencida",
    titulo: "Orden vencida",
    dispara: "Se dispara cuando el control diario encuentra una orden vencida que sigue activa.",
  },
  {
    evento: "item_propuesto",
    titulo: "Bache propuesto por cuadrilla",
    dispara: "Se dispara cuando una cuadrilla propone desde la calle un bache que no estaba en la orden.",
  },
  {
    evento: "cierres_pendientes",
    titulo: "Reclamos listos para cerrar",
    dispara:
      "Se dispara con el control diario cuando hay reclamos cuyo problema ya se reparó y falta responderle al vecino: el sistema empuja la bandeja de Cierres en vez de esperar que alguien la mire.",
  },
  {
    evento: "pulso_diario",
    titulo: "El pulso de las 7:00",
    dispara:
      "Todas las mañanas: el parte del día anterior — qué entró, qué se reparó, dónde se concentró la deuda, qué vence hoy y la anomalía del día. El email lleva el parte completo; el push, el resumen con link.",
  },
  {
    evento: "item_validado",
    titulo: "Bache propuesto validado",
    dispara:
      "Se dispara cuando Bacheo valida un bache que la cuadrilla propuso desde la calle. A la empresa le dice que ya puede reportarlo (o que ya quedó hecho, si lo cargó tapado).",
  },
  {
    evento: "item_rechazado",
    titulo: "Bache propuesto rechazado",
    dispara: "Se dispara cuando Bacheo rechaza un bache propuesto, con el motivo escrito.",
  },
  {
    evento: "orden_reasignada",
    titulo: "Orden pasada a otra empresa",
    dispara: "Se dispara cuando la Dirección le pasa una orden a otra contratista: la nueva se entera de que tiene trabajo.",
  },
  {
    evento: "orden_cerrada",
    titulo: "Orden cerrada",
    dispara: "Se dispara cuando una orden se cierra —sola, al terminar, o a mano por la Dirección.",
  },
  {
    evento: "aviso_general",
    titulo: "Aviso general",
    dispara: "Se dispara cuando la Dirección manda un aviso a mano desde esta misma página.",
  },
];
