"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useState } from "react";
import type { FeatureCollection, Geometry } from "geojson";
import { Layer, Map as MapaGL, Source } from "react-map-gl/maplibre";
import { colorDeEmpresa } from "@/lib/color-empresa";
import { numero } from "@/lib/formato";
import { estiloMapa, usarTemaMapa } from "@/components/mapa/tema-mapa";

type FC = FeatureCollection<Geometry, Record<string, unknown>>;

/**
 * DÓNDE SE ESTÁ TRABAJANDO: las órdenes del último mes, cada empresa con su
 * color. Nació de un problema concreto —dos inspectores generaron la misma
 * obra en la misma bocacalle— así que lo que tiene que responder de un vistazo
 * es "¿esto ya está mandado, y a quién?".
 *
 * Se carga recién al abrirlo: en Órdenes casi nadie lo necesita en cada visita
 * y son hasta 4.000 puntos.
 */
export function MapaOrdenes() {
  const tema = usarTemaMapa();
  const [abierto, setAbierto] = useState(false);
  const [dias, setDias] = useState(30);
  const [datos, setDatos] = useState<FC | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    setCargando(true);
    fetch(`/api/ordenes/mapa?dias=${dias}`)
      .then((r) => r.json())
      .then((d: FC) => setDatos(d))
      .catch(() => setDatos(null))
      .finally(() => setCargando(false));
  }, [abierto, dias]);

  /** El color se resuelve acá y viaja como propiedad: MapLibre no puede
   *  hashear el nombre de la empresa adentro de una expresión de pintado. */
  const conColor = useMemo<FC | null>(() => {
    if (!datos) return null;
    return {
      type: "FeatureCollection",
      features: datos.features.map((f) => ({
        ...f,
        properties: { ...f.properties, color: colorDeEmpresa(String(f.properties?.empresa ?? "")) },
      })),
    };
  }, [datos]);

  const porEmpresa = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of datos?.features ?? []) {
      const e = String(f.properties?.empresa ?? "");
      m.set(e, (m.get(e) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [datos]);

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setAbierto((v) => !v)}
          className="rounded-lg border border-borde-2 px-4 py-2 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste"
        >
          {abierto ? "Ocultar el mapa de órdenes" : "Ver dónde se está trabajando"}
        </button>
        {abierto && (
          <>
            {[15, 30, 90].map((d) => (
              <button
                key={d}
                onClick={() => setDias(d)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  dias === d ? "bg-azul text-white" : "border border-borde-2 text-texto-2 hover:text-texto"
                }`}
              >
                {d} días
              </button>
            ))}
            {cargando && <span className="text-xs text-texto-3">cargando…</span>}
          </>
        )}
      </div>

      {abierto && (
        <div className="mt-3 overflow-hidden rounded-xl border border-borde">
          <div style={{ height: 380 }}>
            <MapaGL
              initialViewState={{ longitude: -65.216, latitude: -26.824, zoom: 12 }}
              mapStyle={estiloMapa(tema)}
              attributionControl={{ compact: true }}
            >
              {conColor && (
                <Source id="ordenes-mapa" type="geojson" data={conColor}>
                  {/* Los tramos son líneas y los baches puntos: dos capas
                      sobre la misma fuente, cada una con su filtro. */}
                  <Layer
                    id="ordenes-linea"
                    type="line"
                    filter={["==", ["geometry-type"], "LineString"]}
                    paint={{ "line-color": ["get", "color"], "line-width": 4, "line-opacity": 0.85 }}
                  />
                  <Layer
                    id="ordenes-punto"
                    type="circle"
                    filter={["==", ["geometry-type"], "Point"]}
                    paint={{
                      "circle-color": ["get", "color"],
                      "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 7],
                      "circle-stroke-width": 0.6,
                      "circle-stroke-color": tema === "oscuro" ? "#0B0F16" : "#ffffff",
                      "circle-opacity": 0.9,
                    }}
                  />
                </Source>
              )}
            </MapaGL>
          </div>
          {porEmpresa.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-borde px-4 py-2 text-[11px]">
              {porEmpresa.map(([empresa, n]) => (
                <span key={empresa} className="flex items-center gap-1.5 text-texto-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: colorDeEmpresa(empresa) }}
                  />
                  {empresa} <span className="num text-texto-3">{numero(n)}</span>
                </span>
              ))}
            </div>
          )}
          {datos && datos.features.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-texto-3">
              No hay órdenes emitidas en los últimos {dias} días.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
