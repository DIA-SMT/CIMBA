"use client";

import { Printer } from "lucide-react";
import { imprimirComo, nombreArchivo } from "@/lib/nombre-archivo";

/**
 * window.print() necesita el navegador, así que la página server delega en
 * esta isla mínima. La hoja de impresión ya está armada por el CSS de
 * nota-sat: acá solo se dispara, con el nombre codificado del canal.
 */
export function BotonImprimir({ documento }: { documento: string }) {
  return (
    <button
      onClick={() => imprimirComo(nombreArchivo(documento))}
      className="flex items-center gap-2 rounded-lg border border-borde-2 px-4 py-2.5 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste"
    >
      <Printer size={15} /> Imprimir o guardar en PDF
    </button>
  );
}
