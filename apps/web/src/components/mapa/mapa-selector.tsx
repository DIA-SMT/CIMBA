"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin } from "lucide-react";
import { useEffect, useRef } from "react";
import { Layer, Map as MapaGL, Marker, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import type { FeatureCollection, Point } from "geojson";

const ESTILO =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Mini-mapa para elegir una ubicación con un clic. Realza nombres y trazas de
 *  calles (como el mapa principal) y puede mostrar una capa de puntos cargada
 *  desde un archivo (GeoJSON / CSV / Excel). */
export function MapaSelector({
  punto,
  alElegir,
  alto = 320,
  capa = null,
}: {
  punto: { lat: number; lon: number } | null;
  alElegir: (lat: number, lon: number) => void;
  alto?: number;
  capa?: FeatureCollection<Point, Record<string, unknown>> | null;
}) {
  const mapRef = useRef<MapRef>(null);

  // Mismo realce de calles que el mapa principal: nombres antes y trazas más visibles.
  useEffect(() => {
    const NOMBRES = [
      { id: "roadname_minor", minzoom: 14.5, size: 10.5, color: "#b9c6d8" },
      { id: "roadname_sec", minzoom: 13.5, size: 11, color: "#c8d4e4" },
      { id: "roadname_pri", minzoom: 12.5, size: 11.5, color: "#d6e0ee" },
      { id: "roadname_major", minzoom: 11.5, size: 12, color: "#e2eaf5" },
    ];
    const TRAZAS = [
      { id: "road_minor_fill", minzoom: 13.5, color: "rgba(88, 97, 118, 1)" },
      { id: "road_minor_case", minzoom: 12.5, color: "rgba(72, 79, 98, 1)" },
      { id: "road_service_fill", minzoom: 14.5, color: "rgba(70, 76, 94, 1)" },
      { id: "road_sec_fill_noramp", minzoom: 12, color: "rgba(96, 105, 126, 1)" },
    ];
    let cancelado = false;
    const aplicar = () => {
      const mapa = mapRef.current?.getMap();
      if (!mapa || !mapa.isStyleLoaded()) return false;
      for (const c of NOMBRES) {
        if (!mapa.getLayer(c.id)) continue;
        mapa.setLayerZoomRange(c.id, c.minzoom, 24);
        mapa.setLayoutProperty(c.id, "text-size", c.size);
        mapa.setPaintProperty(c.id, "text-color", c.color);
        mapa.setPaintProperty(c.id, "text-halo-color", "#070a10");
        mapa.setPaintProperty(c.id, "text-halo-width", 1.7);
      }
      for (const c of TRAZAS) {
        if (!mapa.getLayer(c.id)) continue;
        mapa.setLayerZoomRange(c.id, c.minzoom, 24);
        mapa.setPaintProperty(c.id, "line-color", c.color);
      }
      return true;
    };
    if (aplicar()) return;
    const id = setInterval(() => {
      if (cancelado || aplicar()) clearInterval(id);
    }, 300);
    const mapa = mapRef.current?.getMap();
    mapa?.on("styledata", aplicar);
    return () => {
      cancelado = true;
      clearInterval(id);
      mapa?.off("styledata", aplicar);
    };
  }, []);

  // Al cargar una capa, encuadrar el mapa a sus puntos.
  useEffect(() => {
    const mapa = mapRef.current?.getMap();
    if (!mapa || !capa || capa.features.length === 0) return;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const f of capa.features) {
      const [lon, lat] = f.geometry.coordinates;
      if (lon == null || lat == null) continue;
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }
    if (!Number.isFinite(minLon)) return;
    mapa.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 60, maxZoom: 16, duration: 700 });
  }, [capa]);

  return (
    <div className="overflow-hidden rounded-xl border border-borde" style={{ height: alto }}>
      <MapaGL
        ref={mapRef}
        initialViewState={{ longitude: -65.2226, latitude: -26.8241, zoom: 12.5 }}
        mapStyle={ESTILO}
        onClick={(e) => alElegir(e.lngLat.lat, e.lngLat.lng)}
        attributionControl={{ compact: true }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />

        {capa && capa.features.length > 0 && (
          <Source id="capa-archivo" type="geojson" data={capa}>
            <Layer
              id="capa-archivo-halo"
              type="circle"
              paint={{ "circle-radius": 9, "circle-color": "#2EB1FF", "circle-opacity": 0.18 }}
            />
            <Layer
              id="capa-archivo-punto"
              type="circle"
              paint={{
                "circle-radius": 4.5,
                "circle-color": "#2EB1FF",
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 1.2,
              }}
            />
            <Layer
              id="capa-archivo-nombre"
              type="symbol"
              minzoom={14}
              layout={{
                "text-field": ["coalesce", ["get", "nombre"], ""],
                "text-size": 10,
                "text-offset": [0, 1.1],
                "text-anchor": "top",
              }}
              paint={{ "text-color": "#c8d4e4", "text-halo-color": "#070a10", "text-halo-width": 1.4 }}
            />
          </Source>
        )}

        {punto && (
          <Marker longitude={punto.lon} latitude={punto.lat} anchor="bottom">
            <MapPin size={30} className="text-amarillo drop-shadow" fill="#0066FF" />
          </Marker>
        )}
      </MapaGL>
    </div>
  );
}
