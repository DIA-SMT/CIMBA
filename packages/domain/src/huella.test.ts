import { describe, expect, it } from "vitest";
import { ALTO_HUELLA, ANCHO_HUELLA, distanciaHuellas, esHuella, huellaDePixeles } from "./huella";

/** Una imagen RGB sintética de 144×128: el gris de cada punto lo da `f`. */
function imagen(f: (x: number, y: number) => number, canales = 3): number[] {
  const px: number[] = [];
  for (let y = 0; y < ALTO_HUELLA; y++) {
    for (let x = 0; x < ANCHO_HUELLA; x++) {
      const g = Math.max(0, Math.min(255, Math.round(f(x, y))));
      px.push(g, g, g);
      if (canales === 4) px.push(255);
    }
  }
  return px;
}

/**
 * Lo que protegen estos tests es la alarma de foto repetida: "la misma foto
 * del después en tres baches distintos" (OT-2026-0024, medido el 12/10) tiene
 * que dar la misma huella, y dos fotos distintas, huellas lejanas.
 */
describe("la huella de una foto", () => {
  const degrade = (x: number) => 255 - x * 1.7;

  it("son 64 bits", () => {
    const h = huellaDePixeles(imagen(degrade), 3);
    expect(esHuella(h)).toBe(true);
  });

  it("la misma imagen da la misma huella, con o sin canal alfa", () => {
    const a = huellaDePixeles(imagen(degrade), 3)!;
    const b = huellaDePixeles(imagen(degrade, 4), 4)!;
    expect(distanciaHuellas(a, b)).toBe(0);
  });

  it("un poco de ruido (recompresión) apenas la mueve", () => {
    const base = (x: number, y: number) => 128 + 90 * Math.sin(x / 11) * Math.cos(y / 9);
    const ruido = (x: number, y: number) => base(x, y) + (((x * 7 + y * 13) % 5) - 2);
    const a = huellaDePixeles(imagen(base), 3)!;
    const b = huellaDePixeles(imagen(ruido), 3)!;
    expect(distanciaHuellas(a, b)).toBeLessThanOrEqual(2);
  });

  it("una imagen distinta queda lejos", () => {
    const a = huellaDePixeles(imagen((x, y) => 128 + 90 * Math.sin(x / 11) * Math.cos(y / 9)), 3)!;
    const b = huellaDePixeles(imagen((x, y) => 128 + 90 * Math.cos(x / 7 + y / 5)), 3)!;
    expect(distanciaHuellas(a, b)).toBeGreaterThan(12);
  });

  it("una imagen del tamaño equivocado no da huella", () => {
    expect(huellaDePixeles([1, 2, 3], 3)).toBeNull();
  });
});
