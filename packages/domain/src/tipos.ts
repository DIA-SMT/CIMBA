import { z } from "zod";

// ── Enums del dominio (espejo exacto de los enums de Postgres) ─────────────

export const FUENTES_DEMANDA = [
  "atencion_ciudadana",
  "hcd",
  "redes_sociales",
  "secretaria",
  "bachia",
  "cuadrilla",
  "carga_manual",
  "sat",
] as const;
export const fuenteDemandaSchema = z.enum(FUENTES_DEMANDA);
export type FuenteDemanda = z.infer<typeof fuenteDemandaSchema>;

export const TIPOS_PROBLEMA = [
  "bache",
  "pavimento_deteriorado",
  "hundimiento",
  "fisura",
  "sumidero",
  "tapa_registro",
  "perdida_agua",
  "otro",
] as const;
export const tipoProblemaSchema = z.enum(TIPOS_PROBLEMA);
export type TipoProblema = z.infer<typeof tipoProblemaSchema>;

export const ESTADOS_DEMANDA = [
  "recibida",
  "en_validacion",
  "vinculada",
  "descartada",
  "fuera_de_alcance",
] as const;
export const estadoDemandaSchema = z.enum(ESTADOS_DEMANDA);
export type EstadoDemanda = z.infer<typeof estadoDemandaSchema>;

export const ESTADOS_INCIDENTE = [
  "detectado",
  "priorizado",
  "programado",
  "en_ejecucion",
  "reparado",
  "verificado",
  "desestimado",
] as const;
export const estadoIncidenteSchema = z.enum(ESTADOS_INCIDENTE);
export type EstadoIncidente = z.infer<typeof estadoIncidenteSchema>;

export const ESTADOS_INTERVENCION = ["asignada", "en_curso", "finalizada", "anulada"] as const;
export const estadoIntervencionSchema = z.enum(ESTADOS_INTERVENCION);
export type EstadoIntervencion = z.infer<typeof estadoIntervencionSchema>;

export const ROLES_USUARIO = [
  "admin",
  "atencion_ciudadana",
  "hcd",
  "informacion_estrategica",
  "planificacion",
  "supervision",
  "cuadrilla",
  "lectura",
  // al final: el índice define el id_persona ficticio del acceso dev (90000+i)
  "funcionario",
] as const;
export const rolUsuarioSchema = z.enum(ROLES_USUARIO);
export type RolUsuario = z.infer<typeof rolUsuarioSchema>;

// ── Geometría ───────────────────────────────────────────────────────────────

export const puntoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type Punto = z.infer<typeof puntoSchema>;

/** Bounding box operativo de San Miguel de Tucumán (con margen). */
export const BBOX_SMT = {
  lonMin: -65.32,
  lonMax: -65.14,
  latMin: -26.91,
  latMax: -26.74,
} as const;

export function dentroDeSMT(p: Punto): boolean {
  return (
    p.lon >= BBOX_SMT.lonMin &&
    p.lon <= BBOX_SMT.lonMax &&
    p.lat >= BBOX_SMT.latMin &&
    p.lat <= BBOX_SMT.latMax
  );
}

// ── Demanda normalizada (lo que producen TODOS los adaptadores de ingesta) ──

export const demandaNormalizadaSchema = z.object({
  sistema: z.string().min(1), // 'atencion_ciudadana' | 'sat' | 'consolidado' | ...
  idRemoto: z.string().min(1),
  fuente: fuenteDemandaSchema,
  tipo: tipoProblemaSchema.nullable(),
  descripcion: z.string().nullable(),
  direccionTexto: z.string().nullable(),
  direccionNormalizada: z.string().nullable(),
  punto: puntoSchema.nullable(),
  geocodConfianza: z.number().min(0).max(1).nullable(),
  distritoId: z.number().int().nullable(),
  solicitante: z.string().nullable(),
  prioridadInformada: z.number().int().min(1).max(5).nullable(),
  menciones: z.number().int().nullable(),
  urlOrigen: z.string().nullable(),
  contacto: z.record(z.string(), z.unknown()).default({}),
  creadoEn: z.coerce.date().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type DemandaNormalizada = z.infer<typeof demandaNormalizadaSchema>;

// ── Intervención histórica normalizada (bacheos ejecutados, obras SIGOV) ───

export const intervencionNormalizadaSchema = z.object({
  sistema: z.string().min(1),
  idRemoto: z.string().min(1),
  tipo: tipoProblemaSchema,
  estado: estadoIntervencionSchema,
  punto: puntoSchema.nullable(),
  geocodConfianza: z.number().min(0).max(1).nullable(),
  direccionTexto: z.string().nullable(),
  superficieM2: z.number().nullable(),
  iniciadaEn: z.coerce.date().nullable(),
  finalizadaEn: z.coerce.date().nullable(),
  materiales: z.record(z.string(), z.unknown()).default({}),
  observaciones: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type IntervencionNormalizada = z.infer<typeof intervencionNormalizadaSchema>;

// ── Confianza de geocodificación: etiquetas usadas por los archivos fuente ──

export function confianzaDesdeEtiqueta(etiqueta: string | null | undefined): number | null {
  if (!etiqueta) return null;
  switch (etiqueta.trim().toUpperCase()) {
    case "ALTA":
      return 0.9;
    case "MEDIA":
      return 0.6;
    case "BAJA":
      return 0.3;
    case "FUERA_BBOX":
      return 0.1;
    default:
      return null;
  }
}
