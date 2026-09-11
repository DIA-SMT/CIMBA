/**
 * UN USUARIO POR EMPRESA CONTRATISTA.
 *
 *   node scripts/crear-usuarios-empresas.mjs
 *   node scripts/crear-usuarios-empresas.mjs --clave OtraClave123
 *
 * Crea (o actualiza) un perfil con rol `empresa` por cada empresa activa:
 *
 *   usuario   <slug>@cimba.com     calleri@cimba.com, ingeco@cimba.com, …
 *   clave     123456               la inicial, por defecto
 *   temporal  sí                   el middleware lo encierra en /clave hasta
 *                                  que la cambie
 *
 * Es idempotente: si el usuario ya existe se le repone la clave inicial y se
 * le vuelve a marcar el cambio obligatorio, que es exactamente lo que se
 * necesita cuando una empresa pierde la clave.
 *
 * OJO — NO le toca la clave a quien YA la cambió, salvo que se pase --resetear.
 * Repartir una tanda de altas no puede sacarle el acceso a la empresa que ya
 * está trabajando.
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
const clave = args.includes("--clave") ? args[args.indexOf("--clave") + 1] : "123456";
const resetear = args.includes("--resetear");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/**
 * El id_persona de un perfil es la clave con la que upsertPerfil evita
 * duplicados. Las empresas usan su propio rango para no chocar con los
 * usuarios del personal (920000-929999) ni con el rango que ya usa el login
 * por slug (910000 + id): 930000 + id.
 */
const BASE_ID_PERSONA = 930_000;

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  const empresas = await sql`select id, nombre, slug from empresas where activa order by nombre`;
  const hecho = [];

  for (const e of empresas) {
    const usuario = `${e.slug}@cimba.com`;
    const idPersona = BASE_ID_PERSONA + Number(e.id);

    const previo = await sql`
      select id, clave_temporal from perfiles where usuario = ${usuario}
    `;
    const yaCambio = previo[0] && previo[0].clave_temporal === false;
    if (yaCambio && !resetear) {
      hecho.push({ empresa: e.nombre, usuario, estado: "ya tiene clave propia (intacta)" });
      continue;
    }

    await sql`
      insert into perfiles (id_persona, nombre, rol, usuario, clave_hash, clave_temporal, activo, empresa_id)
      values (${idPersona}, ${e.nombre}, 'empresa', ${usuario}, ${sha256(clave)}, true, true, ${e.id})
      on conflict (id_persona) do update set
        nombre = excluded.nombre,
        rol = 'empresa',
        usuario = excluded.usuario,
        clave_hash = excluded.clave_hash,
        clave_temporal = true,
        activo = true,
        empresa_id = excluded.empresa_id
    `;
    hecho.push({
      empresa: e.nombre,
      usuario,
      estado: previo[0] ? "clave repuesta" : "creado",
    });
  }

  console.table(hecho);
  console.log(
    `\nClave inicial para los ${hecho.filter((h) => h.estado !== "ya tiene clave propia (intacta)").length}: ${clave}` +
      "\nTodos entran por /acceso y el sistema los obliga a cambiarla antes de trabajar.",
  );
} finally {
  await sql.end();
}
