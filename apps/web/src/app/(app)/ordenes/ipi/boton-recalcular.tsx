"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { recalcularRankingIpi } from "@/lib/acciones-ipi";
import { numero } from "@/lib/formato";

/**
 * Vuelve a medir el estado de cada corredor contra la operación de los últimos
 * 24 meses y rehace el índice. Es una pasada sobre toda la red: tarda.
 */
export function BotonRecalcularIpi() {
  const router = useRouter();
  const [pendiente, comenzar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recalcular = () =>
    comenzar(async () => {
      setError(null);
      setAviso(null);
      try {
        const r = await recalcularRankingIpi();
        setAviso(`Listo: ${numero(r.corredores)} corredores recalculados`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo recalcular");
      }
    });

  return (
    <div className="text-right">
      <button
        onClick={recalcular}
        disabled={pendiente}
        className="inline-flex items-center gap-1.5 rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
      >
        <RefreshCw size={14} className={pendiente ? "animate-spin" : ""} />
        {pendiente ? "Midiendo la red…" : "Recalcular el índice"}
      </button>
      {aviso && <p className="mt-1 text-[11px] font-semibold" style={{ color: "var(--color-hecho)" }}>{aviso}</p>}
      {error && <p className="mt-1 text-[11px] text-peligro">{error}</p>}
    </div>
  );
}
