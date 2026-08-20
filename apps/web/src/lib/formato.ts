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
};

/** Macro-estados del mapa (paleta funcional validada sobre #0B0F16). */
export const COLOR_MACRO = {
  abierto: "#3987e5",
  en_curso: "#d95926",
  resuelto: "#199e70",
  inactivo: "#6b7280",
} as const;

export function macroDeEstado(estado: EstadoIncidente): keyof typeof COLOR_MACRO {
  if (estado === "reparado" || estado === "verificado") return "resuelto";
  if (estado === "programado" || estado === "en_ejecucion") return "en_curso";
  if (estado === "desestimado") return "inactivo";
  return "abierto";
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(d);
}

export function numero(n: number): string {
  return new Intl.NumberFormat("es-AR").format(n);
}
