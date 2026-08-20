/**
 * Aplica migraciones y seed contra DATABASE_URL (Supabase Cloud o cualquier
 * Postgres con PostGIS). Sin Docker ni CLI de Supabase.
 *
 *   node scripts/db.mjs migrar   → corre supabase/migrations/*.sql en orden
 *   node scripts/db.mjs seed     → corre supabase/seed.sql
 *   node scripts/db.mjs estado   → tablas y conteos rápidos
 *
 * Idempotencia: registra cada migración aplicada en cimba_migraciones.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

// carga .env simple si existe (sin dependencia extra) — ANTES de leer variables
const envPath = path.join(import.meta.dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const linea of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL (definila en .env de la raíz o en el entorno)");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

const comando = process.argv[2] ?? "migrar";

try {
  if (comando === "migrar") {
    await sql`create table if not exists cimba_migraciones (
      nombre text primary key, aplicada_en timestamptz not null default now()
    )`;
    const dir = path.join(import.meta.dirname, "..", "supabase", "migrations");
    const archivos = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const archivo of archivos) {
      const ya = await sql`select 1 from cimba_migraciones where nombre = ${archivo}`;
      if (ya.length > 0) {
        console.log(`↷ ${archivo} (ya aplicada)`);
        continue;
      }
      const cuerpo = fs.readFileSync(path.join(dir, archivo), "utf8");
      console.log(`▶ aplicando ${archivo}…`);
      await sql.unsafe(cuerpo);
      await sql`insert into cimba_migraciones (nombre) values (${archivo})`;
      console.log(`✔ ${archivo}`);
    }
  } else if (comando === "seed") {
    const cuerpo = fs.readFileSync(path.join(import.meta.dirname, "..", "supabase", "seed.sql"), "utf8");
    await sql.unsafe(cuerpo);
    console.log("✔ seed aplicado");
    // Bucket de fotos vía Storage API (insertar en storage.buckets por SQL no
    // está permitido para el rol postgres en Supabase Cloud).
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (base && service) {
      const res = await fetch(`${base}/storage/v1/bucket`, {
        method: "POST",
        headers: { authorization: `Bearer ${service}`, "content-type": "application/json" },
        body: JSON.stringify({ id: "fotografias", name: "fotografias", public: true }),
      });
      if (res.ok) console.log("✔ bucket fotografias creado");
      else {
        const detalle = await res.json().catch(() => ({}));
        if (String(detalle.error ?? detalle.message ?? "").toLowerCase().includes("already")) {
          console.log("↷ bucket fotografias ya existía");
        } else {
          console.warn("⚠ no se pudo crear el bucket fotografias:", res.status, JSON.stringify(detalle).slice(0, 200));
        }
      }
    } else {
      console.warn("⚠ sin NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: bucket no creado");
    }
  } else if (comando === "estado") {
    const filas = await sql`
      select 'demandas' t, count(*) n from demandas
      union all select 'incidentes', count(*) from incidentes
      union all select 'intervenciones', count(*) from intervenciones
      union all select 'perfiles', count(*) from perfiles
      union all select 'cuadrillas', count(*) from cuadrillas
      union all select 'sync_runs', count(*) from sync_runs
      order by 1`;
    for (const f of filas) console.log(`${f.t.padEnd(16)} ${f.n}`);
  } else {
    console.error(`comando desconocido: ${comando}`);
    process.exit(1);
  }
} finally {
  await sql.end();
}
