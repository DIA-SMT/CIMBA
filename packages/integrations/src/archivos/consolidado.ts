import type { DemandaNormalizada, FuenteDemanda } from "@cimba/domain";
import { demandaNormalizadaSchema, normalizarDireccion } from "@cimba/domain";
import { limpiarTexto, mapearTipo, puntoValido } from "./util";

/**
 * CONSOLIDADO_PEDIDOS_RECLAMOS_SMT (GeoPackage de QGIS).
 * Capa: CONSOLIDADO_PEDIDOS_Y_RECLAMOS (ID, TIPO, UBICACION, LATITUD, LONGITUD, FUENTE)
 * La geometría del gpkg está en POSGAR07 faja 3, pero LATITUD/LONGITUD ya
 * vienen en WGS84 — usamos esas columnas y evitamos reproyectar.
 *
 * FUENTE real → fuente CIMBA:
 *   'HCD'            → hcd
 *   'DIE (SSGED-SG)' → redes_sociales  (Dirección de Información Estratégica)
 *   'DRR (SSGED-SG)' → secretaria      (se conserva el área en metadata)
 */
function mapearFuente(fuente: string): { fuente: FuenteDemanda; area: string } {
  const f = fuente.trim().toUpperCase();
  if (f.startsWith("HCD")) return { fuente: "hcd", area: "Honorable Concejo Deliberante" };
  if (f.startsWith("DIE")) return { fuente: "redes_sociales", area: fuente.trim() };
  return { fuente: "secretaria", area: fuente.trim() };
}

export interface FilaConsolidado {
  id: number | string;
  tipo: string | null;
  ubicacion: string | null;
  lat: number | null;
  lon: number | null;
  fuente: string;
}

/** Mapea filas ya leídas del consolidado (CLI o web) a demandas normalizadas. */
export function mapearFilasConsolidado(
  filas: FilaConsolidado[],
  archivo = "CONSOLIDADO_PEDIDOS_RECLAMOS_SMT_POSGAR07.gpkg",
): DemandaNormalizada[] {
  return filas.map((f) => {
    const { fuente, area } = mapearFuente(f.fuente ?? "");
    const direccion = limpiarTexto(f.ubicacion);
    return demandaNormalizadaSchema.parse({
      sistema: "consolidado",
      idRemoto: String(f.id),
      fuente,
      tipo: mapearTipo(f.tipo),
      descripcion: limpiarTexto(f.tipo),
      direccionTexto: direccion,
      direccionNormalizada: direccion ? normalizarDireccion(direccion) : null,
      punto: puntoValido(f.lat, f.lon),
      // El consolidado no trae etiqueta de calidad: confianza desconocida.
      // La regla de dedup impide auto-vincular sin confianza alta.
      geocodConfianza: null,
      distritoId: null,
      solicitante: area,
      prioridadInformada: null,
      menciones: null,
      urlOrigen: null,
      contacto: {},
      creadoEn: null,
      metadata: {
        area_origen: area,
        fuente_original: f.fuente?.trim() ?? null,
        archivo,
        sin_fecha: true,
      },
    });
  });
}

/** Lee el GeoPackage con better-sqlite3 (solo en CLI/Node, nunca en el bundle web). */
export async function parsearConsolidado(rutaGpkg: string): Promise<DemandaNormalizada[]> {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(rutaGpkg, { readonly: true });
  try {
    const filas = db
      .prepare(
        `select ID as id, TIPO as tipo, UBICACION as ubicacion,
                LATITUD as lat, LONGITUD as lon, FUENTE as fuente
         from CONSOLIDADO_PEDIDOS_Y_RECLAMOS`,
      )
      .all() as FilaConsolidado[];
    return mapearFilasConsolidado(filas);
  } finally {
    db.close();
  }
}
