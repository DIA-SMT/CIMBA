"use client";

import { Printer } from "lucide-react";

/** Imprimir el acta (o guardarla como PDF) para las firmas en papel. */
export function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="flex items-center gap-2 rounded-lg border border-borde-2 px-4 py-2 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste"
    >
      <Printer size={15} /> Imprimir el acta
    </button>
  );
}
