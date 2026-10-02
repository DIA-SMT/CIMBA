"use client";

import { Printer } from "lucide-react";

/**
 * window.print() necesita el navegador, así que la página server delega en
 * esta isla mínima. La hoja de impresión ya está armada por el CSS de
 * nota-sat: acá solo se dispara.
 */
export function BotonImprimir() {
  return (
    <button
      onClick={() => window.print()}
      className="flex items-center gap-2 rounded-lg border border-borde-2 px-4 py-2.5 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste"
    >
      <Printer size={15} /> Imprimir o guardar en PDF
    </button>
  );
}
