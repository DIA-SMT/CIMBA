import fs from "node:fs";
import { parse } from "csv-parse/sync";
import type { DemandaNormalizada } from "@cimba/domain";
import { confianzaDesdeEtiqueta, demandaNormalizadaSchema, normalizarDireccion } from "@cimba/domain";
import { limpiarTexto, mapearTipo, parsearFecha, puntoValido } from "./util";

/**
 * Intimaciones a la Sociedad Aguas del Tucumán (SAT).
 * Archivo: reclamos_SAT_geocodificados.csv
 * Columnas: id, fecha, fecha_raw, anio, mes, n_pedido, direccion_orig,
 * direccion_limpia, query_geo, tipo_dir, motivo, categoria, lat, lon,
 * name_geocoded, types, calidad, in_bbox
 */
export function parsearSat(rutaCsv: string): DemandaNormalizada[] {
  return parsearSatTexto(fs.readFileSync(rutaCsv, "utf8"));
}

export function parsearSatTexto(contenido: string): DemandaNormalizada[] {
  const filas: Record<string, string>[] = parse(contenido, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });

  return filas.map((f) => {
    const direccion = limpiarTexto(f.direccion_orig) ?? limpiarTexto(f.direccion_limpia);
    return demandaNormalizadaSchema.parse({
      sistema: "sat",
      idRemoto: String(f.id),
      fuente: "sat",
      tipo: mapearTipo(f.categoria ?? f.motivo),
      descripcion: limpiarTexto(f.motivo),
      direccionTexto: direccion,
      direccionNormalizada: direccion ? normalizarDireccion(direccion) : null,
      punto: puntoValido(f.lat, f.lon),
      geocodConfianza: confianzaDesdeEtiqueta(f.calidad),
      distritoId: null,
      solicitante: "Sociedad Aguas del Tucumán",
      prioridadInformada: null,
      menciones: null,
      urlOrigen: null,
      contacto: {},
      creadoEn: parsearFecha(f.fecha, "iso") ?? parsearFecha(f.fecha_raw, "dma"),
      metadata: {
        n_pedido: f.n_pedido ?? null,
        categoria: f.categoria ?? null,
        tipo_direccion: f.tipo_dir ?? null,
        match_geocoder: limpiarTexto(f.name_geocoded),
        calidad_geo: f.calidad ?? null,
        archivo: "reclamos_SAT_geocodificados.csv",
      },
    });
  });
}
