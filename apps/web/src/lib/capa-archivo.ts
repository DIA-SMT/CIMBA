import type { Feature, FeatureCollection, Point } from "geojson";

/**
 * Lectura de capas geográficas en el navegador: GeoJSON, CSV y Excel.
 * Devuelve siempre una FeatureCollection de puntos con una propiedad `nombre`
 * (la primera columna de texto que encuentre) para etiquetar en el mapa.
 */
export type CapaPuntos = FeatureCollection<Point, Record<string, unknown>>;

const COLS_LAT = ["lat", "latitud", "latitude", "y", "coord_y", "lat_wgs84"];
const COLS_LON = ["lon", "lng", "long", "longitud", "longitude", "x", "coord_x", "lon_wgs84"];

/** Rango plausible para San Miguel de Tucumán y alrededores. */
const enSmt = (lon: number, lat: number) => lon > -66.5 && lon < -64.5 && lat > -27.8 && lat < -26.0;

function buscarColumna(claves: string[], candidatas: string[]): string | null {
  const normal = (s: string) => s.toLowerCase().trim().replace(/[^a-z_]/g, "");
  for (const c of candidatas) if (claves.includes(normal(c))) return c;
  return null;
}

function filaAPunto(fila: Record<string, unknown>, colLat: string, colLon: string): Feature<Point, Record<string, unknown>> | null {
  const lat = Number(String(fila[colLat] ?? "").replace(",", "."));
  const lon = Number(String(fila[colLon] ?? "").replace(",", "."));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  // Tolerar columnas X/Y invertidas
  const [lonOk, latOk] = enSmt(lon, lat) ? [lon, lat] : enSmt(lat, lon) ? [lat, lon] : [lon, lat];
  const nombre = Object.entries(fila).find(
    ([k, v]) => typeof v === "string" && v.trim().length > 2 && k !== colLat && k !== colLon && !/^-?[\d.,]+$/.test(v),
  )?.[1];
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [lonOk, latOk] },
    properties: { ...fila, nombre: nombre ?? null },
  };
}

function desdeFilas(filas: Array<Record<string, unknown>>): CapaPuntos {
  const columnas = Object.keys(filas[0] ?? {});
  const colLat = buscarColumna(COLS_LAT, columnas);
  const colLon = buscarColumna(COLS_LON, columnas);
  if (!colLat || !colLon) {
    throw new Error(
      `No encontré columnas de coordenadas. Busqué latitud (${COLS_LAT.slice(0, 4).join(", ")}…) y longitud (${COLS_LON.slice(0, 4).join(", ")}…); el archivo tiene: ${columnas.slice(0, 8).join(", ")}.`,
    );
  }
  const features = filas.map((f) => filaAPunto(f, colLat, colLon)).filter((f): f is NonNullable<typeof f> => f != null);
  return { type: "FeatureCollection", features };
}

/** CSV tolerante: detecta el separador (; , o tab) y respeta comillas. */
function parsearCsv(texto: string): Array<Record<string, unknown>> {
  const lineas = texto.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lineas.length < 2) throw new Error("El CSV no tiene filas de datos.");
  const cabecera = lineas[0]!;
  const sep = [";", ",", "\t"].reduce((mejor, s) =>
    cabecera.split(s).length > cabecera.split(mejor).length ? s : mejor,
  );
  const dividir = (linea: string): string[] => {
    const celdas: string[] = [];
    let actual = "";
    let entreComillas = false;
    for (let i = 0; i < linea.length; i++) {
      const ch = linea[i]!;
      if (ch === '"') {
        if (entreComillas && linea[i + 1] === '"') { actual += '"'; i++; }
        else entreComillas = !entreComillas;
      } else if (ch === sep && !entreComillas) {
        celdas.push(actual); actual = "";
      } else actual += ch;
    }
    celdas.push(actual);
    return celdas.map((c) => c.trim());
  };
  const cols = dividir(cabecera);
  return lineas.slice(1).map((l) => {
    const celdas = dividir(l);
    return Object.fromEntries(cols.map((c, i) => [c, celdas[i] ?? ""]));
  });
}

function desdeGeoJson(texto: string): CapaPuntos {
  const raw = JSON.parse(texto) as { type?: string; features?: Array<Feature> };
  if (raw.type !== "FeatureCollection" || !Array.isArray(raw.features)) {
    throw new Error("El GeoJSON debe ser una FeatureCollection.");
  }
  const features: Array<Feature<Point, Record<string, unknown>>> = [];
  for (const f of raw.features) {
    if (!f?.geometry) continue;
    // Puntos directos; para líneas/polígonos usamos el primer vértice como referencia.
    let coords: number[] | null = null;
    if (f.geometry.type === "Point") coords = f.geometry.coordinates as number[];
    else if (f.geometry.type === "MultiPoint" || f.geometry.type === "LineString")
      coords = (f.geometry.coordinates as number[][])[0] ?? null;
    else if (f.geometry.type === "Polygon" || f.geometry.type === "MultiLineString")
      coords = (f.geometry.coordinates as number[][][])[0]?.[0] ?? null;
    if (!coords || coords.length < 2) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const nombre = Object.values(props).find((v) => typeof v === "string" && v.trim().length > 2) ?? null;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [Number(coords[0]), Number(coords[1])] },
      properties: { ...props, nombre },
    });
  }
  return { type: "FeatureCollection", features };
}

export async function leerArchivoComoCapa(archivo: File): Promise<CapaPuntos> {
  const nombre = archivo.name.toLowerCase();
  if (nombre.endsWith(".geojson") || nombre.endsWith(".json")) {
    return desdeGeoJson(await archivo.text());
  }
  if (nombre.endsWith(".csv") || nombre.endsWith(".tsv") || nombre.endsWith(".txt")) {
    return desdeFilas(parsearCsv(await archivo.text()));
  }
  if (nombre.endsWith(".xlsx") || nombre.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const libro = XLSX.read(await archivo.arrayBuffer(), { type: "array" });
    const hoja = libro.Sheets[libro.SheetNames[0]!];
    if (!hoja) throw new Error("El Excel no tiene hojas.");
    const filas = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja, { defval: "" });
    return desdeFilas(filas);
  }
  throw new Error("Formato no soportado: usá GeoJSON, CSV o Excel (.xlsx).");
}
