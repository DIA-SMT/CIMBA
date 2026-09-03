/**
 * Convierte los insumos viales que pasó la Dirección de Bacheo (sep 2026) a
 * GeoJSON WGS84 listo para el mapa y la base:
 *
 *   RED Y JERARQUIA VIAL.zip → jerarquia-vial.json (primarias y secundarias;
 *     las terciarias afuera: "te hacen una mancha en el mapa")
 *     y red-vial.json (10.392 cuadras con pavimento/ripio/cordón cuneta —
 *     el insumo de la clasificación bacheo/ingeniería)
 *   LICITACIONES.zip → sectores-licitacion.json (11 sectores de paños de
 *     hormigón con su empresa + 4 cuadrantes grandes con empresa de hormigón
 *     Y de asfalto y n° de licitación)
 *   2025 RECORRIDOS.rar → recorridos-colectivos.json (la "sensibilidad por
 *     transporte" del ingeniero: por dónde pasan los colectivos)
 *
 * Uso:  node scripts/convertir-insumos-viales.mjs <carpeta-insumos>
 * Idempotente: pisa los .json de apps/web/public/data.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const raiz = path.join(import.meta.dirname, "..");
const carpeta = process.argv[2];
if (!carpeta || !fs.existsSync(carpeta)) {
  console.error("Uso: node scripts/convertir-insumos-viales.mjs <carpeta con red/, licitaciones/, recorridos/>");
  process.exit(1);
}
const salida = path.join(raiz, "apps", "web", "public", "data");

// ── POSGAR 2007 / Argentina faja 3 (EPSG:5345) → WGS84 ──────────────────────
// Gauss-Krüger inversa sobre GRS80: meridiano central -66°, falso este
// 3.500.000, origen de latitud en el polo sur (por eso el norte ~7.03M en
// Tucumán). Fórmulas estándar de Transverse Mercator (series de Krüger).
const A_ELIP = 6378137.0;
const F_ELIP = 1 / 298.257222101;
const E2 = F_ELIP * (2 - F_ELIP);
const EP2 = E2 / (1 - E2);
const LON0 = (-66 * Math.PI) / 180;
const FE = 3_500_000;

function posgarAWgs84(x, y) {
  // Latitud de pie de punto desde el arco de meridiano (medido desde el polo sur)
  const M = y - 111132.9526558088 * 90; // arco de -90° a 0 restado…
  // Más simple y robusto: M medido desde el ecuador = y - M(-90→0). Calculamos
  // el arco de meridiano del ecuador al polo con la misma serie para coherencia.
  const m0 = arcoMeridiano((-90 * Math.PI) / 180);
  const mReal = m0 + y; // y se mide desde el polo sur (lat_0 = -90)
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

function arcoMeridiano(lat) {
  return (
    A_ELIP *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * lat -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * lat) +
      ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * lat) -
      ((35 * E2 ** 3) / 3072) * Math.sin(6 * lat))
  );
}

// Validación dura: si algo cae fuera de un margen amplio de SMT, la
// conversión está mal y no hay que escribir nada.
let fueraDeRango = 0;
function validar([lon, lat]) {
  if (lon < -65.6 || lon > -64.9 || lat < -27.2 || lat > -26.5) fueraDeRango++;
  return [lon, lat];
}

const reproyectarCoords = (coords) =>
  typeof coords[0] === "number" ? validar(posgarAWgs84(coords[0], coords[1])) : coords.map(reproyectarCoords);

// ── 1. Jerarquía vial ────────────────────────────────────────────────────────
function convertirJerarquia() {
  const j = JSON.parse(
    fs.readFileSync(path.join(carpeta, "red", "JERARQUIA VIAL", "AUXILIARES", "Jerarquia_vial.geojson"), "utf8"),
  );
  const features = j.features
    .filter((f) => f.properties.RED_VIAL_C !== "TERCIARIA" && f.geometry)
    .map((f) => ({
      type: "Feature",
      properties: { nombre: f.properties.NOMBRE ?? null, jerarquia: f.properties.RED_VIAL_C.toLowerCase() },
      geometry: { type: f.geometry.type, coordinates: reproyectarCoords(f.geometry.coordinates) },
    }));
  escribir("jerarquia-vial.json", features);
  const n = { primaria: 0, secundaria: 0 };
  for (const f of features) n[f.properties.jerarquia]++;
  console.log(`jerarquia-vial: ${features.length} tramos (${n.primaria} primarias, ${n.secundaria} secundarias; terciarias afuera)`);
}

// ── 2. Red vial (pavimento / ripio / cordón cuneta) ─────────────────────────
function convertirRedVial() {
  const r = JSON.parse(
    fs.readFileSync(path.join(carpeta, "red", "RED VIAL", "AUXILIARES", "Red_vial.geojson"), "utf8"),
  );
  const CAPA = { PAVIMENTO: "pavimento", RIPIO: "ripio", "CORDON CUNETA": "cordon_cuneta" };
  const features = r.features
    .filter((f) => f.geometry)
    .map((f) => ({
      type: "Feature",
      properties: {
        capa: CAPA[f.properties.LAYER] ?? "pavimento",
        intervencion: f.properties.INTERVENCI ?? null,
        direccion: f.properties["DIRECCIÓN"] ?? null,
        barrio: f.properties.BARRIO ?? null,
      },
      geometry: { type: f.geometry.type, coordinates: reproyectarCoords(f.geometry.coordinates) },
    }));
  escribir("red-vial.json", features);
  const n = {};
  for (const f of features) n[f.properties.capa] = (n[f.properties.capa] ?? 0) + 1;
  console.log(`red-vial: ${features.length} cuadras`, JSON.stringify(n));
}

// ── 3. Sectores de licitación ────────────────────────────────────────────────
// 11 sectores de paños de hormigón (KML, ya en WGS84, con EMPRESA) + 4
// cuadrantes grandes (GPKG en POSGAR, con empresa de hormigón Y de asfalto).
function convertirSectores() {
  const features = [];

  // KML de los 11 sectores
  const kml = fs.readFileSync(
    path.join(carpeta, "licitaciones", "SECTORES FINALES", "11 SECTORES PAÑOS DE HORMIGÓN.kml"),
    "utf8",
  );
  const placemarks = kml.split("<Placemark>").slice(1);
  for (const p of placemarks) {
    const sector = /<SimpleData name="ID DISTRIT">([^<]+)</.exec(p)?.[1];
    const empresa = /<SimpleData name="EMPRESA">([^<]+)</.exec(p)?.[1];
    const anillos = [...p.matchAll(/<coordinates>([^<]+)<\/coordinates>/g)].map((m) =>
      m[1]
        .trim()
        .split(/\s+/)
        .map((par) => par.split(",").slice(0, 2).map(Number)),
    );
    if (anillos.length === 0) continue;
    features.push({
      type: "Feature",
      properties: {
        tipo: "hormigon",
        sector: `Sector ${sector}`,
        empresa: normalizarEmpresa(empresa),
        licitacion: null,
      },
      geometry: { type: "Polygon", coordinates: anillos },
    });
  }
  const nHormigon = features.length;

  // GPKG de los 4 cuadrantes (POSGAR): geometría en blob GPKG → WKB
  const Database = require(path.join(raiz, "node_modules/.pnpm/better-sqlite3@12.11.1/node_modules/better-sqlite3"));
  const db = new Database(
    path.join(carpeta, "licitaciones", "CUADRANTES - PAVIMENTO HORMIGON", "CUADRANTES_PAV_HORMIGON.gpkg"),
    { readonly: true },
  );
  const filas = db.prepare('select * from "CUADRANTES_PAV_HORMIGON"').all();
  for (const f of filas) {
    if (f.NOMBRE === "GENERAL") continue; // fila de "vista general", sin datos
    const geo = gpkgAGeoJson(f.geom);
    if (!geo) continue;
    features.push({
      type: "Feature",
      properties: {
        tipo: "cuadrante",
        sector: f.TITULO, // SECTOR SURESTE, etc.
        empresa: normalizarEmpresa(f.NOMBRE),
        empresaAsfalto: normalizarEmpresa(f.ASFALTO_NOMBRE),
        licitacion: f.NUMERO ? String(f.NUMERO) : null,
        panios: f.NUM_PANIOS ?? null,
      },
      geometry: { type: geo.type, coordinates: reproyectarCoords(geo.coordinates) },
    });
  }
  escribir("sectores-licitacion.json", features);
  console.log(`sectores-licitacion: ${nHormigon} sectores de hormigón + ${features.length - nHormigon} cuadrantes`);
}

/** Los nombres vienen con tipeos y encodings rotos: se normalizan al slug de empresas. */
function normalizarEmpresa(crudo) {
  if (!crudo) return null;
  const limpio = crudo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z ]/g, "")
    .toUpperCase()
    .trim();
  const MAPA = {
    CALLERI: "calleri",
    CALLIERI: "calleri",
    LNEA: "linea",
    LINEA: "linea",
    PROYCON: "proycon",
    GALINDO: "galindo",
    INGECO: "ingeco",
    LUXURY: "luxury",
    BARONETTO: "baronetto",
    SERCOVIAL: "sercovial",
    ANTONELLI: "antonelli",
    LECHESI: "lechesi",
    "LECHESI ARECO": "lechesi",
    CONTRATUC: "contratuc",
    UOCRA: "uocra",
  };
  return MAPA[limpio] ?? limpio.toLowerCase();
}

