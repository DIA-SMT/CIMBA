"use client";

import { Printer } from "lucide-react";

export function BotonImprimirNota() {
  return (
    <button
      onClick={() => window.print()}
      className="flex items-center gap-2 rounded-lg border border-borde-2 px-4 py-2 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste"
    >
      <Printer size={15} /> Imprimir la nota
    </button>
  );
}
