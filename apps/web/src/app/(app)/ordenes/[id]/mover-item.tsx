"use client";

import { ArrowRightLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moverItemAOrden } from "@/lib/acciones-ordenes";
import { mensajeDeError } from "@/lib/errores";

/**
 * PASAR UN BACHE A OTRA ORDEN de la misma empresa (28/10): para el que la
 * empresa cargó en la orden equivocada. Solo Bacheo; queda escrito de dónde
 * vino, quién lo movió y por qué.
 */
export function MoverItem({
  itemId,
  destinos,
}: {
  itemId: number;
  /** Las otras órdenes de la misma empresa que pueden recibirlo. */
  destinos: Array<{ id: number; numero: string; detalle: string }>;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [destino, setDestino] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();

  if (destinos.length === 0) return null;

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        title="Pasar este bache a otra orden de la misma empresa"
        className="flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap text-texto-3 hover:text-celeste"
      >
        <ArrowRightLeft size={12} /> Pasar a otra orden
      </button>
    );
  }

  return (
    <div className="mt-1 w-64 max-w-full rounded-lg border border-borde-2 bg-panel p-2 text-left">
      <select
        value={destino}
        onChange={(e) => setDestino(e.target.value)}
        className="w-full rounded-md border border-borde-2 bg-panel-2 px-2 py-1.5 text-xs"
      >
        <option value="">Elegí la orden…</option>
        {destinos.map((d) => (
          <option key={d.id} value={d.id}>
            {d.numero} · {d.detalle}
          </option>
        ))}
      </select>
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Motivo (ej.: es de la zona sur)"
        className="mt-1.5 w-full rounded-md border border-borde-2 bg-panel-2 px-2 py-1.5 text-xs placeholder:text-texto-3"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          disabled={enviando || !destino || motivo.trim().length < 3}
          onClick={() => {
            setError(null);
            iniciar(async () => {
              try {
                await moverItemAOrden({ itemId, ordenDestinoId: Number(destino), motivo: motivo.trim() });
                setAbierto(false);
                router.refresh();
              } catch (e) {
                setError(mensajeDeError(e, "No se pudo mover"));
              }
            });
          }}
          className="rounded-md bg-azul px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {enviando ? "Moviendo…" : "Pasar"}
        </button>
        <button type="button" onClick={() => setAbierto(false)} className="text-xs text-texto-2 hover:text-texto">
          Cancelar
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-peligro">{error}</p>}
    </div>
  );
}
