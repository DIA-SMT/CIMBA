"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cambiarAvisoConfig, type AvisoConfig } from "@/lib/acciones-usuarios";
import { mensajeDeError } from "@/lib/errores";

/**
 * Prender o apagar un aviso. Se ve el estado y se cambia con un clic: la
 * decisión es binaria y reversible, así que no hay confirmación ni guardado
 * aparte.
 */
export function InterruptorAviso({ aviso }: { aviso: AvisoConfig }) {
  const router = useRouter();
  const [pendiente, comenzar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const alternar = () =>
    comenzar(async () => {
      setError(null);
      try {
        await cambiarAvisoConfig({ id: aviso.id, activo: !aviso.activo });
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo cambiar"));
      }
    });

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-borde bg-panel-2 px-2.5 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[12px]">
        {aviso.etiqueta ?? aviso.destino}
        <span className="ml-1.5 text-[10px] tracking-wider text-texto-3 uppercase">{aviso.canal}</span>
      </span>
      <button
        type="button"
        onClick={alternar}
        disabled={pendiente}
        role="switch"
        aria-checked={aviso.activo}
        aria-label={`${aviso.activo ? "Apagar" : "Prender"} el aviso a ${aviso.etiqueta ?? aviso.destino}`}
        className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${
          aviso.activo ? "bg-azul" : "bg-panel-3"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            aviso.activo ? "left-[1.125rem]" : "left-0.5"
          }`}
        />
      </button>
      {error && <span className="text-[10px] text-peligro">{error}</span>}
    </div>
  );
}
