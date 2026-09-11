"use client";

import { LocateFixed, Mic, Search } from "lucide-react";
import { useState } from "react";
import { dentroDeSMT } from "@cimba/domain";
import { useDictadoVoz } from "@/lib/dictado";
import { BarraConfianza } from "@/components/ui";
import { MiniMapa } from "@/components/mapa/mini-mapa";

/**
 * "¿Dónde fue?" — el selector de punto del portal de empresas.
 *
 * Tres caminos al mismo lugar, porque en la calle no siempre sirve el mismo:
 * DICTAR la dirección (con guantes y el celular en el bolsillo del pecho),
 * ESCRIBIRLA (cuando el reconocedor no entiende "Crisóstomo Álvarez"), o el
 * GPS (cuando la esquina no tiene nombre que el geocoder conozca). En los
 * tres casos el punto se muestra en un mini-mapa con el pin ARRASTRABLE y no
 * se acepta hasta que el capataz confirma: el geocoder acierta la cuadra, la
 * persona acierta el bache.
 *
 * Vive acá y no adentro de un formulario porque lo necesitan los dos que
 * cargan sin punto previo: proponer un bache dentro de una orden y cargar un
 * trabajo sin orden. (TarjetaItem tiene su propia variante porque arranca con
 * la ubicación de la orden y este selector solo aparece al corregirla.)
 */

export interface UbicacionElegida {
  lat: number;
  lon: number;
  /** Cómo se resolvió, en criollo: se muestra como confirmación. */
  detalle: string;
}

interface Candidato {
  lat: number;
  lon: number;
  origen: "geocoder" | "gps";
  /** Geocoder: lo que devolvió, para confirmar que es SU esquina. */
  resuelta?: string;
  confianza?: number;
  precisionM?: number;
  /** Movió el pin a mano: el punto ya es del capataz, no del geocoder/GPS. */
  ajustado?: boolean;
}