/** Blob de geometría GPKG: cabecera 'GP' + flags + envelope, después WKB plano. */
function gpkgAGeoJson(blob) {
  if (!blob || blob[0] !== 0x47 || blob[1] !== 0x50) return null;
  const flags = blob[3];
  const tamanoEnvelope = [0, 32, 48, 48, 64][(flags >> 1) & 0x07] ?? 0;
  return wkbAGeoJson(blob.subarray(8 + tamanoEnvelope));
}

function wkbAGeoJson(buf) {
  let pos = 0;
  const leer = () => {
    const le = buf[pos] === 1;
    pos += 1;
    const tipo = le ? buf.readUInt32LE(pos) : buf.readUInt32BE(pos);
    pos += 4;
    const d = () => {
      const v = le ? buf.readDoubleLE(pos) : buf.readDoubleBE(pos);
      pos += 8;
      return v;
    };
    const n = () => {
      const v = le ? buf.readUInt32LE(pos) : buf.readUInt32BE(pos);
      pos += 4;
      return v;
    };
    const base = tipo % 1000; // por si viene con dimensión Z (1003 etc.)
    if (base === 3) {
      // Polygon
      const anillos = [];
      const nAnillos = n();
      for (let i = 0; i < nAnillos; i++) {
        const puntos = [];
        const nPuntos = n();
        for (let k = 0; k < nPuntos; k++) puntos.push([d(), d()]);
        anillos.push(puntos);
      }
      return { type: "Polygon", coordinates: anillos };
    }
    if (base === 6) {
      // MultiPolygon
      const polys = [];
      const nPolys = n();
      for (let i = 0; i < nPolys; i++) polys.push(leer().coordinates);
      return { type: "MultiPolygon", coordinates: polys };
    }
    throw new Error(`tipo WKB no soportado: ${tipo}`);
  };
  return leer();
}

