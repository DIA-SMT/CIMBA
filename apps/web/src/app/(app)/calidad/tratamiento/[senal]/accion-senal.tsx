"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { derivarAIngenieria, marcarDuplicada, marcarYaResuelta } from "@/lib/acciones-tratamiento";
import type { SenalTratamiento } from "@/lib/tratamiento";

/**
 * El botón de confirmación de cada señal, con doble paso inline (nada de
 * window.confirm: no anda en los webviews). El sistema propone, la persona
 * firma; al confirmar, la fila desaparece de la bandeja con el refresh.
 */
const ROTULO: Record<Exclude<SenalTratamiento, "derivar_sat">, { boton: string; confirmar: (ref: number | null) => string }> = {
  no_es_bache: { boton: "→ Ingeniería", confirmar: () => "¿Derivar a Ingeniería (pasado de máquina)?" },
  duplicada: { boton: "Duplicada", confirmar: (ref) => `¿Descartar como duplicada del reclamo #${ref}?` },
  ya_resuelta: { boton: "Ya resuelta", confirmar: (ref) => `¿Vincular al incidente #${ref} ya reparado?` },
};

export function AccionSenal({
  senal,
  demandaId,
  referenciaId,
}: {
  senal: Exclude<SenalTratamiento, "derivar_sat">;
  demandaId: number;
  referenciaId: number | null;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  // Duplicada y ya-resuelta necesitan la referencia; sin ella no hay acción
  // válida (la señal existe pero el detalle no cargó — caso rarísimo).
  if (senal !== "no_es_bache" && referenciaId == null) return null;

  const ejecutar = () => {
    setError(null);
    iniciar(async () => {
      try {
        if (senal === "no_es_bache") await derivarAIngenieria({ demandaId });
        else if (senal === "duplicada") await marcarDuplicada({ demandaId, duplicadaDe: referenciaId! });
        else await marcarYaResuelta({ demandaId, incidenteId: referenciaId! });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo aplicar");
        setConfirmando(false);
      }
    });
  };

  if (confirmando) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="hidden text-[11px] text-texto-3 sm:inline">{ROTULO[senal].confirmar(referenciaId)}</span>
        <button
          onClick={ejecutar}
          disabled={pendiente}
          className="rounded-lg bg-azul px-2.5 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {pendiente ? "…" : "Sí"}
        </button>
        <button
          onClick={() => setConfirmando(false)}
          disabled={pendiente}
          className="px-1.5 py-1.5 text-xs text-texto-3 hover:text-texto"
        >
          no
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        onClick={() => setConfirmando(true)}
        className="rounded-lg border border-amarillo/40 px-2.5 py-1.5 text-xs font-semibold text-amarillo transition hover:border-amarillo hover:bg-amarillo/10"
      >
        {ROTULO[senal].boton}
      </button>
      {error && <span className="max-w-48 text-right text-[10px] text-peligro">{error}</span>}
    </span>
  );
}
