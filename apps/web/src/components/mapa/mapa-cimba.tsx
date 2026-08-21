"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Crosshair, Flame, Layers, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GeolocateControl,
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
import type { FilterSpecification } from "maplibre-gl";
import type { RolUsuario } from "@cimba/domain";
import type { Kpis } from "@/lib/consultas";
import { COLOR_MACRO, ETIQUETA_FUENTE, ETIQUETA_TIPO, fechaCorta, numero } from "@/lib/formato";

/**
 * Vistas del mapa: la respuesta a "es muchísima información y no se entiende".
 * Cada vista prende solo las capas que sirven para esa tarea.
 */
const VISTAS = {
  operativo: {
    etiqueta: "Operativo",
    descripcion: "Lo que hay que resolver HOY: problemas abiertos/en curso y pedidos aún sin cotejar.",
    macro: { abierto: true, en_curso: true, resuelto: false, inactivo: false },
    demandasAbiertas: true,
    verDemandas: true,
    calor: false,
  },
  historico: {
    etiqueta: "Histórico",
    descripcion: "El trabajo hecho: reparaciones y obras finalizadas.",
    macro: { abierto: false, en_curso: true, resuelto: true, inactivo: false },
    demandasAbiertas: false,
    verDemandas: false,
    calor: false,
  },
  analisis: {
    etiqueta: "Análisis",
    descripcion: "Densidad de demanda (mapa de calor) sobre todo el historial.",
    macro: { abierto: true, en_curso: true, resuelto: false, inactivo: false },
    demandasAbiertas: false,
    verDemandas: true,
    calor: true,
  },
  completo: {
    etiqueta: "Todo",
    descripcion: "Todas las capas a la vez (puede ser mucho).",
    macro: { abierto: true, en_curso: true, resuelto: true, inactivo: false },
    demandasAbiertas: false,
    verDemandas: true,
    calor: false,
  },
} as const;
type Vista = keyof typeof VISTAS;

const AYUDA_KPI = {
  demandas: "Pedidos visibles con la vista y filtros actuales: reclamos de vecinos (AC), pedidos del Concejo, intimaciones SAT, redes y secretarías.",
  sinVincular: "Demandas que todavía nadie cotejó contra el territorio: no sabemos si son un problema nuevo, un duplicado o algo ya reparado. Es la cola de consolidación (pestaña Calidad).",
  abiertos: "Incidentes (problemas físicos confirmados) detectados o priorizados, sin cuadrilla asignada aún.",
  enCurso: "Incidentes con trabajo programado o en ejecución (cuadrilla u obra SIGOV).",
  resueltos: "Incidentes reparados o verificados.",
  m2: "Metros cuadrados de pavimento intervenidos según SIGOV y planillas (intervenciones finalizadas).",
} as const;

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

/**
 * Avenidas y corredores principales, derivados de las teselas vectoriales que
 * ya usa el mapa base (source "carto"). Sin lista hardcodeada ni costo extra.
 *
 * Criterio: el NOMBRE oficial de la vía dice "Avenida" (o "Av."), más las
 * autopistas y troncales (Circunvalación y accesos). Se usa el source-layer
 * `transportation_name` porque es el único que trae `name`; filtrar por
 * `class` no sirve en SMT — OSM etiqueta casi todo el centro como "primary".
 * Este criterio es el mismo que usa el bonus de corredor del score de
 * prioridad (que mira "avenida" en la dirección), así que ambos coinciden.
 */
const FILTRO_AVENIDA: FilterSpecification = [
  "any",
  [">=", ["index-of", "venida", ["coalesce", ["get", "name"], ""]], 0],
  [">=", ["index-of", "Av. ", ["coalesce", ["get", "name"], ""]], 0],
  ["match", ["get", "class"], ["motorway", "trunk"], true, false],
];

const capaAvenidasBrillo: LayerProps = {
  id: "avenidas-brillo",
  type: "line",
  source: "carto",
  "source-layer": "transportation_name",
  filter: FILTRO_AVENIDA,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    // Realce sutil: los corredores orientan, los datos mandan.
    "line-color": "#0066ff",
    "line-opacity": 0.2,
    "line-blur": 2.5,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 14, 8, 17, 14],
  },
};