// ── 4. Recorridos de colectivos ──────────────────────────────────────────────
function convertirRecorridos() {
  const dir = path.join(carpeta, "recorridos", "2025 RECORRIDOS");
  const features = [];
  for (const archivo of fs.readdirSync(dir).filter((a) => a.toLowerCase().endsWith(".kml"))) {
    const m = /^L(\d+)[_-](.+)\.kml$/i.exec(archivo);
    const linea = m ? m[1] : archivo.replace(/\.kml$/i, "");
    const ramal = m ? m[2].replace(/_/g, " ") : "";
    const kml = fs.readFileSync(path.join(dir, archivo), "utf8");
    for (const c of kml.matchAll(/<coordinates>([^<]+)<\/coordinates>/g)) {
      const puntos = c[1]
        .trim()
        .split(/\s+/)
        .map((par) => par.split(",").slice(0, 2).map(Number))
        .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
      if (puntos.length < 2) continue;
      features.push({
        type: "Feature",
        properties: { linea: `L${linea}`, ramal },
        geometry: { type: "LineString", coordinates: puntos.map(([lon, lat]) => validar([Number(lon.toFixed(6)), Number(lat.toFixed(6))])) },
      });
    }
  }
  escribir("recorridos-colectivos.json", features);
  const lineas = new Set(features.map((f) => f.properties.linea));
  console.log(`recorridos-colectivos: ${features.length} tramos de ${lineas.size} líneas`);
}

/**
 * Acumula en memoria: NADA se escribe hasta que la validación de bbox pase.
 * Antes cada conversor pisaba su .json al terminar, así que una entrega en
 * otra faja POSGAR destruía los archivos buenos aunque el script saliera con
 * error — exactamente lo que el comentario de validar() prometía evitar.
 */
const pendientes = new Map();
function escribir(nombre, features) {
  pendientes.set(nombre, JSON.stringify({ type: "FeatureCollection", features }));
}
function volcarTodo() {
  for (const [nombre, contenido] of pendientes) {
    fs.writeFileSync(path.join(salida, nombre), contenido);
    console.log(`  → public/data/${nombre} (${Math.round(contenido.length / 1024)} KB)`);
  }
}

convertirJerarquia();
convertirRedVial();
convertirSectores();
convertirRecorridos();

if (fueraDeRango > 0) {
  console.error(`\n⚠ REPROYECCIÓN SOSPECHOSA: ${fueraDeRango} puntos fuera del bbox de SMT. NO usar estos archivos.`);
  process.exit(1);
}
console.log("\nTodo dentro del bbox de SMT: reproyección validada.");
