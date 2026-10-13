import { describe, expect, it } from "vitest";
import { desviacionPct, puntosAMedir, sortearMuestra } from "./muestreo";

/**
 * Lo que protegen estos tests es que la muestra del acta sea al azar Y
 * reproducible: el mismo día, la misma empresa y los mismos puntos tienen que
 * dar siempre la misma muestra, o el acta no se puede verificar después.
 */
describe("el sorteo de la muestra del acta", () => {
  const ids = Array.from({ length: 50 }, (_, i) => 1000 + i);

  it("se mide al menos el 20%, redondeando para arriba, y nunca cero", () => {
    expect(puntosAMedir(50)).toBe(10);
    expect(puntosAMedir(7)).toBe(2);
    expect(puntosAMedir(1)).toBe(1);
    expect(puntosAMedir(0)).toBe(0);
  });

  it("la misma semilla da la misma muestra, sin importar el orden de los puntos", () => {
    const a = sortearMuestra(ids, "2026-10-13:3");
    const b = sortearMuestra([...ids].reverse(), "2026-10-13:3");
    expect(a).toEqual(b);
    expect(a).toHaveLength(10);
    for (const id of a) expect(ids).toContain(id);
  });

  it("otro día u otra empresa dan otra muestra", () => {
    const a = sortearMuestra(ids, "2026-10-13:3");
    expect(sortearMuestra(ids, "2026-10-14:3")).not.toEqual(a);
    expect(sortearMuestra(ids, "2026-10-13:2")).not.toEqual(a);
  });

  it("no son los primeros de la lista: es un sorteo", () => {
    expect(sortearMuestra(ids, "2026-10-13:3")).not.toEqual(ids.slice(0, 10));
  });
});

describe("la desviación entre lo informado y lo medido", () => {
  it("se mide en valor absoluto: de más y de menos pesan igual", () => {
    expect(desviacionPct([{ informado: 100, medido: 95 }])).toBe(5);
    expect(desviacionPct([{ informado: 100, medido: 105 }])).toBe(5);
  });

  it("se calcula sobre el total medido, no punto por punto", () => {
    expect(desviacionPct([
      { informado: 4, medido: 5 },
      { informado: 6, medido: 5 },
    ])).toBe(0);
  });

  it("sin nada informado no divide por cero", () => {
    expect(desviacionPct([])).toBe(0);
  });
});
