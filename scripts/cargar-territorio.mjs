/**
 * Carga (o recarga) las capas territoriales pesadas a la base: la RED VIAL
 * (10.392 cuadras) y los SECTORES DE LICITACIÓN, leyendo los GeoJSON ya
 * convertidos de apps/web/public/data. Después reclasifica el destino de
 * TODAS las demandas (bacheo / sat / ingeniería) con la red recién cargada.
 *
 *   node scripts/cargar-territorio.mjs
 *
 * Idempotente: son tablas de referencia, se vacían y recargan enteras — cada
 * recarga va adentro de UNA transacción: si el script se corta a mitad
 * (Supabase remoto, cortes de red), la tabla NO puede quedar vacía o a medias,
 * porque el trigger de clasificación seguiría corriendo contra una red
 * mutilada y mandaría todo a "bacheo" sin que nadie lo note.
 * Respeta las correcciones manuales de destino (metadata.destino_corregido).
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const raiz = path.join(import.meta.dirname, "..");
for (const l of fs.readFileSync(path.join(raiz, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

const leer = (nombre) =>
  JSON.parse(fs.readFileSync(path.join(raiz, "apps", "web", "public", "data", nombre), "utf8")).features;

// ── Red vial ──────────────────────────────────────────────────────────────────
const red = leer("red-vial.json");
await sql.begin(async (tx) => {
  await tx.unsafe("delete from red_vial");
  const LOTE = 500;
  for (let i = 0; i < red.length; i += LOTE) {
    const trozo = red.slice(i, i + LOTE);
    const valores = trozo
      .map((f) => {
        const g = JSON.stringify(
          f.geometry.type === "MultiLineString"
            ? f.geometry
            : { type: "MultiLineString", coordinates: [f.geometry.coordinates] },
        ).replace(/'/g, "''");
        const t = (v) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);
        return `(${t(f.properties.capa)}, ${t(f.properties.intervencion)}, ${t(f.properties.direccion)}, ${t(f.properties.barrio)}, st_setsrid(st_geomfromgeojson('${g}'), 4326))`;
      })
      .join(",\n");
    await tx.unsafe(`insert into red_vial (capa, intervencion, direccion, barrio, geom) values ${valores}`);
    process.stdout.write(`\rred_vial: ${Math.min(i + LOTE, red.length)}/${red.length}`);
  }
});
console.log();

// ── Sectores de licitación ────────────────────────────────────────────────────
const sectores = leer("sectores-licitacion.json");
await sql.begin(async (tx) => {
  await tx.unsafe("delete from sectores_licitacion");
  for (const f of sectores) {
    const g = JSON.stringify(
      f.geometry.type === "MultiPolygon"
        ? f.geometry
        : { type: "MultiPolygon", coordinates: [f.geometry.coordinates] },
    ).replace(/'/g, "''");
    const p = f.properties;
    await tx.unsafe(`
      insert into sectores_licitacion (tipo, sector, empresa_id, empresa_asfalto_id, licitacion, metadata, geom)
      values (
        '${p.tipo}', '${String(p.sector).replace(/'/g, "''")}',
        (select id from empresas where slug = ${p.empresa ? `'${p.empresa}'` : "null"}),
        (select id from empresas where slug = ${p.empresaAsfalto ? `'${p.empresaAsfalto}'` : "null"}),
        ${p.licitacion ? `'${p.licitacion}'` : "null"},
        '${JSON.stringify({ panios: p.panios ?? undefined }).replace(/'/g, "''")}',
        st_multi(st_setsrid(st_geomfromgeojson('${g}'), 4326))
      )
    `);
  }
});
console.log(`sectores_licitacion: ${sectores.length} cargados`);

// ── Reclasificación de destino ────────────────────────────────────────────────
// Con la red cargada, TODAS las demandas se reclasifican (menos las corregidas
// a mano). El trigger cubre lo que entre de acá en adelante.
console.log("reclasificando destinos…");
await sql.unsafe(`
  update demandas set destino = clasificar_destino_demanda(tipo, descripcion, geom)
  where metadata->>'destino_corregido' is null
`);
const resumen = await sql.unsafe(`
  select destino::text, count(*)::int as n,
    count(*) filter (where estado in ('recibida','en_validacion'))::int as abiertas
  from demandas group by 1 order by 2 desc
`);
console.table(resumen);
await sql.end();
console.log("Listo.");
