/**
 * CERRAR UN RECLAMO EN ATENCIÓN CIUDADANA, DE A UNO Y A MANO.
 *
 *   pnpm --filter @cimba/integrations exec tsx src/cli/cerrar-uno-ac.ts <id_reclamo> [--ejecutar]
 *
 * Usa el MISMO camino que la aplicación —cerrarReclamoAc— y no curl: así lo
 * que se prueba es la integración y no una llamada parecida. Sin --ejecutar
 * respeta CIMBA_AC_CIERRE del entorno; con --ejecutar fuerza el modo real.
 *
 * Muestra la cadena de movimientos antes y después, leída directo de la base
 * de AC. Eso solo funciona desde adentro de la red municipal, y es a propósito:
 * esta herramienta es para acompañar los primeros cierres mirando el resultado,
 * no para operar a diario.
 *
 * El texto de la respuesta sale de CIMBA, de lo que escribió quien cerró la
 * demanda. No se inventa acá: lo que lee el vecino lo redactó una persona.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { getDb, sql } from "@cimba/db";
import { cerrarReclamoAc } from "../fuentes/cierre-ac";

const envPath = path.join(import.meta.dirname, "..", "..", "..", "..", ".env");
if (fs.existsSync(envPath)) {
  for (const linea of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
    if (m?.[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
    }
  }
}

const idReclamo = Number(process.argv[2]);
const EJECUTAR = process.argv.includes("--ejecutar");
if (!Number.isInteger(idReclamo)) {
  console.error("Uso: tsx src/cli/cerrar-uno-ac.ts <id_reclamo> [--ejecutar]");
  process.exit(1);
}
if (EJECUTAR) process.env.CIMBA_AC_CIERRE = "real";

const db = getDb();

// La respuesta que escribió quien cerró la demanda en CIMBA.
const filas = (await db.execute(sql`
  select d.id as demanda_id,
         d.metadata->'cierre'->>'respuesta' as respuesta,
         d.metadata->'cierre'->>'por' as cerro
  from demandas d
  join external_ref er on er.entidad_local = 'demanda' and er.id_local = d.id
                      and er.sistema = 'atencion_ciudadana'
  where er.id_remoto = ${String(idReclamo)}
`)) as unknown as Array<{ demanda_id: string; respuesta: string | null; cerro: string | null }>;
const demanda = filas[0];
if (!demanda?.respuesta) {
  console.error(`El reclamo ${idReclamo} no tiene una respuesta escrita en CIMBA. No se inventa el texto.`);
  process.exit(1);
}
console.log(`demanda ${demanda.demanda_id} · la respuesta la escribió ${demanda.cerro}`);
console.log(`texto: "${demanda.respuesta}"\n`);

const { default: mysql } = await import("mysql2/promise");
const cx = await mysql.createConnection({
  host: process.env.MYSQL_BACHEO_HOST,
  port: Number(process.env.MYSQL_BACHEO_PORT ?? 3306),
  user: process.env.MYSQL_AC_USER ?? process.env.MYSQL_BACHEO_USER,
  password: process.env.MYSQL_AC_PASSWORD ?? process.env.MYSQL_BACHEO_PASSWORD,
  connectTimeout: 20_000,
  database: "smt_atencion_ciudadana",
});
const cadena = async (titulo: string) => {
  const [r] = await cx.query(
    `select m.id_movi, e.nombre_estado, mo.nombre_motivo, m.id_derivacion, m.id_oficina,
            m.reparti_graba, m.usuario_egreso, left(m.detalle_movi, 44) detalle
       from mov_reclamo m
       left join estado_reclamo e on e.id_estado = m.id_estado
       left join motivo mo on mo.id_motivo = m.id_motivo
      where m.id_reclamo = ? order by m.id_movi`,
    [idReclamo],
  );
  console.log(`\n── ${titulo} ──`);
  console.table(r);
};

await cadena("antes");

const r = await cerrarReclamoAc({
  idReclamo,
  idUsuarioAc: Number(process.env.CIMBA_AC_USUARIO ?? 0),
  detalle: demanda.respuesta,
  desenlace: "reparado",
});

console.log(`\nmodo: ${r.modo} · HTTP ${r.estadoHttp ?? "—"} · aplicado: ${r.aplicado}`);
console.log(`respuesta de AC: ${r.mensaje ?? r.error ?? "(nada)"}`);
if (r.idMovimientoCierre) console.log(`movimiento de cierre creado: ${r.idMovimientoCierre}`);

if (r.aplicado) {
  await cadena("después");
  // Queda el rastro en la demanda, igual que lo deja la acción de la app.
  await db.execute(sql`
    update demandas set metadata = metadata || jsonb_build_object(
      'cierre_ac', jsonb_build_object(
        'id_reclamo', ${idReclamo}::int,
        'id_movimiento', ${r.idMovimientoCierre}::int,
        'modo', 'real'::text,
        'en', now()::text
      )
    ) where id = ${Number(demanda.demanda_id)}
  `);
  console.log("\nrastro guardado en la demanda de CIMBA.");
}

await cx.end();
process.exit(r.aplicado || r.modo === "simulado" ? 0 : 1);
