"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { EstadoIncidente } from "@cimba/domain";
import {
  desverificarIncidente,
  priorizarIncidente,
  programarIntervencion,
  verificarIncidente,
} from "@/lib/acciones";
import { GLOSARIO } from "@/lib/glosario";

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
  // Deshacer una verificación pide motivo: ver el bloque de abajo.
  const [deshaciendo, setDeshaciendo] = useState(false);
  const [motivo, setMotivo] = useState("");

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
        title={GLOSARIO.priorizar.texto}
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
        title={GLOSARIO.programar.texto}
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
        title={GLOSARIO.verificar.texto}
        className="rounded-md border border-resuelto/50 bg-resuelto/10 px-2.5 py-1 text-[11px] font-semibold text-resuelto transition hover:bg-resuelto/20 disabled:opacity-50"
      >
        Verificar ✓
      </button>
    );
  }

  /**
   * DESHACER la verificación. Verificar era un camino de una sola dirección:
   * un clic sobre la fila equivocada dejaba el bache marcado como controlado
   * en campo para siempre. Pide motivo —igual que el rechazo de un propuesto—
   * porque deshacer un control es una decisión, no un resbalón.
   */
  if (puedeVerificar && estado === "verificado") {
    return deshaciendo ? (
      <span className="flex flex-wrap items-center gap-1.5">
        <input
          autoFocus
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="¿Por qué se deshace?"
          className="w-44 rounded-md border border-borde-2 bg-panel-2 px-2 py-1 text-[11px] placeholder:text-texto-3"
        />
        <button
          disabled={pendiente || motivo.trim().length < 3}
          onClick={() => ejecutar(() => desverificarIncidente({ incidenteId, motivo: motivo.trim() }))}
          className="rounded-md bg-amarillo px-2.5 py-1 text-[11px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {pendiente ? "…" : "Confirmar"}
        </button>
        <button
          onClick={() => setDeshaciendo(false)}
          disabled={pendiente}
          className="text-[11px] text-texto-3 hover:text-texto-2"
        >
          Cancelar
        </button>
      </span>
    ) : (
      <button
        disabled={pendiente}
        onClick={() => setDeshaciendo(true)}
        title="Deshacer la verificación: el trabajo sigue hecho, se deshace el control en campo"
        className="rounded-md border border-borde-2 px-2.5 py-1 text-[11px] font-semibold text-texto-3 transition hover:border-amarillo/60 hover:text-amarillo disabled:opacity-50"
      >
        Deshacer verificación
      </button>
    );
  }

  return null;
}
