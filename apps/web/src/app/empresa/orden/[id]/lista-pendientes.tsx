"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { LocateFixed, Map as IconoMapa, Search, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Layer, Map as MapaGL, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import type { ItemOrden } from "@/lib/ordenes";
import { numero } from "@/lib/formato";
import { estiloMapa, usarTemaMapa } from "@/components/mapa/tema-mapa";
import { TarjetaItem } from "./tarjeta-item";

/**
 * EL TRABAJO DEL DÍA, ORDENADO PARA LA CALLE.
 *
 * Una orden de bacheo no son cuatro baches: cuando se releva un circuito
 * entero puede traer decenas, y hasta ahora la única manera de encontrar uno
 * era bajar scrolleando una lista en el orden en que la armó el sistema. En
 * el teléfono, con guantes y el camión esperando, eso no escala.
 *
 * Tres cosas, y ninguna cambia lo que se guarda:
 *  - BUSCAR por calle, para ir directo al que se está por tapar.
 *  - ORDENAR POR CERCANÍA con el GPS del teléfono: el próximo bache es el que
 *    está a la vuelta, no el que le tocó el número más bajo.
 *  - EL MAPA DE LA ORDEN, para ver de una cuánto falta y dónde — que es como
 *    se arma el recorrido de la jornada, no leyendo direcciones sueltas.
 */

