"use client";

import { Check, ChevronDown, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * UN <select> CON BUSCADOR, para listas que no se recorren a ojo.
 *
 * Armar una orden empieza por elegir dónde: 47 circuitos, 20 distritos, más
 * de cien barrios y los corredores del IPI. En un <select> nativo eso es
 * scrollear una lista alfabética hasta encontrarlo — y en el celular, un
 * rodillo de cien nombres. Acá se escribe "sarmiento" y quedan dos.
 *
 * El buscador ignora tildes y mayúsculas a propósito: el Director escribe
 * rápido y sin acentos, y "Nuñez" tiene que encontrar "Núñez".
 *
 * Deliberadamente NO es un combobox libre: solo se puede elegir de la lista.
 * Lo que se elige es una FK que después arma la orden; un texto libre acá
 * sería una orden sin ámbito real.
 */

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

export interface OpcionBuscable {
  ref: number | string;
  etiqueta: string;
  /** Segunda línea opcional: pendientes, sector, lo que ayude a decidir. */
  detalle?: string | null;
}

export function SelectorBuscable({
  opciones,
  valor,
  alElegir,
  placeholder,
  vacio,
  className = "",
}: {
  opciones: OpcionBuscable[];
  /** "" o 0 = sin elegir. */
  valor: number | string;
  alElegir: (ref: number | string) => void;
  placeholder: string;
  /** Qué decir cuando la lista viene vacía de entrada. */
  vacio?: string;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const caja = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const elegida = opciones.find((o) => String(o.ref) === String(valor));

  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (!q) return opciones;
    return opciones.filter(
      (o) => normalizar(o.etiqueta).includes(q) || normalizar(o.detalle ?? "").includes(q),
    );
  }, [opciones, busqueda]);

  // Cerrar al tocar afuera o con Escape: sin esto el panel queda abierto
  // tapando el resto del formulario.
  useEffect(() => {
    if (!abierto) return;
    const afuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("mousedown", afuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", afuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  useEffect(() => {
    if (abierto) input.current?.focus();
    else setBusqueda("");
  }, [abierto]);

  return (
    <div ref={caja} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-left text-sm transition hover:border-celeste/60"
      >
        <span className={`min-w-0 truncate ${elegida ? "" : "text-texto-3"}`}>
          {elegida ? elegida.etiqueta : placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {elegida && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Quitar la selección"
              onClick={(e) => {
                e.stopPropagation();
                alElegir(typeof valor === "number" ? 0 : "");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  alElegir(typeof valor === "number" ? 0 : "");
                }
              }}
              className="rounded p-0.5 text-texto-3 transition hover:text-texto"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={15} className="text-texto-3" />
        </span>
      </button>

      {abierto && (
        <div className="panel-vidrio absolute z-30 mt-1 w-full max-w-[calc(100vw-1.5rem)] rounded-xl p-1.5">
          <div className="relative mb-1.5">
            <Search size={14} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-texto-3" />
            <input
              ref={input}
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              onKeyDown={(e) => {
                // Enter con una sola coincidencia elige: escribir y confirmar
                // sin levantar la mano del teclado.
                if (e.key === "Enter" && visibles.length === 1 && visibles[0]) {
                  alElegir(visibles[0].ref);
                  setAbierto(false);
                }
              }}
              placeholder="Escribí para buscar…"
              className="w-full rounded-lg border border-borde-2 bg-panel px-3 py-2 pl-8 text-sm placeholder:text-texto-3"
            />
          </div>

          <div className="max-h-64 overflow-y-auto">
            {visibles.map((o) => {
              const activa = String(o.ref) === String(valor);
              return (
                <button
                  key={String(o.ref)}
                  type="button"
                  onClick={() => {
                    alElegir(o.ref);
                    setAbierto(false);
                  }}
                  className={`flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                    activa ? "bg-celeste/10 text-celeste" : "hover:bg-panel-3"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{o.etiqueta}</span>
                    {o.detalle && (
                      <span className="block truncate text-[11px] text-texto-3">{o.detalle}</span>
                    )}
                  </span>
                  {activa && <Check size={14} className="mt-0.5 shrink-0" />}
                </button>
              );
            })}

            {visibles.length === 0 && (
              <p className="px-2.5 py-6 text-center text-[12px] text-texto-3">
                {opciones.length === 0
                  ? (vacio ?? "No hay opciones para elegir.")
                  : `Nada coincide con “${busqueda}”.`}
              </p>
            )}
          </div>

          {opciones.length > 12 && visibles.length > 0 && (
            <p className="num border-t border-borde pt-1.5 text-center text-[10px] text-texto-3">
              {visibles.length} de {opciones.length}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
