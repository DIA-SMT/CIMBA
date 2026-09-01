"use client";

import { Check, Copy, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generarClaveEmpresa } from "@/lib/acciones-ordenes";

/**
 * Genera la clave de acceso de la empresa y la muestra UNA sola vez (en la
 * base queda solo el hash). Si ya había clave, pide un segundo clic: regenerar
 * corta el acceso del referente hasta que le pasen la nueva.
 */
export function BotonClave({ empresaId, tieneClave }: { empresaId: number; tieneClave: boolean }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [clave, setClave] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [copiada, setCopiada] = useState(false);

  const generar = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await generarClaveEmpresa({ empresaId });
        setClave(r.clave);
        setConfirmando(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo generar la clave");
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
      <div className="max-w-64">
        <div className="flex items-center gap-2">
          <code className="num rounded-md border border-amarillo/50 bg-amarillo/10 px-2.5 py-1 text-sm font-bold tracking-wider text-amarillo select-all">
            {clave}
          </code>
          <button
            onClick={() => void copiar()}
            title="Copiar la clave"
            className="rounded-md border border-borde-2 p-1.5 text-texto-2 transition hover:border-celeste hover:text-celeste"
          >
            {copiada ? <Check size={13} style={{ color: "#199e70" }} /> : <Copy size={13} />}
          </button>
        </div>
        <p className="mt-1 text-[10px] leading-snug text-peligro">
          No se vuelve a mostrar: pasásela al referente ahora.
        </p>
        {error && <p className="mt-1 text-[10px] text-peligro">{error}</p>}
      </div>
    );
  }

  if (tieneClave && !confirmando) {
    return (
      <div>
        <button
          disabled={pendiente}
          onClick={() => setConfirmando(true)}
          className="flex items-center gap-1.5 rounded-md border border-borde-2 px-2.5 py-1.5 text-[11px] font-semibold text-texto-2 transition hover:border-amarillo/50 hover:text-amarillo disabled:opacity-50"
        >
          <KeyRound size={12} /> Regenerar clave
        </button>
        {error && <p className="mt-1 text-[10px] text-peligro">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <button
        disabled={pendiente}
        onClick={generar}
        className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${
          confirmando
            ? "border-peligro/50 bg-peligro/10 text-peligro hover:bg-peligro/20"
            : "border-celeste/50 bg-celeste/10 text-celeste hover:bg-celeste/20"
        }`}
        title={confirmando ? "La clave actual deja de funcionar en el momento" : undefined}
      >
        <KeyRound size={12} />
        {pendiente ? "Generando…" : confirmando ? "¿Seguro? La anterior deja de servir" : "Generar clave"}
      </button>
      {confirmando && !pendiente && (
        <button onClick={() => setConfirmando(false)} className="mt-1 text-[10px] text-texto-3 hover:text-texto">
          cancelar
        </button>
      )}
      {error && <p className="mt-1 text-[10px] text-peligro">{error}</p>}
    </div>
  );
}
