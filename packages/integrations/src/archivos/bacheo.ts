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
  return parsearBacheoMensualTexto(fs.readFileSync(rutaCsv, "utf8"), etiqueta);
}

export function parsearBacheoMensualTexto(contenido: string, etiqueta: string): IntervencionNormalizada[] {
  const filas: Record<string, string>[] = parse(contenido, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
  });
  // Año: si la etiqueta del archivo y el contenido difieren (el zip de mayo
  // dice 2026 pero mes_bacheo dice "Mayo 2025"), manda la etiqueta y el valor
  // original queda en metadata para confirmar con la Dirección de Bacheo.
  const anioEtiqueta = /(\d{4})/.exec(etiqueta)?.[1];
  return filas.map((f) => {
    let fecha = fechaDesdeMes(f.mes_bacheo);
    if (fecha && anioEtiqueta && fecha.getFullYear() !== Number(anioEtiqueta)) {
      fecha = new Date(fecha);
      fecha.setFullYear(Number(anioEtiqueta));
    }
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
        mes: etiqueta,
        mes_original: f.mes_bacheo ?? null,
        match_geocoder: limpiarTexto(f.name_geocoded),
        calidad_geo: f.calidad_geo ?? null,
        archivo: etiqueta,
        /**
         * QUIÉN LO HIZO. Estas planillas son el bacheo por ADMINISTRACIÓN —
         * las cuadrillas propias del municipio—, y hasta ahora entraban sin
         * decirlo: 1.314 intervenciones quedaron sin origen y sin empresa,
         * mientras las de la app de la Dirección (Ingeco, Elías Maza) y las de
         * SIGOV sí la traían. Agrupar el trabajo por ejecutor dejaba afuera al
         * ejecutor más grande, y la Dirección lo notó mirando las fotos:
         * "todos los baches con foto son de Ingeco" — porque el resto no decía
         * de quién era.
         *
         * Mismas claves que usan bacheo-empresas y sigov-mysql: si acá se
         * llamaran distinto, cada consulta tendría que conocer las tres.
         */
        origen: "bacheo_planillas",
        empresa: "ADMINISTRACIÓN (cuadrillas propias)",
      },
    });
  });
}

/** Formato marzo: `Mes de marzo;LAT;LON;GEO_CONFIANZA;LOCALIDAD;PROVINCIA;PAIS;DIRECCION_GEO` */
export function parsearBacheoMarzo(rutaCsv: string): IntervencionNormalizada[] {
  return parsearBacheoMarzoTexto(fs.readFileSync(rutaCsv, "utf8"));
}

