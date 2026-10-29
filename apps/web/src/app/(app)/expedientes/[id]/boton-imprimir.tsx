"use client";

import { Printer } from "lucide-react";
import { imprimirComo, nombreArchivo } from "@/lib/nombre-archivo";

/** La nota sale con su número en el nombre: CIMBA-NOTA-SAT-2026-0005-AAAAMMDD. */
export function BotonImprimirNota({ numero }: { numero: string }) {
  return (
    <button
      onClick={() => imprimirComo(nombreArchivo(numero))}
      className="flex items-center gap-2 rounded-lg border border-borde-2 px-4 py-2 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste"
    >
      <Printer size={15} /> Imprimir la nota
    </button>
  );
}
