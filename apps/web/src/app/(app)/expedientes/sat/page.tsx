import Link from "next/link";
import { leerSesion } from "@/lib/auth";
import { DESTINATARIO_SAT, renglonesParaNotaSat } from "@/lib/expedientes";
import { numero } from "@/lib/formato";
import { Panel, TituloPagina } from "@/components/ui";
import { CSS_IMPRESION_NOTA } from "../nota-sat";
import { EditorNota } from "./editor-nota";

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
  /**
   * La nota incluye TAMBIÉN los reclamos de agua sin ubicación, y la bandeja
   * de Tratamiento solo lista los georreferenciados: por eso el recorrido
   * mostraba tres números distintos para lo mismo y el Director firmaba una
   * nota con más reclamos de los que había visto. Acá se muestra la resta.
   */
  const sinUbicacion = renglones.filter((r) => r.lat == null || r.lon == null).length;

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
              <b className="num text-texto">{numero(renglones.length)}</b> reclamos en esta nota
              {sinUbicacion > 0 ? (
                <>
                  :{" "}
                  <b className="num">{numero(renglones.length - sinUbicacion)}</b> georreferenciados
                  (los que viste en la bandeja) +{" "}
                  <b className="num">{numero(sinUbicacion)}</b> sin ubicación, que entran igual
                  porque la SAT los identifica por el ticket
                </>
              ) : (
                <> (todos georreferenciados)</>
              )}
              . <b className="num">{numero(conFoto)}</b> con fotografía. Nada se registra hasta que
              confirmes abajo.
            </span>
          </div>

          <EditorNota renglones={renglones} destinatario={DESTINATARIO_SAT} puedeGenerar={puedeGenerar} />
        </>
      )}
    </div>
  );
}