export function parsearBacheoMarzoTexto(contenido: string): IntervencionNormalizada[] {
  const filas: string[][] = parse(contenido, {
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

/**
 * FORMATO DIARIO: `DIA;DIRECCION;Latitud;Longitud;GEO_CONFIANZA;LOCALIDAD;PROVINCIA;PAIS`
 *
 * La planilla que mandó la Dirección el 16/09 (agosto → 10 de septiembre).
 * Frente a las mensuales tiene una mejora real: la fecha viene POR FILA y no
 * como "mes_bacheo", así que cada bacheo queda en el día en que se hizo en vez
 * de amontonarse todo el 15 del mes.
 *
 * Sigue sin traer superficie ni espesor, igual que todas las planillas de
 * administración: entran con superficie null y certifican cero toneladas. No
 * es algo que el parser pueda inventar — se pidió que la próxima exportación
 * agregue las dos columnas.
 */
export function parsearBacheoDiario(rutaCsv: string): IntervencionNormalizada[] {
  return parsearBacheoDiarioTexto(fs.readFileSync(rutaCsv, "utf8"));
}

export function parsearBacheoDiarioTexto(contenido: string): IntervencionNormalizada[] {
  const filas: Record<string, string>[] = parse(contenido, {
    columns: true,
    delimiter: ";",
    skip_empty_lines: true,
    bom: true,
    trim: true,
  });

  /**
   * LA IDENTIDAD DE CADA FILA, SIN DEPENDER DEL ORDEN.
   *
   * Las planillas viejas numeraban por posición y por eso no se podían volver a
   * subir: insertar una fila corría todas las siguientes y duplicaba medio
   * archivo. Acá la identidad es el DÍA + LA DIRECCIÓN, que es lo que
   * identifica al trabajo en la realidad. Si la Dirección reenvía el mismo
   * archivo no entra nada; si manda uno que lo incluye y agrega septiembre
   * entero, entran solo las filas nuevas.
   *
   * El contador es para el caso real de dos bacheos en la misma dirección el
   * mismo día (hay uno en este archivo): el segundo es -2 y sigue siendo
   * estable mientras el archivo conserve las dos filas.
   */
  const vistos = new Map<string, number>();
  const salida: IntervencionNormalizada[] = [];

  for (const f of filas) {
    const fecha = parsearFecha(f.DIA, "dma");
    // Sin fecha la fila no se puede ubicar en el tiempo y ensuciaría todos los
    // cortes por mes: se deja afuera y la diferencia de conteo la delata.
    if (!fecha) continue;

    const direccion = limpiarTexto(f.DIRECCION);
    const dia = fecha.toISOString().slice(0, 10);
    const base = `${dia}-${(direccion ?? "sin-direccion")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60)}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);

    salida.push(
      intervencionNormalizadaSchema.parse({
        sistema: "bacheo_planillas",
        idRemoto: `diario-${base}${n > 1 ? `-${n}` : ""}`,
        tipo: "bache",
        estado: "finalizada",
        punto: puntoValido(f.Latitud, f.Longitud),
        geocodConfianza: confianzaDesdeEtiqueta(f.GEO_CONFIANZA),
        direccionTexto: direccion,
        superficieM2: null,
        iniciadaEn: fecha,
        finalizadaEn: fecha,
        materiales: {},
        observaciones: null,
        metadata: {
          calidad_geo: f.GEO_CONFIANZA ?? null,
          archivo: "BACHEO_AGOSTO_10SEPTIEMBRE_2026_geo_QGIS_PowerBI.csv",
          // Mismas claves que el resto de las planillas: ver el comentario de
          // parsearBacheoMensualTexto.
          origen: "bacheo_planillas",
          empresa: "ADMINISTRACIÓN (cuadrillas propias)",
        },
      }),
    );
  }
  return salida;
}

const MESES_ABREV: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12,
};

/**
 * Fechas del CSV junio-julio: el archivo MEZCLA D/M y M/D en la misma columna
 * ("6/1/2026" es 1-jun pero "16/6/2026" es 16-jun) y trae filas separadoras de
 * sección ("jun-26;;;;"). Desambiguación: si un componente es >12 la lectura es
 * única; si ambos son ≤12 se elige la interpretación cuyo mes coincide con la
 * sección vigente; a falta de todo, mitad del mes de la sección.
 */
function fechaJunJul(crudo: string | undefined, mesSeccion: number | null): Date | null {
  const s = (crudo ?? "").trim();
  const fabricar = (anio: number, mes: number, dia: number) =>
    mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31
      ? new Date(`${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}T12:00:00-03:00`)
      : null;

  // "12 y 13/6/2026" → primer día del rango
  const rango = /^(\d{1,2})\s*y\s*\d{1,2}\/(\d{1,2})\/(\d{4})/.exec(s);
  if (rango) return fabricar(Number(rango[3]), Number(rango[2]), Number(rango[1]));

  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const anio = Number(m[3]);
    if (a > 12) return fabricar(anio, b, a); // D/M inequívoco
    if (b > 12) return fabricar(anio, a, b); // M/D inequívoco
    if (mesSeccion !== null) {
      if (b === mesSeccion && a !== mesSeccion) return fabricar(anio, b, a); // D/M
      if (a === mesSeccion && b !== mesSeccion) return fabricar(anio, a, b); // M/D
    }
    return fabricar(anio, b, a); // convención local D/M
  }

  return mesSeccion !== null ? fabricar(2026, mesSeccion, 15) : null;
}

/** Formato junio/julio: `Fecha;Dirección / Trabajo;Tipo de trabajo;Tipo de punto;Dirección para geolocalizar;Latitud;Longitud;GEO_CONFIANZA;...` */
export function parsearBacheoJunioJulio(rutaCsv: string): IntervencionNormalizada[] {
  return parsearBacheoJunioJulioTexto(fs.readFileSync(rutaCsv, "utf8"));
}

export function parsearBacheoJunioJulioTexto(contenido: string): IntervencionNormalizada[] {
  const filas: string[][] = parse(contenido, {
    delimiter: ";",
    skip_empty_lines: true,
    bom: true,
    relax_column_count: true,
    from_line: 2,
  });

  const resultado: IntervencionNormalizada[] = [];
  let mesSeccion: number | null = null;
  let i = 0;
  for (const f of filas) {
    // Fila separadora de sección: "jun-26;;;;..."
    const seccion = /^([a-z]{3})-\d{2}$/i.exec((f[0] ?? "").trim());
    if (seccion && seccion[1]) {
      mesSeccion = MESES_ABREV[seccion[1].toLowerCase()] ?? mesSeccion;
      continue;
    }
    if (puntoValido(f[5], f[6]) === null || limpiarTexto(f[1]) === null) continue;

    i++;
    const fecha = fechaJunJul(f[0], mesSeccion);
    resultado.push(
      intervencionNormalizadaSchema.parse({
        sistema: "bacheo_planillas",
        idRemoto: `junjul-2026-${i}`,
        tipo: mapearTipo(f[2] || "bacheo"),
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
          fecha_cruda: limpiarTexto(f[0]),
          archivo: "BACHEO_JUNIO_JULIO_2026_geo_QGIS_PowerBI_2.csv",
        },
      }),
    );
  }
  return resultado;
}
