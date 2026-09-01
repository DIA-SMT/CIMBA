/**
 * Sincroniza SIGOV Obras Viales leyendo el MySQL de la Dirección.
 *
 *   pnpm ingest:sigov          → sincroniza
 *   pnpm ingest:sigov --dry    → muestra qué haría, sin escribir nada
 *
 * Necesita estar adentro de la red municipal (172.16.8.214 es IP privada).
 * En producción esto lo corre el enlace, no esta línea de comandos.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { mapearLoteSigov, traerSigov } from "../fuentes/sigov-mysql";
import { sincronizarSigov } from "../fuentes/sincronizar-sigov";

function cargarEnv() {
  const candidatos = [
    path.join(process.cwd(), "..", "..", ".env"),
    path.join(process.cwd(), ".env"),
  ];
  const archivo = candidatos.find((c) => fs.existsSync(c));
  if (!archivo) return;
  for (const linea of fs.readFileSync(archivo, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
    if (m?.[1] && !process.env[m[1]]) {
      process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
    }
  }
}
cargarEnv();

function contar<T>(items: T[], clave: (t: T) => string): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const i of items) {
    const k = clave(i);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1]);
}

async function main() {
  const seco = process.argv.includes("--dry");

  console.log("Leyendo SIGOV…");
  const { obras, fotos } = await traerSigov();
  const lote = mapearLoteSigov(obras, fotos);

  const m2 = lote.intervenciones
    .filter((i) => i.estado === "finalizada")
    .reduce((a, i) => a + (i.superficieM2 ?? 0), 0);

  console.log(`\n${obras.length} obras, ${fotos.length} fotos:`);
  for (const [e, n] of contar(lote.intervenciones, (i) => i.estado)) {
    console.log(`  ${String(n).padStart(4)}  ${e}`);
  }
  console.log(`\n  ${Math.round(m2).toLocaleString("es-AR")} m² terminados`);
  console.log(`  ${lote.canceladas} canceladas · ${lote.posiblesDuplicados} marcadas como posible duplicado · ${lote.sinGeo} sin coordenadas`);

  console.log("\n  por contratista:");
  for (const [c, n] of contar(
    lote.intervenciones,
    (i) => String((i.metadata as { contratista?: unknown }).contratista ?? "sin contratista"),
  ).slice(0, 12)) {
    console.log(`    ${String(n).padStart(4)}  ${c}`);
  }

  console.log("\n  fotos por momento:");
  for (const [m, n] of contar(lote.fotos, (f) => f.momento)) {
    console.log(`    ${String(n).padStart(5)}  ${m}`);
  }

  if (lote.sospechosos.length > 0) {
    console.log(`\n  A REVISAR EN SIGOV: ${lote.sospechosos.length} superficies no creíbles.`);
    console.log("  Se cargan sin superficie para no inflar la obra ejecutada:");
    for (const s of lote.sospechosos) {
      console.log(`    ${String(Math.round(s.m2)).padStart(7)} m²  ${s.direccion}`);
    }
  }

  const sinFecha = lote.intervenciones.filter((i) => i.estado === "finalizada" && !i.finalizadaEn);
  if (sinFecha.length > 0) {
    console.log(`\n  ${sinFecha.length} terminadas sin fecha de fin (no entran en las series de tiempo)`);
  }

  if (seco) {
    console.log("\n--dry: no se escribió nada.");
    process.exit(0);
  }

  console.log("\nIngestando…");
  const r = await sincronizarSigov();
  if (!r.huboNovedades) {
    console.log("Sin novedades: nada cambió desde la última sincronización.");
    process.exit(0);
  }
  console.log(
    `  obras → nuevas ${r.nuevas} | actualizadas ${r.actualizadas} | sin cambios ${r.sinCambios} | errores ${r.errores}`,
  );
  console.log(`  fotos → nuevas ${r.fotosNuevas}`);
  console.log("\nListo.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
