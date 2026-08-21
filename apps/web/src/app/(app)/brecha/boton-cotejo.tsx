"use client";

import { CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cotejarConReparados } from "@/lib/acciones-consolidar";
import { numero } from "@/lib/formato";

export function BotonCotejo({
  cotejables,
  cotejablesAmpliado,
}: {
  cotejables: number;
  cotejablesAmpliado: number;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [ampliado, setAmpliado] = useState(false);
  const [cerradas, setCerradas] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cantidad = ampliado ? cotejablesAmpliado : cotejables;

  const correr = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await cotejarConReparados({ ampliado });
        setCerradas(r.cerradas);
        router.refresh();
      } catch {
        setError("El cotejo falló a mitad de camino. Es seguro reintentarlo: nunca duplica ni borra.");
      }
    });
  };

  return (
    <div className="rounded-xl border border-resuelto/40 bg-resuelto/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-sm font-bold">
            <CheckCheck size={16} className="text-resuelto" /> Cotejo retroactivo: cerrar lo que ya se hizo
          </p>
          <p className="mt-1 text-xs leading-relaxed text-texto-2">
            Vincula cada pedido con la reparación posterior que ya existe a menos de 25 m (tipo compatible).
            Achica la brecha aparente y habilita, por primera vez, medir el tiempo pedido → reparación y
            responderle a quien pidió. Auditado y reversible; lo dudoso queda para revisión en la bandeja.
          </p>
          <label
            className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-texto-2"
            title="El consolidado histórico de QGIS no trae etiqueta de calidad de geocodificación. Con esto activado, la cercanía (≤ 25 m) + tipo compatible + reparación posterior alcanzan para cotejar; el vínculo queda marcado con confianza menor (0.7) para poder revisarlo."
          >
            <input
              type="checkbox"
              checked={ampliado}
              onChange={(e) => setAmpliado(e.target.checked)}
              className="mt-0.5 accent-[#199e70]"
            />
            <span>
              Incluir pedidos sin etiqueta de confianza de geocodificación (consolidado histórico) —{" "}
              <b>{numero(cotejablesAmpliado)}</b> en total
            </span>
          </label>
        </div>
        <button
          onClick={correr}
          disabled={pendiente || cantidad === 0}
          className="rounded-xl bg-resuelto px-5 py-3 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {pendiente ? "Cotejando…" : `Cotejar ${numero(cantidad)} pedidos`}
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-peligro">{error}</p>}
      {cerradas !== null && (
        <p className="mt-3 text-sm font-semibold text-resuelto">
          ✓ {numero(cerradas)} pedidos quedaron vinculados a su reparación. Los números de arriba ya están
          actualizados.
        </p>
      )}
    </div>
  );
}
