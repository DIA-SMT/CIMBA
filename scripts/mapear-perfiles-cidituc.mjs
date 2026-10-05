/**
 * MAPEO DE PERFILES DE CIMBA A SU id_persona REAL DE CIDITUC.
 *
 *   node scripts/mapear-perfiles-cidituc.mjs            → ensayo, no toca nada
 *   node scripts/mapear-perfiles-cidituc.mjs --ejecutar → aplica el cambio
 *
 * ── POR QUÉ ESTO ES PRECONDICIÓN DEL SSO, Y NO UN ADORNO ────────────────────
 *
 * `upsertPerfil` busca por `id_persona` y su ON CONFLICT no toca `rol`. O sea:
 * si el perfil YA existe con el id_persona real, entrar por Ciudad Digital
 * conserva el rol que la persona tiene en CIMBA. Si NO existe, crea uno nuevo
 * con el rol inicial — y `derivarRolInicial` da 'lectura' a todo el que no sea
 * id_tusuario == 1.
 *
 * Medido contra el padrón el 02/10: de las ocho personas de CIMBA, NINGUNA es
 * id_tusuario 1. Son 38 (ADMINISTRADOR CORTES), 44 (EMPLEADO ATENCIÓN
 * CIUDADANA), 4 (EMPLEADO GENERAL) y hasta 3 (CIUDADANO). Encender el SSO sin
 * mapear primero significa que Alejandro, Marco y Leonardo —administradores de
 * CIMBA— entran como lectura y con un perfil duplicado.
 *
 * Los id_persona inventados (920000+) no tienen ninguna FK colgando: lo que
 * referencia a un perfil es `perfiles.id` (uuid), no este número. El cambio es
 * un UPDATE de una columna con restricción UNIQUE.
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

/**
 * Los pares verificados el 02/10 cruzando `perfiles` contra
 * ciudadano_digital.persona. Van a mano y no se re-derivan en cada corrida: un
 * emparejamiento por nombre que hoy da bien puede dar otra cosa mañana si
 * alguien se carga en el padrón, y esto escribe sobre identidades.
 *
 * `evidencia` dice por qué creemos que son la misma persona. Los dos que dicen
 * "nombre" son los más débiles — ahí no hubo email que confirmara.
 */
const PARES = [
  { cimba: 920004, cidituc: 14771,  perfil: "Alejandro Vera Antonelli", padron: "VERA ANTONELLI, DARIO ALEJANDRO", evidencia: "email" },
  { cimba: 920006, cidituc: 100673, perfil: "Rafael Carrizo Mure",      padron: "CARRIZO MURE, RAFAEL",            evidencia: "email" },
  { cimba: 920007, cidituc: 106027, perfil: "Elias Gustavo Maza",       padron: "MAZA, ELIAS",                     evidencia: "email" },
  { cimba: 920008, cidituc: 44264,  perfil: "Edgardo Reverso",          padron: "REVERSO, EDGARDO HECTOR",         evidencia: "email" },
  { cimba: 920009, cidituc: 157201, perfil: "Bruno Rossi Kaese",        padron: "ROSSI, BRUNO",                    evidencia: "email" },
  { cimba: 920010, cidituc: 4015,   perfil: "Humberto Ponce de Leon",   padron: "PONCE DE LEÓN, HUMBERTO",         evidencia: "email" },
  { cimba: 920005, cidituc: 72995,  perfil: "Leonardo Míguez",          padron: "MIGUEZ, LEONARDO",                evidencia: "nombre — CONFIRMAR" },
  { cimba: 920011, cidituc: 70167,  perfil: "Marco Rossi",              padron: "ROSSI, MARCO",                    evidencia: "nombre — CONFIRMAR" },
];

const EJECUTAR = process.argv.includes("--ejecutar");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

try {
  const actuales = await sql`
    select id_persona, nombre, usuario, email, rol::text rol, activo
    from perfiles where id_persona = any(${PARES.map((p) => p.cimba)})`;
  const porId = new Map(actuales.map((p) => [Number(p.id_persona), p]));

  // Que ninguno de los id_persona destino esté ya tomado: la columna es UNIQUE
  // y un choque abortaría a mitad de camino.
  const ocupados = await sql`
    select id_persona, nombre from perfiles where id_persona = any(${PARES.map((p) => p.cidituc)})`;

  const plan = PARES.map((p) => ({
    perfil: p.perfil,
    rol: porId.get(p.cimba)?.rol ?? "(no existe en CIMBA)",
    de: p.cimba,
    a: p.cidituc,
    padron: p.padron,
    evidencia: p.evidencia,
    estado: !porId.has(p.cimba)
      ? "NO EXISTE — se saltea"
      : ocupados.some((o) => Number(o.id_persona) === p.cidituc)
        ? "DESTINO OCUPADO — se saltea"
        : "listo",
  }));
  console.table(plan);

  const aplicables = PARES.filter((p, i) => plan[i].estado === "listo");
  console.log(`\naplicables: ${aplicables.length} de ${PARES.length}`);

  if (!EJECUTAR) {
    console.log("\n(ENSAYO — no se modificó nada. Correr con --ejecutar.)");
  } else {
    await sql.begin(async (tx) => {
      for (const p of aplicables) {
        await tx`update perfiles set id_persona = ${p.cidituc} where id_persona = ${p.cimba}`;
      }
    });
    console.log(`\n✔ ${aplicables.length} perfiles remapeados.`);
    console.table(await sql`
      select id_persona, nombre, rol::text rol from perfiles
      where id_persona = any(${aplicables.map((p) => p.cidituc)}) order by nombre`);
  }
} finally {
  await sql.end();
}
