"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resolverPropuesto } from "@/lib/acciones-ordenes";

/**
 * VALIDAR / RECHAZAR un item que la empresa propuso desde la calle. Validado
 * pasa a 'pendiente' y la empresa ya lo puede trabajar; rechazado queda con
 * su motivo en la traza ("los confirmás vos", dijo el Director).
 */
export function ResolverPropuesto({ itemId }: { itemId: number }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const resolver = (decision: "validar" | "rechazar", motivoTexto?: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await resolverPropuesto({ itemId, decision, motivo: motivoTexto });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo resolver");
      }
    });
  };

  return (
    <div className="space-y-2">
      {!rechazando ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={pendiente}
            onClick={() => resolver("validar")}
            className="flex items-center gap-1.5 rounded-lg bg-resuelto px-4 py-2 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
            title="Pasa a pendiente: la empresa ya lo puede trabajar"
          >
            <Check size={15} /> {pendiente ? "Guardando…" : "Validar"}
          </button>
          <button
            disabled={pendiente}
            onClick={() => setRechazando(true)}
            className="flex items-center gap-1.5 rounded-lg border border-peligro/40 px-4 py-2 text-sm font-semibold text-peligro transition hover:bg-peligro/10 disabled:opacity-50"
          >
            <X size={15} /> Rechazar
          </button>
        </div>
      ) : (
        <div className="flex w-full flex-wrap items-center gap-2">
          <input
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo del rechazo (lo ve la empresa)"
            className="min-w-48 flex-1 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
          />
          <button
            disabled={pendiente || motivo.trim().length < 3}
            onClick={() => resolver("rechazar", motivo.trim())}
            className="rounded-lg bg-peligro/90 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {pendiente ? "Rechazando…" : "Confirmar rechazo"}
          </button>
          <button
            onClick={() => setRechazando(false)}
            disabled={pendiente}
            className="text-sm text-texto-2 hover:text-texto"
          >
            Cancelar
          </button>
        </div>
      )}
      {error && <p className="text-xs text-peligro">{error}</p>}
    </div>
  );
}
