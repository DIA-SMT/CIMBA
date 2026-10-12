"use client";

import { CalendarDays } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { corregirFechaOrden } from "@/lib/acciones-ordenes";
import { mensajeDeError } from "@/lib/errores";
import { hoyISO } from "@/lib/formato";

/**
 * CORREGIR LA FECHA DE FINALIZACIÓN, al lado de donde se lee.
 *
 * En una orden cerrada es el día en que se terminó; en una viva, el
 * vencimiento. El calendario ofrece solo lo que el servidor acepta: el cierre
 * hasta hoy (hacia atrás sin tope), el vencimiento de hoy en adelante.
 */
export function CorregirFecha({
  ordenId,
  campo,
  actual,
}: {
  ordenId: number;
  campo: "cierre" | "vencimiento";
  /** La fecha de hoy en la orden, 'YYYY-MM-DD', o null si no tiene. */
  actual: string | null;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [fecha, setFecha] = useState(actual ?? "");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const guardar = (valor: string | null) => {
    setError(null);
    startTransition(async () => {
      try {
        await corregirFechaOrden({ ordenId, fecha: valor, motivo: motivo.trim() || undefined });
        setAbierto(false);
        setMotivo("");
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo cambiar la fecha"));
      }
    });
  };

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => {
          setFecha(actual ?? "");
          setAbierto(true);
        }}
        className="inline-flex items-center gap-1 text-xs font-semibold text-celeste hover:underline print:hidden"
        title={campo === "cierre" ? "Corregir el día en que se terminó la orden" : "Cambiar el vencimiento de la orden"}
      >
        <CalendarDays size={12} />
        {campo === "cierre" ? "Corregir fecha de cierre" : actual ? "Cambiar vencimiento" : "Poner vencimiento"}
      </button>
    );
  }

  return (
    <div className="mt-2 w-full max-w-md rounded-xl border border-borde-2 bg-panel p-3 text-left print:hidden">
      <p className="text-sm font-bold">
        {campo === "cierre" ? "Día en que se terminó la orden" : "Vencimiento de la orden"}
      </p>
      <p className="mt-0.5 text-[12px] leading-snug text-texto-2">
        {campo === "cierre"
          ? "Lo cargado no cambia: se corrige solo la fecha de la orden. Queda escrito quién la cambió y cuándo."
          : "Desde hoy en adelante. Queda escrito quién lo cambió y cuándo."}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="date"
          value={fecha}
          max={campo === "cierre" ? hoyISO() : undefined}
          min={campo === "cierre" ? "2020-01-01" : hoyISO()}
          onChange={(e) => setFecha(e.target.value)}
          className="num rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm"
        />
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={500}
          placeholder="Motivo (opcional)"
          className="min-w-40 flex-1 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pendiente || !fecha || fecha === actual}
          onClick={() => guardar(fecha)}
          className="rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {pendiente ? "Guardando…" : "Guardar fecha"}
        </button>
        {campo === "vencimiento" && actual && (
          <button
            type="button"
            disabled={pendiente}
            onClick={() => guardar(null)}
            className="text-sm font-semibold text-texto-2 hover:text-texto disabled:opacity-40"
          >
            Dejarla sin vencimiento
          </button>
        )}
        <button type="button" onClick={() => setAbierto(false)} className="text-sm text-texto-2 hover:text-texto">
          Cancelar
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-peligro">{error}</p>}
    </div>
  );
}
