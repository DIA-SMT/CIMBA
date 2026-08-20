import fs from "node:fs";
import { parse } from "csv-parse/sync";
import type { IntervencionNormalizada } from "@cimba/domain";
import { confianzaDesdeEtiqueta, intervencionNormalizadaSchema } from "@cimba/domain";
import { fechaDesdeMes, limpiarTexto, mapearTipo, parsearFecha, puntoValido } from "./util";

/**
 * Bacheos EJECUTADOS por cuadrillas municipales (planillas mensuales
 * geocodificadas que hoy alimentan QGIS y Power BI). Cada fila es una
 * intervención finalizada; la ingesta le crea su incidente en estado
 * 'reparado' para conservar la trazabilidad problema → trabajo.
 */

/** Formato abril/mayo: id,mes_bacheo,direccion_original,direccion_limpia,lat,lon,name_geocoded,types,calidad_geo,in_bbox */
export function parsearBacheoMensual(rutaCsv: string, etiqueta: string): IntervencionNormalizada[] {
  const filas: Record<string, string>[] = parse(fs.readFileSync(rutaCsv, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });
  return filas.map((f) => {
    const fecha = fechaDesdeMes(f.mes_bacheo);
    return intervencionNormalizadaSchema.parse({
      sistema: "bacheo_planillas",
      idRemoto: `${etiqueta}-${f.id}`,
      tipo: "bache",
      estado: "finalizada",
      punto: puntoValido(f.lat, f.lon),
      geocodConfianza: confianzaDesdeEtiqueta(f.calidad_geo),
      direccionTexto: limpiarTexto(f.direccion_original) ?? limpiarTexto(f.direccion_limpia),
      superficieM2: null,
      iniciadaEn: fecha,
      finalizadaEn: fecha,
      materiales: {},
      observaciones: null,
      metadata: {
        mes: f.mes_bacheo ?? etiqueta,
        match_geocoder: limpiarTexto(f.name_geocoded),
        calidad_geo: f.calidad_geo ?? null,
        archivo: etiqueta,
      },
    });
  });
}

/** Formato marzo: `Mes de marzo;LAT;LON;GEO_CONFIANZA;LOCALIDAD;PROVINCIA;PAIS;DIRECCION_GEO` */
export function parsearBacheoMarzo(rutaCsv: string): IntervencionNormalizada[] {
  const filas: string[][] = parse(fs.readFileSync(rutaCsv, "utf8"), {
    delimiter: ";",
    skip_empty_lines: true,
    bom: true,
    from_line: 2,
  });
  const fecha = new Date("2026-03-15T12:00:00-03:00");
  return filas
    .filter((f) => puntoValido(f[1], f[2]) !== null)
    .map((f, i) =>
      intervencionNormalizadaSchema.parse({
        sistema: "bacheo_planillas",
        idRemoto: `marzo-2026-${i + 1}`,
        tipo: "bache",
        estado: "finalizada",
        punto: puntoValido(f[1], f[2]),
        geocodConfianza: confianzaDesdeEtiqueta(f[3] ?? null),
        direccionTexto: limpiarTexto(f[0]),
        superficieM2: null,
        iniciadaEn: fecha,
        finalizadaEn: fecha,
        materiales: {},
        observaciones: null,
        metadata: { mes: "Marzo 2026", archivo: "BACHEO_MARZO_2026_geo_QGIS_PowerBI.csv" },
      }),
    );
}

/** Formato junio/julio: `Fecha;Dirección / Trabajo;Tipo de trabajo;Tipo de punto;Dirección para geolocalizar;Latitud;Longitud;GEO_CONFIANZA;...` */
export function parsearBacheoJunioJulio(rutaCsv: string): IntervencionNormalizada[] {
  const filas: string[][] = parse(fs.readFileSync(rutaCsv, "utf8"), {
    delimiter: ";",
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    from_line: 2,
  });
  return filas
    .filter((f) => puntoValido(f[5], f[6]) !== null && limpiarTexto(f[1]) !== null)
    .map((f, i) => {
      const fecha = parsearFecha(f[0], "mda"); // export de Sheets en M/D/YYYY
      return intervencionNormalizadaSchema.parse({
        sistema: "bacheo_planillas",
        idRemoto: `junjul-2026-${i + 1}`,
        tipo: mapearTipo(f[2]) === "otro" ? "bache" : mapearTipo(f[2]),
        estado: "finalizada",
        punto: puntoValido(f[5], f[6]),
        geocodConfianza: confianzaDesdeEtiqueta(f[7] ?? null),
        direccionTexto: limpiarTexto(f[1]),
        superficieM2: null,
        iniciadaEn: fecha,
        finalizadaEn: fecha,
        materiales: {},
        observaciones: limpiarTexto(f[3]) ? `Tipo de punto: ${limpiarTexto(f[3])}` : null,
        metadata: {
          tipo_trabajo: limpiarTexto(f[2]),
          tipo_punto: limpiarTexto(f[3]),
          archivo: "BACHEO_JUNIO_JULIO_2026_geo_QGIS_PowerBI_2.csv",
        },
      });
    });
}
