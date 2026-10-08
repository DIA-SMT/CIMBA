/**
 * SINCRONIZAR LOS CIERRES QUE HIZO ATENCIÓN CIUDADANA.
 *
 *   pnpm --filter @cimba/integrations exec tsx src/cli/sincronizar-estados-ac.ts           → ensayo
 *   pnpm --filter @cimba/integrations exec tsx src/cli/sincronizar-estados-ac.ts --ejecutar
 *
 * Recorre las demandas de Atención Ciudadana que CIMBA tiene abiertas, le
 * pregunta a la API por el estado real de cada una, y cierra de NUESTRO lado
 * las que allá ya están finalizadas.
 *
 * Solo lee de AC. Lo único que escribe es `demandas` en la base de CIMBA, y
 * deja asentado en la metadata que el cierre vino de ellos y en qué
 * movimiento: así se distingue de un cierre hecho por nosotros, y se puede
 * volver atrás sabiendo cuáles fueron.
 *
 * No toca el incidente a propósito: que el vecino deje de preguntar no
 * significa que el pozo esté tapado.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { getDb, sql } from "@cimba/db";
import { sincronizarEstadosAc, type EstadoAc } from "../fuentes/estado-ac";

const envPath = path.join(import.meta.dirname, "..", "..", "..", "..", ".env");
if (fs.existsSync(envPath)) {
  for (const linea of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
    if (m?.[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
    }
  }
}

const EJECUTAR = process.argv.includes("--ejecutar");
const db = getDb();

const abiertas = (await db.execute(sql`
  select er.id_remoto::bigint as id_reclamo, d.id as demanda_id
  from demandas d
  join external_ref er on er.entidad_local = 'demanda' and er.id_local = d.id
                      and er.sistema = 'atencion_ciudadana'
  where d.estado in ('recibida','en_validacion','vinculada')
    and er.id_remoto ~ '^[0-9]+$'
  order by er.id_remoto::bigint desc
`)) as unknown as Array<{ id_reclamo: string; demanda_id: string }>;

const porReclamo = new Map(abiertas.map((a) => [Number(a.id_reclamo), Number(a.demanda_id)]));
console.log(`demandas de Atención Ciudadana abiertas en CIMBA: ${abiertas.length}`);
console.log(EJECUTAR ? "modo: EJECUTAR\n" : "modo: ENSAYO (no se escribe nada)\n");

const cerrados: Array<{ reclamo: number; demanda: number; estado: string; movimiento: number | null }> = [];

const resumen = await sincronizarEstadosAc(
  [...porReclamo.keys()],
  async (estado: EstadoAc) => {
    const demandaId = porReclamo.get(estado.idReclamo);
    if (demandaId == null) return;
    cerrados.push({
      reclamo: estado.idReclamo,
      demanda: demandaId,
      estado: estado.nombreEstado ?? String(estado.idEstado),
      movimiento: estado.idMovimiento,
    });
    if (!EJECUTAR) return;
    await db.execute(sql`
      update demandas set estado = 'cerrada',
        metadata = metadata || jsonb_build_object(
          'cierre', jsonb_build_object(
            'en', now()::text,
            'por', 'Atención Ciudadana'::text,
            'origen', 'sincronizacion'::text,
            'id_estado_ac', ${estado.idEstado}::int,
            'estado_ac', ${estado.nombreEstado}::text,
            'id_movimiento_ac', ${estado.idMovimiento}::int
          )
        )
      where id = ${demandaId} and estado in ('recibida','en_validacion','vinculada')
    `);
  },
);

console.log("\n── resumen ──");
console.table([resumen]);
if (cerrados.length > 0) {
  console.log(`\n${EJECUTAR ? "cerradas" : "se cerrarían"} (primeras 15):`);
  console.table(cerrados.slice(0, 15));
}
if (resumen.errores.length > 0) {
  console.log("\nerrores (primeros 5):");
  console.table(resumen.errores.slice(0, 5));
}
if (!EJECUTAR) console.log("\n(ENSAYO — no se modificó nada. Correr con --ejecutar.)");
process.exit(0);
