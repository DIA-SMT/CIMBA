import Link from "next/link";
import type { FuenteDemanda, TipoProblema } from "@cimba/domain";
import { leerSesion } from "@/lib/auth";
import { demandasParaCerrar } from "@/lib/ordenes";
import { ETIQUETA_FUENTE, ETIQUETA_TIPO, numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { FilaCierre } from "./fila-cierre";

export const dynamic = "force-dynamic";

/** Etiquetas de demandas.destino (enum destino_resolucion). Local: formato.ts no es de esta tarea. */
const ETIQUETA_DESTINO: Record<string, string> = {
  bacheo: "Bacheo",
  sat: "SAT (Aguas)",
  ingenieria: "Ingeniería (ripio)",
};

/**
 * Bandeja de cierre de Atención Ciudadana: reclamos cuyo bache YA se reparó
 * (la empresa cargó la intervención desde su orden de trabajo, o la cuadrilla
 * desde /campo) y que todavía figuran abiertos porque nadie le respondió al
 * vecino. Es el último eslabón del circuito pedido → reparación → respuesta.
 *
 * Los filtros por fuente/tipo/destino salen de la reunión con el Director:
 * "necesito sí o sí que el cierre esté para separar por tipo y por quién lo pide".
 */
export default async function PaginaCierres({
  searchParams,
}: {
  searchParams: Promise<{ fuente?: string; tipo?: string; destino?: string }>;
}) {
  const sesion = (await leerSesion())!;
  const filtros = await searchParams;
  const hayFiltro = Boolean(filtros.fuente || filtros.tipo || filtros.destino);

  // La bandeja completa alimenta los conteos de los chips; la filtrada es la
  // que se lista y la que mide el KPI. Con ≤500 filas el doble viaje es barato.
  const todas = await demandasParaCerrar(sesion);
  const demandas = hayFiltro ? await demandasParaCerrar(sesion, filtros) : todas;

  // El botón de cierre es solo para quien le responde al vecino: Atención
  // Ciudadana (o admin). Los demás roles ven el listado igual — RLS ya decidió
  // qué filas les llegan — pero sin accionar.
  const puedeCerrar = ["admin", "atencion_ciudadana"].includes(sesion.rol_cimba);

  // Conteos para los chips, sobre la bandeja SIN filtrar: así un chip activo
  // no hace desaparecer a los demás.
  const contar = (claves: Array<string | null>) => {
    const m = new Map<string, number>();
    for (const k of claves) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const porFuente = contar(todas.map((d) => d.fuente));
  const porTipo = contar(todas.map((d) => d.tipo));
  const porDestino = contar(todas.map((d) => d.destino));

  const link = (cambios: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...filtros, ...cambios })) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/cierres?${qs}` : "/cierres";
  };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <TituloPagina
        titulo="Cierre de reclamos — el circuito completo"
        sub="Reclamos cuyo problema YA está reparado: falta responderle al vecino y cerrar el ticket."
      />

      {/* El KPI de la bandeja: cuánta respuesta debemos, no cuánta obra falta */}
      <Panel className="mb-4 p-5">
        <div className="num text-3xl font-extrabold text-resuelto">{numero(demandas.length)}</div>
        <p className="mt-1 text-sm font-bold">
          reclamos listos para cerrar
          {hayFiltro && (
            <span className="ml-1.5 font-normal text-texto-3">
              (de <span className="num">{numero(todas.length)}</span> en total, con los filtros de abajo)
            </span>
          )}
        </p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-texto-2">
          Cada fila ya tiene su reparación registrada en el territorio. Acá no falta asfalto: falta avisarle
          a quien pidió y cerrar el ticket para que deje de contar como deuda.
        </p>
      </Panel>

      {/* Separar por quién lo pide (fuente) y por tipo: cada chip es un filtro de un clic */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Quién pide:</span>
        {porFuente.map(([fuente, n]) => (
          <Link
            key={fuente}
            href={link({ fuente: filtros.fuente === fuente ? undefined : fuente })}
            title={`Ver solo los reclamos de ${ETIQUETA_FUENTE[fuente as FuenteDemanda] ?? fuente}`}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
              filtros.fuente === fuente
                ? "border-celeste/60 bg-celeste/10 text-celeste"
                : "border-borde text-texto-2 hover:border-borde-2 hover:text-texto"
            }`}
          >
            {ETIQUETA_FUENTE[fuente as FuenteDemanda] ?? fuente} <span className="num text-texto-3">{numero(n)}</span>
          </Link>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Tipo:</span>
        {porTipo.map(([tipo, n]) => (
          <Link
            key={tipo}
            href={link({ tipo: filtros.tipo === tipo ? undefined : tipo })}
            className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
              filtros.tipo === tipo
                ? "border-celeste/60 bg-celeste/10 text-celeste"
                : "border-borde text-texto-2 hover:border-borde-2 hover:text-texto"
            }`}
          >
            {ETIQUETA_TIPO[tipo as TipoProblema] ?? tipo} <span className="num text-texto-3">{numero(n)}</span>
          </Link>
        ))}
        {/* Quién lo resuelve: un select GET (server-first, sin isla) */}
        <form action="/cierres" method="get" className="ml-auto flex items-center gap-2">
          {filtros.fuente && <input type="hidden" name="fuente" value={filtros.fuente} />}
          {filtros.tipo && <input type="hidden" name="tipo" value={filtros.tipo} />}
          <label className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
            Quién lo resuelve:
            <select
              name="destino"
              defaultValue={filtros.destino ?? ""}
              className="rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-xs font-normal normal-case tracking-normal text-texto"
            >
              <option value="">Todos</option>
              {porDestino.map(([destino, n]) => (
                <option key={destino} value={destino}>
                  {ETIQUETA_DESTINO[destino] ?? destino} ({numero(n)})
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-lg border border-borde-2 px-2.5 py-1.5 text-xs font-semibold text-texto-2 transition hover:border-celeste hover:text-celeste">
            Aplicar
          </button>
          {hayFiltro && (
            <Link href="/cierres" className="text-xs text-texto-3 hover:text-texto">
              Limpiar
            </Link>
          )}
        </form>
      </div>

      {!puedeCerrar && demandas.length > 0 && (
        <p className="mb-4 rounded-lg border border-amarillo/40 bg-amarillo/10 px-4 py-2.5 text-xs text-amarillo">
          El cierre lo hace Atención Ciudadana (o admin): con tu rol ves el listado pero no podés cerrar.
        </p>
      )}

      <Panel className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
              <th className="px-4 py-3">Fuente</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Dirección</th>
              <th className="px-4 py-3">Pedido el</th>
              <th className="px-4 py-3">Reparado el</th>
              <th className="px-4 py-3">m²</th>
              <th className="px-4 py-3">Fotos después</th>
              <th className="px-4 py-3">Incidente</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {demandas.map((d) => (
              <FilaCierre key={d.demandaId} demanda={d} puedeCerrar={puedeCerrar} />
            ))}
            {demandas.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-texto-3">
                  {hayFiltro
                    ? "No hay reclamos pendientes de cierre con estos filtros."
                    : "No hay reclamos pendientes de cierre: o no hay reparaciones nuevas sobre reclamos abiertos, o ya se respondió todo."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>

      <p className="mt-4 text-xs leading-relaxed text-texto-3">
        El cierre queda registrado en <code>metadata.cierre</code> de la demanda (quién, cuándo y qué se
        respondió). La demanda cerrada sale de la brecha automáticamente: el filtro de brecha solo cuenta
        pedidos en recibida/en validación.
      </p>
    </div>
  );
}
