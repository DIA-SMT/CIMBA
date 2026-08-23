"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapIcon, MapPin, Satellite } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Layer, Map as MapaGL, Marker, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import { bboxDeCapa, type CapaPuntos } from "@/lib/capa-archivo";

const ESTILO =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** Imagen satelital de Esri (uso gratuito con atribución). */
export const TILES_SATELITE =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const ATRIBUCION_SATELITE = "Esri, Maxar, Earthstar Geographics";

/** Mini-mapa para elegir una ubicación con un clic. Realza nombres y trazas de
 *  calles (como el mapa principal), permite vista satelital para ubicar con
 *  precisión, y muestra capas cargadas (GeoJSON / CSV / Excel / GeoPackage)
 *  con sus geometrías reales: puntos, líneas y polígonos. */
export function MapaSelector({
  punto,
  alElegir,
  alto = 320,
  capa = null,
}: {
  punto: { lat: number; lon: number } | null;
  alElegir: (lat: number, lon: number) => void;
  alto?: number;
  capa?: CapaPuntos | null;
}) {
  const mapRef = useRef<MapRef>(null);
  const [satelite, setSatelite] = useState(false);
  // Si el estilo no tiene la capa de nombres, el raster va arriba de todo
  // (sin beforeId) en vez de fallar silenciosamente.
  const [hayAncla, setHayAncla] = useState(true);

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
      if (!mapa.getLayer("roadname_minor")) setHayAncla(false);
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

  // Al cargar una capa, encuadrar el mapa a su extensión (cualquier geometría).
  useEffect(() => {
    const mapa = mapRef.current?.getMap();
    if (!mapa || !capa) return;
    const bbox = bboxDeCapa(capa);
    if (!bbox) return;
    mapa.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, maxZoom: 16, duration: 700 });
  }, [capa]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-borde" style={{ height: alto }}>
      <MapaGL
        ref={mapRef}
        initialViewState={{ longitude: -65.2226, latitude: -26.8241, zoom: 12.5 }}
        mapStyle={ESTILO}
        onClick={(e) => alElegir(e.lngLat.lat, e.lngLat.lng)}
        attributionControl={{ compact: true }}
      >
        <NavigationControl position="bottom-right" showCompass={false} />

        {satelite && (
          <Source
            id="selector-satelite"
            type="raster"
            tiles={[TILES_SATELITE]}
            tileSize={256}
            attribution={ATRIBUCION_SATELITE}
          >
            {/* Debajo de los nombres de calles: la imagen no tapa las etiquetas */}
            <Layer id="selector-satelite-capa" type="raster" beforeId={hayAncla ? "roadname_minor" : undefined} />
          </Source>
        )}

        {capa && capa.features.length > 0 && (
          <Source id="capa-archivo" type="geojson" data={capa}>
            <Layer
              id="capa-archivo-relleno"
              type="fill"
              filter={["==", ["geometry-type"], "Polygon"]}
              paint={{ "fill-color": "#2EB1FF", "fill-opacity": 0.14 }}
            />
            <Layer
              id="capa-archivo-linea"
              type="line"
              filter={["any", ["==", ["geometry-type"], "LineString"], ["==", ["geometry-type"], "Polygon"]]}
              paint={{ "line-color": "#2EB1FF", "line-width": 2, "line-opacity": 0.85 }}
            />
            <Layer
              id="capa-archivo-halo"
              type="circle"
              filter={["==", ["geometry-type"], "Point"]}
              paint={{ "circle-radius": 9, "circle-color": "#2EB1FF", "circle-opacity": 0.18 }}
            />
            <Layer
              id="capa-archivo-punto"
              type="circle"
              filter={["==", ["geometry-type"], "Point"]}
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
          <Marker
            longitude={punto.lon}
            latitude={punto.lat}
            anchor="bottom"
            draggable
            onDragEnd={(e) => alElegir(e.lngLat.lat, e.lngLat.lng)}
          >
            {/* stopPropagation: un clic sobre el pin no debe llegar al mapa
                (lo movería ~30 px al norte, a la posición del cursor). */}
            <span onClick={(ev) => ev.stopPropagation()}>
              <MapPin size={30} className="cursor-grab text-amarillo drop-shadow active:cursor-grabbing" fill="#0066FF" />
            </span>
          </Marker>
        )}
      </MapaGL>

      <button
        onClick={() => setSatelite((s) => !s)}
        title={satelite ? "Volver al plano de calles" : "Vista satelital: ubicá el punto mirando la imagen real"}
        className={`panel-vidrio absolute top-2 right-2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition ${satelite ? "text-amarillo ring-1 ring-amarillo/50" : "text-texto-2 hover:text-texto"}`}
      >
        {satelite ? <MapIcon size={12} /> : <Satellite size={12} />}
        {satelite ? "Plano" : "Satélite"}
      </button>
    </div>
  );
}