const capaAvenidas: LayerProps = {
  id: "avenidas-linea",
  type: "line",
  source: "carto",
  "source-layer": "transportation_name",
  filter: FILTRO_AVENIDA,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": "#2eb1ff",
    "line-opacity": 0.62,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.1, 14, 2.2, 17, 4],
  },
};

const capaAvenidasNombre: LayerProps = {
  id: "avenidas-nombre",
  type: "symbol",
  source: "carto",
  "source-layer": "transportation_name",
  filter: FILTRO_AVENIDA,
  layout: {
    "symbol-placement": "line",
    "text-field": ["get", "name"],
    "text-font": ["Open Sans Bold"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 12, 9.5, 16, 12.5],
    "text-letter-spacing": 0.04,
    "symbol-spacing": 320,
    "text-max-angle": 35,
  },
  paint: {
    "text-color": "#7cc4e8",
    "text-opacity": 0.85,
    "text-halo-color": "#070a10",
    "text-halo-width": 1.8,
  },
};

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
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 3.5, 14, 6, 17, 9, 19.5, 14],
    // Anillo amarillo = obra SIGOV (contratada); anillo claro = CIMBA/planillas
    "circle-stroke-width": ["case", ["==", ["get", "origen"], "sigov"], 2, 1],
    "circle-stroke-color": [
      "case",
      ["==", ["get", "origen"], "sigov"],
      "#f4dc00",
      "rgba(237,242,250,0.4)",
    ],
  },
  layout: {},
};

/** Anillo de selección: marca exactamente el punto elegido. */
const capaSeleccion: LayerProps = {
  id: "seleccion-anillo",
  type: "circle",
  source: "seleccion",
  paint: {
    "circle-color": "rgba(0,0,0,0)",
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 9, 17, 16],
    "circle-stroke-width": 2.5,
    "circle-stroke-color": "#f4dc00",
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
    // Honestidad visual: la opacidad refleja la confianza de la geocodificación
    // (un punto tenue puede no estar exactamente ahí).
    "circle-opacity": [
      "interpolate", ["linear"], ["coalesce", ["get", "confianza"], 0.55],
      0.1, 0.25,
      0.5, 0.45,
      0.9, 0.8,
    ],
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.6, 14, 3, 17, 5, 19.5, 8],
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

export function MapaCimba(props: { kpisIniciales: Kpis; rol: RolUsuario; iaHabilitada: boolean }) {
  return (
    <QueryClientProvider client={clienteQuery}>
      <MapaInterno {...props} />
    </QueryClientProvider>
  );
}

interface Informe {
  titulo: string;
  resumen: string;
  focos: string[];
  recomendaciones: string[];
}

type Seleccion =
  | { capa: "incidente"; props: Record<string, unknown>; lngLat: [number, number] }
  | { capa: "demanda"; props: Record<string, unknown>; lngLat: [number, number] };

