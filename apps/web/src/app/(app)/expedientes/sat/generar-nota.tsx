"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generarNotaSat } from "@/lib/acciones-tratamiento";

/**
 * El acto administrativo: registrar la nota. Dos pasos a propósito — generar
 * numera el expediente, congela el detalle y deriva los reclamos; no hay
 * vuelta atrás liviana, así que el botón lo dice con todas las letras.
 */
export function GenerarNota({ cantidad }: { cantidad: number }) {
  const router = useRouter();
  const [observaciones, setObservaciones] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const generar = () => {
    setError(null);
    iniciar(async () => {
      try {
        const r = await generarNotaSat({
          observaciones: observaciones.trim() || undefined,
        });
        router.push(`/expedientes/${r.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo registrar la nota");
        setConfirmando(false);
      }
    });
  };

  return (
    <div className="panel-vidrio mx-auto mt-6 max-w-3xl rounded-2xl p-5 print:hidden">
      <label className="mb-1 block text-xs font-semibold tracking-wider text-texto-3 uppercase">
        Párrafo adicional (opcional — se agrega al cuerpo de la nota)
      </label>
      <textarea
        value={observaciones}
        onChange={(e) => setObservaciones(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Ej.: Se solicita priorizar los casos con pérdida activa sobre calzada."
        className="w-full rounded-xl border border-borde-2 bg-panel-2 px-4 py-3 text-sm outline-none placeholder:text-texto-3 focus:border-celeste/50"
      />
      {error && <p className="mt-2 text-center text-xs text-peligro">{error}</p>}
      <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
        <p className="text-xs text-texto-3">
          Al registrar: la nota queda numerada en el registro de expedientes y los{" "}
          <b>{cantidad}</b> reclamos salen de la cola de bacheo con esa referencia.
        </p>
        {confirmando ? (
          <div className="flex items-center gap-2">
            <button
              onClick={generar}
              disabled={pendiente}
              className="rounded-xl bg-azul px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {pendiente ? "Registrando…" : `Sí, registrar la nota (${cantidad})`}
            </button>
            <button
              onClick={() => setConfirmando(false)}
              disabled={pendiente}
              className="px-2 py-2 text-sm text-texto-3 hover:text-texto"
            >
              no
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmando(true)}
            className="rounded-xl bg-azul px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            Generar y registrar la nota
          </button>
        )}
      </div>
    </div>
  );
}
