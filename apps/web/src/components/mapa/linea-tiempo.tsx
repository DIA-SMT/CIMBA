"use client";

import { Pause, Play, X } from "lucide-react";
import { useEffect } from "react";
import { numero } from "@/lib/formato";

const MESES_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function etiquetaMes(mes: string): string {
  const [anio, m] = mes.split("-");
  return `${MESES_ES[Number(m) - 1] ?? m} ${anio}`;
}

/**
 * Línea de tiempo reproducible: recorre la historia mes a mes — los pedidos
 * van apareciendo y las reparaciones los van apagando. Para presentar el
 * avance del plan de bacheo sin una sola planilla.
 */
export function LineaTiempo({
  meses,
  idx,
  setIdx,
  reproduciendo,
  setReproduciendo,
  alCerrar,
  pedidosVisibles,
  reparacionesVisibles,
}: {
  meses: string[];
  idx: number;
  setIdx: (i: number) => void;
  reproduciendo: boolean;
  setReproduciendo: (r: boolean) => void;
  alCerrar: () => void;
  pedidosVisibles: number;
  reparacionesVisibles: number;
}) {
  useEffect(() => {
    if (!reproduciendo) return;
    const id = setInterval(() => {
      if (idx >= meses.length - 1) {
        setReproduciendo(false);
        return;
      }
      setIdx(idx + 1);
    }, 800);
    return () => clearInterval(id);
  }, [reproduciendo, idx, meses.length, setIdx, setReproduciendo]);

  const mes = meses[idx] ?? meses[meses.length - 1] ?? "";

  return (
    <div className="panel-vidrio absolute bottom-6 left-1/2 z-20 w-[520px] max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-2xl px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold tracking-wider text-texto-3 uppercase">
          Línea de tiempo · historia del bacheo
        </span>
        <button onClick={alCerrar} className="text-texto-3 hover:text-texto" title="Cerrar línea de tiempo">
          <X size={14} />
        </button>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={() => {
            if (idx >= meses.length - 1) setIdx(0);
            setReproduciendo(!reproduciendo);
          }}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-azul text-white transition hover:brightness-110"
          title={reproduciendo ? "Pausar" : "Reproducir la historia"}
        >
          {reproduciendo ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between">
            <span className="text-xl font-extrabold tracking-tight capitalize">{etiquetaMes(mes)}</span>
            <span className="num text-[11px] text-texto-2">
              <span style={{ color: "#3987e5" }}>●</span> {numero(pedidosVisibles)} pedidos ·{" "}
              <span style={{ color: "#199e70" }}>●</span> {numero(reparacionesVisibles)} reparaciones
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(0, meses.length - 1)}
            value={idx}
            onChange={(e) => {
              setReproduciendo(false);
              setIdx(Number(e.target.value));
            }}
            className="w-full accent-[#0066ff]"
          />
          <div className="flex justify-between text-[9px] text-texto-3">
            <span>{etiquetaMes(meses[0] ?? "")}</span>
            <span>{etiquetaMes(meses[meses.length - 1] ?? "")}</span>
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-texto-3">
        Solo pedidos con fecha de origen confiable; el consolidado histórico sin fecha queda fuera de la película.
      </p>
    </div>
  );
}