function MapaInterno({ kpisIniciales, iaHabilitada }: { kpisIniciales: Kpis; rol: RolUsuario; iaHabilitada: boolean }) {
  const mapRef = useRef<MapRef>(null);
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);
  const [panelCapas, setPanelCapas] = useState(true);
  const [marcador, setMarcador] = useState<[number, number] | null>(null);
  const [informe, setInforme] = useState<Informe | null>(null);
  const [generandoInforme, setGenerandoInforme] = useState(false);
  const [errorInforme, setErrorInforme] = useState<string | null>(null);

  // Estado de capas y filtros — arranca en vista OPERATIVA (lo accionable)
  const [vista, setVista] = useState<Vista>("operativo");
  const [verMacro, setVerMacro] = useState<Record<string, boolean>>({ ...VISTAS.operativo.macro });
  const [soloDemandasAbiertas, setSoloDemandasAbiertas] = useState(true);
  const [verDemandas, setVerDemandas] = useState(true);
  const [verCalor, setVerCalor] = useState(false);
  const [fuentes, setFuentes] = useState<Record<string, boolean>>({});
  const [tipos, setTipos] = useState<Record<string, boolean>>({});
  const [verAvenidas, setVerAvenidas] = useState(true);
  const [verCalles, setVerCalles] = useState(true);
  const [dias, setDias] = useState<number | null>(null); // null = todo
  const [verZonas, setVerZonas] = useState(false);

  const aplicarVista = (v: Vista) => {
    setVista(v);
    setVerMacro({ ...VISTAS[v].macro });
    setSoloDemandasAbiertas(VISTAS[v].demandasAbiertas);
    setVerDemandas(VISTAS[v].verDemandas);
    setVerCalor(VISTAS[v].calor);
  };

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
      if (tipos[String(f.properties.tipo)] === false) return false;
      if (corte && Date.parse(String(f.properties.detectado_en)) < corte) return false;
      return true;
    });
    return { type: "FeatureCollection", features };
  }, [data, verMacro, tipos, corte]);

  const demandasFiltradas = useMemo<FC>(() => {
    const features = (data?.demandas.features ?? []).filter((f) => {
      const fuente = String(f.properties.fuente);
      if (fuentes[fuente] === false) return false;
      if (tipos[String(f.properties.tipo)] === false) return false;
      if (soloDemandasAbiertas && !["recibida", "en_validacion"].includes(String(f.properties.estado)))
        return false;
      if (corte && Date.parse(String(f.properties.creado_en)) < corte) return false;
      return true;
    });
    return { type: "FeatureCollection", features };
  }, [data, fuentes, tipos, soloDemandasAbiertas, corte]);

  // Zonas calientes: direcciones más repetidas entre las demandas visibles
  const zonasCalientes = useMemo(() => {
    const porDireccion = new Map<string, { n: number; lon: number; lat: number }>();
    for (const f of demandasFiltradas.features) {
      const dir = String(f.properties.direccion ?? "").trim();
      if (!dir) continue;
      const previo = porDireccion.get(dir);
      if (previo) previo.n++;
      else
        porDireccion.set(dir, {
          n: 1,
          lon: f.geometry.coordinates[0] ?? 0,
          lat: f.geometry.coordinates[1] ?? 0,
        });
    }
    return [...porDireccion.entries()]
      .filter(([, v]) => v.n >= 2)
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 10);
  }, [demandasFiltradas]);

  // KPIs: estado del territorio bajo los filtros de tipo/período — NO dependen
  // de qué capas estén visibles (apagar una capa no hace desaparecer el problema).
  const kpis = useMemo(() => {
    const inc = (data?.incidentes.features ?? []).filter((f) => {
      if (tipos[String(f.properties.tipo)] === false) return false;
      if (corte && Date.parse(String(f.properties.detectado_en)) < corte) return false;
      return true;
    });
    return {
      demandas: demandasFiltradas.features.length,
      abiertos: inc.filter((f) => f.properties.macro === "abierto").length,
      enCurso: inc.filter((f) => f.properties.macro === "en_curso").length,
      resueltos: inc.filter((f) => f.properties.macro === "resuelto").length,
      m2: kpisIniciales.m2Intervenidos,
      sinVincular: kpisIniciales.demandasSinVincular,
    };
  }, [data, tipos, corte, demandasFiltradas, kpisIniciales]);

  /**
   * Callejero legible al hacer zoom, para poder ubicar cualquier dirección y no
   * solo las avenidas. El estilo dark-matter de CARTO es deliberadamente
   * minimalista: rellena las calles menores recién en zoom 15, oculta sus
   * nombres hasta zoom 16 y pinta calles de servicio en #0b0b0b (invisible).
   * Acá se adelantan esos zooms y se sube el contraste, sin tocar el estilo
   * remoto: se ajustan las capas ya presentes cuando el estilo termina de cargar.
   */
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
        mapa.setLayoutProperty(c.id, "visibility", verCalles ? "visible" : "none");
        if (!verCalles) continue;
        mapa.setLayerZoomRange(c.id, c.minzoom, 24);
        mapa.setLayoutProperty(c.id, "text-size", c.size);
        mapa.setPaintProperty(c.id, "text-color", c.color);
        mapa.setPaintProperty(c.id, "text-halo-color", "#070a10");
        mapa.setPaintProperty(c.id, "text-halo-width", 1.7);
      }

      // Las trazas se realzan siempre: el toggle es solo de nombres.
      for (const c of TRAZAS) {
        if (!mapa.getLayer(c.id)) continue;
        mapa.setLayerZoomRange(c.id, c.minzoom, 24);
        mapa.setPaintProperty(c.id, "line-color", c.color);
      }
      return true;
    };

    if (aplicar()) return;
    // El estilo puede no estar listo al montar: reintenta y se engancha a styledata.
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
  }, [verCalles]);
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

  const generarInforme = async () => {
    setGenerandoInforme(true);
    setErrorInforme(null);
    try {
      const cuenta = (features: FC["features"], clave: string) => {
        const m: Record<string, number> = {};
        for (const f of features) {
          const v = String(f.properties[clave] ?? "sin_dato");
          m[v] = (m[v] ?? 0) + 1;
        }
        return m;
      };
      const abiertos = incidentesFiltrados.features.filter((f) => f.properties.macro !== "resuelto");
      const porDireccion: Record<string, number> = {};
      for (const f of abiertos) {
        const d = String(f.properties.direccion ?? "").trim();
        if (d) porDireccion[d] = (porDireccion[d] ?? 0) + 1;
      }
      const zonas = Object.entries(porDireccion)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([direccion, cantidad]) => ({ direccion, cantidad }));

      const res = await fetch("/api/ia/informe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          periodo: dias ? `últimos ${dias} días` : "histórico completo",
          incidentes: {
            total: incidentesFiltrados.features.length,
            por_macro: cuenta(incidentesFiltrados.features, "macro"),
            por_tipo: cuenta(incidentesFiltrados.features, "tipo"),
          },
          demandas: {
            total: demandasFiltradas.features.length,
            por_fuente: cuenta(demandasFiltradas.features, "fuente"),
            sin_vincular: kpisIniciales.demandasSinVincular,
          },
          m2_intervenidos: kpisIniciales.m2Intervenidos,
          zonas_calientes: zonas,
        }),
      });
      const cuerpo = (await res.json()) as { informe?: Informe; error?: string };
      if (!res.ok || !cuerpo.informe) throw new Error(cuerpo.error ?? "No se pudo generar el informe");
      setInforme(cuerpo.informe);
    } catch (e) {
      setErrorInforme(e instanceof Error ? e.message : "Error de IA");
    } finally {
      setGenerandoInforme(false);
    }
  };

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
    // Precisión: usar las coordenadas EXACTAS del punto, no las del clic
    const geom = feature.geometry as { type: string; coordinates?: [number, number] };
    const lngLat: [number, number] =
      geom.type === "Point" && geom.coordinates ? [geom.coordinates[0], geom.coordinates[1]] : [e.lngLat.lng, e.lngLat.lat];
    if (feature.layer.id === "incidentes-punto") {
      setSeleccion({ capa: "incidente", props: feature.properties ?? {}, lngLat });
    } else if (feature.layer.id === "demandas-punto") {
      setSeleccion({ capa: "demanda", props: feature.properties ?? {}, lngLat });
    }
    mapRef.current?.easeTo({ center: lngLat, duration: 400, offset: [-140, 0] });
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <MapaGL
        ref={mapRef}
        initialViewState={{ longitude: CENTRO_SMT[0], latitude: CENTRO_SMT[1], zoom: 12.6 }}
        mapStyle={ESTILO_MAPA}
        maxZoom={19.5}
        interactiveLayerIds={["clusters", "incidentes-punto", "demandas-punto"]}
        onClick={alClick}
        onError={(e) => {
          // Un estilo o capa inválidos dejarían el mapa en negro sin avisar.
          console.error("[mapa] error de MapLibre:", e.error?.message ?? e);
        }}
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
        <GeolocateControl
          position="bottom-right"
          positionOptions={{ enableHighAccuracy: true }}
          trackUserLocation
          showAccuracyCircle
        />
        <ScaleControl position="bottom-left" />

        {/* Corredores principales: se montan primero para quedar DEBAJO de los datos */}
        {verAvenidas && (
          <>
            <Layer {...capaAvenidasBrillo} />
            <Layer {...capaAvenidas} />
            <Layer {...capaAvenidasNombre} />
          </>
        )}

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
          clusterMaxZoom={14}
          clusterRadius={45}
        >
          <Layer {...capaPulso} />
          <Layer {...capaIncidentes} />
          <Layer {...capaClusters} />
          <Layer {...capaClusterConteo} />
        </Source>

        <Source
          id="seleccion"
          type="geojson"
          data={{
            type: "FeatureCollection",
            features: seleccion
              ? [{ type: "Feature", geometry: { type: "Point", coordinates: seleccion.lngLat }, properties: {} }]
              : [],
          }}
        >
          <Layer {...capaSeleccion} />
        </Source>

        {marcador && (
          <Marker longitude={marcador[0]} latitude={marcador[1]} anchor="bottom">
            <div className="flex flex-col items-center">
              <Crosshair size={26} className="text-amarillo drop-shadow" />
            </div>
          </Marker>
        )}
      </MapaGL>

      {/* Selector de vista */}
      <div className="absolute top-3 left-1/2 z-20 -translate-x-1/2">
        <div className="panel-vidrio flex rounded-xl p-1">
          {(Object.keys(VISTAS) as Vista[]).map((v) => (
            <button
              key={v}
              onClick={() => aplicarVista(v)}
              title={VISTAS[v].descripcion}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                vista === v ? "bg-azul text-white" : "text-texto-2 hover:text-texto"
              }`}
            >
              {VISTAS[v].etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="pointer-events-none absolute top-16 left-3 right-3 z-10 flex flex-wrap gap-2">
        <Kpi etiqueta="Demandas" valor={kpis.demandas} color="#8fa3bf" ayuda={AYUDA_KPI.demandas} />
        <Kpi etiqueta="Sin vincular" valor={kpis.sinVincular} color="#f4dc00" ayuda={AYUDA_KPI.sinVincular} />
        <Kpi etiqueta="Abiertos" valor={kpis.abiertos} color={COLOR_MACRO.abierto} ayuda={AYUDA_KPI.abiertos} />
        <Kpi etiqueta="En curso" valor={kpis.enCurso} color={COLOR_MACRO.en_curso} pulso ayuda={AYUDA_KPI.enCurso} />
        <Kpi etiqueta="Resueltos" valor={kpis.resueltos} color={COLOR_MACRO.resuelto} ayuda={AYUDA_KPI.resueltos} />
        <Kpi etiqueta="m² intervenidos" valor={kpis.m2} color="#2eb1ff" ayuda={AYUDA_KPI.m2} />
        <div className="pointer-events-auto ml-auto flex items-start gap-2">
          {iaHabilitada && (
            <button
              onClick={() => void generarInforme()}
              disabled={generandoInforme}
              className="panel-vidrio flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-semibold text-celeste transition hover:text-texto disabled:opacity-60"
              title="Informe ejecutivo generado por IA sobre lo visible en el mapa"
            >
              <Sparkles size={14} className={generandoInforme ? "animate-pulse text-amarillo" : ""} />
              {generandoInforme ? "Generando…" : "Informe IA"}
            </button>
          )}
          <Buscador
            alEncontrar={(lon, lat) => {
              setMarcador([lon, lat]);
              mapRef.current?.flyTo({ center: [lon, lat], zoom: 16.5, duration: 1200 });
            }}
          />
        </div>
      </div>

      {/* Zonas calientes */}
      <div className="absolute bottom-6 left-72 z-10 hidden md:block">
        {verZonas ? (
          <div className="panel-vidrio w-72 rounded-xl p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
                <Flame size={14} className="text-encurso" /> Zonas calientes
              </span>
              <button onClick={() => setVerZonas(false)} className="text-texto-3 hover:text-texto">
                <X size={14} />
              </button>
            </div>
            <p className="mb-2 text-[10px] text-texto-3">
              Direcciones con más demandas pendientes (con la vista y filtros actuales). Clic para volar.
            </p>
            {zonasCalientes.length === 0 ? (
              <p className="py-3 text-center text-xs text-texto-3">Sin repeticiones con estos filtros.</p>
            ) : (
              <div className="max-h-56 space-y-1 overflow-y-auto">
                {zonasCalientes.map(([dir, z]) => (
                  <button
                    key={dir}
                    onClick={() => mapRef.current?.flyTo({ center: [z.lon, z.lat], zoom: 16.5, duration: 900 })}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-borde bg-panel-2/60 px-2.5 py-1.5 text-left text-xs transition hover:border-encurso/50"
                  >
                    <span className="truncate">{dir}</span>
                    <span className="num shrink-0 font-bold text-encurso">{z.n}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => setVerZonas(true)}
            className="panel-vidrio rounded-xl p-3 text-encurso transition hover:text-texto"
            title="Zonas calientes: direcciones con más demandas repetidas"
          >
            <Flame size={18} />
          </button>
        )}
      </div>

      {/* Informe IA */}
      {(informe || errorInforme) && (
        <div className="panel-vidrio absolute top-28 right-3 z-20 w-96 max-w-[calc(100vw-24px)] rounded-xl">
          <div className="flex items-center justify-between border-b border-borde px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
              <Sparkles size={14} className="text-celeste" /> Informe IA
            </span>
            <button onClick={() => { setInforme(null); setErrorInforme(null); }} className="text-texto-3 hover:text-texto">
              <X size={14} />
            </button>
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto px-4 py-4 text-[13px]">
            {errorInforme && <p className="text-peligro">{errorInforme}</p>}
            {informe && (
              <>
                <p className="font-bold">{informe.titulo}</p>
                <p className="text-texto-2">{informe.resumen}</p>
                {informe.focos.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold tracking-wider text-amarillo uppercase">Focos críticos</p>
                    <ul className="list-disc space-y-1 pl-4 text-texto-2">
                      {informe.focos.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                )}
                {informe.recomendaciones.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold tracking-wider text-celeste uppercase">Recomendaciones</p>
                    <ul className="list-disc space-y-1 pl-4 text-texto-2">
                      {informe.recomendaciones.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  </div>
                )}
                <p className="text-[10px] text-texto-3">Generado por IA sobre agregados del mapa — sin datos personales.</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Panel de capas */}
      <div className="absolute bottom-6 left-3 z-10">
        {panelCapas ? (
          <div className="panel-vidrio max-h-[calc(100vh-14rem)] w-64 overflow-y-auto rounded-xl p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
                <Layers size={14} className="text-celeste" /> Capas
              </span>
              <button onClick={() => setPanelCapas(false)} className="text-texto-3 hover:text-texto">
                <X size={14} />
              </button>
            </div>

            <p className="mb-1.5 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Territorio</p>
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Avenidas y corredores principales según la clasificación vial de OpenStreetMap (motorway/trunk/primary/secondary)"
            >
              <input
                type="checkbox"
                checked={verAvenidas}
                onChange={(e) => setVerAvenidas(e.target.checked)}
                className="accent-[#0066ff]"
              />
              <span className="inline-block h-0.5 w-4 rounded bg-celeste" />
              Avenidas principales
            </label>
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Nombres de todas las calles al acercar el zoom, para ubicar cualquier dirección"
            >
              <input
                type="checkbox"
                checked={verCalles}
                onChange={(e) => setVerCalles(e.target.checked)}
                className="accent-[#0066ff]"
              />
              <span className="text-[10px] text-texto-3">Aa</span>
              Nombres de calles
            </label>

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
            <label
              className="mb-1 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Mostrar solo demandas aún sin cotejar (recibidas/en validación); apagalo para ver también las ya vinculadas o descartadas"
            >
              <input
                type="checkbox"
                checked={soloDemandasAbiertas}
                onChange={(e) => setSoloDemandasAbiertas(e.target.checked)}
                className="accent-[#0066ff]"
              />
              Solo pendientes (sin vincular)
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

            <p className="mt-3 mb-1.5 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Tipo de problema</p>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(ETIQUETA_TIPO) as Array<keyof typeof ETIQUETA_TIPO>).map((t) => {
                const activo = tipos[t] !== false;
                return (
                  <button
                    key={t}
                    onClick={() => setTipos((v) => ({ ...v, [t]: !activo }))}
                    className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition ${
                      activo ? "border-borde-2 bg-panel-2 text-texto-2" : "border-borde text-texto-3 line-through opacity-60"
                    }`}
                  >
                    {ETIQUETA_TIPO[t]}
                  </button>
                );
              })}
            </div>

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

function Kpi({
  etiqueta,
  valor,
  color,
  pulso,
  ayuda,
}: {
  etiqueta: string;
  valor: number;
  color: string;
  pulso?: boolean;
  ayuda?: string;
}) {
  return (
    <div
      className="panel-vidrio pointer-events-auto flex cursor-help items-center gap-2.5 rounded-xl px-3.5 py-2"
      title={ayuda}
    >
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
    <aside className="panel-vidrio absolute top-28 right-3 bottom-6 z-10 flex w-80 flex-col rounded-xl">
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
        <a
          href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${seleccion.lngLat[1]},${seleccion.lngLat[0]}`}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-[12px] font-semibold text-celeste hover:underline"
        >
          Ver en Street View ↗
        </a>
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
