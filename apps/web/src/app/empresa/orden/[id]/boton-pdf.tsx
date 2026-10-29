"use client";

import { FileText } from "lucide-react";
import { documentoOrden, imprimirComo, nombreArchivo } from "@/lib/nombre-archivo";

/**
 * LA ORDEN EN PDF, la misma hoja que baja la Dirección: la planilla con cada
 * bache, sus medidas, el ticket, la fecha y las fotos (pedido del usuario,
 * 14/10). El navegador la arma con "Guardar como PDF" en el diálogo de
 * impresión: en el celular, Android lo ofrece como impresora y el iPhone
 * desde Compartir. Sale con el mismo nombre codificado que la de la Dirección.
 */
export function BotonPdfOrden({ cerrados, numero }: { cerrados: number; numero: string }) {
  return (
    <button
      type="button"
      onClick={() => imprimirComo(nombreArchivo(documentoOrden(numero)))}
      className="mb-4 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-borde-2 px-3 text-sm font-semibold text-texto-2 transition hover:border-celeste/60 hover:text-celeste"
      title="Abre la impresión: elegí «Guardar como PDF»"
    >
      <FileText size={15} className="shrink-0" />
      Descargar la orden en PDF, con fotos{cerrados > 0 ? ` (${cerrados} cargados)` : ""}
    </button>
  );
}
