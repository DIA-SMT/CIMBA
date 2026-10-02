"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { eliminarItemOrden } from "@/lib/acciones-ordenes";
import { mensajeDeError } from "@/lib/errores";

/**
 * SACAR UN ITEM QUE NO CORRESPONDE.
 *
 * "Un botón de borrar elemento si no corresponde" — Dirección de Bacheo,
 * 14/09. Pasa seguido al armar la orden: un punto que entró por un filtro mal
 * puesto, un bache duplicado, una dirección que no era.
 *
 * Pide motivo y confirma en la misma fila, sin window.confirm(): el diálogo
 * nativo no dice QUÉ se está por borrar, y acá se borra de a uno entre
 * muchos. El motivo va a la auditoría antes del delete, así que "quién sacó
 * este punto y por qué" se puede contestar después.
 *
 * El servidor rechaza los items ya reportados —detrás hay una intervención con
 * fotos y m²— así que el botón ni aparece para ellos.
 */
export function BorrarItem({ itemId, direccion }: { itemId: number; direccion: string | null }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        disabled={pendiente}
        title="Sacar este punto de la orden"
        className="rounded-md border border-borde-2 p-1.5 text-texto-3 transition hover:border-peligro/50 hover:text-peligro disabled:opacity-50"
      >
        <Trash2 size={14} />
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        autoFocus
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder={`¿Por qué se saca ${direccion ? `"${direccion}"` : "este punto"}?`}
        className="w-52 rounded-md border border-borde-2 bg-panel-2 px-2 py-1 text-[11px] placeholder:text-texto-3"
      />
      <button
        disabled={pendiente || motivo.trim().length < 3}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              await eliminarItemOrden({ itemId, motivo: motivo.trim() });
              router.refresh();
            } catch (e) {
              setError(mensajeDeError(e, "No se pudo borrar"));
            }
          });
        }}
        className="rounded-md bg-peligro/90 px-2.5 py-1 text-[11px] font-bold text-white transition hover:brightness-110 disabled:opacity-40"
      >
        {pendiente ? "Borrando…" : "Borrar"}
      </button>
      <button
        onClick={() => {
          setAbierto(false);
          setError(null);
        }}
        disabled={pendiente}
        className="text-[11px] text-texto-3 hover:text-texto-2"
      >
        Cancelar
      </button>
      {error && <span className="w-full text-[11px] text-peligro">{error}</span>}
    </div>
  );
}
