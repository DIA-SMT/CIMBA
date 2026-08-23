"use client";

import { MapPinned, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { corregirUbicacionDemanda } from "@/lib/acciones";
import { MapaSelector } from "@/components/mapa/mapa-selector";

/**
 * Corregir (o asignar) la ubicación de una demanda arrastrando el punto en el
 * mapa — con vista satelital para clavarlo mirando la imagen real, como se
 * hacía en QGIS. La confianza pasa a 1.0: la puso una persona.
 */
export function CorregirUbicacion({
  demandaId,
  lat,
  lon,
}: {
  demandaId: number;
  lat: number | null;
  lon: number | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const original = lat != null && lon != null ? { lat, lon } : null;
  const [punto, setPunto] = useState<{ lat: number; lon: number } | null>(original);
  const [actualizarDireccion, setActualizarDireccion] = useState(true);
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  const guardar = () => {
    if (!punto) {
      setError("Marcá o arrastrá el punto en el mapa.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        let direccion: string | undefined;
        if (actualizarDireccion) {
          try {
            const res = await fetch(`/api/georreversa?lat=${punto.lat}&lon=${punto.lon}`);
            const data = (await res.json()) as { direccion: string | null };
            direccion = data.direccion ?? undefined;
          } catch {
            direccion = undefined;
          }
        }
        await corregirUbicacionDemanda({ demandaId, lat: punto.lat, lon: punto.lon, direccion });
        setGuardado(true);
        setAbierto(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar la ubicación.");
      }
    });
  };

  if (!abierto) {
    return (
      <button
        onClick={() => {
          setAbierto(true);
          setGuardado(false);
        }}
        className="inline-flex items-center gap-1.5 rounded-lg border border-borde-2 px-3 py-1.5 text-[13px] font-semibold text-texto-2 transition hover:border-amarillo/60 hover:text-amarillo"
        title="Mover el punto en el mapa (con vista satelital) para corregir una geocodificación errada"
      >
        <MapPinned size={14} />
        {guardado ? "Ubicación corregida ✓" : lat == null ? "Asignar ubicación" : "Corregir ubicación"}
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-amarillo/40 bg-amarillo/5 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-amarillo">
          Arrastrá el pin (o hacé clic) hasta el lugar exacto — el botón Satélite ayuda a clavarlo
        </p>
        <button
          onClick={() => {
            // cancelar descarta lo no guardado: el pin vuelve a la ubicación real
            setAbierto(false);
            setPunto(original);
            setError(null);
          }}
          className="text-texto-3 hover:text-texto"
          title="Cancelar (descarta el punto no guardado)"
        >
          <X size={15} />
        </button>
      </div>
      <MapaSelector punto={punto} alElegir={(la, lo) => setPunto({ lat: la, lon: lo })} alto={300} />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-texto-2">
          <input
            type="checkbox"
            checked={actualizarDireccion}
            onChange={(e) => setActualizarDireccion(e.target.checked)}
            className="accent-[#0066ff]"
          />
          Actualizar también la dirección con la nueva ubicación
        </label>
        {punto && (
          <span className="num text-[11px] text-texto-3">
            {punto.lat.toFixed(6)}, {punto.lon.toFixed(6)}
          </span>
        )}
        <button
          onClick={guardar}
          disabled={pendiente || !punto}
          className="ml-auto rounded-lg bg-azul px-4 py-2 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {pendiente ? "Guardando…" : "Guardar nueva ubicación"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-peligro">{error}</p>}
    </div>
  );
}
