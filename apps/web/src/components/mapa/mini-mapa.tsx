"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { MapPin, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Map as MapaGL, Marker, NavigationControl, type MapRef } from "react-map-gl/maplibre";
import { estiloMapa, usarTemaMapa } from "./tema-mapa";

/**
 * Mini-mapa universal — el pedido literal del Director: "en todo lugar donde
 * se referencie algo debe poder abrirse aunque sea en miniatura el mapa para
 * poder marcar cosas o verificar".
 *
 * Dos piezas:
 *  - <MiniMapa>: el mapa chico en sí, embebible donde haga falta; con alMover
 *    el pin se vuelve arrastrable (para afinar puntos geocodificados).
 *  - <ChipMiniMapa>: el gatillo para tablas y tarjetas; abre el mini-mapa en
 *    un modal liviano. Modal y no expansión inline: adentro de <table> una
 *    fila expandida rompe el layout y en mobile no entra.
 */

// El tema del basemap sale del hook compartido de tema-mapa.ts (mismo que usan
// el mapa comando y los demás mini-mapas): un solo lugar que observa data-tema.

export function MiniMapa({
  lat,
  lon,
  etiqueta,
  alMover,
  alto = 260,
}: {
  lat: number;
  lon: number;
  etiqueta?: string | null;
  /** Si viene, el pin es arrastrable (y un click lo mueve): modo "afinar el punto". */
  alMover?: (punto: { lat: number; lon: number }) => void;
  alto?: number;
}) {
  const tema = usarTemaMapa();
  const mapRef = useRef<MapRef>(null);
  // El pin vive en estado local para seguir el arrastre sin depender de que
  // el padre devuelva las coordenadas; el ref espeja ese estado para que el
  // efecto distinga un punto NUEVO de afuera (re-geocodificación) del eco de
  // nuestro propio alMover, sin re-correrse en cada arrastre.
  const [punto, setPunto] = useState({ lat, lon });
  const puntoRef = useRef({ lat, lon });

  useEffect(() => {
    if (puntoRef.current.lat === lat && puntoRef.current.lon === lon) return;
    puntoRef.current = { lat, lon };
    setPunto({ lat, lon });
    // Punto realmente nuevo desde afuera: recentrar para no dejar el pin
    // afuera del encuadre.
    mapRef.current?.getMap()?.easeTo({ center: [lon, lat], duration: 350 });
  }, [lat, lon]);

  const mover = (nLat: number, nLon: number) => {
    puntoRef.current = { lat: nLat, lon: nLon };
    setPunto({ lat: nLat, lon: nLon });
    alMover?.({ lat: nLat, lon: nLon });
  };

  return (
    <div className="w-full">
      <div className="overflow-hidden rounded-xl border border-borde" style={{ height: alto }}>
        <MapaGL
          ref={mapRef}
          initialViewState={{ longitude: lon, latitude: lat, zoom: 16 }}
          mapStyle={estiloMapa(tema)}
          attributionControl={false}
          onClick={alMover ? (e) => mover(e.lngLat.lat, e.lngLat.lng) : undefined}
        >
          <NavigationControl position="bottom-right" showCompass={false} />
          <Marker
            longitude={punto.lon}
            latitude={punto.lat}
            anchor={alMover ? "bottom" : "center"}
            draggable={Boolean(alMover)}
            onDragEnd={alMover ? (e) => mover(e.lngLat.lat, e.lngLat.lng) : undefined}
          >
            {alMover ? (
              /* stopPropagation: un clic sobre el pin no debe llegar al mapa
                 (lo movería a la posición del cursor). */
              <span onClick={(ev) => ev.stopPropagation()} title={etiqueta ?? undefined}>
                <MapPin
                  size={30}
                  className="cursor-grab drop-shadow active:cursor-grabbing"
                  style={{ color: tema === "oscuro" ? "#f4dc00" : "#ffffff" }}
                  fill="#0066ff"
                />
              </span>
            ) : (
              <span className="relative flex h-6 w-6 items-center justify-center" title={etiqueta ?? undefined}>
                <span className="pulso absolute inline-flex h-6 w-6 rounded-full" style={{ background: "#f4dc0033" }} />
                <span
                  className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-white/80"
                  style={{ background: "#f4dc00" }}
                />
              </span>
            )}
          </Marker>
        </MapaGL>
      </div>
      {alMover && (
        <p className="num mt-1.5 text-[11px] text-texto-3">
          {punto.lat.toFixed(6)}, {punto.lon.toFixed(6)}
          <span className="ml-2 font-sans text-texto-2">— arrastrá el pin hasta el lugar exacto</span>
        </p>
      )}
    </div>
  );
}

