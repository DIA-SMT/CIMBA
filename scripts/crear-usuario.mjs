/**
 * ALTA DE UN USUARIO DEL PERSONAL, desde la línea de comandos.
 *
 *   node scripts/crear-usuario.mjs leomiguez@cimba.com "Leonardo Míguez" admin
 *   node scripts/crear-usuario.mjs otro@cimba.com "Nombre" planificacion --clave 123456
 *
 * Existe para el arranque y para el día en que nadie pueda entrar: el alta
 * normal se hace desde Configuración, en la aplicación. Es idempotente — si el
 * usuario ya está, le repone la clave y le vuelve a exigir el cambio, que es
 * exactamente lo que hace falta cuando alguien la perdió.
 *
 * La clave nace TEMPORAL: el middleware encierra a quien entra con ella en
 * /clave hasta que la cambie, así la que se dictó por teléfono no queda viva.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import postgres from "postgres";

const RAIZ = path.join(import.meta.dirname, "..");
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

const args = process.argv.slice(2);
const [usuarioCrudo, nombre, rol] = args;
if (!usuarioCrudo || !nombre || !rol) {
  console.error('Uso: node scripts/crear-usuario.mjs <usuario> "<nombre>" <rol> [--clave X]');
  process.exit(1);
}
const usuario = usuarioCrudo.toLowerCase();
const clave = args.includes("--clave") ? args[args.indexOf("--clave") + 1] : "123456";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** Rango reservado para las altas locales del personal (ver acciones-usuarios). */
const BASE_ID_PERSONA = 920_000;

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  const roles = await sql`select unnest(enum_range(null::rol_usuario))::text as v`;
  if (!roles.some((r) => r.v === rol)) {
    console.error(`Rol inválido: ${rol}. Válidos: ${roles.map((r) => r.v).join(", ")}`);
    process.exit(1);
  }

  const [ya] = await sql`select id, nombre from perfiles where usuario = ${usuario}`;
  if (ya) {
    await sql`
      update perfiles set nombre = ${nombre}, rol = ${rol}::rol_usuario, activo = true,
             clave_hash = ${sha256(clave)}, clave_temporal = true, email = coalesce(email, ${usuario})
      where id = ${ya.id}
    `;
    console.log(`↻ ${usuario} ya existía: rol ${rol}, clave repuesta (temporal)`);
  } else {
    const [{ n }] = await sql`
      select coalesce(max(id_persona) + 1, ${BASE_ID_PERSONA}) as n from perfiles
      where id_persona >= ${BASE_ID_PERSONA} and id_persona < ${BASE_ID_PERSONA + 10000}
    `;
    await sql`
      insert into perfiles (id_persona, nombre, email, rol, usuario, clave_hash, clave_temporal, activo)
      values (${Number(n)}, ${nombre}, ${usuario}, ${rol}::rol_usuario, ${usuario}, ${sha256(clave)}, true, true)
    `;
    console.log(`✔ ${usuario} creado con rol ${rol} (id_persona ${n})`);
  }
  console.log(`   clave inicial: ${clave} — la va a tener que cambiar al entrar`);
} finally {
  await sql.end();
}
