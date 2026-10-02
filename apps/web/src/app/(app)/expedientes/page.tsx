import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { listarExpedientes, renglonesParaNotaSat } from "@/lib/expedientes";
import { fechaCorta, numero } from "@/lib/formato";
import { ETIQUETA_FUENTE } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { PanelTabla } from "@/components/tabla-deslizable";

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

      {/**
        * LOS REPORTES DE VUELTA. Distintos de las notas de arriba y conviene
        * no confundirlos: la nota a la SAT DERIVA trabajo (cambia estados,
        * saca reclamos de la cola); esto RINDE CUENTAS —qué pasó con lo que
        * pidieron— y no toca nada. Por eso no se numeran ni se registran: se
        * imprimen y se entregan, y mañana el mismo reporte dice otra cosa
        * porque el trabajo avanzó.
        */}
      <div className="mb-5">
        <h2 className="mb-2 text-xs font-bold tracking-wider text-texto-3 uppercase">
          Reportes de gestión por canal
        </h2>
        <p className="mb-2.5 text-sm text-texto-2">
          Qué pidió cada canal y qué pasó con cada pedido, para imprimir y entregar.
        </p>
        <div className="flex flex-wrap gap-2">
          {(["hcd", "redes_sociales", "atencion_ciudadana", "secretaria", "sat"] as const).map((f) => (
            <Link
              key={f}
              href={`/expedientes/reporte/${f}`}
              className="rounded-lg border border-borde-2 px-3 py-2 text-sm font-semibold text-texto-2 transition hover:border-celeste/60 hover:text-celeste"
            >
              {ETIQUETA_FUENTE[f]}
            </Link>
          ))}
        </div>
      </div>

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
        <PanelTabla>
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
        </PanelTabla>
      )}
    </div>
  );
}
