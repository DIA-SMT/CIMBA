/**
 * Carga las ZONAS DE BACHEO INTEGRAL (las divisiones fijas por empresa) a la
 * base, para que sean un ámbito elegible al armar una orden.
 *
 *   node scripts/cargar-zonas-bacheo.mjs
 *   node scripts/cargar-zonas-bacheo.mjs "C:\ruta\Bacheo integral.kml"
 *
 * Sin argumentos lee apps/web/public/data/bacheo-integral.json, que es la capa
 * que ya dibuja el mapa — así la base y el mapa no pueden desincronizarse.
 * Con un .kml de Google My Maps lo convierte primero (mismo parser que
 * scripts/convertir-bacheo-integral.mjs) y REGENERA también el JSON, para que
 * el mapa y las órdenes sigan mirando exactamente lo mismo.
 *
 * Es idempotente: borra y vuelve a escribir las zonas por nombre. Las órdenes
 * ya emitidas apuntan por FK y no se tocan.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const RAIZ = path.join(import.meta.dirname, "..");
const DESTINO_JSON = path.join(RAIZ, "apps", "web", "public", "data", "bacheo-integral.json");

const envPath = path.join(RAIZ, ".env");
if (fs.existsSync(envPath)) {
  for (const linea of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

// ── POSGAR 2007 / Argentina faja 3 (EPSG:5345) → WGS84 ──────────────────────
// El GIS de la DOV exporta proyectado, y el JSON de esta capa venía así desde
// el principio: coordenadas de 3.5 millones que MapLibre interpreta como
// grados y dibuja fuera del planeta (la capa "Bacheo integral" del mapa nunca
// se vio), y que st_contains nunca hacía coincidir con ningún incidente. Se
// detecta sola —un |lon| > 180 no es un grado— y se convierte.
const A_ELIP = 6378137.0;
const F_ELIP = 1 / 298.257222101;
const E2 = F_ELIP * (2 - F_ELIP);
const EP2 = E2 / (1 - E2);
const LON0 = (-66 * Math.PI) / 180;
const FE = 3_500_000;

const arcoMeridiano = (lat) =>
  A_ELIP *
  ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * lat -
    ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * lat) +
    ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * lat) -
    ((35 * E2 ** 3) / 3072) * Math.sin(6 * lat));

function posgarAWgs84(x, y) {
  const m0 = arcoMeridiano((-90 * Math.PI) / 180);
  const mu = (m0 + y) / (A_ELIP * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
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
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** ¿Las coordenadas vienen proyectadas? Un grado nunca pasa de 180. */
const estaProyectado = (c) => (Array.isArray(c[0]) ? estaProyectado(c[0]) : Math.abs(c[0]) > 180);
const aGrados = (c) => (typeof c[0] === "number" ? posgarAWgs84(c[0], c[1]) : c.map(aGrados));

function normalizarProyeccion(fc) {
  if (fc.features.length === 0) return fc;
  if (!estaProyectado(fc.features[0].geometry.coordinates)) return fc;
  for (const f of fc.features) f.geometry.coordinates = aGrados(f.geometry.coordinates);
  console.log("↻ coordenadas POSGAR convertidas a WGS84");
  return fc;
}

/** El KML de My Maps: un Placemark por zona, con el nombre y la obra. */
function desdeKml(ruta) {
  const kml = fs.readFileSync(ruta, "utf8");
  const features = [];
  for (const pm of kml.match(/<Placemark>[\s\S]*?<\/Placemark>/g) ?? []) {
    const nombre = /<name>([\s\S]*?)<\/name>/.exec(pm)?.[1]?.trim() ?? "Sin nombre";
    const desc = /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/.exec(pm)?.[1] ?? "";
    const lineas = desc.split(/<br\s*\/?>/i).map((l) => l.trim()).filter(Boolean);
    const anillos = [];
    for (const m of pm.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)) {
      const puntos = m[1]
        .trim()
        .split(/\s+/)
        .map((c) => c.split(",").slice(0, 2).map(Number))
        .filter((p) => p.length === 2 && p.every(Number.isFinite));
      if (puntos.length >= 4) anillos.push(puntos);
    }
    if (anillos.length === 0) continue;
    features.push({
      type: "Feature",
      properties: {
        nombre,
        empresa: lineas.find((l) => /^E\d|empresa/i.test(l)) ?? null,
        detalle: lineas.join(" · ") || null,
      },
      geometry: { type: "MultiPolygon", coordinates: anillos.map((a) => [a]) },
    });
  }
  return { type: "FeatureCollection", features };
}

const origen = process.argv[2];
let fc;
if (origen) {
  if (!/\.kml$/i.test(origen)) {
    console.error(
      "Solo se entiende .kml. Si tenés un .gpkg, exportalo a KML o GeoJSON desde QGIS\n" +
        "(Capa → Guardar como…) y volvé a correr esto con ese archivo.",
    );
    process.exit(1);
  }
  fc = normalizarProyeccion(desdeKml(origen));
  fs.writeFileSync(DESTINO_JSON, JSON.stringify(fc));
  console.log(`✔ ${fc.features.length} zonas → ${path.relative(RAIZ, DESTINO_JSON)}`);
} else {
  fc = normalizarProyeccion(JSON.parse(fs.readFileSync(DESTINO_JSON, "utf8")));
  // Si venía proyectado, se reescribe: el mapa lee este mismo archivo.
  fs.writeFileSync(DESTINO_JSON, JSON.stringify(fc));
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  let n = 0;
  for (const f of fc.features) {
    const p = f.properties ?? {};
    const nombre = String(p.nombre ?? "").trim();
    if (!nombre) continue;
    await sql`
      insert into zonas_bacheo (nombre, empresa, detalle, geom, actualizado_en)
      values (
        ${nombre}, ${p.empresa ?? null}, ${p.detalle ?? null},
        st_multi(st_setsrid(st_geomfromgeojson(${JSON.stringify(f.geometry)}), 4326)),
        now()
      )
      on conflict (nombre) do update set
        empresa = excluded.empresa,
        detalle = excluded.detalle,
        geom = excluded.geom,
        actualizado_en = now()
    `;
    n++;
  }

  /**
   * El nombre de la empresa del contrato ("INGECO-2", "CALLERI") no coincide
   * con empresas.nombre ("INGECO S.A.", "CALLERI E HIJOS S.A."): se une por el
   * prefijo, que es lo único estable, y lo que no matchea queda en null — la
   * zona sirve igual, solo que sin el link a la ficha de la empresa.
   */
  const unidas = await sql`
    update zonas_bacheo z set empresa_id = e.id
    from empresas e
    where z.empresa is not null
      and e.slug = lower(split_part(regexp_replace(z.empresa, '[^A-Za-z0-9-]', '', 'g'), '-', 1))
    returning z.nombre, e.nombre as empresa
  `;

  const total = await sql`select count(*)::int as n from zonas_bacheo`;
  console.log(`✔ ${n} zonas cargadas · ${total[0].n} en la base`);
  for (const u of unidas) console.log(`  ${u.nombre} → ${u.empresa}`);
} finally {
  await sql.end();
}
