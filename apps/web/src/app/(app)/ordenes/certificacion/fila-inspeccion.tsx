"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { registrarInspeccion } from "@/lib/acciones-certificacion";
import { mensajeDeError } from "@/lib/errores";

/**
 * Los dos únicos veredictos posibles en la calle: conforme o con observación.
 * Observar obliga a escribir qué se vio — un "observado" sin motivo no le
 * sirve a nadie después, ni para la garantía ni para la próxima licitación.
 */
export function FilaInspeccion({
  intervencionId,
  momento,
}: {
  intervencionId: number;
  momento: "24h" | "30d" | "90d" | "6m";
}) {
  const router = useRouter();
  const [pendiente, comenzar] = useTransition();
  const [escribiendo, setEscribiendo] = useState(false);
  const [obs, setObs] = useState("");
  const [error, setError] = useState<string | null>(null);

  const registrar = (resultado: "conforme" | "observado") =>
    comenzar(async () => {
      setError(null);
      try {
        await registrarInspeccion({
          intervencionId,
          momento,
          resultado,
          observaciones: obs.trim() || undefined,
        });
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo registrar"));
      }
    });

  if (escribiendo) {
    return (
      <div className="flex flex-col items-end gap-1.5">
        <input
          autoFocus
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="¿Qué se observó?"
          className="w-52 rounded-lg border border-borde-2 bg-panel px-2.5 py-1.5 text-xs outline-none focus:border-celeste"
        />
        <div className="flex gap-1.5">
          <button
            disabled={pendiente || obs.trim().length < 3}
            onClick={() => registrar("observado")}
            className="rounded-md bg-peligro px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {pendiente ? "…" : "Registrar observación"}
          </button>
          <button onClick={() => setEscribiendo(false)} className="text-[11px] text-texto-3 hover:text-texto">
            cancelar
          </button>
        </div>
        {error && <p className="text-[10px] text-peligro">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <button
        disabled={pendiente}
        onClick={() => registrar("conforme")}
        title="La reparación está en condiciones"
        className="inline-flex items-center gap-1 rounded-md border border-borde-2 px-2.5 py-1 text-[11px] font-semibold text-texto-2 transition hover:border-[#199e70] hover:text-[#199e70] disabled:opacity-50"
      >
        <Check size={12} /> Conforme
      </button>
      <button
        disabled={pendiente}
        onClick={() => setEscribiendo(true)}
        title="Registrar un hallazgo"
        className="inline-flex items-center gap-1 rounded-md border border-borde-2 px-2.5 py-1 text-[11px] font-semibold text-texto-2 transition hover:border-peligro hover:text-peligro disabled:opacity-50"
      >
        <X size={12} /> Observar
      </button>
      {error && <p className="text-[10px] text-peligro">{error}</p>}
    </div>
  );
}
