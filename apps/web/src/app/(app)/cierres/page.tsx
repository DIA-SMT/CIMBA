import { leerSesion } from "@/lib/auth";
import { demandasParaCerrar } from "@/lib/ordenes";
import { numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { FilaCierre } from "./fila-cierre";

export const dynamic = "force-dynamic";

/**
 * Bandeja de cierre de Atención Ciudadana: reclamos cuyo bache YA se reparó
 * (la empresa cargó la intervención desde su orden de trabajo, o la cuadrilla
 * desde /campo) y que todavía figuran abiertos porque nadie le respondió al
 * vecino. Es el último eslabón del circuito pedido → reparación → respuesta.
 */
export default async function PaginaCierres() {
  const sesion = (await leerSesion())!;
  const demandas = await demandasParaCerrar(sesion);
  // El botón de cierre es solo para quien le responde al vecino: Atención
  // Ciudadana (o admin). Los demás roles ven el listado igual — RLS ya decidió
  // qué filas les llegan — pero sin accionar.
  const puedeCerrar = ["admin", "atencion_ciudadana"].includes(sesion.rol_cimba);

  return (
    <div className="mx-auto max-w-6xl p-6">
      <TituloPagina
        titulo="Cierre de reclamos — el circuito completo"
        sub="Reclamos cuyo problema YA está reparado: falta responderle al vecino y cerrar el ticket."
      />

      {/* El KPI de la bandeja: cuánta respuesta debemos, no cuánta obra falta */}
      <Panel className="mb-6 p-5">
        <div className="num text-3xl font-extrabold text-resuelto">{numero(demandas.length)}</div>
        <p className="mt-1 text-sm font-bold">reclamos listos para cerrar</p>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-texto-2">
          Cada fila ya tiene su reparación registrada en el territorio. Acá no falta asfalto: falta avisarle
          a quien pidió y cerrar el ticket para que deje de contar como deuda.
        </p>
      </Panel>

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
                  No hay reclamos pendientes de cierre: o no hay reparaciones nuevas sobre reclamos abiertos,
                  o ya se respondió todo.
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
