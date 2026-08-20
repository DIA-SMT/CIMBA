"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { EstadoIncidente } from "@cimba/domain";
import { priorizarIncidente, programarIntervencion, verificarIncidente } from "@/lib/acciones";

export function AccionesIncidente({
  incidenteId,
  estado,
  cuadrillas,
  puedePlanificar,
  puedeVerificar,
}: {
  incidenteId: number;
  estado: EstadoIncidente;
  cuadrillas: Array<{ id: number; nombre: string }>;
  puedePlanificar: boolean;
  puedeVerificar: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [eligiendo, setEligiendo] = useState(false);

  const ejecutar = (fn: () => Promise<unknown>) =>
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch {
        /* el server action valida y audita; un error deja la fila sin cambios */
      } finally {
        setEligiendo(false);
      }
    });

  if (puedePlanificar && estado === "detectado") {
    return (
      <button
        disabled={pendiente}
        onClick={() => ejecutar(() => priorizarIncidente({ incidenteId }))}
        className="rounded-md border border-amarillo/50 bg-amarillo/10 px-2.5 py-1 text-[11px] font-semibold text-amarillo transition hover:bg-amarillo/20 disabled:opacity-50"
      >
        Priorizar
      </button>
    );
  }

  if (puedePlanificar && (estado === "priorizado" || estado === "detectado")) {
    return eligiendo ? (
      <select
        autoFocus
        disabled={pendiente}
        defaultValue=""
        onChange={(e) => {
          const id = Number(e.target.value);
          if (id) ejecutar(() => programarIntervencion({ incidenteId, cuadrillaId: id }));
        }}
        onBlur={() => setEligiendo(false)}
        className="rounded-md border border-borde-2 bg-panel-2 px-2 py-1 text-[11px]"
      >
        <option value="" disabled>Cuadrilla…</option>
        {cuadrillas.map((c) => (
          <option key={c.id} value={c.id}>{c.nombre}</option>
        ))}
      </select>
    ) : (
      <button
        disabled={pendiente}
        onClick={() => setEligiendo(true)}
        className="rounded-md border border-celeste/50 bg-celeste/10 px-2.5 py-1 text-[11px] font-semibold text-celeste transition hover:bg-celeste/20 disabled:opacity-50"
      >
        Programar
      </button>
    );
  }

  if (puedeVerificar && estado === "reparado") {
    return (
      <button
        disabled={pendiente}
        onClick={() => ejecutar(() => verificarIncidente({ incidenteId }))}
        className="rounded-md border border-resuelto/50 bg-resuelto/10 px-2.5 py-1 text-[11px] font-semibold text-resuelto transition hover:bg-resuelto/20 disabled:opacity-50"
      >
        Verificar ✓
      </button>
    );
  }

  return null;
}
