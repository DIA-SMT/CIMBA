import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { listarExpedientes, renglonesParaNotaSat } from "@/lib/expedientes";
import { fechaCorta, numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * El registro de expedientes: toda nota que salió de CIMBA queda acá, con su
 * número, fecha, cantidad y quién la generó — "debe quedar registro de la
 * nota o expediente que se hace".
 */
export default async function PaginaExpedientes() {
  const sesion = (await leerSesion())!;
  const [expedientes, pendientesSat] = await Promise.all([
    listarExpedientes(sesion),
    renglonesParaNotaSat(sesion),
  ]);
  const puedeGenerar = ["admin", "planificacion", "atencion_ciudadana"].includes(sesion.rol_cimba);

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <TituloPagina
        titulo="Expedientes"
        sub="Las notas administrativas que salen de CIMBA: numeradas, registradas y con su detalle congelado al momento de la firma."
        extra={
          puedeGenerar && pendientesSat.length > 0 ? (
            <Link
              href="/expedientes/sat"
              className="rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110"
            >
              Previsualizar nota a la SAT ({numero(pendientesSat.length)})
            </Link>
          ) : undefined
        }
      />

      {expedientes.length === 0 ? (
        <Panel className="p-6 text-sm text-texto-2">
          Todavía no se generó ningún expediente.
          {pendientesSat.length > 0 && (
            <>
              {" "}Hay <b>{numero(pendientesSat.length)}</b> reclamos de la SAT esperando la
              primera nota — <Link href="/expedientes/sat" className="text-celeste hover:underline">previsualizala acá</Link>.
            </>
          )}
        </Panel>
      ) : (
        <Panel className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
                <th className="px-4 py-3">Nota</th>
                <th className="px-4 py-3">Destinatario</th>
                <th className="num px-4 py-3 text-right">Reclamos</th>
                <th className="px-4 py-3">Generada</th>
                <th className="px-4 py-3">Por</th>
              </tr>
            </thead>
            <tbody>
              {expedientes.map((e) => (
                <tr key={e.id} className="border-b border-borde/60 transition hover:bg-panel-2">
                  <td className="px-4 py-2.5">
                    <Link href={`/expedientes/${e.id}`} className="num font-bold text-celeste hover:underline">
                      {e.numero}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-texto-2">{e.destinatario}</td>
                  <td className="num px-4 py-2.5 text-right">{numero(e.cantidad)}</td>
                  <td className="num px-4 py-2.5 text-texto-2">{fechaCorta(e.generadoEn)}</td>
                  <td className="px-4 py-2.5 text-texto-2">{e.generadoPor ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
