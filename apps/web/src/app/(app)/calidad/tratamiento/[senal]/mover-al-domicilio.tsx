"use client";

import { MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { corregirUbicacionDemanda } from "@/lib/acciones";
import { mensajeDeError } from "@/lib/errores";

/**
 * MOVER EL PIN A DONDE DICE LA DIRECCIÓN.
 *
 * La señal ya hizo el trabajo difícil: cruzó la dirección escrita del reclamo
 * contra el callejero municipal —los miles de puntos con calle y altura que el
 * municipio tiene, casi todos tomados con GPS parado en la calle— y encontró
 * que el pin está a cuadras de ahí. Arreglarlo es mover el punto a la posición
 * que el callejero conoce.
 *
 * Con confirmación, porque escribe: la sugerencia es muy buena —la distancia
 * mediana entre dirección y pin en los reclamos sanos es de 18 metros— pero no
 * es infalible, y quien mueve el punto de un reclamo tiene que saber que lo
 * está moviendo. Si la dirección es la que está mal, se corrige en la ficha.
 */
export function MoverAlDomicilio({
  demandaId,
  lat,
  lon,
}: {
  demandaId: number;
  lat: number;
  lon: number;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [pendiente, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const mover = () =>
    iniciar(async () => {
      setError(null);
      try {
        await corregirUbicacionDemanda({ demandaId, lat, lon });
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo mover el punto"));
        setConfirmando(false);
      }
    });

  if (confirmando) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="hidden text-[11px] text-texto-3 sm:inline">¿Mover el pin a esa dirección?</span>
        <button
          onClick={mover}
          disabled={pendiente}
          className="rounded-lg bg-azul px-2.5 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {pendiente ? "…" : "Sí"}
        </button>
        <button
          onClick={() => setConfirmando(false)}
          disabled={pendiente}
          className="px-1.5 py-1.5 text-xs text-texto-3 hover:text-texto"
        >
          no
        </button>
        {error && <span className="text-[11px] text-peligro">{error}</span>}
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirmando(true)}
      title={`Mover el pin a ${lat.toFixed(5)}, ${lon.toFixed(5)} — la posición que el callejero municipal conoce para esa dirección`}
      className="inline-flex items-center gap-1 rounded-lg border border-celeste/50 bg-celeste/10 px-2.5 py-1.5 text-xs font-semibold text-celeste transition hover:bg-celeste/20"
    >
      <MapPin size={13} /> Mover el pin
    </button>
  );
}
