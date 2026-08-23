"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { Layer, Map as MapaGL, Source } from "react-map-gl/maplibre";
import type { FeatureCollection, Point } from "geojson";
import type { ViewState } from "react-map-gl/maplibre";

const ESTILO =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

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
}: {
  vistaMapa: ViewState;
  demandas: FC;
}) {
  const [corte, setCorte] = useState(50);
  const arrastrando = useRef(false);
  const contRef = useRef<HTMLDivElement>(null);

  const mover = useCallback((clientX: number) => {
    const r = contRef.current?.getBoundingClientRect();
    if (!r) return;
    const pct = ((clientX - r.left) / r.width) * 100;
    setCorte(Math.min(92, Math.max(8, pct)));
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
      {/* Mapa espejo (solo pedidos), recortado a la izquierda del divisor */}
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - corte}% 0 0)` }}>
        <MapaGL
          {...vistaMapa}
          mapStyle={ESTILO}
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
                "circle-stroke-color": "#0B0F16",
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

      {/* Etiquetas de lectura */}
      <div className="absolute bottom-16 z-10 select-none" style={{ left: `max(12px, calc(${corte}% - 130px))` }}>
        <span className="rounded-lg bg-[#3987e5] px-2.5 py-1 text-[11px] font-black tracking-wider text-white uppercase shadow">
          Lo pedido
        </span>
      </div>
      <div className="absolute bottom-16 z-10 select-none" style={{ left: `calc(${corte}% + 14px)` }}>
        <span className="rounded-lg bg-[#199e70] px-2.5 py-1 text-[11px] font-black tracking-wider text-white uppercase shadow">
          Lo hecho
        </span>
      </div>
    </div>
  );
}
