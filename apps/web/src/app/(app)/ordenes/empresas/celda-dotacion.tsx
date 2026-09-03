"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { actualizarEmpresa } from "@/lib/acciones-ordenes";

/**
 * Celda editable de la dotación de una empresa (cuadrillas o turnos/día):
 * "eso puede ir variando" (el Director), así que se corrige acá mismo, sin
 * formulario aparte. Guarda al salir del campo o con Enter; si el valor no
 * cambió, no viaja nada al servidor.
 */
export function CeldaDotacion({
  empresaId,
  campo,
  valor,
  min,
  max,
}: {
  empresaId: number;
  campo: "cuadrillas" | "turnosPorDia";
  valor: number;
  min: number;
  max: number;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [texto, setTexto] = useState(String(valor));
  const [error, setError] = useState<string | null>(null);

  const guardar = () => {
    const n = Number(texto.trim());
    if (!Number.isInteger(n) || n < min || n > max) {
      setError(`Entre ${min} y ${max}`);
      return;
    }
    setError(null);
    if (n === valor) return; // sin cambios: nada que guardar
    startTransition(async () => {
      try {
        await actualizarEmpresa({
          empresaId,
          ...(campo === "cuadrillas" ? { cuadrillas: n } : { turnosPorDia: n }),
        });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar");
        setTexto(String(valor));
      }
    });
  };

  return (
    <div className="inline-flex flex-col items-end">
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={texto}
        disabled={pendiente}
        onChange={(e) => {
          setTexto(e.target.value);
          setError(null);
        }}
        onBlur={guardar}
        onKeyDown={(e) => {
          // Enter dispara el blur, y el blur guarda: un solo camino, sin doble envío.
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setTexto(String(valor));
            setError(null);
          }
        }}
        title={`Se guarda al salir del campo o con Enter (${min}–${max})`}
        className={`num w-16 rounded-lg border bg-panel-2 px-2 py-1 text-right text-sm transition disabled:opacity-50 ${
          error ? "border-peligro/60" : "border-borde-2 focus:border-celeste"
        }`}
      />
      {pendiente && <span className="mt-0.5 text-[9px] text-texto-3">Guardando…</span>}
      {error && <span className="mt-0.5 text-[9px] text-peligro">{error}</span>}
    </div>
  );
}
