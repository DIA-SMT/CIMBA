import { describe, expect, it } from "vitest";
import { parsearBacheoDiarioTexto, parsearBacheoJunioJulioTexto } from "./bacheo";

/**
 * Las dos planillas de administración que se solapan.
 *
 * El 17/09 agosto decía 315 trabajos y son 295: la planilla de junio-julio se
 * pasa tres días para agosto (3, 4 y 5) y esas mismas 20 filas vuelven en la
 * planilla de agosto, que arranca justo el 03/08. Como el idRemoto lleva el
 * nombre del archivo, el deduplicador las dio por trabajos distintos.
 *
 * Estos tests fijan las dos mitades del arreglo: junio-julio corta en julio, y
 * la identidad de la planilla diaria sale del contenido y no de la posición.
 */

const CABECERA_JJ =
  "Fecha;Dirección / Trabajo;Tipo de trabajo;Tipo de punto;Dirección para geolocalizar;Latitud;Longitud;GEO_CONFIANZA";

const fila = (fecha: string, direccion: string) =>
  `${fecha};${direccion};bacheo;puntual;${direccion};-26.8237156;-65.1976484;ALTA`;

describe("parsearBacheoJunioJulio", () => {
  const csv = [
    CABECERA_JJ,
    "jun-26;;;;;;;",
    fila("16/6/2026", "Muñecas 2500"),
    "jul-26;;;;;;;",
    fila("2/7/2026", "Lavalle 1500"),
    fila("3/8/2026", "Baltazar aguirre 838"),
    fila("5/8/2026", "Las piedras 3333"),
  ].join("\n");

  it("no emite las filas que se pasan a agosto: las trae la planilla de agosto", () => {
    const r = parsearBacheoJunioJulioTexto(csv);
    expect(r).toHaveLength(2);
    expect(r.map((x) => x.direccionTexto)).toEqual(["Muñecas 2500", "Lavalle 1500"]);
    expect(r.every((x) => x.finalizadaEn! < new Date("2026-08-01T00:00:00-03:00"))).toBe(true);
  });

  /**
   * El idRemoto de este archivo es posicional. Si el corte dejara de contar las
   * filas de agosto, cualquier fila posterior se correría de número y el
   * próximo ingest la vería como nueva — volviendo a duplicar, que es
   * exactamente lo que se está arreglando.
   */
  it("mantiene la numeración de las filas que sí entran", () => {
    const r = parsearBacheoJunioJulioTexto(csv);
    expect(r.map((x) => x.idRemoto)).toEqual(["junjul-2026-1", "junjul-2026-2"]);
  });
});

describe("parsearBacheoDiario", () => {
  const csv = [
    "DIA;DIRECCION;Latitud;Longitud;GEO_CONFIANZA;LOCALIDAD;PROVINCIA;PAIS",
    "03/08/2026;Baltazar aguirre 838;-26.8363441;-65.2362038;ALTA;San Miguel de Tucumán;Tucumán;Argentina",
    "12/08/2026;Mexico 3010;-26.8237156;-65.1976484;MEDIA;San Miguel de Tucumán;Tucumán;Argentina",
    "12/08/2026;Mexico 3010;-26.8237156;-65.1976484;MEDIA;San Miguel de Tucumán;Tucumán;Argentina",
  ].join("\n");

  it("fecha el trabajo el día en que se hizo", () => {
    const r = parsearBacheoDiarioTexto(csv);
    expect(r[0]!.finalizadaEn!.toISOString().slice(0, 10)).toBe("2026-08-03");
  });

  /** Identidad por contenido: reenviar el archivo no puede duplicar nada. */
  it("da el mismo idRemoto a la misma fila, y distingue dos trabajos del mismo día y dirección", () => {
    const r = parsearBacheoDiarioTexto(csv);
    expect(r[0]!.idRemoto).toBe("diario-2026-08-03-baltazar-aguirre-838");
    expect(r[1]!.idRemoto).toBe("diario-2026-08-12-mexico-3010");
    expect(r[2]!.idRemoto).toBe("diario-2026-08-12-mexico-3010-2");
    expect(new Set(r.map((x) => x.idRemoto)).size).toBe(r.length);
  });

  it("no inventa superficie: estas planillas no la traen", () => {
    expect(parsearBacheoDiarioTexto(csv).every((x) => x.superficieM2 == null)).toBe(true);
  });
});
