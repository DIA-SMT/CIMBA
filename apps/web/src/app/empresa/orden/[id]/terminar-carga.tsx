"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { marcarCargaTerminada } from "@/lib/acciones-ordenes";
import { mensajeDeError } from "@/lib/errores";
import { fechaCorta, numero } from "@/lib/formato";

/**
 * «TERMINAMOS DE CARGAR» (28/10). La orden ya no se cierra sola al reportar
 * el último punto: la cuadrilla sigue sumando los baches que encuentra en el
 * lugar y, cuando cargó todo, avisa con este botón. La cierra la Dirección.
 */
export function TerminarCarga({
  ordenId,
  pendientes,
  terminada,
  soloLectura,
}: {
  ordenId: number;
  /** Puntos de la orden todavía sin reportar: con alguno, no se puede terminar. */
  pendientes: number;
  terminada: { por: string | null; en: string } | null;
  /** Vista espejo de la Dirección: se ve el estado y una nota, no el botón. */
  soloLectura: boolean;
}) {
  const router = useRouter();
  const [enviando, iniciar] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (terminada) {
    return (
      <p className="mb-4 flex items-start gap-2 rounded-xl border border-resuelto/40 bg-resuelto/10 px-4 py-3 text-sm leading-snug">
        <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-resuelto" />
        <span>
          <b>Carga terminada</b> el {fechaCorta(terminada.en)}
          {terminada.por ? ` por ${terminada.por}` : ""}. La Dirección la revisa y la cierra. Si aparece
          otro bache, agregalo igual: la marca se saca sola.
        </span>
      </p>
    );
  }
  /**
   * En la vista espejo el botón no va: «terminamos de cargar» lo dice la
   * empresa, y quien mira desde la Dirección cierra la orden directamente.
   * Sin esta nota, Bacheo lo buscaba y creía que faltaba (28/10, OT-0049).
   */
  if (soloLectura) {
    return (
      <p className="mb-4 rounded-xl border border-borde bg-panel px-4 py-3 text-sm leading-snug text-texto-2">
        «Terminamos de cargar» es el aviso de la empresa. Desde acá cargá lo que falte y, cuando esté todo,{" "}
        <Link href={`/ordenes/${ordenId}`} className="font-semibold text-celeste hover:underline">
          cerrá la orden desde Órdenes
        </Link>
        .
      </p>
    );
  }

  if (pendientes > 0) {
    return (
      <p className="mb-4 rounded-xl border border-borde bg-panel px-4 py-3 text-sm leading-snug text-texto-2">
        Cuando termines, vas a poder marcar <b className="text-texto">«Terminamos de cargar»</b>. Antes
        {pendientes === 1 ? " falta reportar 1 bache" : ` faltan reportar ${numero(pendientes)} baches`} de la
        orden (cargado o no encontrado).
      </p>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-resuelto/40 bg-panel p-3">
      {!confirmando ? (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-resuelto px-3 text-sm font-bold text-white transition hover:brightness-110"
        >
          <CheckCircle2 size={16} /> Terminamos de cargar
        </button>
      ) : (
        <div>
          <p className="text-sm leading-snug">
            ¿Ya cargaste todo, incluidos los baches que encontraron en el lugar? La Dirección la revisa y la cierra.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={enviando}
              onClick={() => {
                setError(null);
                iniciar(async () => {
                  try {
                    await marcarCargaTerminada({ ordenId });
                    setConfirmando(false);
                    router.refresh();
                  } catch (e) {
                    setError(mensajeDeError(e, "No se pudo marcar"));
                  }
                });
              }}
              className="min-h-11 rounded-xl bg-resuelto px-4 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {enviando ? "Guardando…" : "Sí, terminamos"}
            </button>
            <button type="button" onClick={() => setConfirmando(false)} className="text-sm text-texto-2 hover:text-texto">
              Todavía no
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-peligro">{error}</p>}
    </div>
  );
}
