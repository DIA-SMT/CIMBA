import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { ordenesDeEmpresa, type OrdenResumen } from "@/lib/ordenes";
import { fechaCorta, hoyISO, numero } from "@/lib/formato";
import { Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Prioridad en el color que ya usa todo CIMBA: la primaria arde, la terciaria espera. */
const TERCIARIA = { etiqueta: "TERCIARIA", clase: "bg-panel-3 text-texto-2" };
const PRIORIDAD: Record<string, { etiqueta: string; clase: string }> = {
  primaria: { etiqueta: "PRIMARIA", clase: "bg-encurso/15 text-encurso" },
  secundaria: { etiqueta: "SECUNDARIA", clase: "bg-amarillo/15 text-amarillo" },
  terciaria: TERCIARIA,
};

const ETIQUETA_ESTADO: Record<string, string> = {
  emitida: "Nueva",
  en_ejecucion: "En ejecución",
  completada: "Completada",
  anulada: "Anulada",
};

/**
 * Vence_en es una fecha sin hora ("YYYY-MM-DD"): se compara como texto contra
 * el hoy LOCAL para no marcar VENCIDA una orden que vence hoy por el
 * corrimiento UTC−3 (a la noche, toISOString ya estaría en el día siguiente).
 */
function estaVencida(orden: OrdenResumen): boolean {
  if (!orden.venceEn) return false;
  if (!["emitida", "en_ejecucion"].includes(orden.estado)) return false;
  return orden.venceEn < hoyISO();
}

export default async function PaginaEmpresa() {
  const sesion = (await leerSesion())!;
  const ordenes = await ordenesDeEmpresa(sesion);
  const activas = ordenes.filter((o) => ["emitida", "en_ejecucion"].includes(o.estado));
  const cerradas = ordenes.filter((o) => !["emitida", "en_ejecucion"].includes(o.estado));

  return (
    <div className="mx-auto max-w-xl p-4 pb-10">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Mis órdenes</h1>
      <p className="mb-5 text-sm text-texto-2">Tocá una orden para cargar los baches hechos.</p>

      {ordenes.length === 0 && (
        <p className="rounded-xl border border-borde bg-panel px-4 py-12 text-center text-base text-texto-2">
          Cuando el Director te emita una orden, aparece acá.
        </p>
      )}

      {activas.length > 0 && (
        <div className="space-y-4">
          {activas.map((o) => (
            <TarjetaOrden key={o.id} orden={o} />
          ))}
        </div>
      )}

      {cerradas.length > 0 && (
        <>
          <h2 className="mt-8 mb-3 text-xs font-bold tracking-wider text-texto-3 uppercase">
            Terminadas
          </h2>
          <div className="space-y-3 opacity-80">
            {cerradas.map((o) => (
              <TarjetaOrden key={o.id} orden={o} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TarjetaOrden({ orden }: { orden: OrdenResumen }) {
  const prioridad = PRIORIDAD[orden.prioridad] ?? TERCIARIA;
  const vencida = estaVencida(orden);
  const pct = orden.items > 0 ? Math.round((100 * orden.hechos) / orden.items) : 0;

  return (
    <Link href={`/empresa/orden/${orden.id}`} className="block">
      <Panel className="p-4 transition active:scale-[0.99]">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="num text-lg font-extrabold">{orden.numero}</span>
          <span className={`rounded px-2 py-1 text-[11px] font-bold ${prioridad.clase}`}>
            {prioridad.etiqueta}
          </span>
          {orden.circuitoCodigo && (
            <span className="rounded bg-celeste/10 px-2 py-1 text-[11px] font-bold text-celeste">
              Circuito {orden.circuitoCodigo}
            </span>
          )}
          <span className="ml-auto text-xs font-semibold text-texto-2">
            {ETIQUETA_ESTADO[orden.estado] ?? orden.estado}
          </span>
        </div>

        {orden.titulo && <p className="mb-2 text-base font-medium">{orden.titulo}</p>}

        <div className="mb-1 flex items-baseline justify-between text-sm">
          <span>
            <b className="num">{numero(orden.hechos)}</b> de <b className="num">{numero(orden.items)}</b> hechos
          </span>
          <span className="num text-texto-2">{numero(orden.m2Reportados)} m²</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-panel-3">
          <div
            className="h-full rounded-full bg-resuelto transition-[width]"
            style={{ width: `${pct}%` }}
          />
        </div>

        {orden.venceEn && (
          <p className="mt-2 text-sm">
            {vencida ? (
              <span className="font-bold text-peligro">VENCIDA — vencía el {fechaCorta(orden.venceEn)}</span>
            ) : (
              <span className="text-texto-2">Vence el {fechaCorta(orden.venceEn)}</span>
            )}
          </p>
        )}
      </Panel>
    </Link>
  );
}
