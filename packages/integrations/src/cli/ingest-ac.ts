/**
 * Catch-up del barrido de Atención Ciudadana, sin el límite de 60 s del cron.
 *
 * El cron diario avanza 200 ids por corrida; el histórico pendiente son unos
 * miles. Este CLI barre en tandas hasta llegar al final de la secuencia (o
 * hasta el tope que se le pase), reportando el avance.
 *
 *   pnpm ingest:ac              → barre hasta el final
 *   pnpm ingest:ac 1000         → barre como máximo 1000 ids
 */
import process from "node:process";
import { crearAdaptadorAtencionCiudadana } from "../fuentes/atencion-ciudadana";
import { cursorAtencionCiudadana, ingestarDemandas, registrarSyncRun } from "../pipeline";

const TANDA = 300;

async function main() {
  const baseUrl = process.env.CIMBA_API_ATENCION_CIUDADANA;
  if (!baseUrl) {
    console.error("Falta CIMBA_API_ATENCION_CIUDADANA en el entorno.");
    process.exit(1);
  }
  const topeIds = Number(process.argv[2]) || Infinity;
  const respaldo = Number(process.env.CIMBA_AC_DESDE_ID ?? 116000);

  let barridos = 0;
  let totales = { leidos: 0, insertados: 0, actualizados: 0, sinCambios: 0, errores: 0, descartados: 0 };

  for (;;) {
    const cursor = await cursorAtencionCiudadana(respaldo);
    const lote = Math.min(TANDA, topeIds - barridos);
    if (lote <= 0) break;

    const ac = crearAdaptadorAtencionCiudadana(baseUrl, { desdeId: cursor, lote, concurrencia: 8 });
    const demandas = await ac.traerDemandas(null);
    const r = await ingestarDemandas(ac.sistema, demandas);
    await registrarSyncRun(r, new Date(), { hastaId: ac.ultimoIdVisto, descartados: ac.descartados });

    barridos += ac.ultimoIdVisto - cursor;
    totales = {
      leidos: totales.leidos + r.leidos,
      insertados: totales.insertados + r.insertados,
      actualizados: totales.actualizados + r.actualizados,
      sinCambios: totales.sinCambios + r.sinCambios,
      errores: totales.errores + r.errores.length,
      descartados: totales.descartados + ac.descartados,
    };
    console.log(
      `ids ${cursor + 1}–${ac.ultimoIdVisto} → pavimento ${r.leidos} (nuevos ${r.insertados}) · ` +
        `otras categorías ${ac.descartados}` +
        (ac.fallos.length > 0 ? ` · FALLOS ${ac.fallos.length}: ${ac.fallos[0]?.error}` : ""),
    );

    /**
     * Fin de la secuencia. Mirar solo si el cursor avanzó NO sirve: pasado el
     * último id real, cada tanda corta a los 25 vacíos y avanza igual ~25 ids,
     * así que el barrido seguiría para siempre (llegó al id 180.000 antes de
     * que se detectara). El corte correcto es "en este tramo no existía ni un id".
     */
    if (ac.existentes === 0) {
      console.log("Ningún id existente en el tramo: fin de la secuencia.");
      break;
    }
  }

  console.log(
    `\nTOTAL → ids barridos ${barridos} | pavimento ${totales.leidos} | nuevos ${totales.insertados} | ` +
      `actualizados ${totales.actualizados} | otras categorías ${totales.descartados} | errores ${totales.errores}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
