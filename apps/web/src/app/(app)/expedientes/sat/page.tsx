import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { DESTINATARIO_SAT, renglonesParaNotaSat } from "@/lib/expedientes";
import { numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { CSS_IMPRESION_NOTA, NotaSat } from "../nota-sat";
import { GenerarNota } from "./generar-nota";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * PREVISUALIZACIÓN de la nota a la SAT: el documento exactamente como va a
 * quedar, ANTES de registrarlo. Registrar es el acto administrativo: numera
 * la nota, congela el detalle y saca los reclamos de la cola de bacheo.
 */
export default async function PaginaPrevisualizacionSat() {
  const sesion = (await leerSesion())!;
  const renglones = await renglonesParaNotaSat(sesion);
  const puedeGenerar = ["admin", "planificacion", "atencion_ciudadana"].includes(sesion.rol_cimba);
  const conFoto = renglones.filter((r) => r.fotoUrl).length;

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <style>{CSS_IMPRESION_NOTA}</style>
      <TituloPagina
        titulo="Nota a la SAT — previsualización"
        sub="Así va a quedar la nota. Registrarla la numera, congela el detalle y deriva estos reclamos fuera de la cola de bacheo."
        extra={
          <Link href="/expedientes" className="text-sm text-texto-2 hover:text-texto">
            ← Registro de expedientes
          </Link>
        }
      />

      {renglones.length === 0 ? (
        <Panel className="p-6 text-sm text-texto-2">
          No hay reclamos de la SAT abiertos: no queda nada para incluir en una nota nueva.
        </Panel>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amarillo/50 bg-amarillo/10 px-4 py-3 text-sm">
            <b className="text-amarillo">BORRADOR</b>
            <span className="text-texto-2">
              {numero(renglones.length)} reclamos ({numero(conFoto)} con fotografía). Nada se
              registra hasta que confirmes abajo.
            </span>
          </div>

          <NotaSat
            numero={null}
            destinatario={DESTINATARIO_SAT}
            renglones={renglones}
          />

          {puedeGenerar ? (
            <GenerarNota cantidad={renglones.length} />
          ) : (
            <p className="mt-4 text-center text-xs text-texto-3">
              Registrar la nota es tarea de planificación o atención ciudadana; tu rol solo puede verla.
            </p>
          )}
        </>
      )}
    </div>
  );
}
