/**
 * Carga las CALLES CON NOMBRE de la ciudad desde OpenStreetMap, para ubicar
 * cruces ("Piedras y San Luis") sin depender de un servicio externo en cada
 * carga. Ver supabase/migrations/0039_calles_osm.sql.
 *
 *   node scripts/cargar-calles-osm.mjs                 → baja de Overpass y carga
 *   node scripts/cargar-calles-osm.mjs archivo.json    → carga un JSON ya bajado
 *
 * Idempotente y sin borrar: cada tramo se identifica por su id de OSM, así que
 * volver a correrlo actualiza lo que cambió y agrega lo nuevo. Un tramo que OSM
 * haya borrado queda (no molesta: una calle que existía sigue cruzándose donde
 * se cruzaba).
 *
 * El nombre normalizado tiene que ser IGUAL al que arma
 * packages/integrations/src/geocoder/cruce-osm.ts (palabras()): si cambia uno,
 * cambia el otro, o lo que escribe la gente no encuentra la calle.
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const raiz = path.join(import.meta.dirname, "..");
for (const l of fs.readFileSync(path.join(raiz, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const TIPOS = new Set(["av", "avda", "avd", "avenida", "pje", "psje", "pasaje", "calle", "bv", "boulevard", "bulevar"]);
const normalizar = (nombre) =>
  nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !TIPOS.has(w))
    .join(" ");

/** La ciudad con margen: sur, oeste, norte, este. */
const CAJA = "-26.92,-65.32,-26.74,-65.13";
const ESPEJOS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

async function bajar() {
  const q = `[out:json][timeout:120];\nway["highway"]["name"](${CAJA});\nout tags geom;`;
  for (const url of ESPEJOS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        body: `data=${encodeURIComponent(q)}`,
        headers: {
          "user-agent": "CIMBA/0.1 (Municipalidad de San Miguel de Tucuman)",
          "content-type": "application/x-www-form-urlencoded",
        },
        signal: AbortSignal.timeout(150000),
      });
      const texto = await r.text();
      if (texto.trimStart().startsWith("{")) return JSON.parse(texto);
      console.log(`${url}: no contestó bien (HTTP ${r.status}), pruebo otro`);
    } catch (e) {
      console.log(`${url}: ${e.message}, pruebo otro`);
    }
  }
  throw new Error("Ningún servidor de OSM contestó: probá más tarde o pasá un archivo ya bajado.");
}

const datos = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], "utf8")) : await bajar();
const tramos = datos.elements
  .filter((e) => e.type === "way" && e.tags?.name && Array.isArray(e.geometry) && e.geometry.length >= 2)
  .map((e) => ({
    id: e.id,
    nombre: e.tags.name,
    nombre_norm: normalizar(e.tags.name),
    tipo: e.tags.highway ?? null,
    geom: JSON.stringify({ type: "LineString", coordinates: e.geometry.map((p) => [p.lon, p.lat]) }),
  }))
  .filter((t) => t.nombre_norm);

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });
const antes = (await sql`select count(*)::int as n from calles_osm`)[0].n;
for (let i = 0; i < tramos.length; i += 500) {
  const lote = tramos.slice(i, i + 500);
  await sql`
    insert into calles_osm (id, nombre, nombre_norm, tipo, geom)
    select x.id, x.nombre, x.nombre_norm, x.tipo, st_setsrid(st_geomfromgeojson(x.geom), 4326)
    from jsonb_to_recordset(${sql.json(lote)})
      as x(id bigint, nombre text, nombre_norm text, tipo text, geom text)
    on conflict (id) do update set
      nombre = excluded.nombre, nombre_norm = excluded.nombre_norm,
      tipo = excluded.tipo, geom = excluded.geom, cargado_en = now()
  `;
}
const despues = (await sql`select count(*)::int as n from calles_osm`)[0].n;
console.log(`Calles de OSM: ${tramos.length} tramos leídos · en la base: ${antes} → ${despues}`);
await sql.end();
