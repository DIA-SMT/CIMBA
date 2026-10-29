"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapIcon, MapPin, Satellite } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Layer, Map as MapaGL, Marker, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import { bboxDeCapa, type CapaPuntos } from "@/lib/capa-archivo";
import { CapaRedVial, ReferenciaTerreno } from "./mini-mapa";
import { ANCLA_NOMBRES, ATRIBUCION_SATELITE, TILES_SATELITE, estiloMapa, usarRealceCalles, usarTemaMapa } from "./tema-mapa";

/** Mini-mapa para elegir una ubicación con un clic. Realza nombres y trazas de
 *  calles (como el mapa principal), permite vista satelital para ubicar con
 *  precisión, y muestra capas cargadas (GeoJSON / CSV / Excel / GeoPackage)
 *  con sus geometrías reales: puntos, líneas y polígonos. */
export function MapaSelector({
  punto,
  alElegir,
  alto = 320,
  capa = null,
  arrancaEnSatelite = false,
  conRedVial = true,
}: {
  punto: { lat: number; lon: number } | null;
  alElegir: (lat: number, lon: number) => void;
  alto?: number;
  capa?: CapaPuntos | null;
  /**
   * Arranca en el plano con la red vial, como todo mapa donde se ubica un
   * punto: hay que leer el nombre de la calle —"sería mejor el que se ve solo
   * la red vial" y "estandaricemos el tipo de mapa", el usuario, 14/10—. El
   * satélite (el reemplazo de QGIS) queda a un botón.
   */
  arrancaEnSatelite?: boolean;
  /** La red vial encima: qué calle es pavimento, cuál ripio, cuál cordón cuneta. */
  conRedVial?: boolean;
}) {
  const mapRef = useRef<MapRef>(null);
  const tema = usarTemaMapa();
  const [satelite, setSatelite] = useState(arrancaEnSatelite);
  // Nombres de calle legibles y trazas marcadas: el mismo realce que el
  // mini-mapa (tema-mapa.ts). Si el estilo no tiene la capa de nombres, el
  // satélite y la red vial van arriba de todo en vez de fallar en silencio.
  const hayAncla = usarRealceCalles(mapRef, tema);

  // Al cargar una capa, encuadrar el mapa a su extensión (cualquier geometría).
  useEffect(() => {
    const mapa = mapRef.current?.getMap();
    if (!mapa || !capa) return;
    const bbox = bboxDeCapa(capa);
    if (!bbox) return;
    mapa.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, maxZoom: 16, duration: 700 });
  }, [capa]);

  return (
    <div>
      <div className="relative overflow-hidden rounded-xl border border-borde" style={{ height: alto }}>
        <MapaGL
          ref={mapRef}
          // Con un punto ya ubicado (corregir un pedido), abre encima de él y a
          // escala de cuadra: antes abría la ciudad entera y el pin había que
          // buscarlo. Sin punto (un pedido nuevo), la ciudad.
          initialViewState={
            punto
              ? { longitude: punto.lon, latitude: punto.lat, zoom: 17 }
              : { longitude: -65.2226, latitude: -26.8241, zoom: 12.5 }
          }
          mapStyle={estiloMapa(tema)}
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
              <Layer id="selector-satelite-capa" type="raster" beforeId={hayAncla ? ANCLA_NOMBRES : undefined} />
            </Source>
          )}

          {/* Encima del satélite —la red vial es lo que se mira— pero debajo de
              los nombres de calle, que no tiene que tapar (29/10). La key la
              vuelve a montar al prender el satélite, para que quede arriba. */}
          {conRedVial && (
            <CapaRedVial
              key={`${satelite}-${hayAncla}`}
              prefijo="selector"
              antesDe={hayAncla ? ANCLA_NOMBRES : undefined}
            />
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
                paint={{
                  "text-color": tema === "oscuro" ? "#c8d4e4" : "#41505f",
                  "text-halo-color": tema === "oscuro" ? "#070a10" : "#ffffff",
                  "text-halo-width": 1.4,
                }}
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
      {conRedVial && (
        <div className="mt-1.5">
          <ReferenciaTerreno />
        </div>
      )}
    </div>
  );
}
