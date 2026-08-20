"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Crosshair, Layers, Search, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Layer,
  Map as MapaGL,
  Marker,
  NavigationControl,
  ScaleControl,
  Source,
  type LayerProps,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import type { FeatureCollection, Point } from "geojson";
import type { RolUsuario } from "@cimba/domain";
import type { Kpis } from "@/lib/consultas";
import { COLOR_MACRO, ETIQUETA_FUENTE, ETIQUETA_TIPO, fechaCorta, numero } from "@/lib/formato";

// ── Tipos del contrato /api/geodata ─────────────────────────────────────────

type FC = FeatureCollection<Point, Record<string, unknown>>;
interface GeoDatos {
  incidentes: FC;
  demandas: FC;
}

const CENTRO_SMT: [number, number] = [-65.2226, -26.8241];
const ESTILO_MAPA =
  process.env.NEXT_PUBLIC_MAP_STYLE_DARK ??
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

// ── Capas MapLibre ──────────────────────────────────────────────────────────

const capaClusters: LayerProps = {
  id: "clusters",
  type: "circle",
  source: "incidentes",
  filter: ["has", "point_count"],
  paint: {
    "circle-color": ["step", ["get", "point_count"], "#1c5cab", 10, "#0066ff", 60, "#2eb1ff", 200, "#f4dc00"],
    "circle-radius": ["step", ["get", "point_count"], 14, 10, 19, 60, 26, 200, 33],
    "circle-stroke-width": 2,
    "circle-stroke-color": "rgba(237,242,250,0.35)",
  },
};

const capaClusterConteo: LayerProps = {
  id: "cluster-conteo",
  type: "symbol",
  source: "incidentes",
  filter: ["has", "point_count"],
  layout: {
    "text-field": ["get", "point_count_abbreviated"],
    "text-size": 12,
    "text-font": ["Open Sans Bold"],
  },
  paint: {
    "text-color": ["step", ["get", "point_count"], "#ffffff", 200, "#16181d"],
  },
};

const capaIncidentes: LayerProps = {
  id: "incidentes-punto",
  type: "circle",
  source: "incidentes",
  filter: ["!", ["has", "point_count"]],
  paint: {
    "circle-color": [
      "match",
      ["get", "macro"],
      "abierto", COLOR_MACRO.abierto,
      "en_curso", COLOR_MACRO.en_curso,
      "resuelto", COLOR_MACRO.resuelto,
      COLOR_MACRO.inactivo,
    ],
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 14, 6, 17, 9],
    // Anillo amarillo = obra SIGOV (contratada); anillo claro = CIMBA/planillas
    "circle-stroke-width": ["case", ["==", ["get", "origen"], "sigov"], 2, 1],
    "circle-stroke-color": [
      "case",
      ["==", ["get", "origen"], "sigov"],
      "#f4dc00",
      "rgba(237,242,250,0.4)",
    ],
  },
};

const capaPulso: LayerProps = {
  id: "incidentes-pulso",
  type: "circle",
  source: "incidentes",
  filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "estado"], "en_ejecucion"]],
  paint: {
    "circle-color": "rgba(0,0,0,0)",
    "circle-radius": 10,
    "circle-stroke-width": 2,
    "circle-stroke-color": COLOR_MACRO.en_curso,
    "circle-stroke-opacity": 0.6,
  },
};

const capaDemandas: LayerProps = {
  id: "demandas-punto",
  type: "circle",
  source: "demandas",
  paint: {
    "circle-color": "#8fa3bf",
    "circle-opacity": 0.55,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.6, 14, 3, 17, 5],
    "circle-stroke-width": ["case", ["<", ["coalesce", ["get", "confianza"], 1], 0.5], 1.2, 0],
    "circle-stroke-color": "#e66767",
  },
};

const capaCalor: LayerProps = {
  id: "demandas-calor",
  type: "heatmap",
  source: "demandas",
  paint: {
    "heatmap-weight": 1,
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 15, 1.6],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 11, 14, 15, 32],
    "heatmap-opacity": 0.75,
    "heatmap-color": [
      "interpolate", ["linear"], ["heatmap-density"],
      0, "rgba(13,54,107,0)",
      0.25, "#104281",
      0.5, "#1c5cab",
      0.72, "#3987e5",
      0.9, "#86b6ef",
      1, "#cde2fb",
    ],
  },
};

