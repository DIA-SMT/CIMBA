/** Corre una pasada del adaptador mock (equivale a una ejecución del cron). */
import process from "node:process";
import { crearAdaptadorMock } from "../fuentes/mock";
import { ingestarDemandas, registrarSyncRun } from "../pipeline";

async function main() {
  const adaptador = crearAdaptadorMock({ cantidad: 10 });
  const desde = new Date(Date.now() - 7 * 86_400_000);
  const demandas = await adaptador.traerDemandas(desde);
  const r = await ingestarDemandas(adaptador.sistema, demandas);
  await registrarSyncRun(r, desde);
  console.log(
    `mock → leídos ${r.leidos} | nuevos ${r.insertados} | actualizados ${r.actualizados} | sin cambios ${r.sinCambios} | errores ${r.errores.length}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
