/**
 * Ingesta de los archivos reales entregados por la Dirección de Bacheo.
 *
 *   pnpm ingest:archivos -- "C:\ruta\a\Datos Bacheo Leo 20-08"
 *
 * Busca los archivos por patrón dentro de la carpeta (tolera renombres) y
 * corre el pipeline completo: normalizar → validar → staging → promover.
 * Es idempotente: re-ejecutar no duplica.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parsearAtencionAbiertos } from "../archivos/atencion-abiertos";
import { parsearBacheoJunioJulio, parsearBacheoMarzo, parsearBacheoMensual } from "../archivos/bacheo";
import { parsearConsolidado } from "../archivos/consolidado";
import { parsearObrasSigov } from "../archivos/obras-sigov";
import { parsearSat } from "../archivos/sat";
import { ingestarDemandas, ingestarIntervenciones, registrarSyncRun } from "../pipeline";

function buscar(carpeta: string, patron: RegExp): string | null {
  const encontrados: string[] = [];
  const recorrer = (dir: string) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const ruta = path.join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(ruta);
      else if (patron.test(entrada.name)) encontrados.push(ruta);
    }
  };
  recorrer(carpeta);
  return encontrados[0] ?? null;
}

async function main() {
  const carpeta = process.argv[2];
  if (!carpeta || !fs.existsSync(carpeta)) {
    console.error("Uso: pnpm ingest:archivos -- <carpeta con los archivos fuente>");
    process.exit(1);
  }

  const resumen: string[] = [];
  const correr = async (nombre: string, fn: () => Promise<{ leidos: number; insertados: number; actualizados: number; sinCambios: number; errores: unknown[] }>) => {
    try {
      const r = await fn();
      const linea = `${nombre}: leídos ${r.leidos} | nuevos ${r.insertados} | actualizados ${r.actualizados} | sin cambios ${r.sinCambios} | errores ${r.errores.length}`;
      console.log(`✔ ${linea}`);
      if (r.errores.length > 0) console.log("   primeros errores:", JSON.stringify(r.errores.slice(0, 3)));
      resumen.push(linea);
    } catch (e) {
      console.error(`✘ ${nombre}:`, e instanceof Error ? e.message : e);
    }
  };

  // ── Demandas ──
  const sat = buscar(carpeta, /reclamos_SAT_geocodificados\.csv$/i);
  if (sat)
    await correr("SAT (intimaciones)", async () => {
      const r = await ingestarDemandas("sat", parsearSat(sat));
      await registrarSyncRun(r, null);
      return r;
    });

  const consolidado = buscar(carpeta, /CONSOLIDADO.*POSGAR07\.gpkg$/i) ?? buscar(carpeta, /CONSOLIDADO.*\.gpkg$/i);
  if (consolidado)
    await correr("Consolidado HCD/DIE/DRR", async () => {
      const r = await ingestarDemandas("consolidado", await parsearConsolidado(consolidado));
      await registrarSyncRun(r, null);
      return r;
    });

  const abiertos = buscar(carpeta, /RECLAMOS ABIERTOS.*\.xlsx$/i);
  if (abiertos)
    await correr("Atención Ciudadana (abiertos)", async () => {
      const r = await ingestarDemandas("atencion_ciudadana", await parsearAtencionAbiertos(abiertos));
      await registrarSyncRun(r, null);
      return r;
    });

  // ── Intervenciones ejecutadas ──
  const marzo = buscar(carpeta, /BACHEO_MARZO.*\.csv$/i);
  if (marzo)
    await correr("Bacheo marzo", async () => {
      const r = await ingestarIntervenciones("bacheo_planillas", parsearBacheoMarzo(marzo));
      await registrarSyncRun(r, null);
      return r;
    });

  const abril = buscar(carpeta, /bacheo_abril.*geocodificado\.csv$/i);
  if (abril)
    await correr("Bacheo abril", async () => {
      const r = await ingestarIntervenciones("bacheo_planillas", parsearBacheoMensual(abril, "abril-2026"));
      await registrarSyncRun(r, null);
      return r;
    });

  const mayo = buscar(carpeta, /bacheo_mayo.*geocodificado\.csv$/i);
  if (mayo)
    await correr("Bacheo mayo", async () => {
      const r = await ingestarIntervenciones("bacheo_planillas", parsearBacheoMensual(mayo, "mayo-2026"));
      await registrarSyncRun(r, null);
      return r;
    });

  const junjul = buscar(carpeta, /BACHEO_JUNIO_JULIO.*\.csv$/i);
  if (junjul)
    await correr("Bacheo junio-julio", async () => {
      const r = await ingestarIntervenciones("bacheo_planillas", parsearBacheoJunioJulio(junjul));
      await registrarSyncRun(r, null);
      return r;
    });

  const obras = buscar(carpeta, /obras_SMT.*\.xlsx$/i);
  if (obras)
    await correr("Obras SIGOV", async () => {
      const r = await ingestarIntervenciones("sigov", await parsearObrasSigov(obras));
      await registrarSyncRun(r, null);
      return r;
    });

  console.log("\n══ Resumen ══");
  for (const l of resumen) console.log(" ", l);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
