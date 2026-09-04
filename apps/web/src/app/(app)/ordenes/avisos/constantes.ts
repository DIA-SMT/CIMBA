/**
 * Vocabulario del tablero de avisos. Se importa desde el server component y
 * desde las islas cliente, así que acá no entra nada de servidor: solo datos.
 */

export type EventoAviso = "orden_emitida" | "orden_vencida" | "item_propuesto" | "aviso_general";

export interface Destinatario {
  id: number;
  evento: EventoAviso;
  canal: "push" | "email";
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

export const ETIQUETA_ROL: Record<string, string> = {
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
    evento: "aviso_general",
    titulo: "Aviso general",
    dispara: "Se dispara cuando la Dirección manda un aviso a mano desde esta misma página.",
  },
];
