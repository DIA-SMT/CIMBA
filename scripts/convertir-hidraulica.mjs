/**
 * Convierte las capas hidráulicas que pasó la Dirección de Obras Viales
 * (10/9/2026, CIMBA-info.rar) a GeoJSON WGS84 para el mapa y la base:
 *
 *   ImbornalesRelevamiento/SHAPE/imbornales-relevamiento-2025-v2.{shp,dbf}
 *     → imbornales.json (1.343 bocas de tormenta relevadas, con estado en
 *       escala leve→moderado→grave→colapsado, colector y cuenca)
 *   ZonasInundables/SHAPE/ZonasInundables.{shp,dbf}
 *     → zonas-inundables.json (puntos críticos de anegamiento con el tirante
 *       descrito por los vecinos)
 *   Bacheo_integral_2026-09-08.gpkg
 *     → bacheo-integral.json (pisa el de 3 polígonos sin empresa por el de 4
 *       CON empresa: el polígono Norte/UOCRA faltaba)
 *
 * Uso:  node scripts/convertir-hidraulica.mjs <carpeta-CIMBA-info>
 * Idempotente: pisa los .json de apps/web/public/data.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const raiz = path.join(import.meta.dirname, "..");
const carpeta = process.argv[2];
if (!carpeta || !fs.existsSync(carpeta)) {
  console.error("Uso: node scripts/convertir-hidraulica.mjs <carpeta descomprimida de CIMBA-info.rar>");
  process.exit(1);
}
const salida = path.join(raiz, "apps", "web", "public", "data");

// ── POSGAR 2007 / Argentina faja 3 (EPSG:5345) → WGS84 ──────────────────────
// Misma inversa de Gauss-Krüger que scripts/convertir-insumos-viales.mjs: las
// dos capas nuevas vienen en la misma proyección que el resto del GIS de la DOV.
const A_ELIP = 6378137.0;
const F_ELIP = 1 / 298.257222101;
const E2 = F_ELIP * (2 - F_ELIP);
const EP2 = E2 / (1 - E2);
const LON0 = (-66 * Math.PI) / 180;
const FE = 3_500_000;

function arcoMeridiano(lat) {
  return (
    A_ELIP *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * lat -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * lat) +
      ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * lat) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * lat))
  );
}

function posgarAWgs84(x, y) {
  const m0 = arcoMeridiano((-90 * Math.PI) / 180);
  const mReal = m0 + y;
  const mu = mReal / (A_ELIP * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const fp =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sinFp = Math.sin(fp);
  const cosFp = Math.cos(fp);
  const tanFp = Math.tan(fp);
  const C1 = EP2 * cosFp * cosFp;
  const T1 = tanFp * tanFp;
  const N1 = A_ELIP / Math.sqrt(1 - E2 * sinFp * sinFp);
  const R1 = (A_ELIP * (1 - E2)) / Math.pow(1 - E2 * sinFp * sinFp, 1.5);
  const D = (x - FE) / N1;

  const lat =
    fp -
    ((N1 * tanFp) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon =
    LON0 +
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) /
      cosFp;

  return [Number(((lon * 180) / Math.PI).toFixed(6)), Number(((lat * 180) / Math.PI).toFixed(6))];
}

const dentroDeSMT = ([lon, lat]) => lon > -65.6 && lon < -64.9 && lat > -27.2 && lat < -26.5;

// ── Lectores mínimos de shapefile (solo tipo Point, que es lo que hay) ──────
function leerDbf(archivo) {
  const b = fs.readFileSync(archivo);
  // El .cpg dice en qué página de códigos están los textos. Las dos capas
  // vienen en UTF-8; leerlas como latin1 convierte "José" en "JosÃ©" y el
  // mojibake termina en el tooltip del mapa.
  const cpg = archivo.replace(/\.dbf$/i, ".cpg");
  const declarada = fs.existsSync(cpg) ? fs.readFileSync(cpg, "utf8").trim().toUpperCase() : "";
  const codificacion = /UTF-?8/.test(declarada) ? "utf8" : "latin1";

  const nRegistros = b.readUInt32LE(4);
  const largoCabecera = b.readUInt16LE(8);
  const largoRegistro = b.readUInt16LE(10);
  const campos = [];
  for (let o = 32; b[o] !== 0x0d && o < largoCabecera; o += 32) {
    campos.push({ nombre: b.toString("latin1", o, o + 11).replace(/\0.*$/, ""), largo: b[o + 16] });
  }
  const filas = [];
  for (let i = 0; i < nRegistros; i++) {
    let o = largoCabecera + i * largoRegistro + 1; // +1: byte de borrado
    const fila = {};
    for (const c of campos) {
      fila[c.nombre] = b.toString(codificacion, o, o + c.largo).trim();
      o += c.largo;
    }
    filas.push(fila);
  }
  return filas;
}

/** Devuelve un [x, y] por registro, en el orden del .dbf. */
function leerPuntosShp(archivo) {
  const b = fs.readFileSync(archivo);
  const puntos = [];
  let o = 100; // fin de la cabecera
  while (o < b.length) {
    const largoContenido = b.readInt32BE(o + 4) * 2;
    const tipo = b.readInt32LE(o + 8);
    puntos.push(tipo === 1 ? [b.readDoubleLE(o + 12), b.readDoubleLE(o + 20)] : null);
    o += 8 + largoContenido;
  }
  return puntos;
}

