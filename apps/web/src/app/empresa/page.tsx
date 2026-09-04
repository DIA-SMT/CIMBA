import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { listarEmpresas, ordenesDeEmpresa, type OrdenResumen } from "@/lib/ordenes";
import { fechaCorta, hoyISO, numero } from "@/lib/formato";
import { Panel } from "@/components/ui";
import { resolverVistaPortal } from "./vista";

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

export default async function PaginaEmpresa({
  searchParams,
}: {
  searchParams: Promise<{ empresa?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const vista = await resolverVistaPortal(sesion, await searchParams);

  // Staff sin empresa elegida: primero decir el portal de quién quiere ver.
  if (!vista.empresaId && !["empresa", "cuadrilla"].includes(sesion.rol_cimba)) {
    const empresas = await listarEmpresas(sesion);
    return (
      <div className="mx-auto max-w-xl p-4 pb-10">
        <h1 className="mb-1 text-2xl font-bold tracking-tight">
          ¿El portal de qué empresa querés ver?
        </h1>
        <p className="mb-5 text-sm text-texto-2">
          Vas a ver exactamente lo mismo que ve esa empresa cuando entra.
        </p>
        <div className="space-y-3">
          {empresas.map((e) => (
            <Link key={e.id} href={`/empresa?empresa=${e.id}`} className="block">
              <Panel className="flex items-center justify-between gap-3 p-4 transition active:scale-[0.99]">
                <span className="min-w-0 truncate text-base font-semibold">
                  {e.nombre}
                  {!e.activa && (
                    <span className="ml-2 text-xs font-normal text-texto-3">inactiva</span>
                  )}
                </span>
                <span className="num shrink-0 text-sm text-texto-2">
                  {numero(e.ordenesActivas)} OT activas →
                </span>
              </Panel>
            </Link>
          ))}
          {empresas.length === 0 && (
            <p className="rounded-xl border border-borde bg-panel px-4 py-12 text-center text-base text-texto-2">
              No hay empresas cargadas todavía.
            </p>
          )}
        </div>
      </div>
    );
  }

  const ordenes = await ordenesDeEmpresa(sesion, vista.empresaId ?? undefined);
  // El nombre para el banner: puede que la empresa no tenga órdenes todavía.
  const nombreEmpresa = vista.esVistaEspejo
    ? (ordenes[0]?.empresaNombre ??
      (await listarEmpresas(sesion)).find((e) => e.id === vista.empresaId)?.nombre ??
      `empresa #${vista.empresaId}`)
    : null;
  const activas = ordenes.filter((o) => ["emitida", "en_ejecucion"].includes(o.estado));
  const cerradas = ordenes.filter((o) => !["emitida", "en_ejecucion"].includes(o.estado));
  // En vista espejo los links internos arrastran ?empresa=N para no perderse.
  const sufijoEspejo = vista.esVistaEspejo ? `?empresa=${vista.empresaId}` : "";

  return (
    <div className="mx-auto max-w-xl p-4 pb-10">
      {vista.esVistaEspejo && <BannerEspejo nombreEmpresa={nombreEmpresa!} />}

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
            <TarjetaOrden key={o.id} orden={o} sufijoEspejo={sufijoEspejo} />
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
              <TarjetaOrden key={o.id} orden={o} sufijoEspejo={sufijoEspejo} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Barra amarilla que recuerda que esto NO es un simulador: lo cargado vale. */
function BannerEspejo({ nombreEmpresa }: { nombreEmpresa: string }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amarillo/50 bg-amarillo/10 px-4 py-3 text-sm">
      <p className="min-w-0 flex-1">
        <b className="text-amarillo">Vista espejo:</b> estás viendo el portal como{" "}
        <b>{nombreEmpresa}</b>. Lo que cargues acá vale de verdad.
      </p>
      <Link href="/ordenes/empresas" className="shrink-0 font-semibold text-celeste hover:underline">
        volver a Órdenes
      </Link>
    </div>
  );
}

function TarjetaOrden({ orden, sufijoEspejo }: { orden: OrdenResumen; sufijoEspejo: string }) {
  const prioridad = PRIORIDAD[orden.prioridad] ?? TERCIARIA;
  const vencida = estaVencida(orden);
  const pct = orden.items > 0 ? Math.round((100 * orden.hechos) / orden.items) : 0;

  return (
    <Link href={`/empresa/orden/${orden.id}${sufijoEspejo}`} className="block">
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
