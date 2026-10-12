import { describe, expect, it } from "vitest";
import {
  EMPRESAS_HABILITADAS_AGUA,
  TIPOS_ORDEN,
  TIPOS_POR_ORDEN,
  entraEnOrden,
  pedidoEntraEnOrden,
  problemaEntraEnOrden,
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

/**
 * "Cuando elegís una opción con reclamos pendientes no aparecen; en su lugar
 * aparecen las obras del SIGOV y los reclamos de la SAT, que no deberían
 * aparecer" (Dirección de Bacheo, 12/10). En el distrito 9 la lista ofrecía
 * siete puntos: cuatro obras del SIGOV y tres problemas armados con
 * intimaciones a la SAT, mientras 172 pedidos de vecinos no figuraban.
 */
describe("qué problema relevado se ofrece en la orden", () => {
  const bache = { tipo: "bache" as const, origen: null, fuentes: ["atencion_ciudadana"] };

  it("una obra del SIGOV no se ofrece en ninguna orden", () => {
    for (const orden of TIPOS_ORDEN) {
      expect(problemaEntraEnOrden(orden, { ...bache, tipo: "pavimento_deteriorado", origen: "sigov" })).toBe(false);
    }
  });

  it("lo que solo pidió la SAT no entra en una orden de bacheo", () => {
    expect(problemaEntraEnOrden("bacheo", { tipo: "hundimiento", origen: null, fuentes: ["sat", "sat"] })).toBe(false);
  });

  it("si además lo pidió un vecino, entra", () => {
    expect(problemaEntraEnOrden("bacheo", { tipo: "hundimiento", origen: null, fuentes: ["sat", "hcd"] })).toBe(true);
  });

  it("la orden de pérdida de agua sí ofrece lo de la SAT", () => {
    expect(problemaEntraEnOrden("perdida_agua", { tipo: "perdida_agua", origen: null, fuentes: ["sat"] })).toBe(true);
  });

  it("un problema sin reclamos detrás (relevado en la calle) entra", () => {
    expect(problemaEntraEnOrden("bacheo", { tipo: "bache", origen: null, fuentes: [] })).toBe(true);
  });
});

describe("qué pedido suelto se ofrece en la orden", () => {
  it("el pedido de un vecino para Bacheo entra en la orden de bacheo", () => {
    expect(pedidoEntraEnOrden("bacheo", { tipo: "bache", destino: "bacheo", fuente: "atencion_ciudadana" })).toBe(true);
  });

  it("sin destino clasificado cuenta como Bacheo, como en el mapa", () => {
    expect(pedidoEntraEnOrden("bacheo", { tipo: "bache", destino: null, fuente: "hcd" })).toBe(true);
  });

  it("una intimación a la SAT no entra en la orden de bacheo aunque diga bache", () => {
    expect(pedidoEntraEnOrden("bacheo", { tipo: "otro", destino: "bacheo", fuente: "sat" })).toBe(false);
  });

  it("un bache en calle de ripio (va a Ingeniería) no entra en bacheo pero sí en ripio", () => {
    const p = { tipo: "pavimento_deteriorado" as const, destino: "ingenieria" as const, fuente: "secretaria" };
    expect(pedidoEntraEnOrden("bacheo", p)).toBe(false);
    expect(pedidoEntraEnOrden("ripio", p)).toBe(true);
  });

  it("la pérdida de agua de la SAT entra en la orden de pérdida de agua", () => {
    expect(pedidoEntraEnOrden("perdida_agua", { tipo: "perdida_agua", destino: "sat", fuente: "sat" })).toBe(true);
  });

  it("el tipo sigue mandando: una pérdida de agua no entra en bacheo", () => {
    expect(pedidoEntraEnOrden("bacheo", { tipo: "perdida_agua", destino: "bacheo", fuente: "atencion_ciudadana" })).toBe(false);
  });
});
