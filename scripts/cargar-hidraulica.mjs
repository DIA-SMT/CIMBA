/**
 * Carga (o recarga) las capas hidráulicas a la base leyendo los GeoJSON que
 * dejó scripts/convertir-hidraulica.mjs: imbornales y zonas inundables.
 *
 *   node scripts/cargar-hidraulica.mjs
 *
 * Idempotente: son tablas de referencia, se vacían y recargan enteras dentro
 * de UNA transacción (mismo criterio que cargar-territorio.mjs: una tabla a
 * medias haría que el clasificador de destino mande a la SAT tapas que son
 * municipales, sin que nadie lo note).
 *
 * Al final reclasifica el destino de las demandas de tapa y sumidero, que es
 * justamente lo que los imbornales recién cargados permiten desambiguar.
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

const t = (v) => (v == null || v === "" ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v == null || !Number.isFinite(Number(v)) ? "null" : Number(v));
const b = (v) => (v == null ? "null" : v ? "true" : "false");
const punto = (f) => `st_setsrid(st_point(${f.geometry.coordinates[0]}, ${f.geometry.coordinates[1]}), 4326)`;

// ── Imbornales ───────────────────────────────────────────────────────────────
const imbornales = leer("imbornales.json");
await sql.begin(async (tx) => {
  await tx.unsafe("delete from imbornales");
  const LOTE = 400;
  for (let i = 0; i < imbornales.length; i += LOTE) {
    const valores = imbornales
      .slice(i, i + LOTE)
      .map((f) => {
        const p = f.properties;
        return `(${t(p.ident)}, ${t(p.clase)}, ${t(p.tipo)}, ${p.estado ? `'${p.estado}'::estado_imbornal` : "null"}, ${t(p.estadoTexto)}, ${t(p.direccion)}, ${t(p.barrio)}, ${t(p.colector)}, ${t(p.cuenca)}, ${b(p.depresion)}, ${n(p.tapas)}, ${t(p.observaciones)}, ${punto(f)})`;
      })
      .join(",\n");
    await tx.unsafe(`
      insert into imbornales (ident, clase, tipo, estado, estado_texto, direccion, barrio, colector, cuenca, depresion, tapas, observaciones, geom)
      values ${valores}
      on conflict do nothing
    `);
    process.stdout.write(`\rimbornales: ${Math.min(i + LOTE, imbornales.length)}/${imbornales.length}`);
  }
  // El distrito se deriva acá y no por trigger: es una carga masiva de
  // referencia, no el alta de un pedido de un vecino.
  await tx.unsafe(`
    update imbornales i set distrito_id = d.id
    from distritos d where i.distrito_id is null and st_contains(d.geom, i.geom)
  `);
  await tx.unsafe(`
    update imbornales i set circuito_id = c.id
    from circuitos c where i.circuito_id is null and st_contains(c.geom, i.geom)
  `);
});
console.log("");

// ── Zonas inundables ─────────────────────────────────────────────────────────
const zonas = leer("zonas-inundables.json");
await sql.begin(async (tx) => {
  await tx.unsafe("delete from zonas_inundables");
  const valores = zonas
    .map((f) => `(${t(f.properties.direccion)}, ${t(f.properties.observaciones)}, ${n(f.properties.tiranteM)}, ${punto(f)})`)
    .join(",\n");
  if (valores) {
    await tx.unsafe(`insert into zonas_inundables (direccion, observaciones, tirante_m, geom) values ${valores}`);
  }
  await tx.unsafe(`
    update zonas_inundables z set distrito_id = d.id
    from distritos d where z.distrito_id is null and st_contains(d.geom, z.geom)
  `);
});
console.log(`zonas_inundables: ${zonas.length}`);

// ── Reclasificación de destino ───────────────────────────────────────────────
// Solo tapas y sumideros: son los que cambian de dueño con esta carga. Se
// respetan las correcciones manuales (metadata.destino_corregido), igual que
// en cargar-territorio.mjs.
const antes = await sql`
  select destino::text, count(*)::int n from demandas
  where tipo in ('tapa_registro', 'sumidero') group by 1 order by 2 desc
`;
await sql.unsafe(`
  update demandas set destino = clasificar_destino_demanda(tipo, descripcion, geom)
  where tipo in ('tapa_registro', 'sumidero') and metadata->>'destino_corregido' is null
`);
const despues = await sql`
  select destino::text, count(*)::int n from demandas
  where tipo in ('tapa_registro', 'sumidero') group by 1 order by 2 desc
`;
console.log("tapas y sumideros — antes:", JSON.stringify(antes), "→ después:", JSON.stringify(despues));

const resumen = await sql`
  select estado::text, count(*)::int n from imbornales group by 1 order by 2 desc nulls last
`;
console.log("imbornales por estado:", JSON.stringify(resumen));

await sql.end();
