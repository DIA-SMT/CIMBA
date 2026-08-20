"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin } from "lucide-react";
import { Map as MapaGL, Marker, NavigationControl } from "react-map-gl/maplibre";

const ESTILO =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Mini-mapa para elegir una ubicación con un clic. */
export function MapaSelector({
  punto,
  alElegir,
  alto = 320,
}: {
  punto: { lat: number; lon: number } | null;
  alElegir: (lat: number, lon: number) => void;
  alto?: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-borde" style={{ height: alto }}>
      <MapaGL
        initialViewState={{ longitude: -65.2226, latitude: -26.8241, zoom: 12.5 }}
        mapStyle={ESTILO}
        onClick={(e) => alElegir(e.lngLat.lat, e.lngLat.lng)}
        attributionControl={{ compact: true }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />
        {punto && (
          <Marker longitude={punto.lon} latitude={punto.lat} anchor="bottom">
            <MapPin size={30} className="text-amarillo drop-shadow" fill="#0066FF" />
          </Marker>
        )}
      </MapaGL>
    </div>
  );
}