export function ChipMiniMapa({
  lat,
  lon,
  etiqueta,
  texto,
  conMapaCompleto = true,
}: {
  lat: number | null | undefined;
  lon: number | null | undefined;
  etiqueta?: string | null;
  /** Si viene, el gatillo es un botón con texto (targets grandes, mobile); sin él, el chip de ícono para tablas. */
  texto?: string;
  /** Apagalo en el portal de empresas: el rol empresa no puede entrar a /mapa. */
  conMapaCompleto?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);

  // Escape cierra: el listener vive solo mientras el modal está abierto.
  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  if (lat == null || lon == null) {
    // Mismo hueco visual que el chip para que las tablas no bailen.
    if (texto) return null;
    return (
      <span
        className="inline-flex h-7 w-7 items-center justify-center text-texto-3 opacity-30"
        title="Sin ubicación registrada"
      >
        <MapPin size={14} />
      </span>
    );
  }

  const titulo = etiqueta ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // En filas clickeables (selección de pendientes) el chip no debe
          // disparar el click de la fila.
          e.stopPropagation();
          setAbierto(true);
        }}
        title={`Ver en mini-mapa: ${titulo}`}
        className={
          texto
            ? "inline-flex items-center gap-1.5 rounded-lg border border-borde-2 px-3 py-2 text-xs font-semibold text-celeste transition hover:border-celeste hover:bg-celeste/10"
            : "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-borde-2 text-celeste transition hover:border-celeste hover:bg-celeste/10"
        }
      >
        <MapPin size={14} />
        {texto}
      </button>

      {/* Portal a <body>: un fixed adentro de una celda puede quedar preso de
          cualquier ancestro con transform/filter, y el mapa (MapLibre) recién
          se monta acá, con el modal abierto — no se paga en cada fila. */}
      {abierto &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={titulo}
          >
            {/* Backdrop: bg-fondo flipea solo con el tema (oscuro/claro). */}
            <div className="absolute inset-0 bg-fondo/70" onClick={() => setAbierto(false)} />
            <div className="panel-vidrio relative w-full max-w-md overflow-hidden rounded-2xl">
              <div className="flex items-center justify-between gap-2 border-b border-borde px-3 py-2">
                <span className="min-w-0 truncate text-xs font-semibold" title={titulo}>
                  {titulo}
                </span>
                <button
                  type="button"
                  onClick={() => setAbierto(false)}
                  title="Cerrar"
                  className="shrink-0 rounded-md p-1.5 text-texto-2 transition hover:bg-panel-3 hover:text-peligro"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="p-2">
                <MiniMapa lat={lat} lon={lon} etiqueta={etiqueta} alto={280} />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-borde px-3 py-1.5">
                <span className="num text-[10px] text-texto-3">
                  {lat.toFixed(6)}, {lon.toFixed(6)}
                </span>
                <span className="flex items-center gap-3">
                  <a
                    href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-semibold text-celeste hover:underline"
                  >
                    Street View ↗
                  </a>
                  {conMapaCompleto && (
                    <Link
                      href={`/mapa?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&z=17`}
                      className="text-[11px] font-semibold text-celeste hover:underline"
                      onClick={() => setAbierto(false)}
                    >
                      Mapa completo →
                    </Link>
                  )}
                </span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
