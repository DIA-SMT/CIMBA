/**
 * Enlace de CIMBA con las fuentes que viven adentro de la red municipal.
 *
 * Por qué existe: CIMBA corre en Vercel, o sea en la nube, y no puede alcanzar
 * ni el MySQL de Obras Viales (172.16.8.214, IP privada) ni nada de la red
 * interna. Este proceso corre del lado de adentro, lee las fuentes y empuja los
 * datos a la base de CIMBA. La conexión sale de adentro hacia afuera, así que
 * no hace falta abrir ningún puerto ni exponer nada.
 *
 * Está pensado para quedar prendido: es un proceso de larga duración con su
 * propio reloj, no una tarea programada. Eso evita que dos corridas se pisen
 * cuando una tarda más de lo previsto, que es el modo de falla típico de
 * Task Scheduler con intervalos cortos.
 *
 *   pnpm runner              → arranca el loop
 *   pnpm runner --una-vez    → corre todo una vez y termina (para probar)
 *
 * Para que sobreviva a un reinicio de la máquina, se registra en el Task
 * Scheduler de Windows con disparador "al iniciar el equipo". Ver docs/runner.md.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { sincronizarEmpresas } from "../fuentes/sincronizar-empresas";

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

const reloj = () =>
  new Date().toLocaleString("es-AR", { dateStyle: "short", timeStyle: "medium" });

function log(msg: string) {
  console.log(`[${reloj()}] ${msg}`);
}

interface Tarea {
  nombre: string;
  cadaMinutos: number;
  correr: () => Promise<string>;
}

const TAREAS: Tarea[] = [
  {
    nombre: "planilla de empresas",
    cadaMinutos: Number(process.env.CIMBA_RUNNER_MIN_EMPRESAS ?? 15),
    correr: async () => {
      const r = await sincronizarEmpresas();
      if (r.sospechosos.length > 0) {
        log(
          `  ⚠ ${r.sospechosos.length} superficies no creíbles sin computar ` +
            `(la mayor: ${Math.round(Math.max(...r.sospechosos.map((s) => s.m2)))} m²)`,
        );
      }
      if (!r.huboNovedades) return `sin novedades (${r.filas} filas)`;
      return (
        `${r.trabajosNuevos} trabajos nuevos, ${r.trabajosActualizados} actualizados, ` +
        `${r.deteccionesNuevas} detecciones, ${r.fotosNuevas} fotos` +
        (r.errores > 0 ? ` — ${r.errores} errores` : "")
      );
    },
  },
];

/**
 * Espaciado creciente ante fallas repetidas. Si la planilla de Google se cae o
 * la base no responde, no tiene sentido reintentar cada 15 minutos y llenar el
 * log; pero tampoco rendirse, porque suelen ser cortes pasajeros.
 */
function esperaTrasFalla(fallasSeguidas: number, baseMin: number): number {
  return Math.min(baseMin * Math.pow(2, fallasSeguidas), 120);
}

async function correrTarea(t: Tarea, estado: { fallas: number }) {
  const t0 = Date.now();
  try {
    const detalle = await t.correr();
    const seg = ((Date.now() - t0) / 1000).toFixed(1);
    log(`${t.nombre}: ${detalle} (${seg}s)`);
    estado.fallas = 0;
  } catch (e) {
    estado.fallas++;
    const motivo = e instanceof Error ? e.message : String(e);
    const proxima = esperaTrasFalla(estado.fallas, t.cadaMinutos);
    log(`${t.nombre}: FALLÓ (${estado.fallas}ª vez) — ${motivo}`);
    log(`  reintenta en ${proxima} min`);
  }
}

async function main() {
  const unaVez = process.argv.includes("--una-vez");

  if (!process.env.DATABASE_URL) {
    console.error("Falta DATABASE_URL: el runner no sabe a qué base escribir.");
    process.exit(1);
  }

  log(`Enlace CIMBA iniciado — ${TAREAS.length} tarea(s)`);
  for (const t of TAREAS) log(`  · ${t.nombre}: cada ${t.cadaMinutos} min`);

  if (unaVez) {
    for (const t of TAREAS) await correrTarea(t, { fallas: 0 });
    log("--una-vez: listo.");
    process.exit(0);
  }

  // Un reloj por tarea, para que una lenta no atrase a las demás.
  for (const t of TAREAS) {
    void (async () => {
      const estado = { fallas: 0 };
      for (;;) {
        await correrTarea(t, estado);
        const min = estado.fallas > 0 ? esperaTrasFalla(estado.fallas, t.cadaMinutos) : t.cadaMinutos;
        await new Promise((r) => setTimeout(r, min * 60_000));
      }
    })();
  }

  // Señal de vida cada hora: sin esto, un runner colgado se ve igual que uno
  // sin novedades que informar.
  setInterval(() => log("sigo vivo"), 60 * 60_000);

  const cerrar = (senal: string) => {
    log(`${senal}: cerrando el enlace.`);
    process.exit(0);
  };
  process.on("SIGINT", () => cerrar("Ctrl+C"));
  process.on("SIGTERM", () => cerrar("SIGTERM"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
