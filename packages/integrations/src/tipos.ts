import type { DemandaNormalizada, IntervencionNormalizada } from "@cimba/domain";

/**
 * Toda fuente de demandas (API institucional, archivo, mock) implementa esta
 * interfaz. La ingesta no sabe de dónde vienen los datos: fetch → normalizar →
 * validar (Zod) → staging → promover.
 */
export interface AdaptadorFuente {
  sistema: string;
  /** Trae demandas creadas/modificadas desde `desde` (incremental si la fuente lo soporta). */
  traerDemandas(desde: Date | null): Promise<DemandaNormalizada[]>;
}

export interface ResultadoIngesta {
  sistema: string;
  leidos: number;
  insertados: number;
  actualizados: number;
  sinCambios: number;
  errores: Array<{ idRemoto: string; error: string }>;
}

export interface LoteArchivos {
  demandas: DemandaNormalizada[];
  intervenciones: IntervencionNormalizada[];
  advertencias: string[];
}
