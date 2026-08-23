import type { Feature, FeatureCollection, Geometry, Point, Position } from "geojson";
import { geometriaDesdeBlob, leerGpkg } from "./gpkg";

/**
 * Lectura de capas geográficas en el navegador: GeoJSON, CSV, Excel y
 * GeoPackage de QGIS (.gpkg). Devuelve una FeatureCollection con las
 * geometrías reales (puntos, líneas y polígonos) y una propiedad `nombre`
 * (la primera columna de texto que encuentre) para etiquetar en el mapa.
 */
export type CapaPuntos = FeatureCollection<Geometry, Record<string, unknown>>;

// En orden de PRIORIDAD: los nombres explícitos ganan a los genéricos x/y,
// que producen falsos positivos (columnas X/Y en metros, "longitud" = largo).
const COLS_LAT = ["lat", "latitud", "latitude", "lat_wgs84", "coord_y", "y"];
const COLS_LON = ["lon", "lng", "long", "longitud", "longitude", "lon_wgs84", "coord_x", "x"];

/** Rango plausible para San Miguel de Tucumán y alrededores. */
const enSmt = (lon: number, lat: number) => lon > -66.5 && lon < -64.5 && lat > -27.8 && lat < -26.0;

function buscarColumna(claves: string[], candidatas: string[]): string | null {
  const normal = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9_]/g, "");
  for (const clave of claves) {
    const col = candidatas.find((c) => normal(c) === clave);
    if (col) return col;
  }
  return null;
}

/** "" y basura no numérica son null, nunca 0 (el clásico punto fantasma en 0,0). */
function aNumero(v: unknown): number | null {
  const s = String(v ?? "").trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function filaAPunto(fila: Record<string, unknown>, colLat: string, colLon: string): Feature<Point, Record<string, unknown>> | null {
  const lat = aNumero(fila[colLat]);
  const lon = aNumero(fila[colLon]);
  if (lat == null || lon == null) return null;
  // Tolerar columnas X/Y invertidas
  const [lonOk, latOk] = enSmt(lon, lat) ? [lon, lat] : enSmt(lat, lon) ? [lat, lon] : [lon, lat];
  // Coordenadas proyectadas en metros (POSGAR/UTM) o basura: afuera.
  if (Math.abs(lonOk) > 180 || Math.abs(latOk) > 90) return null;
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
  if (features.length === 0) {
    // Sin esto, un "éxito vacío" impediría probar la geometría del GPKG.
    throw new Error(
      `Encontré las columnas "${colLat}"/"${colLon}" pero ninguna fila tiene coordenadas válidas en grados (¿están en metros u otro sistema?).`,
    );
  }
  return { type: "FeatureCollection", features };
}

/** Une líneas partidas dentro de comillas: un Enter dentro de una celda no corta el registro. */
function partirRegistros(texto: string): string[] {
  const registros: string[] = [];
  let actual = "";
  let comillas = 0;
  for (const linea of texto.split(/\r?\n/)) {
    actual = actual ? `${actual}\n${linea}` : linea;
    comillas += (linea.match(/"/g) ?? []).length;
    if (comillas % 2 === 0) {
      if (actual.trim()) registros.push(actual);
      actual = "";
      comillas = 0;
    }
  }
  if (actual.trim()) registros.push(actual);
  return registros;
}

/** CSV tolerante: detecta el separador (; , o tab) y respeta comillas. */
function parsearCsv(texto: string): Array<Record<string, unknown>> {
  const lineas = partirRegistros(texto.replace(/^﻿/, ""));
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

function conNombre(props: Record<string, unknown>): Record<string, unknown> {
  const nombre = Object.values(props).find((v) => typeof v === "string" && v.trim().length > 2) ?? null;
  return { ...props, nombre };
}

function desdeGeoJson(texto: string): CapaPuntos {
  const raw = JSON.parse(texto) as { type?: string; features?: Array<Feature> };
  if (raw.type !== "FeatureCollection" || !Array.isArray(raw.features)) {
    throw new Error("El GeoJSON debe ser una FeatureCollection.");
  }
  // Las geometrías se conservan tal cual: puntos, líneas y polígonos se
  // dibujan con su forma real (como en QGIS), no reducidos a un punto.
  const features = raw.features
    .filter((f): f is Feature => Boolean(f?.geometry))
    .map((f) => ({
      type: "Feature" as const,
      geometry: f.geometry,
      properties: conNombre((f.properties ?? {}) as Record<string, unknown>),
    }));
  return { type: "FeatureCollection", features };
}

async function desdeGpkg(archivo: File): Promise<CapaPuntos> {
  const { tabla, srsId, colGeom, filas } = await leerGpkg(archivo);
  if (filas.length === 0) throw new Error(`La capa "${tabla}" del GeoPackage está vacía.`);

  // Camino 1: columnas de lat/lon en WGS84 (el caso del consolidado de QGIS,
  // cuya geometría está en POSGAR pero trae LATITUD/LONGITUD como atributos).
  try {
    const sinGeom = filas.map((f) => {
      const { [colGeom ?? ""]: _geom, ...resto } = f;
      return resto;
    });
    return desdeFilas(sinGeom);
  } catch {
    // sin columnas lat/lon: probamos la geometría binaria
  }

  // Camino 2: geometría WKB, solo si ya está en WGS84 (srs 4326).
  if (colGeom && srsId === 4326) {
    const features = filas
      .map((f) => {
        const geom = geometriaDesdeBlob(f[colGeom]);
        if (!geom) return null;
        const { [colGeom]: _g, ...props } = f;
        return { type: "Feature" as const, geometry: geom, properties: conNombre(props) };
      })
      .filter((f): f is NonNullable<typeof f> => f != null);
    if (features.length > 0) return { type: "FeatureCollection", features };
  }

  throw new Error(
    srsId != null && srsId !== 4326
      ? `La capa "${tabla}" está en el sistema de coordenadas ${srsId} (no WGS84) y no trae columnas de latitud/longitud. Exportala desde QGIS en EPSG:4326 (o como GeoJSON) y volvé a cargarla.`
      : `No pude leer la geometría de la capa "${tabla}".`,
  );
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
  if (nombre.endsWith(".gpkg")) {
    return desdeGpkg(archivo);
  }
  throw new Error("Formato no soportado: usá GeoJSON, CSV, Excel (.xlsx) o GeoPackage (.gpkg).");
}

/** Recorre cualquier geometría GeoJSON y devuelve el bbox [minLon, minLat, maxLon, maxLat]. */
export function bboxDeCapa(capa: CapaPuntos): [number, number, number, number] | null {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const visitar = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") {
      const [lon, lat] = c as Position;
      if (lon == null || lat == null) return;
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      return;
    }
    for (const hijo of c) visitar(hijo);
  };
  for (const f of capa.features) visitar((f.geometry as { coordinates?: unknown }).coordinates);
  return Number.isFinite(minLon) ? [minLon, minLat, maxLon, maxLat] : null;
}
