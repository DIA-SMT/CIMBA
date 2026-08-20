import { describe, expect, it } from "vitest";
import { scorePriorizacion } from "./priorizacion";
import type { FactoresPriorizacion } from "./priorizacion";

const base: FactoresPriorizacion = {
  demandasVinculadas: 1,
  menciones: 0,
  diasAbierto: 0,
  prioridadInformada: null,
  tipo: "bache",
  intervencionesPrevias: 0,
  enCorredorPrincipal: false,
};

describe("scorePriorizacion", () => {
  it("está acotado a 0..100", () => {
    const max = scorePriorizacion({
      demandasVinculadas: 50,
      menciones: 100,
      diasAbierto: 365,
      prioridadInformada: 1,
      tipo: "hundimiento",
      intervencionesPrevias: 5,
      enCorredorPrincipal: true,
    });
    expect(max.total).toBeLessThanOrEqual(100);
    expect(scorePriorizacion(base).total).toBeGreaterThan(0);
  });

  it("más demandas vinculadas → más prioridad, con saturación", () => {
    const s1 = scorePriorizacion({ ...base, demandasVinculadas: 1 }).total;
    const s5 = scorePriorizacion({ ...base, demandasVinculadas: 5 }).total;
    const s20 = scorePriorizacion({ ...base, demandasVinculadas: 20 }).total;
    expect(s5).toBeGreaterThan(s1);
    expect(s20).toBeGreaterThan(s5);
    expect(s20 - s5).toBeLessThan(s5 - s1); // saturación logarítmica
  });

  it("un hundimiento pesa más que una fisura", () => {
    const h = scorePriorizacion({ ...base, tipo: "hundimiento" }).total;
    const f = scorePriorizacion({ ...base, tipo: "fisura" }).total;
    expect(h).toBeGreaterThan(f);
  });

  it("la reincidencia suma", () => {
    const sin = scorePriorizacion(base).total;
    const con = scorePriorizacion({ ...base, intervencionesPrevias: 2 }).total;
    expect(con).toBeGreaterThan(sin);
  });

  it("el desglose suma el total", () => {
    const d = scorePriorizacion({ ...base, demandasVinculadas: 3, diasAbierto: 30, enCorredorPrincipal: true });
    const suma = d.demanda + d.antiguedad + d.severidad + d.reincidencia + d.corredor;
    expect(Math.abs(Math.min(100, suma) - d.total)).toBeLessThan(0.01);
  });
});
