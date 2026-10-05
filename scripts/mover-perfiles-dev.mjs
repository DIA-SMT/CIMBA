/**
 * SACAR LOS PERFILES DEL ACCESO BETA DE ENCIMA DE PERSONAS REALES.
 *
 *   node scripts/mover-perfiles-dev.mjs            → ensayo, no toca nada
 *   node scripts/mover-perfiles-dev.mjs --ejecutar → aplica el cambio
 *
 * Los perfiles del selector de rol (DEV_FAKE_SSO) se crearon con
 * `90000 + índice`. El padrón de CIDITUC va de 1 a 177.193, así que esos diez
 * números son DIEZ PERSONAS REALES. upsertPerfil busca por id_persona: con el
 * SSO andando, si alguna de ellas entra por Ciudad Digital cae sobre el perfil
 * ficticio que ya existe y hereda su rol. El 90000 es "Dev admin".
 *
 * El código ya genera los nuevos en 990000+ (ver api/auth/dev/route.ts), pero
 * eso no mueve los que están. Esto los mueve, respetando el mismo orden de
 * roles para que cada uno conserve su identidad.
 *
 * Es un UPDATE de id_persona. Nada cuelga de esa columna: lo que referencia a
 * un perfil es `perfiles.id` (uuid).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const envPath = path.join(import.meta.dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const linea of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const VIEJO_DESDE = 90000;
const VIEJO_HASTA = 90009;
const NUEVA_BASE = 990000;

const EJECUTAR = process.argv.includes("--ejecutar");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

try {
  const actuales = await sql`
    select id_persona, nombre, rol::text rol, activo, ultimo_ingreso
    from perfiles where id_persona between ${VIEJO_DESDE} and ${VIEJO_HASTA}
    order by id_persona`;

  if (actuales.length === 0) {
    console.log("No queda ningún perfil en 90000..90009. Nada que hacer.");
    process.exit(0);
  }

  const destino = (id) => NUEVA_BASE + (Number(id) - VIEJO_DESDE);
  const ocupados = await sql`
    select id_persona from perfiles where id_persona = any(${actuales.map((p) => destino(p.id_persona))})`;
  const tomados = new Set(ocupados.map((o) => Number(o.id_persona)));

  const plan = actuales.map((p) => ({
    perfil: p.nombre,
    rol: p.rol,
    de: Number(p.id_persona),
    a: destino(p.id_persona),
    estado: tomados.has(destino(p.id_persona)) ? "DESTINO OCUPADO — se saltea" : "listo",
  }));
  console.table(plan);

  const aplicables = plan.filter((p) => p.estado === "listo");
  console.log(`\naplicables: ${aplicables.length} de ${plan.length}`);

  if (!EJECUTAR) {
    console.log("\n(ENSAYO — no se modificó nada. Correr con --ejecutar.)");
  } else {
    await sql.begin(async (tx) => {
      for (const p of aplicables) {
        await tx`update perfiles set id_persona = ${p.a} where id_persona = ${p.de}`;
      }
    });
    console.log(`\n✔ ${aplicables.length} perfiles movidos.`);
    const quedan = await sql`
      select count(*)::int n from perfiles where id_persona between ${VIEJO_DESDE} and ${VIEJO_HASTA}`;
    console.log(`perfiles que siguen sobre ids del padrón: ${quedan[0].n}`);
    console.table(await sql`
      select id_persona, nombre, rol::text rol from perfiles
      where id_persona >= ${NUEVA_BASE} order by id_persona`);
  }
} finally {
  await sql.end();
}
