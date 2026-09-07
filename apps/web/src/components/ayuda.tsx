"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { GLOSARIO, type ClaveGlosario } from "@/lib/glosario";

/**
 * La ⓘ de "¿qué es esto?": un toque y aparece la explicación del glosario,
 * ahí mismo, sin ir a ningún lado. Para lo que un title= no alcanza (en el
 * teléfono no hay hover) — "necesito poder explicar muy bien todo y que sea
 * intuitivo".
 */
export function Ayuda({ termino, alinear = "izquierda" }: { termino: ClaveGlosario; alinear?: "izquierda" | "derecha" }) {
  const [abierta, setAbierta] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const t = GLOSARIO[termino];

  useEffect(() => {
    if (!abierta) return;
    const cerrar = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === "Escape") setAbierta(false);
        return;
      }
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierta(false);
    };
    window.addEventListener("mousedown", cerrar);
    window.addEventListener("keydown", cerrar);
    return () => {
      window.removeEventListener("mousedown", cerrar);
      window.removeEventListener("keydown", cerrar);
    };
  }, [abierta]);

  return (
    <span ref={ref} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        title={abierta ? undefined : `${t.titulo}: tocá para la explicación`}
        aria-label={`Qué significa ${t.titulo}`}
        className={`inline-flex h-4.5 w-4.5 items-center justify-center rounded-full transition ${
          abierta ? "text-celeste" : "text-texto-3 hover:text-celeste"
        }`}
      >
        <HelpCircle size={13} />
      </button>
      {abierta && (
        <span
          role="tooltip"
          className={`panel-vidrio absolute top-6 z-40 block w-72 max-w-[80vw] rounded-xl p-3 text-left shadow-xl ${
            alinear === "derecha" ? "right-0" : "left-0"
          }`}
        >
          <span className="block text-xs font-bold">{t.titulo}</span>
          <span className="mt-1 block text-[11.5px] leading-relaxed font-normal text-texto-2 normal-case">
            {t.texto}
          </span>
        </span>
      )}
    </span>
  );
}
