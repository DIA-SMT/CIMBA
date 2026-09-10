"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { regenerarClaveUsuario } from "@/lib/acciones-usuarios";

/**
 * Resetea la clave de un acceso local (la perdió, sospecha de uso indebido,
 * cambió de responsable el puesto…) y la muestra UNA sola vez. La anterior
 * deja de servir en el momento — por eso pide un segundo clic.
 */
export function BotonClaveUsuario({ perfilId }: { perfilId: string }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [clave, setClave] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [copiada, setCopiada] = useState(false);

  const regenerar = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await regenerarClaveUsuario({ perfilId });
        setClave(r.clave);
        setConfirmando(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo regenerar la clave");
      }
    });
  };

  const copiar = async () => {
    if (!clave) return;
    try {
      await navigator.clipboard.writeText(clave);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2500);
    } catch {
      setError("No se pudo copiar sola: seleccionala y copiala a mano.");
    }
  };

  if (clave) {
    return (
      <div>
        <div className="flex items-center gap-1.5">
          <code className="num rounded-md border border-amarillo/50 bg-amarillo/10 px-2 py-0.5 text-xs font-bold tracking-wider text-amarillo select-all">
            {clave}
          </code>
          <button
            onClick={() => void copiar()}
            title="Copiar la clave"
            className="rounded-md border border-borde-2 p-1 text-texto-2 transition hover:border-celeste hover:text-celeste"
          >
            {copiada ? <Check size={11} style={{ color: "#199e70" }} /> : <Copy size={11} />}
          </button>
        </div>
        <p className="mt-0.5 text-[10px] text-peligro">no se repite: pasásela ahora</p>
      </div>
    );
  }

  if (confirmando) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          disabled={pendiente}
          onClick={regenerar}
          className="rounded-md border border-peligro/50 bg-peligro/10 px-2 py-1 text-[10px] font-semibold text-peligro transition hover:bg-peligro/20 disabled:opacity-50"
        >
          {pendiente ? "…" : "¿Seguro?"}
        </button>
        <button onClick={() => setConfirmando(false)} className="text-[10px] text-texto-3 hover:text-texto">
          cancelar
        </button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setConfirmando(true)}
        title="La clave actual deja de servir al confirmar"
        className="flex items-center gap-1 rounded-md border border-borde-2 px-2 py-1 text-[10px] font-semibold text-texto-2 transition hover:border-amarillo/50 hover:text-amarillo"
      >
        <KeyRound size={11} /> Resetear clave
      </button>
      {error && <p className="mt-0.5 text-[10px] text-peligro">{error}</p>}
    </div>
  );
}
