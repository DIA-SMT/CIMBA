"use client";

import { CloudOff, CloudUpload, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { procesarCola, quitarDeCola, useColaEnvios, type TipoEnvio } from "@/lib/cola-envios";
import { reportarTrabajoLibre } from "@/lib/acciones-carga-libre";
import { proponerItem, reportarItemHecho } from "@/lib/acciones-ordenes";
import { numero } from "@/lib/formato";

/**
 * LO QUE ESPERA SEÑAL. La barra que dice cuántos trabajos están guardados en
 * el teléfono, los manda solos cuando vuelve la red, y deja mandar a mano.
 *
 * Vive en el layout del portal —no en un formulario— porque la cola es del
 * teléfono, no de una orden: la cuadrilla carga tres baches sin señal en una
 * orden, dos en otra, y cuando recupera datos tiene que ver UNA cosa que diga
 * "5 esperando · Enviar ahora".
 *
 * Los rechazados (el servidor dijo que no: item ya reportado, orden cerrada)
 * se listan aparte con el motivo. No se reintentan solos —volvería a fallar— y
 * no se borran solos: la decisión es de quien los cargó.
 */

const EJECUTORES = {
  reportarItemHecho: (fd: FormData) => reportarItemHecho(fd),
  proponerItem: (fd: FormData) => proponerItem(fd),
  reportarTrabajoLibre: (fd: FormData) => reportarTrabajoLibre(fd),
} satisfies Record<TipoEnvio, (fd: FormData) => Promise<unknown>>;

const QUE_ES: Record<TipoEnvio, string> = {
  reportarItemHecho: "bache reportado",
  proponerItem: "bache propuesto",
  reportarTrabajoLibre: "trabajo sin orden",
};

export function ColaPendiente() {
  const router = useRouter();
  const { pendientes, rechazados, enLinea } = useColaEnvios();
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [verRechazados, setVerRechazados] = useState(false);
  const yaIntento = useRef(false);

  const sincronizar = async (automatico: boolean) => {
    if (enviando) return;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await procesarCola(EJECUTORES);
      if (r.enviados > 0) {
        setAviso(
          r.enviados === 1
            ? "Se mandó el trabajo que estaba guardado ✓"
            : `Se mandaron los ${numero(r.enviados)} trabajos que estaban guardados ✓`,
        );
        // Lo enviado aparece en la orden: el server component se rehace.
        router.refresh();
      } else if (!automatico && r.sinRed) {
        setAviso("Todavía no hay señal. Se van a mandar solos cuando vuelva.");
      }
    } finally {
      setEnviando(false);
    }
  };

  /* Al abrir el portal con cola y con red, se manda solo. Una vez por carga
     de página: si falla por red, el evento `online` lo vuelve a disparar. */
  useEffect(() => {
    if (yaIntento.current || pendientes.length === 0 || !enLinea) return;
    yaIntento.current = true;
    void sincronizar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendientes.length, enLinea]);

  /* Vuelve la señal: se manda. Es el momento para el que existe la cola. */
  useEffect(() => {
    if (!enLinea) return;
    if (pendientes.length > 0) void sincronizar(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enLinea]);

  if (pendientes.length === 0 && rechazados.length === 0 && !aviso) {
    if (enLinea) return null;
    // Sin señal y sin cola: se avisa igual, para que la carga que sigue no
    // sorprenda a nadie cuando diga "guardado en el teléfono".
    return (
      <div className="sticky top-16 z-10 flex items-center gap-2 border-b border-amarillo/40 bg-amarillo/10 px-4 py-2 text-[12px] font-semibold text-amarillo">
        <CloudOff size={14} className="shrink-0" />
        Sin señal. Lo que cargues se guarda en el teléfono y se manda solo cuando vuelva.
      </div>
    );
  }

  return (
    <div className="sticky top-16 z-10 border-b border-borde bg-panel px-4 py-2 text-sm">
      {pendientes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {enLinea ? (
            <CloudUpload size={16} className="shrink-0 text-celeste" />
          ) : (
            <CloudOff size={16} className="shrink-0 text-amarillo" />
          )}
          <span className="min-w-0 flex-1 font-semibold">
            {pendientes.length === 1 ? "1 trabajo guardado" : `${numero(pendientes.length)} trabajos guardados`} en el
            teléfono
            <span className="block text-[11px] font-normal text-texto-3">
              {enLinea ? "Con señal: se mandan solos." : "Sin señal: se mandan cuando vuelva."}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void sincronizar(false)}
            disabled={enviando}
            className="flex min-h-10 items-center gap-1.5 rounded-lg bg-azul px-3 text-[12px] font-bold text-white transition disabled:opacity-60"
          >
            <RefreshCw size={14} className={enviando ? "animate-spin" : ""} />
            {enviando ? "Mandando…" : "Enviar ahora"}
          </button>
        </div>
      )}

      {aviso && <p className="mt-1 text-[12px] text-texto-2">{aviso}</p>}

      {rechazados.length > 0 && (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setVerRechazados((v) => !v)}
            className="text-[12px] font-semibold text-peligro"
          >
            {numero(rechazados.length)} {rechazados.length === 1 ? "no fue aceptado" : "no fueron aceptados"} por el
            sistema {verRechazados ? "▾" : "▸"}
          </button>
          {verRechazados && (
            <ul className="mt-1.5 space-y-1.5">
              {rechazados.map((e) => (
                <li key={e.id} className="flex items-start gap-2 rounded-lg border border-peligro/30 bg-peligro/5 px-3 py-2 text-[12px]">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {QUE_ES[e.tipo]}
                      {e.contexto.direccion ? ` · ${e.contexto.direccion}` : ""}
                    </span>
                    <span className="block text-texto-2">{e.rechazo}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void quitarDeCola(e.id)}
                    title="Quitar de la cola"
                    className="shrink-0 rounded-md p-1.5 text-texto-3 transition hover:text-peligro"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
