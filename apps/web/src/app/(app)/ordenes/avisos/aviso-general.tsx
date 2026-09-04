"use client";

import { Megaphone } from "lucide-react";
import { useState, useTransition } from "react";
import { enviarAvisoGeneral } from "@/lib/acciones-avisos";

interface Resultado {
  push: number;
  emails: number;
  saltados: string[];
}

/**
 * El megáfono del Director: redacta y manda YA a los destinatarios de la
 * tarjeta "Aviso general". Muestra el resultado REAL que devuelve el
 * despachador — cuántos push, cuántos emails, qué se salteó — sin inventar
 * éxito que no hubo.
 */
export function AvisoGeneral({ hayDestinatariosActivos }: { hayDestinatariosActivos: boolean }) {
  const [pendiente, startTransition] = useTransition();
  const [asunto, setAsunto] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mandar = () => {
    setError(null);
    setResultado(null);
    if (asunto.trim().length < 3) {
      setError("El asunto necesita al menos 3 caracteres.");
      return;
    }
    if (mensaje.trim().length < 3) {
      setError("Escribí el mensaje antes de mandarlo.");
      return;
    }
    startTransition(async () => {
      try {
        const r = await enviarAvisoGeneral({ asunto: asunto.trim(), mensaje: mensaje.trim() });
        setResultado({ push: r.push, emails: r.emails, saltados: r.saltados });
        if (r.push > 0 || r.emails > 0) {
          setAsunto("");
          setMensaje("");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo mandar el aviso");
      }
    });
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        mandar();
      }}
    >
      {!hayDestinatariosActivos && (
        <p className="rounded-lg border border-amarillo/40 bg-amarillo/10 px-3 py-2 text-xs text-amarillo">
          La tarjeta “Aviso general” no tiene destinatarios activos: lo que mandes ahora no le llega a
          nadie. Agregá al menos uno arriba.
        </p>
      )}

      <input
        type="text"
        value={asunto}
        onChange={(e) => setAsunto(e.target.value)}
        maxLength={150}
        placeholder="Asunto — ej.: Corte por repavimentación en Av. Roca"
        aria-label="Asunto del aviso"
        className="w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm"
      />
      <textarea
        value={mensaje}
        onChange={(e) => setMensaje(e.target.value)}
        maxLength={3000}
        rows={4}
        placeholder="El mensaje. Por push llegan los primeros 160 caracteres; por email va completo."
        aria-label="Mensaje del aviso"
        className="w-full resize-y rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm leading-relaxed"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pendiente}
          className="flex items-center gap-2 rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          <Megaphone size={15} />
          {pendiente ? "Mandando…" : "Mandar ahora"}
        </button>
        <span className="text-[11px] text-texto-3">
          Va a los destinatarios activos de la tarjeta “Aviso general”.
        </span>
      </div>

      {error && <p className="text-sm text-peligro">{error}</p>}

      {resultado && (
        <div
          className={`rounded-lg border px-3 py-2.5 text-sm ${
            resultado.push > 0 || resultado.emails > 0
              ? "border-ok/40 bg-ok/10"
              : "border-amarillo/40 bg-amarillo/10"
          }`}
        >
          {resultado.push > 0 || resultado.emails > 0 ? (
            <p style={{ color: "var(--color-ok)" }}>
              Llegó por push a {resultado.push} dispositivo{resultado.push === 1 ? "" : "s"} y por email a{" "}
              {resultado.emails} dirección{resultado.emails === 1 ? "" : "es"}.
            </p>
          ) : (
            <p className="text-amarillo">El aviso no llegó a nadie.</p>
          )}
          {resultado.saltados.length > 0 && (
            <div className="mt-1.5 text-xs text-texto-2">
              <p className="font-semibold text-amarillo">Saltados:</p>
              <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                {resultado.saltados.map((s, i) => (
                  <li key={i} className="break-all">
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
