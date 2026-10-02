"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useMemo, useRef, useState } from "react";
import { Layer, Map as MapaGL, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import { estiloMapa, usarTemaMapa } from "@/components/mapa/tema-mapa";
import { CapasTerreno, ReferenciaTerreno } from "@/components/mapa/mini-mapa";

/**
 * EL MAPA DE UBICACIÓN DE LA ORDEN.
 *
 * La empresa recibía una lista de direcciones y nada más. Dónde queda eso
 * —si está todo en tres cuadras o repartido en medio distrito, por dónde
 * conviene arrancar, si el bache de "Las Piedras 3800" está cerca del de
 * "San Lorenzo 2400"— se armaba en la cabeza del capataz leyendo direcciones
 * sueltas, o no se armaba.
 *
 * El mapa existía pero estaba escondido: adentro de la lista de pendientes,
 * detrás de un botón, y ese botón solo aparecía con cinco o más pendientes.
 * En una orden de cuatro baches —la mayoría— no había mapa, y en una orden ya
 * terminada tampoco. Ahora se ve siempre, arriba, con TODO lo de la orden:
 * lo que falta en rojo y lo hecho en verde, que es el avance de la jornada
 * dibujado.
 */

export type PuntoOrden = {
  id: number;
  lat: number;
  lon: number;
  direccion: string | null;
  hecho: boolean;
};

/** El semáforo de siempre, acá reducido a la única pregunta de la jornada:
 *  rojo = falta, verde = tapado. */
const COLOR_FALTA = "#d42d20";
const COLOR_HECHO = "#199e70";

export function MapaOrden({
  puntos,
  miPunto = null,
  alElegir,
  alto = 300,
  area = null,
}: {
  puntos: PuntoOrden[];
  /** Dónde está quien mira, si compartió el GPS. */
  miPunto?: { lat: number; lon: number } | null;
  /** Qué hacer al tocar un punto rojo. Sin esto, baja hasta su tarjeta. */
  alElegir?: (id: number) => void;
  alto?: number;
  /**
   * EL ÁREA DE LA ORDEN, cuando se armó dibujando sobre el mapa. La empresa
   * tiene que ver el pedazo de ciudad que le tocó y no solo los puntos
   * sueltos que hay adentro: el borde del área es parte de la instrucción —
   * lo que aparezca ahí adentro también es suyo.
   */
  area?: { type: "Polygon"; coordinates: Array<Array<[number, number]>> } | null;
}) {
  const tema = usarTemaMapa();
  const mapRef = useRef<MapRef>(null);
  const [tocado, setTocado] = useState<PuntoOrden | null>(null);
  /**
   * Satelital y red vial: sin ver la calle real no se decide si eso es
   * pavimento o ripio, y tampoco se reconoce la cuadra. Arranca apagado
   * porque las teselas pesan y la mayoría de las veces alcanza el plano.
   */
  const [terreno, setTerreno] = useState(false);

  /* Bajar hasta la tarjeta del bache. Es lo que hacía la lista cuando el mapa
     vivía adentro de ella; ahora el mapa está arriba y se lo puede hacer solo. */
  const irATarjeta = (id: number) => {
    if (alElegir) return alElegir(id);
    document.getElementById(`item-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const fc = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: puntos.map((p) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
        properties: { id: p.id, hecho: p.hecho, direccion: p.direccion ?? "Sin dirección" },
      })),
    }),
    [puntos],
  );

  /** Encuadre inicial sobre TODOS los puntos de la orden: abrir centrado en el
   *  primero deja la mitad del trabajo fuera de pantalla. */
  /* El encuadre abarca los puntos Y el área: en una orden abierta dibujada
     sobre el mapa puede no haber ningún punto todavía, y ahí lo único que hay
     que mostrar es el área — que es justamente la instrucción. */
  const encuadre = useMemo(() => {
    const lats = puntos.map((p) => p.lat);
    const lons = puntos.map((p) => p.lon);
    for (const [lon, lat] of area?.coordinates[0] ?? []) {
      lats.push(lat);
      lons.push(lon);
    }
    if (lats.length === 0) return null;
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
    };
  }, [puntos, area]);

  if (encuadre == null) {
    return (
      <p className="mb-3 rounded-xl border border-borde bg-panel px-4 py-6 text-center text-sm text-texto-2">
        Ningún trabajo de esta orden tiene ubicación cargada todavía.
      </p>
    );
  }

  return (
    <div className="mb-3">
      <div className="overflow-hidden rounded-xl border border-borde" style={{ height: alto }}>
        <MapaGL
          ref={mapRef}
          /* El encuadre va en el estado INICIAL y no en un fitBounds dentro
             de un efecto: al montar, el mapa todavía no terminó de cargar el
             estilo y el fitBounds se pierde — abría centrado en el primer
             punto con la mitad de la orden fuera de pantalla. */
          initialViewState={{
            bounds: [
              [encuadre.minLon, encuadre.minLat],
              [encuadre.maxLon, encuadre.maxLat],
            ],
            fitBoundsOptions: { padding: 40, maxZoom: 16 },
          }}
          mapStyle={estiloMapa(tema)}
          attributionControl={false}
          interactiveLayerIds={["orden-puntos"]}
          onClick={(e) => {
            const f = e.features?.[0];
            if (!f) return;
            const id = Number(f.properties?.id);
            setTocado(puntos.find((p) => p.id === id) ?? null);
          }}
        >
          <NavigationControl position="bottom-right" showCompass={false} />
          {terreno && <CapasTerreno />}
          {area && (
            <Source id="orden-area" type="geojson" data={{ type: "Feature", properties: {}, geometry: area }}>
              <Layer id="orden-area-fondo" type="fill" paint={{ "fill-color": "#0066ff", "fill-opacity": 0.1 }} />
              <Layer
                id="orden-area-borde"
                type="line"
                paint={{ "line-color": "#0066ff", "line-width": 2.5, "line-opacity": 0.8, "line-dasharray": [2, 1.5] }}
              />
            </Source>
          )}
          <Source id="orden" type="geojson" data={fc}>
            <Layer
              id="orden-puntos"
              type="circle"
              paint={{
                "circle-radius": ["case", ["get", "hecho"], 6, 9],
                "circle-color": ["case", ["get", "hecho"], COLOR_HECHO, COLOR_FALTA],
                "circle-opacity": ["case", ["get", "hecho"], 0.7, 0.95],
                "circle-stroke-width": 1.5,
                "circle-stroke-color": "#ffffff",
              }}
            />
          </Source>
          {miPunto && (
            <Source
              id="yo"
              type="geojson"
              data={{
                type: "FeatureCollection",
                features: [
                  {
                    type: "Feature",
                    geometry: { type: "Point", coordinates: [miPunto.lon, miPunto.lat] },
                    properties: {},
                  },
                ],
              }}
            >
              <Layer
                id="yo-punto"
                type="circle"
                paint={{
                  "circle-radius": 7,
                  "circle-color": "#0066ff",
                  "circle-stroke-width": 3,
                  "circle-stroke-color": "#ffffff",
                }}
              />
            </Source>
          )}
        </MapaGL>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-texto-3">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_FALTA }} />
          falta
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_HECHO }} />
          tapado
        </span>
        {miPunto && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#0066ff" }} />
            estás acá
          </span>
        )}
        <button
          type="button"
          onClick={() => setTerreno((v) => !v)}
          className={`ml-auto rounded-md border px-2 py-1 font-semibold transition ${
            terreno
              ? "border-celeste/60 bg-celeste/10 text-celeste"
              : "border-borde-2 text-texto-2 hover:border-celeste/60 hover:text-celeste"
          }`}
          title="Imagen satelital y red vial: para reconocer la cuadra y ver si es pavimento o ripio"
        >
          {terreno ? "Ver el plano" : "Ver el satélite"}
        </button>
      </div>
      {terreno && (
        <div className="mt-1">
          <ReferenciaTerreno />
        </div>
      )}
      <p className="mt-1 text-[11px] text-texto-3">Tocá un punto rojo para ir a cargarlo.</p>

      {tocado && !tocado.hecho && (
        <button
          type="button"
          onClick={() => irATarjeta(tocado.id)}
          className="mt-2 w-full rounded-xl bg-azul px-4 py-3 text-left text-sm font-bold text-white"
        >
          Cargar {tocado.direccion ?? "este trabajo"} →
        </button>
      )}
      {tocado?.hecho && (
        <p className="mt-2 rounded-xl border border-resuelto/40 bg-resuelto/10 px-4 py-3 text-sm text-resuelto">
          {tocado.direccion ?? "Este trabajo"} ya está cargado.
        </p>
      )}
    </div>
  );
}
