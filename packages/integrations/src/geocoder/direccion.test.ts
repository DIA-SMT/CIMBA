import { describe, expect, it } from "vitest";
import { limpiarDireccion } from "./direccion";

/**
 * Lo que protegen: la Carga rápida que no encontraba "España y Laprida" porque
 * le pegaba la ciudad al final (14/10), y "Eudoro Aráoz al 500" que caía a
 * 1,5 km (13/10).
 */
describe("la dirección que le llega al callejero", () => {
  it("saca la ciudad del final, así el cruce se parte en dos calles reales", () => {
    expect(limpiarDireccion("España y Laprida, San Miguel de Tucumán")).toBe("España y Laprida");
    expect(limpiarDireccion("Av. Sarmiento 471, San Miguel de Tucumán")).toBe("Av. Sarmiento 471");
  });

  it("saca la cola entera que traen los reclamos del 147", () => {
    expect(
      limpiarDireccion("Mario Bravo, San Miguel de Tucumán, Departamento Capital, Tucumán, T4000, Argentina"),
    ).toBe("Mario Bravo");
    expect(limpiarDireccion("Chacabuco 2161, Municipalidad de San Miguel de Tucuman, Tucumán")).toBe("Chacabuco 2161");
  });

  it("el «al» de la altura no queda pegado al nombre de la calle", () => {
    expect(limpiarDireccion("Eudoro Aráoz al 500")).toBe("Eudoro Aráoz 500");
    expect(limpiarDireccion("Eudoro Araoz AL 500, SMT")).toBe("Eudoro Araoz 500");
  });

  it("no toca lo que no es ciudad: una calle que se llama como la provincia sigue ahí", () => {
    expect(limpiarDireccion("Tucumán 450")).toBe("Tucumán 450");
    expect(limpiarDireccion("Avenida Alem 1758")).toBe("Avenida Alem 1758");
    // Un barrio después de la calle no es la ciudad: se deja.
    expect(limpiarDireccion("Pasaje 39-8 Ne 454, Barrio Norte")).toBe("Pasaje 39-8 Ne 454, Barrio Norte");
  });
});
