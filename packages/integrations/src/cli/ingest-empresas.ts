/**
 * Sincroniza los baches que cargan las empresas contratistas desde la app de
 * Google Apps Script de la Dirección de Bacheo.
 *
 *   pnpm ingest:empresas          → sincroniza
 *   pnpm ingest:empresas --dry    → muestra qué haría, sin escribir nada
 *
 * Idempotente: se puede correr cuantas veces se quiera. El pipeline deduplica
 * por id_remoto, así que las filas ya cargadas cuentan como "sin cambios".
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  mapearLoteEmpresas,
  SISTEMA_EMPRESAS,
  traerPuntosGas,
} from "../fuentes/bacheo-empresas";
import {
  guardarFotosExternas,
  ingestarDemandas,
  ingestarIntervenciones,
  registrarSyncRun,
} from "../pipeline";

/**
 * Carga el .env de la raíz. El archivo tiene BOM, así que `source .env` desde
 * bash falla: se parsea acá igual que en scripts/db.mjs.
 */
function cargarEnv() {
  const ruta = path.join(process.cwd(), "..", "..", ".env");
  const alterna = path.join(process.cwd(), ".env");
  const archivo = fs.existsSync(ruta) ? ruta : fs.existsSync(alterna) ? alterna : null;
  if (!archivo) return;
  for (const linea of fs.readFileSync(archivo, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
    if (m?.[1] && !process.env[m[1]]) {
      process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
    }
  }
}
cargarEnv();

const DEPLOY_CARGA =
  process.env.CIMBA_GAS_BACHEO_DEPLOY ??
  "AKfycbyg4YeRe884Lvah-1SDBCBggTvvHBcsdONzTshppQJSCpEz8V8CY6l5trnrkTn5q_uC";

async function main() {
  const seco = process.argv.includes("--dry");

  console.log("Leyendo la planilla de bacheo…");
  const crudos = await traerPuntosGas(DEPLOY_CARGA);
  const lote = mapearLoteEmpresas(crudos);

  const porEmpresa = new Map<string, number>();
  for (const d of [...lote.intervenciones, ...lote.demandas]) {
    const e = String((d.metadata as { empresa?: unknown }).empresa ?? "sin empresa");
    porEmpresa.set(e, (porEmpresa.get(e) ?? 0) + 1);
  }
  const terminadas = lote.intervenciones.filter((i) => i.estado === "finalizada").length;

  console.log(`\nLa planilla tiene ${crudos.length} filas:`);
  console.log(`  ${lote.intervenciones.length} trabajos  (${terminadas} terminados, ${lote.intervenciones.length - terminadas} en curso)`);
  console.log(`  ${lote.demandas.length} detecciones sin obra → entran como pedidos`);
  console.log(`  ${lote.fotos.length} fotos`);
  if (lote.descartados.length > 0) {
    console.log(`  ${lote.descartados.length} descartadas: ${lote.descartados.slice(0, 3).map((d) => `${d.id} (${d.motivo})`).join(", ")}`);
  }
  if (lote.sospechosos.length > 0) {
    const suma = lote.sospechosos.reduce((a, s) => a + s.m2, 0);
    console.log(
      `\n  A REVISAR: ${lote.sospechosos.length} superficies no creíbles, ${Math.round(suma)} m² en total.`,
    );
    console.log("  Se cargaron sin superficie para no inflar la obra ejecutada:");
    for (const s of lote.sospechosos) {
      console.log(`    ${String(Math.round(s.m2)).padStart(5)} m²  ${s.direccion.slice(0, 42)}`);
    }
  }
  console.log("  por empresa:");
  for (const [e, n] of [...porEmpresa].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(5)}  ${e}`);
  }

  if (seco) {
    console.log("\n--dry: no se escribió nada.");
    process.exit(0);
  }

  console.log("\nIngestando…");
  const ri = await ingestarIntervenciones(SISTEMA_EMPRESAS, lote.intervenciones);
  console.log(
    `  trabajos    → nuevos ${ri.insertados} | actualizados ${ri.actualizados} | sin cambios ${ri.sinCambios} | errores ${ri.errores.length}`,
  );
  if (ri.errores.length > 0) console.log(`    primer error: ${ri.errores[0]?.error}`);

  const rd = await ingestarDemandas(SISTEMA_EMPRESAS, lote.demandas);
  console.log(
    `  detecciones → nuevas ${rd.insertados} | actualizadas ${rd.actualizados} | sin cambios ${rd.sinCambios} | errores ${rd.errores.length}`,
  );
  if (rd.errores.length > 0) console.log(`    primer error: ${rd.errores[0]?.error}`);

  // Las fotos van después: necesitan que la intervención ya exista para colgarse.
  const rf = await guardarFotosExternas(SISTEMA_EMPRESAS, lote.fotos);
  console.log(
    `  fotos       → nuevas ${rf.insertadas} | ya estaban ${rf.yaEstaban} | sin intervención ${rf.sinIntervencion}`,
  );

  await registrarSyncRun(
    {
      sistema: SISTEMA_EMPRESAS,
      leidos: ri.leidos + rd.leidos,
      insertados: ri.insertados + rd.insertados,
      actualizados: ri.actualizados + rd.actualizados,
      sinCambios: ri.sinCambios + rd.sinCambios,
      errores: [...ri.errores, ...rd.errores],
    },
    null,
    { filas: crudos.length, fotosNuevas: rf.insertadas, descartadas: lote.descartados.length },
  );

  console.log("\nListo.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
