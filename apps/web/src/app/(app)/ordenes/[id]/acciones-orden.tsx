"use client";

import { Printer, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { EstadoOrden } from "@cimba/domain";
import { anularOrden, emitirOrden } from "@/lib/acciones-ordenes";

/**
 * Los botones del ciclo de vida: emitir (borrador → empresa), anular con
 * motivo, e imprimir. window.print() usa la hoja de impresión que la página
 * server ya dejó lista.
 */
export function AccionesOrden({
  ordenId,
  estado,
  puedePlanificar,
}: {
  ordenId: number;
  estado: EstadoOrden;
  puedePlanificar: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const ejecutar = (fn: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        setAnulando(false);
        setMotivo("");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error");
      }
    });
  };

  const anulable = estado === "borrador" || estado === "emitida" || estado === "en_ejecucion";

  return (
    <div className="flex flex-col items-end gap-2 print:hidden">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {puedePlanificar && estado === "borrador" && (
          <button
            disabled={pendiente}
            onClick={() => ejecutar(() => emitirOrden({ ordenId }))}
            className="flex items-center gap-2 rounded-xl bg-azul px-5 py-2.5 font-semibold text-white transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
          >
            <Send size={15} /> Emitir a la empresa
          </button>
        )}
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 rounded-lg border border-borde-2 px-4 py-2.5 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste"
          title="Imprimir la orden en papel (o guardarla como PDF)"
        >
          <Printer size={15} /> Imprimir
        </button>
        {puedePlanificar && anulable && !anulando && (
          <button
            disabled={pendiente}
            onClick={() => setAnulando(true)}
            className="rounded-lg border border-peligro/40 px-4 py-2.5 text-sm font-semibold text-peligro transition hover:bg-peligro/10 disabled:opacity-50"
          >
            Anular
          </button>
        )}
      </div>

      {anulando && (
        <div className="flex w-full max-w-md items-center gap-2">
          <input
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo de la anulación (obligatorio)"
            className="flex-1 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
          />
          <button
            disabled={pendiente || motivo.trim().length < 3}
            onClick={() => ejecutar(() => anularOrden({ ordenId, motivo: motivo.trim() }))}
            className="rounded-lg bg-peligro/90 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {pendiente ? "Anulando…" : "Confirmar"}
          </button>
          <button onClick={() => setAnulando(false)} className="text-sm text-texto-2 hover:text-texto">
            Cancelar
          </button>
        </div>
      )}

      {error && <p className="text-xs text-peligro">{error}</p>}
    </div>
  );
}
