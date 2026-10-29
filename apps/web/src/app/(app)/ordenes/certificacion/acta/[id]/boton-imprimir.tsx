"use client";

import { Printer } from "lucide-react";
import { imprimirComo, nombreArchivo } from "@/lib/nombre-archivo";

/** Imprimir el acta (o guardarla como PDF) para las firmas en papel, con su número en el nombre. */
export function BotonImprimir({ numero }: { numero: string }) {
  return (
    <button
      type="button"
      onClick={() => imprimirComo(nombreArchivo(numero))}
      className="flex items-center gap-2 rounded-lg border border-borde-2 px-4 py-2 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste"
    >
      <Printer size={15} /> Imprimir el acta
    </button>
  );
}
