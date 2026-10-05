/**
 * PRUEBA DE ESCRITURA EN ATENCIÓN CIUDADANA, SIN DEJAR RASTRO.
 *
 *   pnpm --filter @cimba/integrations exec tsx src/cli/probar-cierre-ac.ts <id_reclamo> <id_usuario_ac>
 *
 * Ejecuta el cierre REAL —el UPDATE del movimiento abierto y el INSERT del de
 * finalización— dentro de una transacción, muestra cómo quedaría la cadena, y
 * hace ROLLBACK. Las tres tablas son InnoDB, así que el rollback es real y la
 * base queda exactamente como estaba.
 *
 * Existe porque un GRANT y un INSERT que entra no son lo mismo: el permiso
 * puede estar otorgado y fallar igual por un trigger, un campo NOT NULL sin
 * default o una foreign key. Esto lo responde sin arriesgar la base de otra
 * dirección.
 *
 * Al final verifica que el conteo de movimientos del reclamo sea idéntico al
 * de antes. Si no lo es, lo grita.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { conexionAcDesdeEntorno, planificarCierreAc } from "../fuentes/cierre-ac";

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
const idUsuarioAc = Number(process.argv[3]);
if (!Number.isInteger(idReclamo) || !Number.isInteger(idUsuarioAc)) {
  console.error("Uso: tsx src/cli/probar-cierre-ac.ts <id_reclamo> <id_usuario_ac>");
  process.exit(1);
}

const conf = conexionAcDesdeEntorno();
console.log(`conectando como "${conf.user}" a ${conf.database}@${conf.host}\n`);

const plan = await planificarCierreAc(
  {
    idReclamo,
    idUsuarioAc,
    desenlace: "reparado",
    detalle:
      "PRUEBA TÉCNICA DE INTEGRACIÓN CIMBA — esta transacción se deshace, no debería quedar registrada.",
  },
  conf,
);

console.log(`reclamo ${idReclamo}`);
console.log(`  último movimiento: ${plan.ultimoMovimiento?.id_movi} (estado ${plan.ultimoMovimiento?.id_estado})`);
console.log(`  derivación a Obras Viales: ${plan.idDerivacion} · estado a escribir: ${plan.idEstado}`);
if (plan.impedimentos.length > 0) {
  console.error("\nimpedimentos, no se prueba nada:", plan.impedimentos);
  process.exit(1);
}

const { default: mysql } = await import("mysql2/promise");
const cx = await mysql.createConnection({ ...conf, connectTimeout: 20_000 });

const contar = async () => {
  const [r] = await cx.query(`select count(*) n from mov_reclamo where id_reclamo = ?`, [idReclamo]);
  return Number((r as unknown as Array<{ n: number }>)[0]!.n);
};

const antes = await contar();
console.log(`\nmovimientos antes: ${antes}`);

let ok = false;
await cx.beginTransaction();
try {
  const cerrar = plan.sentencias[0]!;
  const [u] = await cx.execute(cerrar.sql, cerrar.parametros);
  console.log(`  UPDATE → filas afectadas: ${(u as unknown as { affectedRows: number }).affectedRows}`);

  const alta = plan.sentencias[1]!;
  const [i] = await cx.execute(alta.sql, alta.parametros);
  console.log(`  INSERT → id_movi nuevo: ${(i as unknown as { insertId: number }).insertId}`);

  const [cadena] = await cx.query(
    `select m.id_movi, e.nombre_estado, mo.nombre_motivo, m.id_derivacion, m.id_oficina,
            m.reparti_graba, m.usuario_ingreso, m.usuario_egreso, m.fecha_egreso,
            left(m.detalle_movi, 40) detalle
       from mov_reclamo m
       left join estado_reclamo e on e.id_estado = m.id_estado
       left join motivo mo on mo.id_motivo = m.id_motivo
      where m.id_reclamo = ? order by m.id_movi desc limit 3`,
    [idReclamo],
  );
  console.log("\ncómo quedaría la cadena (últimos movimientos):");
  console.table(cadena);
  ok = true;
} catch (e) {
  console.error("\nLA ESCRITURA FALLÓ:", e instanceof Error ? e.message : e);
} finally {
  await cx.rollback();
  console.log("\nROLLBACK ejecutado.");
}

const despues = await contar();
console.log(`movimientos después: ${despues} ${despues === antes ? "— la base quedó intacta" : "— ¡QUEDÓ ALGO ESCRITO!"}`);
await cx.end();
process.exit(ok && despues === antes ? 0 : 1);
