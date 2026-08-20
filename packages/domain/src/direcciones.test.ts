import { describe, expect, it } from "vitest";
import { claveDireccion, normalizarDireccion, similitudDireccion } from "./direcciones";

describe("normalizarDireccion", () => {
  it("expande abreviaturas comunes", () => {
    expect(normalizarDireccion("AV. Mate de Luna 2400")).toBe("Avenida Mate de Luna 2400");
    expect(normalizarDireccion("PJE SERRANO 486")).toBe("Pasaje Serrano 486");
  });

  it("resuelve el alias real 'Cris Alvarez' → Crisóstomo Álvarez", () => {
    expect(normalizarDireccion("Cris Alvarez 1840")).toBe("Crisóstomo Álvarez 1840");
    expect(normalizarDireccion("Chiclana y Cris Alvarez")).toBe("Chiclana y Crisóstomo Álvarez");
  });

  it("resuelve 'Santiago' → Santiago del Estero sin romper 'Santiago del Estero'", () => {
    expect(normalizarDireccion("Santiago 2081")).toBe("Santiago del Estero 2081");
    expect(normalizarDireccion("Santiago del Estero 2081")).toBe("Santiago del Estero 2081");
  });

  it("normaliza espacios múltiples", () => {
    expect(normalizarDireccion("  Laprida   1900 ")).toBe("Laprida 1900");
  });
});

describe("claveDireccion", () => {
  it("es insensible a acentos, mayúsculas y puntuación", () => {
    expect(claveDireccion("Crisóstomo Álvarez 228")).toBe(claveDireccion("cris alvarez 228"));
  });
});

describe("similitudDireccion", () => {
  it("misma dirección con distinta escritura ≈ 1", () => {
    expect(similitudDireccion("Av. Mate de Luna 2400", "avenida mate de luna 2400")).toBe(1);
  });

  it("direcciones distintas puntúan bajo", () => {
    expect(similitudDireccion("Laprida 1900", "Avenida Roca 3200")).toBeLessThan(0.4);
  });

  it("misma esquina en distinto orden puntúa alto", () => {
    const s = similitudDireccion("San Lorenzo y Av Saenz Peña", "Avenida Saenz Peña y San Lorenzo");
    expect(s).toBeGreaterThan(0.6);
  });
});
