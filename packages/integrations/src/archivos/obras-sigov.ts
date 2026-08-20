import type { EstadoIntervencion, IntervencionNormalizada } from "@cimba/domain";
import { intervencionNormalizadaSchema } from "@cimba/domain";
import { limpiarTexto, mapearTipo, puntoValido } from "./util";

/**
 * Obras de pavimento contratadas (dump de SIGOV: obras_SMT_*.xlsx).
 * Columnas: OBRA_ID, EMPRESA, LICITACION, N° OBRA, CONTRATISTA, ESTADO,
 * PRIORIDAD, TIPO, METROS, ITEM, DESCRIPCION, DOMICILIO, LATITUD, LONGITUD,
 * PRESUPUESTO, MONTO ESTIMADO, CERTIFICADO, LIQUIDACION.
 */
/** CERTIFICADO/LIQUIDACION vienen como texto "2026-06-04 19:01:14.862" (no como celda fecha). */
function fechaSigov(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(v.trim());
    if (m) {
      const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}-03:00`);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const soloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
    if (soloFecha) return new Date(`${v.trim()}T12:00:00-03:00`);
  }
  return null;
}

function mapearEstado(estado: string | null): EstadoIntervencion {
  const e = (estado ?? "").toUpperCase();
  if (e.includes("FINALIZADA") || e.includes("LIQUIDADA") || e.includes("CERTIFICADA")) return "finalizada";
  if (e.includes("EJECUCION") || e.includes("CURSO")) return "en_curso";
  if (e.includes("ANULADA") || e.includes("RESCINDIDA")) return "anulada";
  return "asignada";
}

export async function parsearObrasSigov(rutaXlsx: string): Promise<IntervencionNormalizada[]> {
  const { readFileSync } = await import("node:fs");
  return parsearObrasSigovBuffer(readFileSync(rutaXlsx));
}

export async function parsearObrasSigovBuffer(contenido: Buffer | Uint8Array): Promise<IntervencionNormalizada[]> {
  const { default: xlsx } = await import("xlsx");
  const wb = xlsx.read(contenido, { type: "buffer", cellDates: true });
  const nombreHoja = wb.SheetNames[0];
  if (!nombreHoja) return [];
  const hoja = wb.Sheets[nombreHoja];
  if (!hoja) return [];
  const filas: Record<string, unknown>[] = xlsx.utils.sheet_to_json(hoja, { defval: null });

  return filas
    .filter((f) => f["OBRA_ID"] != null)
    .map((f) => {
      const certificado = fechaSigov(f["CERTIFICADO"]);
      const liquidacion = fechaSigov(f["LIQUIDACION"]);
      const metros = typeof f["METROS"] === "number" ? f["METROS"] : null;
      const tipo = mapearTipo(String(f["TIPO"] ?? ""));
      return intervencionNormalizadaSchema.parse({
        sistema: "sigov",
        idRemoto: limpiarTexto(f["N° OBRA"]) ?? `obra-${f["OBRA_ID"]}`,
        tipo: tipo === "otro" ? "pavimento_deteriorado" : tipo,
        estado: mapearEstado(limpiarTexto(f["ESTADO"])),
        punto: puntoValido(f["LATITUD"], f["LONGITUD"]),
        geocodConfianza: 0.9, // SIGOV releva en campo con GPS
        direccionTexto: limpiarTexto(f["DOMICILIO"]),
        superficieM2: metros,
        iniciadaEn: certificado,
        finalizadaEn: liquidacion ?? certificado,
        materiales: {
          item: limpiarTexto(f["ITEM"]),
          descripcion_item: limpiarTexto(f["DESCRIPCION"]),
          tipo_obra: limpiarTexto(f["TIPO"]),
        },
        observaciones: limpiarTexto(f["TIPO"]),
        metadata: {
          obra_id: f["OBRA_ID"],
          empresa: limpiarTexto(f["EMPRESA"]),
          licitacion: limpiarTexto(f["LICITACION"]),
          contratista: limpiarTexto(f["CONTRATISTA"]),
          prioridad_sigov: limpiarTexto(f["PRIORIDAD"]),
          relevamiento: f["RELEVAMIENTO"] ?? null,
          presupuesto: limpiarTexto(f["PRESUPUESTO"]),
          monto_estimado: typeof f["MONTO ESTIMADO"] === "number" ? f["MONTO ESTIMADO"] : null,
          archivo: "obras_SMT.xlsx",
        },
      });
    });
}