function escribir(nombre, features) {
  fs.writeFileSync(
    path.join(salida, nombre),
    JSON.stringify({ type: "FeatureCollection", features }),
  );
}

const limpio = (v) => {
  const s = String(v ?? "").trim();
  // El relevamiento usa "-" y "**********" (desborde numérico del dbf) como vacío.
  return s === "" || s === "-" || /^\*+$/.test(s) ? null : s;
};

// ── 1. Imbornales relevados ─────────────────────────────────────────────────
/**
 * El estado viene en texto libre con grados intermedios ("LEVE - MODERADO").
 * Se normaliza al peor de los dos: para priorizar mantenimiento conviene
 * equivocarse por exceso, y así entra directo en la escala del semáforo.
 */
function normalizarEstado(texto) {
  const t = (texto ?? "").toUpperCase();
  if (t.includes("COLAPSADO")) return "colapsado";
  if (t.includes("GRAVE")) return "grave";
  if (t.includes("MODERADO")) return "moderado";
  if (t.includes("LEVE")) return "leve";
  return null;
}

function convertirImbornales() {
  const base = path.join(carpeta, "ImbornalesRelevamiento", "SHAPE", "imbornales-relevamiento-2025-v2");
  const filas = leerDbf(`${base}.dbf`);
  const puntos = leerPuntosShp(`${base}.shp`);

  let discrepancias = 0;
  let fuera = 0;
  const features = [];
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    const xy = puntos[i];
    if (!xy) continue;
    const coord = posgarAWgs84(xy[0], xy[1]);
    if (!dentroDeSMT(coord)) {
      fuera++;
      continue;
    }
    // El dbf ya trae lat/lon calculadas: sirven de control de la reproyección.
    const lat = Number(f.latitud);
    const lon = Number(f.longitud);
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0) {
      if (Math.abs(lat - coord[1]) > 0.0005 || Math.abs(lon - coord[0]) > 0.0005) discrepancias++;
    }
    features.push({
      type: "Feature",
      properties: {
        ident: limpio(f.IDENT),
        clase: limpio(f.CLASE),
        tipo: limpio(f.tipo),
        estado: normalizarEstado(f.estado_1),
        estadoTexto: limpio(f.estado_1),
        direccion: limpio(f.direccion_) ?? limpio(f.addr_calle),
        barrio: limpio(f.addr_barri),
        colector: limpio(f.colector),
        cuenca: limpio(f.cuenca_apo),
        depresion: /^SI/i.test(f.depresion ?? "") ? true : /^NO?$/i.test(f.depresion ?? "") ? false : null,
        tapas: Number.isFinite(Number(f.tapas)) && f.tapas !== "" ? Number(f.tapas) : null,
        observaciones: limpio(f.observacio),
      },
      geometry: { type: "Point", coordinates: coord },
    });
  }
  escribir("imbornales.json", features);
  const porEstado = {};
  for (const f of features) porEstado[f.properties.estado ?? "sin_dato"] = (porEstado[f.properties.estado ?? "sin_dato"] ?? 0) + 1;
  console.log(`imbornales: ${features.length} puntos`, JSON.stringify(porEstado));
  if (fuera) console.warn(`  ⚠ ${fuera} fuera del recorte de SMT (descartados)`);
  if (discrepancias) console.warn(`  ⚠ ${discrepancias} con lat/lon del dbf distinta a la reproyección (>55 m)`);
}