/** Distancia en metros — fórmula del haversine, alcanza y sobra para ordenar. */
function metrosEntre(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "a 180 m" / "a 1,4 km": la unidad con la que se decide a cuál ir primero. */
const distanciaCorta = (m: number) =>
  m < 1000 ? `a ${Math.round(m)} m` : `a ${(m / 1000).toFixed(1).replace(".", ",")} km`;

/** Sin tildes ni mayúsculas: "Sarmiento" tiene que encontrar "SARMIENTO" y "sarmíento". */
const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

type Punto = { id: number; lat: number; lon: number; direccion: string | null; hecho: boolean };

export function ListaPendientes({
  pendientes,
  hechos,
  ordenId,
}: {
  pendientes: ItemOrden[];
  /** Solo para el mapa: ver lo tapado al lado de lo que falta es el progreso real. */
  hechos: ItemOrden[];
  ordenId: number;
}) {
  const [busqueda, setBusqueda] = useState("");
  const [porCercania, setPorCercania] = useState(false);
  const [miPunto, setMiPunto] = useState<{ lat: number; lon: number } | null>(null);
  const [errorGps, setErrorGps] = useState<string | null>(null);
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [verMapa, setVerMapa] = useState(false);

  const pedirUbicacion = () => {
    if (!navigator.geolocation) {
      setErrorGps("Este teléfono no comparte la ubicación.");
      return;
    }
    setBuscandoGps(true);
    setErrorGps(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMiPunto({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setPorCercania(true);
        setBuscandoGps(false);
      },
      () => {
        setErrorGps("No se pudo leer tu ubicación. Revisá que el GPS esté encendido.");
        setBuscandoGps(false);
      },
      { enableHighAccuracy: true, timeout: 12_000 },
    );
  };

  /** La lista que se dibuja: filtrada por texto y, si se pidió, ordenada por cercanía. */
  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    let lista = pendientes;
    if (q.length > 0) lista = lista.filter((i) => normalizar(i.direccion ?? "").includes(q));
    if (porCercania && miPunto) {
      // Los que no tienen punto se van al final: no se pueden ordenar por algo
      // que no tienen, y esconderlos sería perder trabajo encargado.
      lista = [...lista].sort((a, b) => {
        const da =
          a.lat != null && a.lon != null ? metrosEntre(miPunto.lat, miPunto.lon, a.lat, a.lon) : Infinity;
        const db =
          b.lat != null && b.lon != null ? metrosEntre(miPunto.lat, miPunto.lon, b.lat, b.lon) : Infinity;
        return da - db;
      });
    }
    return lista;
  }, [pendientes, busqueda, porCercania, miPunto]);

  const irA = (id: number) => {
    setVerMapa(false);
    // El timeout deja que el mapa se pliegue antes de medir la posición del
    // destino; sin esto el scroll apunta a donde estaba la tarjeta con el
    // mapa abierto y queda a media pantalla.
    setTimeout(() => {
      document.getElementById(`item-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 60);
  };

  // Solo vale la pena la barra cuando hay lista para navegar.
  const conHerramientas = pendientes.length >= 5;

  return (
    <div>
      {conHerramientas && (
        <div className="mb-3 rounded-xl border border-borde bg-panel p-3">
          <div className="relative">
            <Search size={16} className="absolute top-1/2 left-3 -translate-y-1/2 text-texto-3" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por calle…"
              className="w-full rounded-xl border border-borde-2 bg-panel-2 py-3 pr-10 pl-9 text-base"
            />
            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda("")}
                aria-label="Borrar la búsqueda"
                className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-texto-3 hover:text-texto"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => (miPunto ? setPorCercania((v) => !v) : pedirUbicacion())}
              disabled={buscandoGps}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition disabled:opacity-60 ${
                porCercania
                  ? "border-celeste/60 bg-celeste/10 text-celeste"
                  : "border-borde-2 text-texto-2 hover:border-celeste/60 hover:text-celeste"
              }`}
            >
              <LocateFixed size={15} />
              {buscandoGps ? "Ubicando…" : porCercania ? "Más cerca mío" : "Ordenar por cercanía"}
            </button>
            <button
              type="button"
              onClick={() => setVerMapa((v) => !v)}
              className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition ${
                verMapa
                  ? "border-celeste/60 bg-celeste/10 text-celeste"
                  : "border-borde-2 text-texto-2 hover:border-celeste/60 hover:text-celeste"
              }`}
            >
              <IconoMapa size={15} />
              {verMapa ? "Ocultar el mapa" : "Ver el mapa"}
            </button>
          </div>

          {errorGps && <p className="mt-2 text-[12px] text-peligro">{errorGps}</p>}
          <p className="mt-2 text-[12px] text-texto-3">
            {visibles.length === pendientes.length ? (
              <>
                <b className="num text-texto-2">{numero(pendientes.length)}</b> pendientes en esta orden
              </>
            ) : (
              <>
                Mostrando <b className="num text-texto-2">{numero(visibles.length)}</b> de{" "}
                <b className="num">{numero(pendientes.length)}</b> pendientes
              </>
            )}
            {porCercania && miPunto && " · ordenados desde donde estás"}
          </p>
        </div>
      )}

      {verMapa && (
        <MapaOrden
          puntos={[
            ...pendientes.flatMap((i) =>
              i.lat != null && i.lon != null
                ? [{ id: i.id, lat: i.lat, lon: i.lon, direccion: i.direccion, hecho: false }]
                : [],
            ),
            ...hechos.flatMap((i) =>
              i.lat != null && i.lon != null
                ? [{ id: i.id, lat: i.lat, lon: i.lon, direccion: i.direccion, hecho: true }]
                : [],
            ),
          ]}
          miPunto={miPunto}
          alElegir={irA}
        />
      )}

      {visibles.length === 0 && (
        <p className="rounded-xl border border-borde bg-panel px-4 py-8 text-center text-sm text-texto-2">
          Ninguna dirección pendiente coincide con “{busqueda}”.
        </p>
      )}

      <div className="space-y-4">
        {visibles.map((item) => {
          const d =
            porCercania && miPunto && item.lat != null && item.lon != null
              ? metrosEntre(miPunto.lat, miPunto.lon, item.lat, item.lon)
              : null;
          return (
            <div key={item.id} id={`item-${item.id}`} className="scroll-mt-4">
              {d != null && (
                <p className="num mb-1 text-[11px] font-semibold text-celeste">{distanciaCorta(d)}</p>
              )}
              <TarjetaItem item={item} ordenId={ordenId} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** El semáforo de siempre, acá reducido a la única pregunta de la jornada:
 *  rojo = falta, verde = tapado. */
const COLOR_FALTA = "#d42d20";
const COLOR_HECHO = "#199e70";

function MapaOrden({
  puntos,
  miPunto,
  alElegir,
}: {
  puntos: Punto[];
  miPunto: { lat: number; lon: number } | null;
  alElegir: (id: number) => void;
}) {
  const tema = usarTemaMapa();
  const mapRef = useRef<MapRef>(null);
  const [tocado, setTocado] = useState<Punto | null>(null);

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
  const encuadre = useMemo(() => {
    if (puntos.length === 0) return null;
    const lats = puntos.map((p) => p.lat);
    const lons = puntos.map((p) => p.lon);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
    };
  }, [puntos]);

  if (puntos.length === 0) {
    return (
      <p className="mb-3 rounded-xl border border-borde bg-panel px-4 py-6 text-center text-sm text-texto-2">
        Ningún trabajo de esta orden tiene ubicación cargada todavía.
      </p>
    );
  }

  return (
    <div className="mb-3">
      <div className="overflow-hidden rounded-xl border border-borde" style={{ height: 300 }}>
        <MapaGL
          ref={mapRef}
          /* El encuadre va en el estado INICIAL y no en un fitBounds dentro
             de un efecto: al montar, el mapa todavía no terminó de cargar el
             estilo y el fitBounds se pierde — abría centrado en el primer
             punto con la mitad de la orden fuera de pantalla. */
          initialViewState={{
            bounds: [
              [encuadre!.minLon, encuadre!.minLat],
              [encuadre!.maxLon, encuadre!.maxLat],
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
        <span className="ml-auto">Tocá un punto rojo para ir a cargarlo.</span>
      </div>

      {tocado && !tocado.hecho && (
        <button
          type="button"
          onClick={() => alElegir(tocado.id)}
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
