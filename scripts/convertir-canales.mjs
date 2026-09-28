/**
 * Convierte la capa de CANALES que pasó la Dirección de Obras Viales
 * (27/9/2026, "Canales SMT.zip") a GeoJSON para el mapa del Sistema Pluvial.
 *
 *   Canales.{shp,dbf,cpg,prj}  → apps/web/public/data/canales.json
 *
 * Son polilíneas en WGS84 (el .prj lo dice): no hace falta reproyectar. Cada
 * canal trae nombre, empresa, largo y observaciones.
 *
 * Uso:  node scripts/convertir-canales.mjs <carpeta con Canales.shp>
 *       node scripts/convertir-canales.mjs <carpeta> --ver   (solo muestra, no escribe)
 * Idempotente: pisa canales.json.
 */
import fs from "node:fs";
import path from "node:path";

const raiz = path.join(import.meta.dirname, "..");
const carpeta = process.argv[2];
const soloVer = process.argv.includes("--ver");
if (!carpeta || !fs.existsSync(path.join(carpeta, "Canales.shp"))) {
  console.error("Uso: node scripts/convertir-canales.mjs <carpeta con Canales.shp> [--ver]");
  process.exit(1);
}

const dentroDeSMT = ([lon, lat]) => lon > -65.6 && lon < -64.9 && lat > -27.2 && lat < -26.5;

// ── Lectores mínimos de shapefile (mismo criterio que convertir-hidraulica) ──
function leerDbf(archivo) {
  const b = fs.readFileSync(archivo);
  // El .cpg dice en qué página de códigos están los textos: leer UTF-8 como
  // latin1 convierte "José" en "JosÃ©" y el mojibake termina en el mapa.
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

/** Una lista de partes (cada parte, una lista de [lon, lat]) por registro, o null. */
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
          parte.push([Number(x.toFixed(6)), Number(y.toFixed(6))]);
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
  return s && s !== "0" && s !== "-" ? s : null;
};
const numero = (v) => {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const bloqueado = (v) => /BLOQUEAD/i.test(String(v ?? ""));
/** "POR ADMINISTRACION" → "Administración"; "CONTATRUC" → "Contatruc". */
function responsable(v) {
  const s = texto(v);
  if (!s) return null;
  if (/ADMINISTRACI/i.test(s)) return "Administración";
  if (s.toUpperCase() === "FFCC") return "FFCC";
  // La capa dice "CONTATRUC": es Contratuc, la contratista dada de alta en CIMBA.
  if (/^CONTR?ATRUC$/i.test(s)) return "Contratuc";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

const base = path.join(carpeta, "Canales");
const filas = leerDbf(`${base}.dbf`);
const lineas = leerLineasShp(`${base}.shp`);
if (filas.length !== lineas.length) {
  console.error(`El .dbf tiene ${filas.length} filas y el .shp ${lineas.length} formas: no coinciden.`);
  process.exit(1);
}

if (soloVer) {
  console.table(filas.map((f, i) => ({ ...f, partes: lineas[i]?.length ?? 0, puntos: lineas[i]?.flat().length ?? 0 })));
  process.exit(0);
}

let fuera = 0;
let sinForma = 0;
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
  features.push({
    type: "Feature",
    geometry: partes.length === 1 ? { type: "LineString", coordinates: partes[0] } : { type: "MultiLineString", coordinates: partes },
    properties: {
      // ID-TEXT es el único que no se repite ("12A", "22B"): el ID numérico sí.
      id: texto(f["ID-TEXT"]) ?? String(i + 1),
      nombre: texto(f.NOMBRE),
      /* La columna EMPRESA dice quién mantiene el canal (Delfi, Ingeco,
         Contatruc, FFCC, Por Administración)... salvo en los tapados, donde
         dice "CANAL BLOQUEADO". Eso es un estado, no una empresa: se separa. */
      responsable: bloqueado(f.EMPRESA) ? null : responsable(f.EMPRESA),
      bloqueado: bloqueado(f.EMPRESA) || /TAPADO/i.test(String(f.NOMBRE ?? "")),
      // LONG REAL es la medida de la DOV. LONGITUD viene desbordada
      // ("**********") en la mitad de las filas: no se usa.
      largoM: numero(f["LONG REAL"]) === null ? null : Math.round(numero(f["LONG REAL"])),
      observaciones: texto(f.OBSERVACIO),
    },
  });
});

fs.writeFileSync(
  path.join(raiz, "apps", "web", "public", "data", "canales.json"),
  JSON.stringify({ type: "FeatureCollection", features }),
);
console.log(`canales.json: ${features.length} canales${fuera ? ` · ${fuera} fuera de SMT (descartados)` : ""}${sinForma ? ` · ${sinForma} sin forma` : ""}`);
