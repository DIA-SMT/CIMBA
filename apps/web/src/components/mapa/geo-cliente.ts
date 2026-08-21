import type { Feature, FeatureCollection, Point, Polygon } from "geojson";

/**
 * Geometría de cliente para los recursos dinámicos del mapa (analizador de
 * zona, hexágonos 3D). Proyección equirectangular local centrada en SMT:
 * error < 0,1 % dentro del ejido, más que suficiente para visualización.
 */

const R = 6_371_000;
const LAT0 = -26.8241;
const LON0 = -65.2226;
const RAD = Math.PI / 180;
const COS0 = Math.cos(LAT0 * RAD);

export function aMetros(lon: number, lat: number): [number, number] {
  return [(lon - LON0) * RAD * R * COS0, (lat - LAT0) * RAD * R];
}

export function aGrados(x: number, y: number): [number, number] {
  return [LON0 + x / (R * COS0) / RAD, LAT0 + y / R / RAD];
}

export function distanciaM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const [x1, y1] = aMetros(lon1, lat1);
  const [x2, y2] = aMetros(lon2, lat2);
  return Math.hypot(x2 - x1, y2 - y1);
}

/** Polígono circular (para el analizador de zona). */
export function crearCirculo(lon: number, lat: number, radioM: number): Feature<Polygon> {
  const [cx, cy] = aMetros(lon, lat);
  const anillo: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (2 * Math.PI * i) / 48;
    anillo.push(aGrados(cx + radioM * Math.cos(a), cy + radioM * Math.sin(a)));
  }
  return { type: "Feature", geometry: { type: "Polygon", coordinates: [anillo] }, properties: {} };
}

/**
 * Agrupa puntos en hexágonos (axial, pointy-top) de radio tamM y devuelve los
 * polígonos con el conteo — la base de la capa de densidad 3D.
 */
export function hexbins(
  features: Array<Feature<Point, Record<string, unknown>>>,
  tamM = 140,
): FeatureCollection<Polygon, { n: number }> {
  const celdas = new Map<string, { q: number; r: number; n: number }>();

  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    if (lon == null || lat == null) continue;
    const [x, y] = aMetros(lon, lat);
    const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / tamM;
    const r = ((2 / 3) * y) / tamM;
    // redondeo cúbico
    let rq = Math.round(q);
    let rs = Math.round(-q - r);
    let rr = Math.round(r);
    const dq = Math.abs(rq - q);
    const ds = Math.abs(rs - (-q - r));
    const dr = Math.abs(rr - r);
    if (dq > ds && dq > dr) rq = -rs - rr;
    else if (dr > ds) rr = -rq - rs;

    const clave = `${rq},${rr}`;
    const celda = celdas.get(clave);
    if (celda) celda.n++;
    else celdas.set(clave, { q: rq, r: rr, n: 1 });
  }

  const feats: Array<Feature<Polygon, { n: number }>> = [];
  for (const { q, r, n } of celdas.values()) {
    const cx = tamM * Math.sqrt(3) * (q + r / 2);
    const cy = tamM * 1.5 * r;
    const anillo: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const a = RAD * (60 * i - 30);
      anillo.push(aGrados(cx + tamM * Math.cos(a), cy + tamM * Math.sin(a)));
    }
    const primero = anillo[0];
    if (primero) anillo.push(primero);
    feats.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [anillo] }, properties: { n } });
  }
  return { type: "FeatureCollection", features: feats };
}