// ── Componente principal ────────────────────────────────────────────────────

const clienteQuery = new QueryClient();

export function MapaCimba(props: { kpisIniciales: Kpis; rol: RolUsuario }) {
  return (
    <QueryClientProvider client={clienteQuery}>
      <MapaInterno {...props} />
    </QueryClientProvider>
  );
}

type Seleccion =
  | { capa: "incidente"; props: Record<string, unknown>; lngLat: [number, number] }
  | { capa: "demanda"; props: Record<string, unknown>; lngLat: [number, number] };

function MapaInterno({ kpisIniciales }: { kpisIniciales: Kpis; rol: RolUsuario }) {
  const mapRef = useRef<MapRef>(null);
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);
  const [panelCapas, setPanelCapas] = useState(true);
  const [marcador, setMarcador] = useState<[number, number] | null>(null);

  // Estado de capas y filtros
  const [verMacro, setVerMacro] = useState<Record<string, boolean>>({
    abierto: true,
    en_curso: true,
    resuelto: true,
    inactivo: false,
  });
  const [verDemandas, setVerDemandas] = useState(true);
  const [verCalor, setVerCalor] = useState(false);
  const [fuentes, setFuentes] = useState<Record<string, boolean>>({});
  const [dias, setDias] = useState<number | null>(null); // null = todo

  const { data } = useQuery<GeoDatos>({
    queryKey: ["geodata"],
    queryFn: async () => {
      const res = await fetch("/api/geodata");
      if (!res.ok) throw new Error("geodata");
      return res.json();
    },
    refetchInterval: 60_000,
  });

  // Fuentes presentes en los datos (chips dinámicos)
  const fuentesPresentes = useMemo(() => {
    const s = new Set<string>();
    for (const f of data?.demandas.features ?? []) s.add(String(f.properties.fuente));
    return [...s].sort();
  }, [data]);

  const corte = dias ? Date.now() - dias * 86_400_000 : null;

  const incidentesFiltrados = useMemo<FC>(() => {
    const features = (data?.incidentes.features ?? []).filter((f) => {
      if (!verMacro[String(f.properties.macro)]) return false;
      if (corte && Date.parse(String(f.properties.detectado_en)) < corte) return false;
      return true;
    });
    return { type: "FeatureCollection", features };
  }, [data, verMacro, corte]);

  const demandasFiltradas = useMemo<FC>(() => {
    const features = (data?.demandas.features ?? []).filter((f) => {
      const fuente = String(f.properties.fuente);
      if (fuentes[fuente] === false) return false;
      if (corte && Date.parse(String(f.properties.creado_en)) < corte) return false;
      return true;
    });
    return { type: "FeatureCollection", features };
  }, [data, fuentes, corte]);

  // KPIs vivos calculados sobre lo visible
  const kpis = useMemo(() => {
    const inc = incidentesFiltrados.features;
    return {
      demandas: demandasFiltradas.features.length,
      abiertos: inc.filter((f) => f.properties.macro === "abierto").length,
      enCurso: inc.filter((f) => f.properties.macro === "en_curso").length,
      resueltos: inc.filter((f) => f.properties.macro === "resuelto").length,
      m2: kpisIniciales.m2Intervenidos,
      sinVincular: kpisIniciales.demandasSinVincular,
    };
  }, [incidentesFiltrados, demandasFiltradas, kpisIniciales]);

  // Pulso animado de "en ejecución"
  useEffect(() => {
    let vivo = true;
    let raf = 0;
    const animar = (t: number) => {
      if (!vivo) return;
      const mapa = mapRef.current?.getMap();
      if (mapa?.getLayer("incidentes-pulso")) {
        const fase = (t % 1800) / 1800;
        mapa.setPaintProperty("incidentes-pulso", "circle-radius", 8 + fase * 16);
        mapa.setPaintProperty("incidentes-pulso", "circle-stroke-opacity", 0.65 * (1 - fase));
      }
      raf = requestAnimationFrame(animar);
    };
    raf = requestAnimationFrame(animar);
    return () => {
      vivo = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  const alClick = useCallback((e: MapLayerMouseEvent) => {
    const feature = e.features?.[0];
    if (!feature) {
      setSeleccion(null);
      return;
    }
    if (feature.layer.id === "clusters") {
      const mapa = mapRef.current?.getMap();
      const fuente = mapa?.getSource("incidentes") as { getClusterExpansionZoom?: (id: number) => Promise<number> } | undefined;
      const clusterId = feature.properties?.cluster_id as number;
      void fuente?.getClusterExpansionZoom?.(clusterId).then((zoom) => {
        mapa?.easeTo({ center: e.lngLat, zoom: zoom + 0.5, duration: 500 });
      });
      return;
    }
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    if (feature.layer.id === "incidentes-punto") {
      setSeleccion({ capa: "incidente", props: feature.properties ?? {}, lngLat });
    } else if (feature.layer.id === "demandas-punto") {
      setSeleccion({ capa: "demanda", props: feature.properties ?? {}, lngLat });
    }
    mapRef.current?.easeTo({ center: e.lngLat, duration: 400, offset: [-140, 0] });
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapaGL
        ref={mapRef}
        initialViewState={{ longitude: CENTRO_SMT[0], latitude: CENTRO_SMT[1], zoom: 12.6 }}
        mapStyle={ESTILO_MAPA}
        interactiveLayerIds={["clusters", "incidentes-punto", "demandas-punto"]}
        onClick={alClick}
        onMouseEnter={() => {
          const c = mapRef.current?.getCanvas();
          if (c) c.style.cursor = "pointer";
        }}
        onMouseLeave={() => {
          const c = mapRef.current?.getCanvas();
          if (c) c.style.cursor = "";
        }}
        attributionControl={{ compact: true }}
      >
        <NavigationControl position="bottom-right" visualizePitch />
        <ScaleControl position="bottom-left" />

        {verDemandas && (
          <Source id="demandas" type="geojson" data={demandasFiltradas}>
            {verCalor && <Layer {...capaCalor} />}
            <Layer {...capaDemandas} />
          </Source>
        )}

        <Source
          id="incidentes"
          type="geojson"
          data={incidentesFiltrados}
          cluster
          clusterMaxZoom={15}
          clusterRadius={55}
        >
          <Layer {...capaPulso} />
          <Layer {...capaIncidentes} />
          <Layer {...capaClusters} />
          <Layer {...capaClusterConteo} />
        </Source>

        {marcador && (
          <Marker longitude={marcador[0]} latitude={marcador[1]} anchor="bottom">
            <div className="flex flex-col items-center">
              <Crosshair size={26} className="text-amarillo drop-shadow" />
            </div>
          </Marker>
        )}
      </MapaGL>

      {/* KPIs */}
      <div className="pointer-events-none absolute top-3 left-3 right-3 z-10 flex flex-wrap gap-2">
        <Kpi etiqueta="Demandas" valor={kpis.demandas} color="#8fa3bf" />
        <Kpi etiqueta="Sin vincular" valor={kpis.sinVincular} color="#f4dc00" />
        <Kpi etiqueta="Abiertos" valor={kpis.abiertos} color={COLOR_MACRO.abierto} />
        <Kpi etiqueta="En curso" valor={kpis.enCurso} color={COLOR_MACRO.en_curso} pulso />
        <Kpi etiqueta="Resueltos" valor={kpis.resueltos} color={COLOR_MACRO.resuelto} />
        <Kpi etiqueta="m² intervenidos" valor={kpis.m2} color="#2eb1ff" />
        <div className="pointer-events-auto ml-auto">
          <Buscador
            alEncontrar={(lon, lat) => {
              setMarcador([lon, lat]);
              mapRef.current?.flyTo({ center: [lon, lat], zoom: 16.5, duration: 1200 });
            }}
          />
        </div>
      </div>

      {/* Panel de capas */}
      <div className="absolute bottom-6 left-3 z-10">
        {panelCapas ? (
          <div className="panel-vidrio w-64 rounded-xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
                <Layers size={14} className="text-celeste" /> Capas
              </span>
              <button onClick={() => setPanelCapas(false)} className="text-texto-3 hover:text-texto">
                <X size={14} />
              </button>
            </div>

            <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Incidentes</p>
            {(
              [
                ["abierto", "Abiertos"],
                ["en_curso", "En curso"],
                ["resuelto", "Resueltos"],
                ["inactivo", "Desestimados"],
              ] as const
            ).map(([clave, etiqueta]) => (
              <label key={clave} className="mb-1 flex cursor-pointer items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={verMacro[clave] ?? false}
                  onChange={(e) => setVerMacro((v) => ({ ...v, [clave]: e.target.checked }))}
                  className="accent-[#0066ff]"
                />
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: COLOR_MACRO[clave] }} />
                {etiqueta}
              </label>
            ))}
            <p className="mt-1 mb-2 flex items-center gap-1.5 text-[10px] text-texto-3">
              <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-amarillo" /> anillo amarillo = obra SIGOV
            </p>

            <p className="mt-3 mb-1.5 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Demandas</p>
            <label className="mb-1 flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" checked={verDemandas} onChange={(e) => setVerDemandas(e.target.checked)} className="accent-[#0066ff]" />
              Puntos de demanda
            </label>
            <label className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]">
              <input type="checkbox" checked={verCalor} onChange={(e) => setVerCalor(e.target.checked)} className="accent-[#0066ff]" />
              Mapa de calor
            </label>
            {fuentesPresentes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {fuentesPresentes.map((f) => {
                  const activa = fuentes[f] !== false;
                  return (
                    <button
                      key={f}
                      onClick={() => setFuentes((v) => ({ ...v, [f]: !activa }))}
                      className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition ${
                        activa ? "border-celeste/50 bg-celeste/10 text-celeste" : "border-borde-2 text-texto-3"
                      }`}
                    >
                      {ETIQUETA_FUENTE[f as keyof typeof ETIQUETA_FUENTE] ?? f}
                    </button>
                  );
                })}
              </div>
            )}

            <p className="mt-3 mb-1.5 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Período</p>
            <div className="flex gap-1">
              {(
                [
                  [null, "Todo"],
                  [30, "30d"],
                  [90, "90d"],
                  [180, "180d"],
                ] as const
              ).map(([d, etiqueta]) => (
                <button
                  key={etiqueta}
                  onClick={() => setDias(d)}
                  className={`flex-1 rounded-md border px-1 py-1 text-[11px] font-medium transition ${
                    dias === d ? "border-azul bg-azul/20 text-texto" : "border-borde-2 text-texto-3 hover:text-texto"
                  }`}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button onClick={() => setPanelCapas(true)} className="panel-vidrio rounded-xl p-3 text-celeste transition hover:text-texto" title="Capas">
            <Layers size={18} />
          </button>
        )}
      </div>

      {/* Panel de detalle */}
      {seleccion && <PanelDetalle seleccion={seleccion} alCerrar={() => setSeleccion(null)} />}
    </div>
  );
}

function Kpi({ etiqueta, valor, color, pulso }: { etiqueta: string; valor: number; color: string; pulso?: boolean }) {
  return (
    <div className="panel-vidrio pointer-events-auto flex items-center gap-2.5 rounded-xl px-3.5 py-2">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${pulso ? "pulso" : ""}`} style={{ background: color }} />
      <div className="leading-tight">
        <div className="num text-base font-bold">{numero(valor)}</div>
        <div className="text-[9px] font-medium tracking-wider text-texto-3 uppercase">{etiqueta}</div>
      </div>
    </div>
  );
}

function Buscador({ alEncontrar }: { alEncontrar: (lon: number, lat: number) => void }) {
  const [q, setQ] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [sinResultado, setSinResultado] = useState(false);

  const buscar = async () => {
    if (q.trim().length < 4) return;
    setBuscando(true);
    setSinResultado(false);
    try {
      const res = await fetch(`/api/geocodificar?q=${encodeURIComponent(q)}`);
      const cuerpo = (await res.json()) as { resultado: { punto: { lat: number; lon: number } } | null };
      if (cuerpo.resultado) alEncontrar(cuerpo.resultado.punto.lon, cuerpo.resultado.punto.lat);
      else setSinResultado(true);
    } finally {
      setBuscando(false);
    }
  };

  return (
    <div className="panel-vidrio flex items-center gap-2 rounded-xl px-3 py-2">
      <Search size={14} className={buscando ? "animate-pulse text-amarillo" : "text-texto-3"} />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void buscar()}
        placeholder="Buscar dirección… (Enter)"
        className="w-52 bg-transparent text-[13px] outline-none placeholder:text-texto-3"
      />
      {sinResultado && <span className="text-[10px] text-peligro">sin resultado</span>}
    </div>
  );
}

function PanelDetalle({ seleccion, alCerrar }: { seleccion: Seleccion; alCerrar: () => void }) {
  const p = seleccion.props;
  const esIncidente = seleccion.capa === "incidente";
  const macro = String(p.macro ?? "abierto") as keyof typeof COLOR_MACRO;

  return (
    <aside className="panel-vidrio absolute top-16 right-3 bottom-6 z-10 flex w-80 flex-col rounded-xl">
      <div className="flex items-center justify-between border-b border-borde px-4 py-3">
        <div className="flex items-center gap-2">
          {esIncidente ? (
            <>
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: COLOR_MACRO[macro] }} />
              <span className="text-sm font-bold">Incidente #{String(p.id)}</span>
            </>
          ) : (
            <>
              <span className="inline-block h-3 w-3 rounded-full bg-[#8fa3bf]" />
              <span className="text-sm font-bold">Demanda #{String(p.id)}</span>
            </>
          )}
        </div>
        <button onClick={alCerrar} className="text-texto-3 hover:text-texto">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-[13px]">
        <Dato etiqueta="Dirección" valor={String(p.direccion ?? "—")} />
        <Dato
          etiqueta="Tipo"
          valor={ETIQUETA_TIPO[String(p.tipo) as keyof typeof ETIQUETA_TIPO] ?? String(p.tipo ?? "—")}
        />
        {esIncidente ? (
          <>
            <Dato etiqueta="Estado" valor={String(p.estado).replaceAll("_", " ")} />
            {p.score != null && <Dato etiqueta="Score de prioridad" valor={<span className="num font-bold text-amarillo">{Number(p.score).toFixed(1)}</span>} />}
            <Dato etiqueta="Demandas vinculadas" valor={String(p.demandas ?? 0)} />
            {p.m2 != null && <Dato etiqueta="Superficie" valor={`${numero(Number(p.m2))} m²`} />}
            {p.origen === "sigov" && <Dato etiqueta="Origen" valor="Obra contratada (SIGOV)" />}
            <Dato etiqueta="Detectado" valor={fechaCorta(String(p.detectado_en))} />
          </>
        ) : (
          <>
            <Dato
              etiqueta="Fuente"
              valor={ETIQUETA_FUENTE[String(p.fuente) as keyof typeof ETIQUETA_FUENTE] ?? String(p.fuente)}
            />
            <Dato etiqueta="Estado" valor={String(p.estado).replaceAll("_", " ")} />
            {p.confianza != null && (
              <Dato etiqueta="Confianza geocod." valor={`${Math.round(Number(p.confianza) * 100)}%`} />
            )}
            <Dato etiqueta="Ingresó" valor={fechaCorta(String(p.creado_en))} />
          </>
        )}
        <div className="num pt-1 text-[10px] text-texto-3">
          {seleccion.lngLat[1].toFixed(6)}, {seleccion.lngLat[0].toFixed(6)}
        </div>
      </div>

      <div className="border-t border-borde p-3">
        <Link
          href={esIncidente ? `/incidentes?foco=${String(p.id)}` : `/demandas/${String(p.id)}`}
          className="block rounded-lg bg-azul px-3 py-2.5 text-center text-sm font-semibold text-white transition hover:brightness-110"
        >
          {esIncidente ? "Gestionar incidente" : "Abrir en bandeja"}
        </Link>
      </div>
    </aside>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-wider text-texto-3 uppercase">{etiqueta}</div>
      <div className="mt-0.5">{valor}</div>
    </div>
  );
}