export function SelectorUbicacion({
  direccionTexto,
  alCambiarDireccion,
  ubicacion,
  alElegir,
}: {
  direccionTexto: string;
  alCambiarDireccion: (v: string) => void;
  ubicacion: UbicacionElegida | null;
  alElegir: (u: UbicacionElegida | null) => void;
}) {
  const [buscando, setBuscando] = useState(false);
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [errorGeo, setErrorGeo] = useState<string | null>(null);
  const [candidato, setCandidato] = useState<Candidato | null>(null);

  const buscarDireccion = async (texto: string) => {
    const q = texto.trim();
    if (q.length < 4) {
      setErrorGeo("Escribí la dirección un poco más completa (calle y altura).");
      return;
    }
    setBuscando(true);
    setErrorGeo(null);
    setCandidato(null);
    try {
      const res = await fetch(`/api/geocodificar?q=${encodeURIComponent(q)}`);
      const data = (await res.json()) as {
        resultado: {
          punto: { lat: number; lon: number };
          confianza: number;
          direccionResuelta: string | null;
        } | null;
      };
      if (!data.resultado) {
        setErrorGeo("No se encontró esa dirección: probá con calle y altura, sin barrio.");
        return;
      }
      setCandidato({
        lat: data.resultado.punto.lat,
        lon: data.resultado.punto.lon,
        origen: "geocoder",
        confianza: data.resultado.confianza,
        resuelta: data.resultado.direccionResuelta ?? q,
      });
    } catch {
      setErrorGeo("Falló la búsqueda: fijate la señal y probá de nuevo.");
    } finally {
      setBuscando(false);
    }
  };

  const dictado = useDictadoVoz((frase) => {
    alCambiarDireccion(frase);
    void buscarDireccion(frase);
  });

  const usarGps = () => {
    if (!navigator.geolocation) {
      setErrorGeo("Este teléfono no expone el GPS al navegador.");
      return;
    }
    setBuscandoGps(true);
    setErrorGeo(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBuscandoGps(false);
        const { latitude, longitude, accuracy } = pos.coords;
        if (!dentroDeSMT({ lat: latitude, lon: longitude })) {
          setErrorGeo("El GPS te ubica fuera de San Miguel de Tucumán: probá de nuevo al lado del bache.");
          return;
        }
        setCandidato({
          lat: latitude,
          lon: longitude,
          origen: "gps",
          precisionM: Math.round(accuracy),
        });
      },
      () => {
        setBuscandoGps(false);
        setErrorGeo("No se pudo leer tu ubicación: revisá que el GPS esté encendido.");
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  return (
    <div className="space-y-2">
      <input
        value={direccionTexto}
        onChange={(e) => alCambiarDireccion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void buscarDireccion(direccionTexto);
        }}
        placeholder={
          dictado.escuchando ? "Escuchando… decí la dirección" : "Calle y altura, ej: Las Piedras 1500"
        }
        className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-base placeholder:text-texto-3"
      />
      <div className="grid grid-cols-3 gap-2">
        {dictado.hayVoz && (
          <button
            type="button"
            onClick={() => {
              dictado.limpiarError();
              dictado.alternar();
            }}
            className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border text-xs font-bold transition ${
              dictado.escuchando
                ? "animate-pulse border-peligro/60 bg-peligro/15 text-peligro"
                : "border-borde-2 bg-panel-2 hover:border-celeste"
            }`}
          >
            <Mic size={20} className={dictado.escuchando ? "" : "text-celeste"} />
            {dictado.escuchando ? "Escuchando…" : "Dictar"}
          </button>
        )}
        <button
          type="button"
          onClick={() => void buscarDireccion(direccionTexto)}
          disabled={buscando}
          className="flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-borde-2 bg-panel-2 text-xs font-bold transition hover:border-celeste disabled:opacity-50"
        >
          <Search size={20} className="text-celeste" />
          {buscando ? "Buscando…" : "Ubicar"}
        </button>
        <button
          type="button"
          onClick={usarGps}
          disabled={buscandoGps}
          className={`flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-borde-2 bg-panel-2 text-xs font-bold transition hover:border-celeste disabled:opacity-50 ${
            dictado.hayVoz ? "" : "col-span-2"
          }`}
        >
          <LocateFixed size={20} className="text-celeste" />
          {buscandoGps ? "Leyendo GPS…" : "Usar mi GPS"}
        </button>
      </div>

      {(errorGeo || dictado.error) && (
        <p className="text-xs leading-relaxed text-peligro">{errorGeo ?? dictado.error}</p>
      )}

      {candidato && (
        <div className="rounded-lg border border-borde-2 bg-panel-2 p-3">
          <p className="text-sm leading-snug">
            {candidato.origen === "gps"
              ? `Tu GPS (±${candidato.precisionM ?? "?"} m)`
              : candidato.resuelta}
          </p>
          <div className="mt-2">
            <MiniMapa
              lat={candidato.lat}
              lon={candidato.lon}
              etiqueta={candidato.resuelta ?? direccionTexto}
              alto={200}
              alMover={({ lat, lon }) =>
                setCandidato((c) => (c ? { ...c, lat, lon, ajustado: true } : c))
              }
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            {candidato.origen === "geocoder" && candidato.confianza != null ? (
              <BarraConfianza valor={candidato.confianza} />
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => {
                const c = candidato;
                // Misma frontera operativa que valida el server, con un
                // mensaje que se entiende acá y no un error de zod.
                if (!dentroDeSMT({ lat: c.lat, lon: c.lon })) {
                  setErrorGeo("El pin quedó fuera de San Miguel de Tucumán: acercalo al bache");
                  return;
                }
                alElegir({
                  lat: c.lat,
                  lon: c.lon,
                  detalle: c.ajustado
                    ? "Pin ajustado en el mapa"
                    : c.origen === "gps"
                      ? `Tu GPS (±${c.precisionM ?? "?"} m)`
                      : (c.resuelta ?? "Dirección geocodificada"),
                });
                setCandidato(null);
                setErrorGeo(null);
              }}
              className="rounded-lg bg-azul px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
            >
              Usar esta ✓
            </button>
          </div>
        </div>
      )}

      {ubicacion && !candidato && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-resuelto/40 bg-resuelto/10 px-3 py-3">
          <span className="text-sm font-semibold">{ubicacion.detalle} ✓</span>
          <button
            type="button"
            onClick={() => alElegir(null)}
            className="shrink-0 rounded-lg border border-borde-2 px-3 py-2 text-xs font-semibold text-texto-2 transition hover:border-amarillo/60 hover:text-amarillo"
          >
            Corregir
          </button>
        </div>
      )}
    </div>
  );
}
