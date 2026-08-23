"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { GUIA_FUNCIONES } from "@/lib/guia-funciones";

interface Recuadro {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Recorrido guiado del mapa: recorre GUIA_FUNCIONES iluminando el elemento
 * real de cada función (spotlight por data-tour) con su explicación al lado.
 * Los pasos sin elemento visible (gestos como el clic derecho, o botones
 * ocultos en mobile) se muestran como tarjeta centrada.
 */
export function GuiaMapa({ alCerrar }: { alCerrar: () => void }) {
  const [paso, setPaso] = useState(0);
  const [rect, setRect] = useState<Recuadro | null>(null);
  const actual = GUIA_FUNCIONES[paso];
  const ultimo = paso === GUIA_FUNCIONES.length - 1;

  const medir = useCallback(() => {
    const el = actual?.tour ? document.querySelector(`[data-tour="${actual.tour}"]`) : null;
    const r = el?.getBoundingClientRect();
    // Elementos ocultos (display:none en mobile) miden 0: tarjeta centrada.
    setRect(r && r.width > 4 && r.height > 4 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
  }, [actual]);

  useEffect(() => {
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [medir]);

  const siguiente = useCallback(() => {
    if (paso === GUIA_FUNCIONES.length - 1) alCerrar();
    else setPaso((p) => p + 1);
  }, [paso, alCerrar]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") alCerrar();
      if (e.key === "ArrowRight" || e.key === "Enter") siguiente();
      if (e.key === "ArrowLeft") setPaso((p) => Math.max(0, p - 1));
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [alCerrar, siguiente]);

  if (!actual) return null;

  // Tarjeta: pegada al elemento iluminado (arriba o abajo, sin salirse) en
  // pantallas grandes; hoja inferior fija en mobile.
  const ANCHO = 330;
  const ALTO_ESTIMADO = 210;
  const esAngosta = typeof window !== "undefined" && window.innerWidth < 640;
  let estiloTarjeta: React.CSSProperties;
  if (esAngosta) {
    estiloTarjeta = { position: "fixed", left: 12, right: 12, bottom: 12 };
  } else if (rect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const abajo = rect.top + rect.height + 14;
    const top = abajo + ALTO_ESTIMADO > vh - 12 ? Math.max(12, rect.top - ALTO_ESTIMADO - 14) : abajo;
    const left = Math.min(Math.max(12, rect.left), vw - ANCHO - 12);
    estiloTarjeta = { position: "fixed", top, left, width: ANCHO };
  } else {
    estiloTarjeta = { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: ANCHO, maxWidth: "calc(100vw - 24px)" };
  }

  return (
    <div className="fixed inset-0 z-[70]">
      {/* Fondo clickeable: avanza (y bloquea el mapa mientras dura el tour) */}
      <div className="absolute inset-0" onClick={siguiente} />

      {/* Spotlight: agujero de luz alrededor del elemento del paso */}
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-xl border-2 border-amarillo transition-all duration-200"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(5, 8, 14, 0.74), 0 0 24px rgba(244, 220, 0, 0.35)",
          }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 bg-[rgba(5,8,14,0.74)]" />
      )}

      {/* Tarjeta del paso */}
      <div className="panel-vidrio z-[80] rounded-2xl p-4 shadow-2xl" style={estiloTarjeta} onClick={(e) => e.stopPropagation()}>
        <div className="mb-1.5 flex items-start justify-between gap-3">
          <h3 className="text-sm font-bold text-amarillo">{actual.titulo}</h3>
          <button onClick={alCerrar} className="shrink-0 text-texto-3 transition hover:text-texto" title="Salir del recorrido (Esc)">
            <X size={15} />
          </button>
        </div>
        <p className="text-[13px] leading-relaxed text-texto-2">{actual.desc}</p>
        {actual.como && <p className="mt-1.5 text-[11px] leading-snug text-texto-3">{actual.como}</p>}
        <div className="mt-3 flex items-center justify-between">
          <span className="num text-[10px] text-texto-3">
            {paso + 1} de {GUIA_FUNCIONES.length}
          </span>
          <div className="flex items-center gap-1.5">
            {paso > 0 && (
              <button
                onClick={() => setPaso((p) => p - 1)}
                className="flex items-center gap-1 rounded-lg border border-borde-2 px-2.5 py-1.5 text-xs font-semibold text-texto-2 transition hover:text-texto"
              >
                <ChevronLeft size={13} /> Anterior
              </button>
            )}
            <button
              onClick={siguiente}
              className="flex items-center gap-1 rounded-lg bg-azul px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110"
            >
              {ultimo ? "¡Listo!" : "Siguiente"} {!ultimo && <ChevronRight size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
