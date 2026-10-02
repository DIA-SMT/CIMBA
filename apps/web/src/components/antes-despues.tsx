"use client";

import { ChevronsLeftRight } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * ANTES | DESPUÉS con cortina. Las dos fotos del mismo bache, una encima de la
 * otra; la de arriba (el antes) se recorta con clip-path hasta donde está el
 * divisor, y el divisor se mueve arrastrando en cualquier punto de la imagen.
 *
 * El control es un <input type="range"> invisible que ocupa toda la imagen:
 * anda con el dedo, con el mouse y con las flechas del teclado, y no hay que
 * inventar ningún manejo de eventos. La prueba más contundente que tiene la
 * pantalla de Avance en cuatro líneas de CSS.
 *
 * Con `barrido` la cortina se corre sola: arranca mostrando el antes y a
 * los dos segundos lo barre hasta el después. Es lo que hace el visor cuando
 * las fotos pasan solas en el televisor.
 */
export function AntesDespues({
  antes,
  despues,
  alt,
  className = "",
  ajuste = "cover",
  barrido = false,
}: {
  antes: string;
  despues: string;
  alt: string;
  /** Tamaño y forma los pone quien lo usa (p. ej. `aspect-[4/3] w-full`). */
  className?: string;
  /** "cover" llena el marco (fichas chicas); "contain" muestra la foto entera (pantalla completa). */
  ajuste?: "cover" | "contain";
  /** Correr la cortina sola, del antes al después. */
  barrido?: boolean;
}) {
  const [pos, setPos] = useState(barrido ? 100 : 50);

  useEffect(() => {
    if (!barrido) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setPos(50);
      return;
    }
    let raf = 0;
    const inicio = performance.now() + 1400;
    const DURACION = 2200;
    const paso = (ahora: number) => {
      const x = Math.min(1, Math.max(0, (ahora - inicio) / DURACION));
      // Suave al arrancar y al frenar.
      const e = x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
      setPos(100 - e * 100);
      if (x < 1) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [barrido]);
  const encaje = ajuste === "contain" ? "object-contain" : "object-cover";
  return (
    <div className={`relative overflow-hidden rounded-lg border border-borde bg-panel-3 select-none ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- fotos de Storage/externas */}
      <img src={despues} alt={alt} className={`block h-full w-full ${encaje}`} draggable={false} loading="lazy" />
      {/* eslint-disable-next-line @next/next/no-img-element -- fotos de Storage/externas */}
      <img
        src={antes}
        alt=""
        aria-hidden="true"
        className={`absolute inset-0 h-full w-full ${encaje}`}
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        draggable={false}
        loading="lazy"
      />
      <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%` }} aria-hidden="true">
        <div className="absolute inset-y-0 -ml-px w-0.5 bg-white shadow-[0_0_6px_rgba(0,0,0,.6)]" />
        <div className="absolute top-1/2 -ml-3.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-black shadow-lg">
          <ChevronsLeftRight size={14} />
        </div>
      </div>
      <span className="pointer-events-none absolute top-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase">
        Antes
      </span>
      <span className="pointer-events-none absolute top-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase">
        Después
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        aria-label="Comparar el antes y el después: arrastrá el divisor"
        className="absolute inset-0 m-0 h-full w-full cursor-ew-resize appearance-none bg-transparent opacity-0"
      />
    </div>
  );
}
