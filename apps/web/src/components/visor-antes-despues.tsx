"use client";

import { ChevronLeft, ChevronRight, MapPin, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AntesDespues } from "./antes-despues";

/**
 * EL ANTES Y EL DESPUÉS A PANTALLA COMPLETA. Para mostrar en una reunión o en
 * el televisor: la cortina ocupando toda la pantalla, el lugar y la empresa
 * abajo, flechas para pasar de un trabajo al otro y un botón para ir al punto
 * en el mapa. Sin antes, muestra solo el después, grande.
 *
 * Mismo patrón que el visor de fotos del resto del sistema: overlay fixed en
 * un portal a <body>, montado recién al abrirse, teclado (←/→ navegan, Escape
 * cierra), nada más.
 */

export interface ParAntesDespues {
  antes: string | null;
  despues: string;
  titulo: string;
  sub?: string | null;
  lon?: number | null;
  lat?: number | null;
  /** La intervención, para que el mapa abra su ficha al ir. */
  id?: number | null;
}

export function VisorAntesDespues({
  pares,
  indiceInicial = 0,
  alCerrar,
  alIrAlMapa,
}: {
  pares: ParAntesDespues[];
  indiceInicial?: number;
  alCerrar: () => void;
  alIrAlMapa?: (lugar: { lon: number; lat: number; id: number | null }) => void;
}) {
  const [indice, setIndice] = useState(Math.min(indiceInicial, Math.max(0, pares.length - 1)));
  const par = pares[indice];

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        alCerrar();
      } else if (e.key === "ArrowLeft" && pares.length > 1) {
        e.preventDefault();
        setIndice((i) => (i - 1 + pares.length) % pares.length);
      } else if (e.key === "ArrowRight" && pares.length > 1) {
        e.preventDefault();
        setIndice((i) => (i + 1) % pares.length);
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [pares.length, alCerrar]);

  if (!par || typeof document === "undefined") return null;

  const ir =
    alIrAlMapa && par.lon != null && par.lat != null
      ? () => {
          alIrAlMapa({ lon: par.lon!, lat: par.lat!, id: par.id ?? null });
          alCerrar();
        }
      : null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/92 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Antes y después del trabajo"
      onClick={alCerrar}
    >
      <div className="relative w-[min(96vw,1500px)]" onClick={(e) => e.stopPropagation()}>
        {par.antes ? (
          <AntesDespues
            key={`${par.antes}|${par.despues}`}
            antes={par.antes}
            despues={par.despues}
            alt={par.titulo}
            ajuste="contain"
            className="h-[min(76vh,900px)] w-full bg-black"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- fotos de Storage/externas
          <img
            src={par.despues}
            alt={par.titulo}
            className="block h-[min(76vh,900px)] w-full rounded-lg object-contain"
          />
        )}

        <div className="mt-3 flex flex-wrap items-end justify-between gap-3 text-white">
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold tracking-tight">{par.titulo}</p>
            {par.sub && <p className="text-sm text-white/70">{par.sub}</p>}
            {!par.antes && <p className="text-xs text-white/50">Este trabajo no tiene foto del antes.</p>}
          </div>
          <div className="flex items-center gap-2">
            {ir && (
              <button
                type="button"
                onClick={ir}
                className="flex items-center gap-1.5 rounded-lg border border-white/30 px-3 py-1.5 text-sm font-semibold transition hover:bg-white/10"
              >
                <MapPin size={14} />
                Ver en el mapa
              </button>
            )}
            {pares.length > 1 && (
              <span className="num text-sm text-white/60">
                {indice + 1} / {pares.length}
              </span>
            )}
          </div>
        </div>

        {pares.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => setIndice((i) => (i - 1 + pares.length) % pares.length)}
              aria-label="Anterior"
              className="absolute top-1/2 -left-2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80 sm:-left-14 sm:p-3"
            >
              <ChevronLeft size={22} />
            </button>
            <button
              type="button"
              onClick={() => setIndice((i) => (i + 1) % pares.length)}
              aria-label="Siguiente"
              className="absolute top-1/2 -right-2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80 sm:-right-14 sm:p-3"
            >
              <ChevronRight size={22} />
            </button>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={alCerrar}
        aria-label="Cerrar"
        className="absolute top-4 right-4 rounded-full bg-black/60 p-2 text-white transition hover:bg-black/80"
      >
        <X size={20} />
      </button>
    </div>,
    document.body,
  );
}
