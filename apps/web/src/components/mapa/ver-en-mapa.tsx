"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Eye, MapPin, Maximize2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { Map as MapaGL, Marker, NavigationControl } from "react-map-gl/maplibre";

const ESTILO =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Niveles de opacidad del panel: opaco → translúcido → casi transparente. */
const NIVELES_OPACIDAD = [1, 0.55, 0.22] as const;

/**
 * "Ver en mapa" desde cualquier lista o detalle: abre un mini-mapa flotante
 * centrado en el punto, SIN salir de la pantalla actual. El botón del ojo lo
 * transparenta por niveles para seguir leyendo la tabla debajo; el de expandir
 * lleva al mapa completo ya centrado (deep-link /mapa?lat&lon&z).
 * Solo un panel abierto a la vez en toda la app.
 */
export function VerEnMapa({
  lat,
  lon,
  etiqueta,
  color = "#f4dc00",
}: {
  lat: number | null | undefined;
  lon: number | null | undefined;
  etiqueta?: string | null;
  color?: string;
}) {
  const id = useId();
  const [abierto, setAbierto] = useState(false);
  const [nivel, setNivel] = useState(0);

  useEffect(() => {
    const alAbrirOtro = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) setAbierto(false);
    };
    window.addEventListener("cimba:ver-en-mapa", alAbrirOtro);
    return () => window.removeEventListener("cimba:ver-en-mapa", alAbrirOtro);
  }, [id]);

  if (lat == null || lon == null) {
    return (
      <span
        className="inline-flex h-7 w-7 items-center justify-center text-texto-3 opacity-30"
        title="Sin ubicación registrada"
      >
        <MapPin size={14} />
      </span>
    );
  }

  const abrir = () => {
    window.dispatchEvent(new CustomEvent("cimba:ver-en-mapa", { detail: id }));
    setAbierto(true);
    setNivel(0);
  };

  const urlMapaCompleto = `/mapa?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&z=17`;

  return (
    <>
      <button
        onClick={abrir}
        title={`Ver en mapa: ${etiqueta ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`}`}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-borde-2 text-celeste transition hover:border-celeste hover:bg-celeste/10"
      >
        <MapPin size={14} />
      </button>

      {abierto && (
        <div
          className="fixed right-4 bottom-20 z-50 w-[400px] max-w-[calc(100vw-32px)] transition-opacity duration-200"
          style={{ opacity: NIVELES_OPACIDAD[nivel] ?? 1 }}
        >
          <div className="panel-vidrio overflow-hidden rounded-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-borde px-3 py-2">
              <span className="min-w-0 truncate text-xs font-semibold" title={etiqueta ?? undefined}>
                <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: color }} />
                {etiqueta ?? "Ubicación"}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => setNivel((n) => (n + 1) % NIVELES_OPACIDAD.length)}
                  title="Transparentar / destransparentar el panel para ver la tabla debajo"
                  className={`rounded-md p-1.5 transition hover:bg-panel-3 ${nivel > 0 ? "text-amarillo" : "text-texto-2"}`}
                >
                  <Eye size={14} />
                </button>
                <Link
                  href={urlMapaCompleto}
                  title="Abrir en el mapa completo, centrado en este punto"
                  className="rounded-md p-1.5 text-texto-2 transition hover:bg-panel-3 hover:text-celeste"
                >
                  <Maximize2 size={14} />
                </Link>
                <button
                  onClick={() => setAbierto(false)}
                  title="Cerrar"
                  className="rounded-md p-1.5 text-texto-2 transition hover:bg-panel-3 hover:text-peligro"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div style={{ height: 250 }}>
              <MapaGL
                initialViewState={{ longitude: lon, latitude: lat, zoom: 16 }}
                mapStyle={ESTILO}
                attributionControl={false}
              >
                <NavigationControl position="bottom-right" showCompass={false} />
                <Marker longitude={lon} latitude={lat} anchor="center">
                  <span className="relative flex h-5 w-5 items-center justify-center">
                    <span className="pulso absolute inline-flex h-5 w-5 rounded-full" style={{ background: `${color}33` }} />
                    <span
                      className="relative inline-flex h-3 w-3 rounded-full border-2 border-white/80"
                      style={{ background: color }}
                    />
                  </span>
                </Marker>
              </MapaGL>
            </div>

            <div className="flex items-center justify-between border-t border-borde px-3 py-1.5">
              <span className="num text-[10px] text-texto-3">
                {lat.toFixed(6)}, {lon.toFixed(6)}
              </span>
              <a
                href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-semibold text-celeste hover:underline"
              >
                Street View ↗
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
