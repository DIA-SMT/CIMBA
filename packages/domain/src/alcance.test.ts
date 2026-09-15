import { describe, expect, it } from "vitest";
import {
  EMPRESAS_HABILITADAS_AGUA,
  TIPOS_ORDEN,
  TIPOS_POR_ORDEN,
  entraEnOrden,
} from "./alcance";
import { TIPOS_PROBLEMA } from "./tipos";

/**
 * Lo que estos tests protegen es una frase de la Dirección de Bacheo: "están
 * apareciendo para ejecutar como bache tapas de registro o pérdidas de agua,
 * que corresponde a la SAT". Eran 70 de los 202 incidentes abiertos.
 */
describe("qué entra en cada orden", () => {
  it("una orden de bacheo no ofrece lo que es de la SAT", () => {
    for (const tipo of ["perdida_agua", "perdida_cloacal", "tapa_registro", "sumidero"] as const) {
      expect(entraEnOrden("bacheo", tipo)).toBe(false);
    }
  });

  it("una orden de bacheo sí ofrece la calzada", () => {
    for (const tipo of ["bache", "pavimento_deteriorado", "hundimiento", "fisura"] as const) {
      expect(entraEnOrden("bacheo", tipo)).toBe(true);
    }
  });

  it("cada tipo de orden ofrece lo suyo y nada más", () => {
    expect(entraEnOrden("tapas", "tapa_registro")).toBe(true);
    expect(entraEnOrden("tapas", "bache")).toBe(false);
    expect(entraEnOrden("imbornales", "sumidero")).toBe(true);
    expect(entraEnOrden("imbornales", "perdida_agua")).toBe(false);
    expect(entraEnOrden("perdida_agua", "perdida_agua")).toBe(true);
    expect(entraEnOrden("perdida_agua", "perdida_cloacal")).toBe(true);
    expect(entraEnOrden("perdida_agua", "bache")).toBe(false);
  });

  /**
   * Un incidente sin tipo es un dato incompleto, no un problema de otra
   * repartición: cae en bacheo, que es el cajón por defecto del sistema. Si
   * cayera en todas, una orden de imbornales ofrecería baches sin clasificar.
   */
  it("el incidente sin tipo solo entra en bacheo", () => {
    expect(entraEnOrden("bacheo", null)).toBe(true);
    expect(entraEnOrden("imbornales", null)).toBe(false);
    expect(entraEnOrden("perdida_agua", null)).toBe(false);
  });

  /** Un tipo de orden sin tipos mapeados no ofrecería NADA, en silencio. */
  it("todos los tipos de orden tienen algo que ofrecer", () => {
    for (const orden of TIPOS_ORDEN) {
      expect(TIPOS_POR_ORDEN[orden].length, `${orden} no ofrece ningún tipo`).toBeGreaterThan(0);
    }
  });

  /** Un tipo de problema nuevo que nadie mapee quedaría invisible para siempre. */
  it("ningún tipo de problema queda fuera de todas las órdenes", () => {
    const mapeados = new Set(Object.values(TIPOS_POR_ORDEN).flat());
    const huerfanos = TIPOS_PROBLEMA.filter((t) => !mapeados.has(t));
    expect(huerfanos, `sin orden que los ofrezca: ${huerfanos.join(", ")}`).toEqual([]);
  });
});

describe("quién puede tocar la red de agua", () => {
  it("solo UOCRA e INGECO", () => {
    expect([...EMPRESAS_HABILITADAS_AGUA].sort()).toEqual(["ingeco", "uocra"]);
  });
});
