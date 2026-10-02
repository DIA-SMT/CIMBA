/**
 * Convierte la capa de COLECTORES PLUVIALES que pasó la Dirección de Obras
 * Viales (30/9/2026, "COLECTORES-300926.zip") a GeoJSON para el mapa del
 * Sistema Pluvial.
 *
 *   ColectoresLeo.{shp,dbf,cpg,prj}  → apps/web/public/data/colectores.json
 *
 * Es la geometría real de los colectores a los que descargan los imbornales:
 * `imbornales.json` ya traía el NOMBRE del colector de cada boca de tormenta
 * ("SAN CAYETANO", "ALVAREZ - CONDARCO"...) pero no su trazado. Los nombres
 * de esta capa coinciden con esos (confirmado contra los 6 colectores que
 * tienen imbornales relevados).
 *
 * 145 tramos, en 6 tipos de obra (Colector, Canal, FFCC, Vialidad, Parque,
 * Ducto): un mismo colector nombrado puede tener varios tramos "Colector" (el
 * caño principal) y algún tramo de otro tipo donde cruza una vía, un
 * ferrocarril o un ducto — son el mismo trazado, no un colector aparte.
 *
 * Viene en POSGAR (el .prj dice 2007, el .qmd dice 94; la diferencia entre
 * ambos realizaciones es de centímetros, irrelevante a esta escala), con los
 * mismos parámetros de Gauss-Krüger que el resto del GIS de la DOV: misma
 * inversa que scripts/convertir-hidraulica.mjs.
 *
 * Uso:  node scripts/convertir-colectores.mjs <carpeta con ColectoresLeo.shp>
 *       node scripts/convertir-colectores.mjs <carpeta> --ver   (solo muestra)
 * Idempotente: pisa colectores.json.
 */
import fs from "node:fs";
import path from "node:path";

const raiz = path.join(import.meta.dirname, "..");
const carpeta = process.argv[2];
const soloVer = process.argv.includes("--ver");
if (!carpeta || !fs.existsSync(path.join(carpeta, "ColectoresLeo.shp"))) {
  console.error("Uso: node scripts/convertir-colectores.mjs <carpeta con ColectoresLeo.shp> [--ver]");
  process.exit(1);
}

// ── POSGAR / Argentina faja 3 → WGS84 (misma inversa que convertir-hidraulica.mjs) ──
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

/** Metros entre dos puntos [lon, lat], suficiente para sumar el largo de un tramo. */
function metros([lon1, lat1], [lon2, lat2]) {
  const r = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

// ── Lectores mínimos de shapefile (mismo criterio que convertir-canales.mjs) ──
function leerDbf(archivo) {
  const b = fs.readFileSync(archivo);
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

/** Una lista de partes (cada parte, una lista de [x, y] en POSGAR) por registro, o null. */
function leerLineasShp(archivo) {
  const b = fs.readFileSync(archivo);
  const lineas = [];
  let o = 100; // fin de la cabecera
  while (o < b.length) {
    const largoContenido = b.readInt32BE(o + 4) * 2;
    const tipo = b.readInt32LE(o + 8);
    if (tipo === 3 || tipo === 13 || tipo === 23) {
      const nPartes = b.readInt32LE(o + 44);
      const nPuntos = b.readInt32LE(o + 48);
      const inicioPartes = o + 52;
      const inicioPuntos = inicioPartes + nPartes * 4;
      const partes = [];
      for (let p = 0; p < nPartes; p++) {
        const desde = b.readInt32LE(inicioPartes + p * 4);
        const hasta = p + 1 < nPartes ? b.readInt32LE(inicioPartes + (p + 1) * 4) : nPuntos;
        const parte = [];
        for (let k = desde; k < hasta; k++) {
          const x = b.readDoubleLE(inicioPuntos + k * 16);
          const y = b.readDoubleLE(inicioPuntos + k * 16 + 8);
          parte.push(posgarAWgs84(x, y));
        }
        if (parte.length >= 2) partes.push(parte);
      }
      lineas.push(partes.length > 0 ? partes : null);
    } else {
      lineas.push(null);
    }
    o += 8 + largoContenido;
  }
  return lineas;
}

const texto = (v) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s && !/^\*+$/.test(s) ? s : null;
};

/** "Colector" / "FFCC" / "Vialidad"... tal cual vienen: son categorías, no nombres propios. */
const TIPOS_VALIDOS = new Set(["Colector", "Canal", "FFCC", "Vialidad", "Parque", "Ducto"]);

const base = path.join(carpeta, "ColectoresLeo");
const filas = leerDbf(`${base}.dbf`);
const lineas = leerLineasShp(`${base}.shp`);
if (filas.length !== lineas.length) {
  console.error(`El .dbf tiene ${filas.length} filas y el .shp ${lineas.length} formas: no coinciden.`);
  process.exit(1);
}

if (soloVer) {
  console.table(
    filas.map((f, i) => ({ ...f, partes: lineas[i]?.length ?? 0, puntos: lineas[i]?.flat().length ?? 0 })),
  );
  process.exit(0);
}

let fuera = 0;
let sinForma = 0;
let sinTipo = 0;
const features = [];
filas.forEach((f, i) => {
  const partes = lineas[i];
  if (!partes) {
    sinForma++;
    return;
  }
  if (!partes.flat().every(dentroDeSMT)) {
    fuera++;
    return;
  }
  const tipo = TIPOS_VALIDOS.has(f.Tipo) ? f.Tipo : null;
  if (!tipo) sinTipo++;
  const largoM = Math.round(partes.reduce((s, parte) => s + parte.slice(1).reduce((s2, p, k) => s2 + metros(parte[k], p), 0), 0));
  features.push({
    type: "Feature",
    geometry: partes.length === 1 ? { type: "LineString", coordinates: partes[0] } : { type: "MultiLineString", coordinates: partes },
    properties: {
      id: texto(f.fid) ?? String(i + 1),
      nombre: texto(f.nombre),
      tipo: tipo ?? "Colector",
      largoM,
    },
  });
});

fs.writeFileSync(
  path.join(raiz, "apps", "web", "public", "data", "colectores.json"),
  JSON.stringify({ type: "FeatureCollection", features }),
);
console.log(
  `colectores.json: ${features.length} tramos` +
    (fuera ? ` · ${fuera} fuera de SMT (descartados)` : "") +
    (sinForma ? ` · ${sinForma} sin forma` : "") +
    (sinTipo ? ` · ${sinTipo} con tipo desconocido (quedaron como Colector)` : ""),
);