// ── 2. Zonas inundables ─────────────────────────────────────────────────────
function convertirZonasInundables() {
  const base = path.join(carpeta, "ZonasInundables", "SHAPE", "ZonasInundables");
  const filas = leerDbf(`${base}.dbf`);
  const puntos = leerPuntosShp(`${base}.shp`);
  const features = [];
  for (let i = 0; i < filas.length; i++) {
    const xy = puntos[i];
    if (!xy) continue;
    const coord = posgarAWgs84(xy[0], xy[1]);
    if (!dentroDeSMT(coord)) continue;
    const obs = limpio(filas[i].OBSERVACIO);
    features.push({
      type: "Feature",
      properties: {
        direccion: limpio(filas[i].DIRECCION),
        observaciones: obs,
        // El tirante viene narrado ("MAS DE 1M DE TIRANTE", "llega a más de 2m"):
        // se extrae el número para poder ordenar por gravedad.
        tiranteM: (() => {
          const m = /(\d+([.,]\d+)?)\s*M\b/i.exec(obs ?? "");
          return m ? Number(m[1].replace(",", ".")) : null;
        })(),
      },
      geometry: { type: "Point", coordinates: coord },
    });
  }
  escribir("zonas-inundables.json", features);
  console.log(`zonas-inundables: ${features.length} puntos críticos`);
}

// ── 3. Bacheo integral (gpkg con empresa) ───────────────────────────────────
function convertirBacheoIntegral() {
  const Database = require(
    path.join(raiz, "node_modules/.pnpm/better-sqlite3@12.11.1/node_modules/better-sqlite3"),
  );
  const archivo = path.join(carpeta, "Bacheo_integral_2026-09-08.gpkg");
  const db = new Database(archivo, { readonly: true });
  const tabla = db
    .prepare("select table_name from gpkg_contents where data_type = 'features' limit 1")
    .get().table_name;
  const filas = db.prepare(`select Name, EMPRESA, description, geom from "${tabla}"`).all();
  const features = filas.map((f) => ({
    type: "Feature",
    properties: {
      nombre: limpio(f.Name),
      empresa: limpio(f.EMPRESA),
      detalle: limpio(String(f.description ?? "").replace(/<br\s*\/?>/gi, " · ")),
    },
    geometry: gpkgAGeoJson(f.geom),
  }));
  escribir("bacheo-integral.json", features);
  console.log(
    `bacheo-integral: ${features.length} polígonos`,
    features.map((f) => `${f.properties.nombre}→${f.properties.empresa ?? "?"}`).join(", "),
  );
  db.close();
}

/** GeoPackage envuelve WKB en una cabecera propia: se saltea y se lee el WKB. */
function gpkgAGeoJson(blob) {
  const b = Buffer.from(blob);
  const banderas = b[3];
  const tipoSrs = (banderas >> 1) & 0x07;
  const bytesEnvolvente = [0, 32, 48, 48, 64][tipoSrs] ?? 0;
  return leerWkb(b, 8 + bytesEnvolvente).geo;
}

function leerWkb(b, o) {
  const le = b[o] === 1;
  const u32 = (p) => (le ? b.readUInt32LE(p) : b.readUInt32BE(p));
  const f64 = (p) => (le ? b.readDoubleLE(p) : b.readDoubleBE(p));
  const bruto = u32(o + 1);
  // El KML de origen trae altitud: los tipos 1000+ (Z), 2000+ (M) y 3000+ (ZM)
  // son el mismo geometry con dimensiones de más, que se leen y se descartan.
  const tipo = bruto % 1000;
  const dims = 2 + (bruto >= 3000 ? 2 : bruto >= 1000 ? 1 : 0);
  o += 5;
  if (tipo === 3 || tipo === 6) {
    // Polygon (3) y MultiPolygon (6) se recorren igual salvo un nivel más.
    if (tipo === 6) {
      const n = u32(o);
      o += 4;
      const partes = [];
      for (let i = 0; i < n; i++) {
        const r = leerWkb(b, o);
        partes.push(r.geo.coordinates);
        o = r.o;
      }
      return { geo: { type: "MultiPolygon", coordinates: partes }, o };
    }
    const nAnillos = u32(o);
    o += 4;
    const anillos = [];
    for (let a = 0; a < nAnillos; a++) {
      const nPuntos = u32(o);
      o += 4;
      const puntos = [];
      for (let p = 0; p < nPuntos; p++) {
        puntos.push([Number(f64(o).toFixed(6)), Number(f64(o + 8).toFixed(6))]);
        o += 8 * dims;
      }
      anillos.push(puntos);
    }
    return { geo: { type: "Polygon", coordinates: anillos }, o };
  }
  throw new Error(`WKB tipo ${tipo} no soportado`);
}

convertirImbornales();
convertirZonasInundables();
convertirBacheoIntegral();
