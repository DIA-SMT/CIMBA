"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Layer, Map as MapaGL, Source } from "react-map-gl/maplibre";
import type { FeatureCollection, Point } from "geojson";
import type { MapRef, ViewState } from "react-map-gl/maplibre";
import { numero } from "@/lib/formato";
import { estiloMapa, usarTemaMapa } from "./tema-mapa";

type FC = FeatureCollection<Point, Record<string, unknown>>;

/**
 * Cortina "LO PEDIDO | LO HECHO": un segundo mapa sincronizado, recortado con
 * clip-path, que muestra SOLO los pedidos; el mapa principal (que en modo
 * comparación muestra solo lo hecho) queda visible a la derecha de la cortina.
 * La brecha se vuelve una imagen que se recorre arrastrando el divisor.
 */
export function CortinaComparar({
  vistaMapa,
  demandas,
  espejoRef,
  alCambiarCorte,
  balance,
}: {
  vistaMapa: ViewState;
  demandas: FC;
  /** Para poder capturar el mapa espejo junto con el principal en una imagen. */
  espejoRef?: React.Ref<MapRef>;
  alCambiarCorte?: (corte: number) => void;
  /** La brecha en números, de lo que hay en pantalla en este momento — para
   *  que no haya que interpretar la densidad de puntos a ojo. */
  balance?: { pend: number; sinAt: number; m2: number } | null;
}) {
  const [corte, setCorte] = useState(50);
  const arrastrando = useRef(false);
  const contRef = useRef<HTMLDivElement>(null);
  // El espejo tiene que usar el MISMO estilo base que el mapa principal:
  // una cortina mitad clara y mitad oscura no compara nada.
  const tema = usarTemaMapa();

  const mover = useCallback(
    (clientX: number) => {
      const r = contRef.current?.getBoundingClientRect();
      if (!r) return;
      const pct = Math.min(92, Math.max(8, ((clientX - r.left) / r.width) * 100));
      setCorte(pct);
      alCambiarCorte?.(pct);
    },
    [alCambiarCorte],
  );

  useEffect(() => {
    alCambiarCorte?.(corte);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const alMover = (e: PointerEvent) => {
      if (arrastrando.current) mover(e.clientX);
    };
    const alSoltar = () => {
      arrastrando.current = false;
    };
    window.addEventListener("pointermove", alMover);
    window.addEventListener("pointerup", alSoltar);
    return () => {
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
    };
  }, [mover]);

  return (
    <div ref={contRef} className="pointer-events-none absolute inset-0 z-[6]">
      {/* Mapa espejo (solo pedidos), recortado a la izquierda del divisor.
          pointer-events-auto: sin esto, hover/clic sobre "Lo pedido" atraviesa
          este mapa (no interactivo) y llega al mapa principal de abajo,
          disparando tooltips/paneos de puntos que ni siquiera se ven ahí. */}
      <div className="pointer-events-auto absolute inset-0" style={{ clipPath: `inset(0 ${100 - corte}% 0 0)` }}>
        <MapaGL
          ref={espejoRef}
          {...vistaMapa}
          mapStyle={estiloMapa(tema)}
          interactive={false}
          attributionControl={false}
          style={{ width: "100%", height: "100%" }}
        >
          <Source id="comp-demandas" type="geojson" data={demandas}>
            <Layer
              id="comp-demandas-halo"
              type="circle"
              paint={{ "circle-radius": 7, "circle-color": "#3987e5", "circle-opacity": 0.25 }}
            />
            <Layer
              id="comp-demandas-punto"
              type="circle"
              paint={{
                "circle-radius": 3.5,
                "circle-color": "#3987e5",
                "circle-stroke-color": tema === "oscuro" ? "#0B0F16" : "#ffffff",
                "circle-stroke-width": 1,
              }}
            />
          </Source>
        </MapaGL>
      </div>

      {/* Divisor arrastrable */}
      <div
        className="pointer-events-auto absolute top-0 bottom-0 z-10 flex w-6 -translate-x-1/2 cursor-ew-resize items-center justify-center"
        style={{ left: `${corte}%` }}
        onPointerDown={(e) => {
          arrastrando.current = true;
          e.preventDefault();
        }}
      >
        <div className="h-full w-[3px] bg-amarillo/90 shadow-[0_0_10px_rgba(244,220,0,0.5)]" />
        <div className="absolute top-1/2 -translate-y-1/2 rounded-full border-2 border-amarillo bg-panel px-1.5 py-2 text-[10px] font-black text-amarillo">
          ⇔
        </div>
      </div>

      {/* Etiquetas de lectura: el número sale de lo que hay en pantalla en
          este momento, para no tener que interpretar la densidad de puntos
          a ojo — la brecha, convertida en una cifra clara. */}
      <div className="absolute bottom-16 z-10 max-w-44 select-none" style={{ left: `max(12px, calc(${corte}% - 170px))` }}>
        <span className="inline-block rounded-lg bg-[#3987e5] px-2.5 py-1 text-[11px] font-black tracking-wider text-white uppercase shadow">
          Lo pedido
        </span>
        <div className="mt-1 rounded-md bg-fondo/85 px-2.5 py-1.5">
          <p className="num text-2xl font-black" style={{ color: tema === "oscuro" ? "#6fadf5" : "#2f6fd0" }}>{numero(balance?.pend ?? 0)}</p>
          <p className="text-[10px] leading-snug text-texto-2">pedidos pendientes en pantalla</p>
        </div>
      </div>
      <div className="absolute bottom-16 z-10 max-w-44 select-none" style={{ left: `calc(${corte}% + 14px)` }}>
        <span className="inline-block rounded-lg bg-[#199e70] px-2.5 py-1 text-[11px] font-black tracking-wider text-white uppercase shadow">
          Lo hecho
        </span>
        <div className="mt-1 rounded-md bg-fondo/85 px-2.5 py-1.5">
          <p className="num text-2xl font-black" style={{ color: tema === "oscuro" ? "#3ecb92" : "#0e7f57" }}>{numero(balance?.m2 ?? 0)} m²</p>
          <p className="text-[10px] leading-snug text-texto-2">reparados o en obra, en pantalla</p>
        </div>
      </div>
    </div>
  );
}
