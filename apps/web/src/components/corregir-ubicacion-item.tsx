"use client";

import { MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { corregirUbicacionItem } from "@/lib/acciones-ordenes";
import { mensajeDeError } from "@/lib/errores";
import { MiniMapa } from "@/components/mapa/mini-mapa";

/**
 * CORREGIR EL PIN DE UN ITEM, desde los dos lados del mostrador.
 *
 * El punto llega mal seguido: el geocodificador pifia media cuadra, el GPS del
 * teléfono pifia veinte metros bajo los árboles, y la dirección del reclamo a
 * veces estaba mal escrita desde el origen. Antes no había forma de moverlo —y
 * el caso peor era el item propuesto, esperando validación: ni la empresa que
 * lo cargó ni el Director que lo tenía que aprobar podían tocarlo. La única
 * salida era rechazarlo y pedir que lo cargaran de nuevo, con la foto y las
 * medidas otra vez.
 *
 * El mapa abre con satelital y red vial: sin ver la calle real no se puede
 * decidir dónde va el pin.
 */
export function CorregirUbicacionItem({
  itemId,
  lat,
  lon,
  direccion,
  /** El portal de empresas no puede abrir /mapa: el chip no lo ofrece ahí. */
  compacto = false,
}: {
  itemId: number;
  lat: number | null;
  lon: number | null;
  direccion?: string | null;
  compacto?: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [punto, setPunto] = useState<{ lat: number; lon: number } | null>(
    lat != null && lon != null ? { lat, lon } : null,
  );
  const [texto, setTexto] = useState(direccion ?? "");
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Sin punto de partida no hay mapa que abrir: el item nunca tuvo ubicación.
  if (lat == null || lon == null) return null;

  const movido = punto != null && (punto.lat !== lat || punto.lon !== lon);
  const cambioTexto = texto.trim() !== (direccion ?? "").trim();

  const guardar = () => {
    if (!punto) return;
    setError(null);
    startTransition(async () => {
      try {
        await corregirUbicacionItem({
          itemId,
          lat: punto.lat,
          lon: punto.lon,
          direccion: cambioTexto ? texto.trim() || undefined : undefined,
        });
        setAbierto(false);
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo mover el punto"));
      }
    });
  };

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={
          compacto
            ? "inline-flex items-center gap-1 text-[11px] font-semibold text-celeste hover:underline"
            : "inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-borde-2 px-3 text-xs font-semibold text-celeste transition hover:border-celeste hover:bg-celeste/10"
        }
        title="Mover el pin al lugar exacto del bache"
      >
        <MapPin size={13} /> Corregir la ubicación
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-celeste/40 bg-celeste/5 p-2.5">
      <p className="mb-2 text-[12px] font-semibold text-celeste">
        Arrastrá el pin —o tocá el mapa— hasta donde está el bache
      </p>
      <MiniMapa
        lat={punto?.lat ?? lat}
        lon={punto?.lon ?? lon}
        etiqueta={direccion}
        alMover={(p) => setPunto(p)}
        alto={260}
        conTerreno
      />
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Dirección (opcional): corregila si estaba mal escrita"
        className="mt-2 w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2.5 text-sm placeholder:text-texto-3"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pendiente || (!movido && !cambioTexto)}
          onClick={guardar}
          className="rounded-lg bg-azul px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          title={!movido && !cambioTexto ? "Movés el pin o cambiás la dirección y recién ahí hay algo que guardar" : undefined}
        >
          {pendiente ? "Guardando…" : "Guardar la ubicación"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAbierto(false);
            setPunto({ lat, lon });
            setTexto(direccion ?? "");
          }}
          className="text-sm text-texto-2 transition hover:text-texto"
        >
          Cancelar
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-peligro">{error}</p>}
    </div>
  );
}
