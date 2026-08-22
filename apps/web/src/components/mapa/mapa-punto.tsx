"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Maximize2 } from "lucide-react";
import Link from "next/link";
import { Map as MapaGL, Marker, NavigationControl } from "react-map-gl/maplibre";

const ESTILO =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/**
 * Mini-mapa embebido y siempre visible para páginas de detalle: muestra el
 * punto con pulso, y un botón para saltar al mapa completo ya centrado.
 * (A diferencia de VerEnMapa, no es un panel flotante que se abre y cierra.)
 */
export function MapaPunto({
  lat,
  lon,
  color = "#f4dc00",
  alto = 260,
  zoom = 16,
}: {
  lat: number;
  lon: number;
  color?: string;
  alto?: number;
  zoom?: number;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-borde">
      <div style={{ height: alto }}>
        <MapaGL
          initialViewState={{ longitude: lon, latitude: lat, zoom }}
          mapStyle={ESTILO}
          attributionControl={false}
        >
          <NavigationControl position="bottom-right" showCompass={false} />
          <Marker longitude={lon} latitude={lat} anchor="center">
            <span className="relative flex h-6 w-6 items-center justify-center">
              <span className="pulso absolute inline-flex h-6 w-6 rounded-full" style={{ background: `${color}33` }} />
              <span
                className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-white/80"
                style={{ background: color }}
              />
            </span>
          </Marker>
        </MapaGL>
      </div>
      <Link
        href={`/mapa?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&z=17`}
        title="Abrir en el mapa completo, centrado en este punto"
        className="panel-vidrio absolute top-2 right-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-celeste transition hover:text-texto"
      >
        <Maximize2 size={12} /> Mapa completo
      </Link>
      <div className="flex items-center justify-between border-t border-borde bg-panel px-3 py-1.5">
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
  );
}
