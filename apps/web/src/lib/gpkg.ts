"use client";

/**
 * Lectura de GeoPackage (los .gpkg de QGIS) en el navegador con sql.js (WASM,
 * servido desde /public — sin nativos ni servidor). Un GeoPackage es una base
 * SQLite con tablas de metadatos estándar (gpkg_contents, gpkg_geometry_columns)
 * y la geometría como blob: cabecera GPKG + WKB.
 */

import type { Geometry, Position } from "geojson";

export interface TablaGpkg {
  tabla: string;
  srsId: number | null;
  colGeom: string | null;
  filas: Array<Record<string, unknown>>;
}

const TAMANO_MAX = 50 * 1024 * 1024;
const FILAS_MAX = 50000;

export async function leerGpkg(archivo: File): Promise<TablaGpkg> {
  if (archivo.size > TAMANO_MAX) {
    throw new Error(
      `El GeoPackage pesa ${(archivo.size / 1024 / 1024).toFixed(0)} MB y el navegador soporta hasta 50 MB. ` +
        "Exportá desde QGIS solo la capa que necesitás, o convertila a GeoJSON.",
    );
  }
  const { default: initSqlJs } = await import("sql.js");
  const SQL = await initSqlJs({ locateFile: () => "/sql-wasm.wasm" });
  const db = new SQL.Database(new Uint8Array(await archivo.arrayBuffer()));
  try {
    const meta = db.exec(
      "select c.table_name, c.srs_id, g.column_name from gpkg_contents c " +
        "left join gpkg_geometry_columns g on g.table_name = c.table_name " +
        "where c.data_type = 'features' limit 1",
    );
    const fila = meta[0]?.values[0];
    if (!fila) throw new Error("El GeoPackage no tiene capas de features (gpkg_contents vacío).");
    const tabla = String(fila[0]);
    const srsId = fila[1] != null ? Number(fila[1]) : null;
    const colGeom = fila[2] != null ? String(fila[2]) : null;

    const datos = db.exec(`select * from "${tabla.replaceAll('"', '""')}" limit ${FILAS_MAX}`);
    const r = datos[0];
    if (!r) return { tabla, srsId, colGeom, filas: [] };
    const filas = r.values.map((v) =>
      Object.fromEntries(r.columns.map((c, i) => [c, v[i] as unknown])),
    );
    return { tabla, srsId, colGeom, filas };
  } finally {
    db.close();
  }
}

// ── WKB → GeoJSON (puntos, líneas y polígonos, con multi*) ───────────────────

class LectorBinario {
  private v: DataView;
  private pos = 0;
  private little = true;
  constructor(buf: Uint8Array) {
    this.v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  saltar(n: number) {
    this.pos += n;
  }
  byte(): number {
    return this.v.getUint8(this.pos++);
  }
  u32(): number {
    const x = this.v.getUint32(this.pos, this.little);
    this.pos += 4;
    return x;
  }
  f64(): number {
    const x = this.v.getFloat64(this.pos, this.little);
    this.pos += 8;
    return x;
  }
  setEndian(little: boolean) {
    this.little = little;
  }
}

/** Cabecera GPKG: 'GP' + versión + flags; el envelope opcional depende de los flags. */
function saltarCabeceraGpkg(r: LectorBinario): void {
  const g = r.byte();
  const p = r.byte();
  if (g !== 0x47 || p !== 0x50) throw new Error("Blob de geometría sin cabecera GPKG.");
  r.byte(); // versión
  const flags = r.byte();
  r.saltar(4); // srs_id
  const tipoEnvelope = (flags >> 1) & 0b111;
  const bytesEnvelope = [0, 32, 48, 48, 64][tipoEnvelope] ?? 0;
  r.saltar(bytesEnvelope);
}

function leerWkb(r: LectorBinario): Geometry {
  r.setEndian(r.byte() === 1);
  const tipoCrudo = r.u32();
  const tipo = tipoCrudo % 1000; // 1000/2000/3000 = variantes Z/M/ZM
  const conZ = tipoCrudo >= 1000 && tipoCrudo < 3000 ? 1 : tipoCrudo >= 3000 ? 2 : 0;
  const extras = conZ; // coordenadas extra a descartar por punto

  const punto = (): Position => {
    const x = r.f64();
    const y = r.f64();
    for (let i = 0; i < extras; i++) r.f64();
    // POINT EMPTY se codifica como NaN: un solo NaN corrompería el bbox de
    // toda la capa y el GeoJSON exportado, así que la feature se descarta.
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("geometría vacía (coordenadas NaN)");
    return [x, y];
  };
  const anillo = (): Position[] => {
    const n = r.u32();
    return Array.from({ length: n }, punto);
  };

  switch (tipo) {
    case 1:
      return { type: "Point", coordinates: punto() };
    case 2:
      return { type: "LineString", coordinates: anillo() };
    case 3: {
      const n = r.u32();
      return { type: "Polygon", coordinates: Array.from({ length: n }, anillo) };
    }
    case 4: {
      const n = r.u32();
      return { type: "MultiPoint", coordinates: Array.from({ length: n }, () => (leerWkb(r) as { coordinates: Position }).coordinates) };
    }
    case 5: {
      const n = r.u32();
      return { type: "MultiLineString", coordinates: Array.from({ length: n }, () => (leerWkb(r) as { coordinates: Position[] }).coordinates) };
    }
    case 6: {
      const n = r.u32();
      return { type: "MultiPolygon", coordinates: Array.from({ length: n }, () => (leerWkb(r) as { coordinates: Position[][] }).coordinates) };
    }
    default:
      throw new Error(`Tipo WKB ${tipo} no soportado.`);
  }
}

/** Convierte el blob de geometría GPKG a GeoJSON. Solo tiene sentido en WGS84 (srs 4326). */
export function geometriaDesdeBlob(blob: unknown): Geometry | null {
  if (!(blob instanceof Uint8Array) || blob.length < 8) return null;
  try {
    const r = new LectorBinario(blob);
    saltarCabeceraGpkg(r);
    return leerWkb(r);
  } catch {
    return null;
  }
}
