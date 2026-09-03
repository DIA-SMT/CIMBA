"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Visor de fotos liviano y reutilizable — el pedido literal del Director:
 * "que se haga click en las fotos sin salir; no quiero abrir muchas pestañas".
 *
 * Dos piezas, mismo patrón que el modal del mini-mapa (mapa/mini-mapa.tsx):
 *  - <GaleriaFotos>: las miniaturas (img lazy, alto fijo) que abren el visor
 *    en el índice clickeado.
 *  - <VisorFotos>: el lightbox en sí — overlay fixed en un portal a <body>,
 *    montado recién al abrirse, así las tablas con muchas filas no pagan nada.
 * Sin dependencias nuevas: portal + teclado + estado local, nada más.
 */

export interface FotoVisor {
  url: string;
  /** Leyenda grande del visor, p. ej. "ANTES · 26/06/26". */
  etiqueta?: string | null;
  alt?: string;
  /** Insignia sobre la miniatura (ANTES / DURANTE / DESPUÉS) con su color funcional. */
  insignia?: { texto: string; color: string } | null;
  /** Sello al pie de la miniatura, línea por línea (fecha, coordenadas). */
  sello?: string[] | null;
}

export function VisorFotos({
  fotos,
  indiceInicial = 0,
  alCerrar,
}: {
  fotos: FotoVisor[];
  /** El visor arranca en la foto clickeada, no siempre en la primera. */
  indiceInicial?: number;
  alCerrar: () => void;
}) {
  const [indice, setIndice] = useState(indiceInicial);

  // Teclado: ←/→ navegan (con vuelta), Escape cierra. El listener vive solo
  // mientras el visor está montado — el mismo esquema del ChipMiniMapa.
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        alCerrar();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setIndice((i) => (i - 1 + fotos.length) % fotos.length);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        setIndice((i) => (i + 1) % fotos.length);
      }
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [fotos.length, alCerrar]);

  // Con el visor abierto, la página de atrás no debe scrollear (clave en el
  // portal de empresas, que es mobile). Se restaura lo que hubiera antes.
  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, []);

  const foto = fotos[indice];
  if (!foto) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={foto.etiqueta ?? `Foto ${indice + 1} de ${fotos.length}`}
    >
      {/* Backdrop: bg-fondo flipea solo con el tema; click afuera cierra. */}
      <div className="absolute inset-0 bg-fondo/85" onClick={alCerrar} />

      {/* relative: sin posicionar, la imagen quedaría pintada DEBAJO del
          backdrop posicionado y el click "sobre la foto" la cerraría. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- imagen de Storage, sin optimizador */}
      <img
        src={foto.url}
        alt={foto.alt ?? foto.etiqueta ?? `Foto ${indice + 1}`}
        className="relative max-h-[85vh] max-w-[90vw] rounded-xl border border-borde object-contain shadow-2xl"
      />

      {/* Contador y cierre, arriba */}
      <span className="num absolute top-3 left-4 rounded-lg border border-borde bg-panel/85 px-2.5 py-1 text-xs font-bold text-texto-2">
        {indice + 1} / {fotos.length}
      </span>
      <button
        type="button"
        onClick={alCerrar}
        title="Cerrar (Escape)"
        className="absolute top-3 right-3 rounded-lg border border-borde bg-panel/85 p-2.5 text-texto-2 transition hover:text-peligro"
      >
        <X size={18} />
      </button>

      {/* La etiqueta abajo: qué momento es y de cuándo */}
      {foto.etiqueta && (
        <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center">
          <span className="rounded-lg border border-borde bg-panel/85 px-3 py-1.5 text-sm font-semibold">
            {foto.etiqueta}
          </span>
        </p>
      )}

      {/* Flechas: targets grandes, pensadas para el capataz en la calle */}
      {fotos.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => setIndice((i) => (i - 1 + fotos.length) % fotos.length)}
            title="Anterior (←)"
            className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full border border-borde bg-panel/85 p-3 text-texto transition hover:text-celeste sm:left-4"
          >
            <ChevronLeft size={26} />
          </button>
          <button
            type="button"
            onClick={() => setIndice((i) => (i + 1) % fotos.length)}
            title="Siguiente (→)"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full border border-borde bg-panel/85 p-3 text-texto transition hover:text-celeste sm:right-4"
          >
            <ChevronRight size={26} />
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

export function GaleriaFotos({
  fotos,
  miniAlto = 128,
  miniAncho,
  className = "flex flex-wrap gap-2",
}: {
  fotos: FotoVisor[];
  /** Alto fijo de las miniaturas, en px. */
  miniAlto?: number;
  /** Ancho fijo (tablas, tiras horizontales); sin él la miniatura llena su celda de grilla. */
  miniAncho?: number;
  /** Layout del contenedor: cada página trae su grilla o su tira scrolleable. */
  className?: string;
}) {
  const [indiceAbierto, setIndiceAbierto] = useState<number | null>(null);

  if (fotos.length === 0) return null;

  return (
    <>
      <div className={className}>
        {fotos.map((fo, i) => (
          <button
            key={i}
            type="button"
            onClick={(e) => {
              // En filas clickeables la miniatura no debe disparar la fila.
              e.stopPropagation();
              setIndiceAbierto(i);
            }}
            title={fo.etiqueta ? `Ampliar: ${fo.etiqueta}` : "Ampliar foto"}
            className="group relative block shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-borde transition hover:border-celeste"
            style={{ height: miniAlto, width: miniAncho }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- imagen de Storage, sin optimizador */}
            <img
              src={fo.url}
              alt={fo.alt ?? fo.etiqueta ?? "Foto de obra"}
              loading="lazy"
              className="h-full w-full object-cover transition group-hover:brightness-110"
            />
            {fo.insignia && (
              <span
                className="absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase"
                /* Fondo oscuro fijo: va SOBRE la foto, no sobre el panel — no debe flipear. */
                style={{ background: "rgba(7,10,16,0.8)", color: fo.insignia.color }}
              >
                {fo.insignia.texto}
              </span>
            )}
            {fo.sello && fo.sello.length > 0 && (
              <span className="absolute inset-x-0 bottom-0 bg-fondo/85 px-1.5 py-1 text-left text-[9px] leading-tight text-texto-2">
                {fo.sello.map((linea, j) => (
                  <span key={j} className={j === 0 ? "block" : "num block text-texto-3"}>
                    {linea}
                  </span>
                ))}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* El visor se monta recién al click: cerrado no cuesta nada. */}
      {indiceAbierto != null && (
        <VisorFotos fotos={fotos} indiceInicial={indiceAbierto} alCerrar={() => setIndiceAbierto(null)} />
      )}
    </>
  );
}
