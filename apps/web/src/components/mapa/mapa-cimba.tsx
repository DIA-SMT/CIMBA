"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Camera,
  ChevronDown,
  Columns2,
  Construction,
  Crosshair,
  Download,
  Droplets,
  Eye,
  EyeOff,
  Flame,
  GripVertical,
  HelpCircle,
  History,
  Layers,
  Link2,
  Menu,
  Printer,
  Radar,
  RotateCcw,
  Ruler,
  Satellite,
  Send,
  Sparkles,
  X,
} from "lucide-react";
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
  type ViewState,
} from "react-map-gl/maplibre";
import type { Feature, FeatureCollection, LineString, MultiLineString, MultiPolygon, Point, Polygon } from "geojson";
import type { FilterSpecification } from "maplibre-gl";
import { dentroDeSMT, type EstadoIncidente, type RolUsuario } from "@cimba/domain";
import type { Kpis } from "@/lib/consultas";
import type { CircuitoResumen, DeudaTerritorial } from "@/lib/ordenes";
import {
  ETIQUETA_FUENTE,
  ETIQUETA_TIPO,
  SEMAFORO,
  fechaCorta,
  numero,
  pasoDeBrecha,
  pasoDeEstado,
  semaforoHex,
} from "@/lib/formato";
import { interpretarBusquedaMapa } from "@/lib/acciones-busqueda";
import { usePanelArrastrable } from "@/lib/arrastrable";
import { vincularDemanda } from "@/lib/acciones";
import { listarContactosWhatsapp } from "@/lib/acciones-contactos";
import { AltaRapida } from "./alta-rapida";
import { AnalisisZona, type ZonaActiva } from "./analisis-zona";
import { ComparadorObra } from "./comparador-obra";
import { CortinaComparar } from "./cortina-comparar";
import { GuiaMapa } from "./guia-mapa";
import { BuscadorMapa } from "./buscador-mapa";
import { abrirReporte } from "./reporte-mapa";
import { crearCirculo, distanciaM, hexbins } from "./geo-cliente";
import { LineaTiempo } from "./linea-tiempo";
import { estiloMapa, usarTemaMapa, type TemaMapa } from "./tema-mapa";

/**
 * Vistas del mapa: la respuesta a "es muchísima información y no se entiende".
 * Cada vista prende solo las capas que sirven para esa tarea. Quedaron TRES
 * (pedido del Director: "no es tan claro qué ofrece cada cosa; simplificalo"):
 * HOY (lo que hay que resolver), BRECHA (lo pedido vs. lo hecho) e HISTORIAL
 * (todo el trabajo hecho). Las viejas ANÁLISIS y TODO desaparecieron: el mapa
 * de calor de Análisis ahora es la capa "Densidad de demanda" (grupo Lo
 * pedido, disponible en cualquier vista) y Todo era ruido — el panel de capas
 * ya deja prender lo que quieras desde cualquier vista.
 */
const VISTAS = {
  hoy: {
    etiqueta: "Hoy",
    descripcion: "Lo que hay que resolver: problemas abiertos o en curso y pedidos aún pendientes.",
    macro: { abierto: true, en_curso: true, resuelto: false, inactivo: false },
    demandasAbiertas: true,
    verDemandas: true,
  },
  brecha: {
    etiqueta: "Brecha",
    descripcion:
      "Lo pedido vs. lo hecho: cada pedido pendiente pintado con el semáforo — rojo nadie lo tocó, naranja está en cola, ámbar la cuadrilla está en obra, verde parece resuelto (hay una reparación cerca).",
    macro: { abierto: false, en_curso: false, resuelto: false, inactivo: false },
    demandasAbiertas: true,
    verDemandas: true,
  },
  historial: {
    etiqueta: "Historial",
    descripcion: "Todo el trabajo hecho: reparaciones y obras finalizadas.",
    macro: { abierto: false, en_curso: true, resuelto: true, inactivo: false },
    demandasAbiertas: false,
    verDemandas: false,
  },
} as const;
type Vista = keyof typeof VISTAS;

/** Claves viejas de vista (links guardados, la page todavía las valida):
 *  caen con gracia sobre las tres nuevas. "analisis" además prende la capa
 *  Densidad de demanda, que era lo único que esa vista aportaba. */
type VistaLegado = "operativo" | "historico" | "analisis" | "completo";
const VISTA_LEGADO: Record<VistaLegado, Vista> = {
  operativo: "hoy",
  historico: "historial",
  analisis: "hoy",
  completo: "hoy",
};
const normalizarVista = (v: string | null | undefined): Vista | undefined =>
  v == null ? undefined
    : Object.hasOwn(VISTAS, v) ? (v as Vista)
    : Object.hasOwn(VISTA_LEGADO, v) ? (VISTA_LEGADO as Record<string, Vista>)[v]
    : undefined;

/** Cuánto se muestra encima del mapa (ver el estado `detalle`). */
type Detalle = "completo" | "esencial" | "limpio";
const ETIQUETA_DETALLE: Record<Detalle, string> = { completo: "Todo", esencial: "Esencial", limpio: "Limpio" };

/**
 * En "esencial" la fila de KPIs baja de seis cifras a DOS: las que contestan
 * la pregunta de cada vista. HOY y BRECHA se leen sobre la deuda de pedidos
 * (cuántos hay y cuántos nadie cotejó todavía); HISTORIAL se lee sobre lo
 * producido (reparaciones y m²). Los otros cuatro no desaparecen: están a un
 * clic en "Todo", y el panel de Capas los sigue mostrando con su conteo.
 */
const KPIS_ESENCIALES: Record<Vista, readonly string[]> = {
  hoy: ["demandas", "sinAtencion"],
  brecha: ["demandas", "sinAtencion"],
  historial: ["resueltos", "m2"],
};

const AYUDA_KPI = {
  demandas: "Pedidos visibles con la vista y filtros actuales: reclamos de vecinos (AC), pedidos del Concejo, intimaciones SAT, redes y secretarías.",
  /**
   * Era "Sin vincular", pero ese número salía de un count GLOBAL del servidor
   * sin ningún filtro y convivía con "Demandas", que sí respeta destino, tipo,
   * fuente y período: con el default (solo bacheo) llegaba a ser MAYOR que el
   * total del que era subconjunto. El geojson no trae si la demanda está
   * vinculada a un incidente (no viaja demanda_incidente), así que no se puede
   * replicar del lado del cliente: se cambió por la cifra que sí se puede
   * calcular sobre el MISMO conjunto y que contesta la misma pregunta operativa.
   * La cola de consolidación global sigue viva en la pestaña Calidad.
   */
  sinAtencion: "De esos mismos pedidos, cuántos no tienen NADA cerca: ni incidente detectado, ni orden emitida, ni reparación a menos de 40 m. Es el paso rojo del semáforo. La cola de «sin vincular» (pedidos que nadie cotejó todavía) es un total del sistema y vive en la pestaña Calidad.",
  abiertos: "Incidentes (problemas físicos confirmados) detectados o priorizados, sin cuadrilla asignada aún.",
  enCurso: "Incidentes con trabajo programado o en ejecución (cuadrilla u obra SIGOV).",
  resueltos: "Incidentes reparados o verificados.",
  m2: "Metros cuadrados de pavimento intervenidos según SIGOV y planillas (intervenciones finalizadas).",
} as const;

// ── Tipos del contrato /api/geodata ─────────────────────────────────────────

type FC = FeatureCollection<Point, Record<string, unknown>>;
/** Capas de referencia territorial (distritos/circuitos/barrios): polígonos. */
type FCPoligono = FeatureCollection<Polygon | MultiPolygon, Record<string, unknown>>;
/** Capas viales (jerarquía, red vial, recorridos de colectivos): líneas. */
type FCLinea = FeatureCollection<LineString | MultiLineString, Record<string, unknown>>;
interface GeoDatos {
  incidentes: FC;
  demandas: FC;
}

/** demandas.destino (enum destino_resolucion de la 0006): QUIÉN resuelve el
 *  pedido. Es propiedad de la demanda, no del incidente. */
type Destino = "bacheo" | "sat" | "ingenieria";
const DESTINOS: readonly Destino[] = ["bacheo", "sat", "ingenieria"];
const ETIQUETA_DESTINO: Record<Destino, string> = {
  bacheo: "Bacheo",
  sat: "SAT (agua)",
  ingenieria: "Ingeniería",
};
/** Los cinco valores de demandas.brecha, con el nombre que se muestra. */
const ETIQUETA_BRECHA: Record<string, string> = {
  sin_atencion: "Sin atención",
  en_cola: "En cola",
  en_obra: "En obra",
  posible_resuelta: "Parece resuelta",
  atendida: "Atendida",
};
const AYUDA_DESTINO: Record<Destino, string> = {
  bacheo: "La cola real de la Dirección de Bacheo: lo que se resuelve con asfalto u hormigón. Es lo único prendido al abrir el mapa.",
  sat: "Pérdidas de agua, tapas y sumideros: los resuelve la SAT por expediente, no la cuadrilla. Se marcan con anillo violeta fino.",
  ingenieria: "Reclamos que no son bache (calle de ripio, apertura, traza): van a Ingeniería. Se marcan con anillo magenta grueso.",
};
/** Aclaración que va en los tres chips: la cifra NO es "lo que se ve en
 *  pantalla" ni cambia al apagar el chip — es el tamaño completo de esa cola
 *  bajo los filtros de datos (tipo, fuente, período, distrito). */
const AYUDA_CUENTA_DESTINO =
  "La cifra es el total de esta cola con los filtros actuales de tipo, fuente y período: no cambia al prender o apagar el chip.";
/** El destino con el que se cuenta un pedido. Un pedido que el trigger no
 *  clasificó (destino null) se cuenta como bacheo: es la cola de la Dirección
 *  hasta que alguien diga lo contrario, y así ningún pedido desaparece del
 *  mapa por un dato que falta. */
const destinoDe = (v: unknown): Destino => (v === "sat" || v === "ingenieria" ? v : "bacheo");

const CENTRO_SMT: [number, number] = [-65.2226, -26.8241];

// ── Tema visual del mapa ────────────────────────────────────────────────────
// El estilo base y el hook reactivo (data-tema + MutationObserver) viven en
// tema-mapa.ts, compartidos con los mini-mapas; la paleta de las capas
// propias es local a este archivo.

type Tema = TemaMapa;

/**
 * Variantes de color por tema para las capas del mapa. El OSCURO conserva
 * exactamente los valores históricos (validados sobre dark-matter); el CLARO
 * oscurece los acentos que mueren sobre positron (el amarillo como texto/anillo
 * pasa a ocre), invierte los halos de etiqueta (claros, no #070a10) y da vuelta
 * las rampas secuenciales pensadas para fondo negro (densidad alta = azul
 * OSCURO sobre fondo claro, no celeste lavado).
 */
function paleta(tema: Tema) {
  const oscuro = tema === "oscuro";
  // EL SEMÁFORO en hex crudo del tema: MapLibre no resuelve var(), y varias
  // capas además concatenan alfa sobre el color. La tabla vive en formato.ts
  // (una sola verdad para HTML y canvas): acá solo se elige el juego.
  const s = semaforoHex(tema);
  return {
    oscuro,
    /** Los cinco pasos del semáforo, listos para las expresiones de pintado. */
    sinAtencion: s.sin_atencion,
    enCola: s.en_cola,
    enObra: s.en_obra,
    resuelto: s.resuelto,
    inactivo: s.inactivo,
    /** PROCEDENCIA (no estado): anillo de la obra contratada por SIGOV. Era
     *  amarillo, pero el amarillo quedó reservado para las afordancias de
     *  interacción y el ámbar del semáforo es demasiado parecido. Es el mismo
     *  celeste institucional que --color-celeste: en HTML usar esa clase. */
    sigov: oscuro ? "#2eb1ff" : "#0b7fd1",
    /**
     * DESTINO (ni estado ni procedencia): quién resuelve el pedido. Los dos
     * colores anteriores competían con cosas que ya significaban otra cosa —
     * el celeste agua de la SAT contra el celeste SIGOV y el marrón del ripio
     * de Ingeniería contra el naranja "en cola" (1.13:1, indistinguibles y en
     * la MISMA fila de la leyenda). Violeta y magenta son los únicos dos
     * rangos de matiz que quedan libres: a ΔE ≥ 44 de cada paso del semáforo
     * y del celeste institucional, y por encima de 5:1 contra el fondo en los
     * dos temas. El destino además se refuerza por FORMA en capaDemandasDestino
     * (anillo fino para la SAT, grueso y más abierto para Ingeniería): quien no
     * distingue matices igual los separa.
     */
    destinoSat: oscuro ? "#b18cff" : "#6d28d9",
    destinoIngenieria: oscuro ? "#ff7ad9" : "#be185d",
    /** Marca de RANKING (Top 20), deliberadamente FUERA del semáforo: el disco
     *  amarillo #f4dc00 se fundía con el ámbar "en obra" (#ffc233), que es
     *  justo el estado de casi todo lo que el Top 20 numera. Tinta invertida
     *  (disco claro sobre oscuro y al revés): ningún estado se pinta así. */
    rankDisco: oscuro ? "#edf2fa" : "#16202e",
    rankNumero: oscuro ? "#0B0F16" : "#ffffff",
    /** Halo de toda etiqueta de texto sobre el mapa. */
    halo: oscuro ? "#070a10" : "#ffffff",
    /** Amarillo de acento: anillos, hilos de cotejo, cifras flotantes. */
    acento: oscuro ? "#f4dc00" : "#b48f00",
    /** Trazo color-de-fondo que separa un punto de sus vecinos. */
    tinta: oscuro ? "#0B0F16" : "#ffffff",
    trazoPunto: oscuro ? "rgba(237,242,250,0.4)" : "rgba(22,24,29,0.4)",
    trazoCluster: oscuro ? "rgba(237,242,250,0.35)" : "rgba(22,24,29,0.3)",
    trazoBrecha: oscuro ? "rgba(7,10,16,0.8)" : "rgba(255,255,255,0.85)",
    avenidaNombre: oscuro ? "#7cc4e8" : "#19638f",
    /** Jerarquía vial oficial (primarias/secundarias): azul firme sobre claro,
     *  celeste suave sobre oscuro — nunca el azul #0066ff de los clusters. */
    jerarquiaVial: oscuro ? "#8fc7f2" : "#2456a6",
    /** Red vial: el pavimento es contexto (casi se funde con el fondo), el
     *  RIPIO es la estrella (ahí no hay bache: es pasado de máquina). */
    pavimento: oscuro ? "#4a5468" : "#b9c1cc",
    ripio: oscuro ? "#e6893a" : "#b45309",
    cordonCuneta: oscuro ? "#95a2b6" : "#79879a",
    /** Recorridos de colectivos: rosa sobre oscuro, violeta sobre claro —
     *  lejos del rosa de barrios y del violeta de distritos. */
    colectivo: oscuro ? "#f08fd0" : "#8b2fc9",
    /** Zonas del programa "Bacheo integral" (KML del Director): teal — es un
     *  ÁREA translúcida de programa, no un estado, y queda lejos del semáforo. */
    bacheoIntegral: oscuro ? "#2dd4bf" : "#0d9488",
    /** Trazo fuerte de lo que está comprometido o pasando ahora (programado y
     *  en ejecución): el color ya lo dice, el trazo lo pone por encima del
     *  archivo cuando conviven miles de puntos. */
    trazoActivo: oscuro ? "rgba(237,242,250,0.95)" : "rgba(22,24,29,0.8)",
    distritos: oscuro ? "#a78bfa" : "#6d4fd4",
    circuitos: oscuro ? "#34d399" : "#0c8a5f",
    barrios: oscuro ? "#f472b6" : "#c22672",
    demanda: oscuro ? "#8fa3bf" : "#5b6b82",
    /** Amarillo del inicio de la rampa de antigüedad (como relleno de punto). */
    edadReciente: oscuro ? "#f4dc00" : "#bfa000",
    /** El relleno por empresa al 0.12 casi no se ve sobre claro: sube un poco. */
    opacidadEmpresa: oscuro ? 0.12 : 0.22,
    /** Rampa secuencial azul (calor / hexágonos), de menor a mayor densidad. */
    rampa: oscuro
      ? (["#104281", "#1c5cab", "#3987e5", "#86b6ef", "#cde2fb"] as const)
      : (["#a8cbf4", "#6ba3e8", "#3987e5", "#1c5cab", "#0d3568"] as const),
    calorCero: oscuro ? "rgba(13,54,107,0)" : "rgba(168,203,244,0)",
  };
}
type Paleta = ReturnType<typeof paleta>;

/** El hex del semáforo que le toca a un estado de incidente en el tema
 *  vigente. Para HTML el equivalente es SEMAFORO[pasoDeEstado(estado)], que
 *  devuelve la CSS var y se re-tematiza sola; acá hace falta el hex crudo. */
function colorDeEstado(p: Paleta, estado: string): string {
  const paso = pasoDeEstado(estado as EstadoIncidente);
  return paso === "sin_atencion"
    ? p.sinAtencion
    : paso === "en_cola"
      ? p.enCola
      : paso === "en_obra"
        ? p.enObra
        : paso === "resuelto"
          ? p.resuelto
          : p.inactivo;
}

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

const capaAvenidasNombre = (p: Paleta): LayerProps => ({
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
    "text-color": p.avenidaNombre,
    "text-opacity": 0.85,
    "text-halo-color": p.halo,
    "text-halo-width": 1.8,
  },
});

// ── Límites territoriales de referencia ──────────────────────────────────────
// Tres capas de contexto administrativo: distritos (violeta, la más "oficial"
// — alimenta distrito_id), circuitos (verde — desde el módulo de órdenes de
// trabajo dejaron de ser solo referencia: cargan empresa asignada y prioridad,
// ver "Capa OPERATIVA" abajo), barrios (rosa, la más fina — 327 polígonos,
// solo con etiqueta a partir de zoom 14 para no saturar la pantalla).
// Pedido literal del Director: "quiero que los circuitos y distritos estén
// mucho más marcados" — línea sólida firme + un halo tenue debajo, para que
// el límite se lea incluso con el satélite prendido sin tapar los datos.
const capaDistritosHalo = (p: Paleta): LayerProps => ({
  id: "distritos-halo",
  type: "line",
  source: "distritos",
  paint: {
    "line-color": p.distritos,
    "line-opacity": 0.22,
    "line-blur": 3,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, 5, 14, 8, 17, 12],
  },
});
const capaDistritosLinea = (p: Paleta): LayerProps => ({
  id: "distritos-linea",
  type: "line",
  source: "distritos",
  paint: {
    "line-color": p.distritos,
    "line-opacity": 0.8,
    "line-width": 2.5,
  },
});
/**
 * Coropleta de la deuda: cada distrito teñido según qué proporción de sus
 * pedidos abiertos no tiene nada cerca. Verde = atendido, rojo = abandonado;
 * los que no tienen pedidos (pct -1) quedan sin pintar, no en verde: no es
 * "cero deuda", es "nada que medir".
 */
const capaDistritosRelleno: LayerProps = {
  id: "distritos-relleno",
  type: "fill",
  source: "distritos",
  paint: {
    "fill-color": [
      "case",
      ["<", ["get", "pct_brecha"], 0], "rgba(0,0,0,0)",
      ["interpolate", ["linear"], ["get", "pct_brecha"],
        0, "#199e70", 50, "#f4dc00", 75, "#d95926", 100, "#ff3b30"],
    ],
    "fill-opacity": ["case", ["<", ["get", "pct_brecha"], 0], 0, 0.22],
  },
};

const capaDistritosNombre = (p: Paleta): LayerProps => ({
  id: "distritos-nombre",
  type: "symbol",
  source: "distritos",
  minzoom: 11,
  layout: {
    // Con datos: "Distrito 7 · 89%". Sin pedidos abiertos: solo el nombre.
    "text-field": [
      "case",
      ["<", ["get", "pct_brecha"], 0], ["get", "nombre"],
      ["concat", ["get", "nombre"], " · ", ["to-string", ["get", "pct_brecha"]], "%"],
    ],
    "text-font": ["Open Sans Bold"],
    "text-size": 12.5,
  },
  paint: { "text-color": p.distritos, "text-halo-color": p.halo, "text-halo-width": 2.2 },
});

/** Contorno grueso del distrito aislado con ?distrito= (el filtro es runtime). */
const capaDistritoFoco = (id: number, p: Paleta): LayerProps => ({
  id: "distrito-foco",
  type: "line",
  source: "distritos",
  filter: ["==", ["get", "id"], id],
  paint: { "line-color": p.acento, "line-width": 3, "line-opacity": 0.9 },
});

const capaCircuitosLinea = (p: Paleta): LayerProps => ({
  id: "circuitos-linea",
  type: "line",
  source: "circuitos",
  paint: {
    "line-color": p.circuitos,
    "line-opacity": 0.85,
    "line-width": 2,
  },
});
const capaCircuitosNombre = (p: Paleta): LayerProps => ({
  id: "circuitos-nombre",
  type: "symbol",
  source: "circuitos",
  minzoom: 12.5,
  layout: {
    // El código pelado ("15B") es como lo nombra el Director al armar la
    // orden: la palabra "Circuito" solo agregaba ruido a 47 etiquetas.
    "text-field": ["get", "circuito"],
    "text-font": ["Open Sans Bold"],
    "text-size": 11.5,
    "text-letter-spacing": 0.05,
  },
  paint: { "text-color": p.circuitos, "text-halo-color": p.halo, "text-halo-width": 2 },
});

// ── Capa OPERATIVA de circuitos ──────────────────────────────────────────────
// Con el toggle de circuitos prendido, el mapa pide /api/circuitos-operativos
// y junta por código contra el geojson estático: relleno suave por EMPRESA
// asignada, borde reforzado por PRIORIDAD. Si el fetch falla, los circuitos
// se ven igual que siempre (los datos operativos son opcionales).

/** 12 colores categóricos distinguibles entre sí sobre el fondo oscuro. */
const PALETA_EMPRESAS = [
  "#4f9cf9", "#f2a33c", "#3ec9a7", "#e06fae", "#b18cff", "#f4dc00",
  "#6fd1e8", "#ef7d54", "#9ecf4a", "#ff8fa3", "#c9b458", "#8f9bff",
] as const;

/** Color estable por hash del nombre: la misma empresa se pinta igual en
 *  cualquier sesión y pantalla, sin coordinar nada con el servidor.
 *  Se normaliza el nombre (minúsculas, sin espacios de borde) porque la misma
 *  empresa llega como "ingeco" en sectores-licitacion.json y con la grafía de
 *  la tabla empresas en /api/circuitos-operativos: ambas capas deben coincidir. */
function colorDeEmpresa(nombre: string): string {
  /**
   * La MISMA empresa llega con grafías distintas según la fuente: los sectores
   * de licitación traen el slug ("calleri") y los circuitos operativos el
   * nombre completo de la tabla ("CALLERI E HIJOS S.A."). Se hashea solo la
   * primera palabra sin acentos, que coincide con el slug en todas las
   * empresas reales (LÍNEA→linea, INGECO S.A.→ingeco, LECHESI ARECO→lechesi…),
   * para que cada empresa tenga UN color en todas las capas.
   */
  const clave =
    nombre
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase()
      .split(/[\s(]+/)[0] ?? "";
  let h = 5381;
  for (let i = 0; i < clave.length; i++) h = ((h << 5) + h + clave.charCodeAt(i)) | 0;
  return PALETA_EMPRESAS[Math.abs(h) % PALETA_EMPRESAS.length] ?? "#4f9cf9";
}

const ETIQUETA_PRIORIDAD: Record<string, string> = {
  primaria: "Primaria",
  secundaria: "Secundaria",
  terciaria: "Terciaria",
};
// En HTML (no en el canvas) los tokens sí flipean solos con el tema.
const COLOR_PRIORIDAD: Record<string, string> = { primaria: "var(--color-encurso)", secundaria: "var(--color-amarillo)" };

const capaCircuitosEmpresa = (p: Paleta): LayerProps => ({
  id: "circuitos-empresa-relleno",
  type: "fill",
  source: "circuitos",
  paint: {
    "fill-color": ["coalesce", ["get", "color_empresa"], "rgba(0,0,0,0)"],
    // Sin empresa asignada no hay tinte, pero la capa sigue siendo clickeable
    // (la opacidad 0 no saca el polígono de queryRenderedFeatures).
    "fill-opacity": ["case", ["has", "color_empresa"], p.opacidadEmpresa, 0],
  },
});

/** Refuerzo del borde según prioridad; la terciaria no se refuerza a propósito
 *  (que lo urgente resalte exige que lo demás no compita). */
const capaCircuitosPrioridad = (p: Paleta): LayerProps => ({
  id: "circuitos-prioridad-borde",
  type: "line",
  source: "circuitos",
  filter: ["match", ["get", "prioridad"], ["primaria", "secundaria"], true, false],
  paint: {
    "line-color": ["match", ["get", "prioridad"], "primaria", "#d95926", "secundaria", p.acento, "rgba(0,0,0,0)"],
    "line-opacity": 0.9,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 14, 3, 17, 4.5],
  },
});

const capaBarriosRelleno: LayerProps = {
  id: "barrios-relleno",
  type: "fill",
  source: "barrios",
  // Los que tienen problemas reportados se leen sin abrir el panel: rojo tenue.
  paint: { "fill-color": "#ff3b30", "fill-opacity": ["case", ["get", "problemas"], 0.1, 0] },
};
const capaBarriosLinea = (p: Paleta): LayerProps => ({
  id: "barrios-linea",
  type: "line",
  source: "barrios",
  paint: {
    "line-color": p.barrios,
    "line-opacity": 0.55,
    "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 15, 1.2, 17, 1.8],
  },
});
const capaBarriosNombre = (p: Paleta): LayerProps => ({
  id: "barrios-nombre",
  type: "symbol",
  source: "barrios",
  minzoom: 14,
  layout: {
    "text-field": ["get", "nombre"],
    "text-font": ["Open Sans Regular"],
    "text-size": 9.5,
  },
  paint: { "text-color": p.barrios, "text-halo-color": p.halo, "text-halo-width": 1.4 },
});

// ── Deuda territorial: barrios y circuitos pintados como los distritos ──────
// "Esto se pinta por deuda… podemos hacer lo mismo para circuito de trabajo y
// para barrios; eso le va a hacer feliz a la doctora." MISMA rampa y semántica
// que capaDistritosRelleno: verde = atendido, rojo = abandonado; pct_deuda -1
// (sin pedidos abiertos) queda sin pintar — no es "cero deuda", es "nada que
// medir". Los datos llegan de /api/deuda-territorial y se juntan client-side
// contra los geojson estáticos (ver los memos barriosConDeuda/circuitosConDeuda).
const capaBarriosDeuda: LayerProps = {
  // Mismo id que el relleno clásico de "problemas": las dos variantes se
  // intercambian sin tocar el orden de capas ni el tooltip.
  id: "barrios-relleno",
  type: "fill",
  source: "barrios",
  paint: {
    "fill-color": [
      "case",
      ["<", ["get", "pct_deuda"], 0], "rgba(0,0,0,0)",
      ["interpolate", ["linear"], ["get", "pct_deuda"],
        0, "#199e70", 50, "#f4dc00", 75, "#d95926", 100, "#ff3b30"],
    ],
    // Un toque más opaco que los distritos: los polígonos de barrio son chicos
    // y al 0.22 el tinte se pierde entre las líneas del fondo.
    "fill-opacity": ["case", ["<", ["get", "pct_deuda"], 0], 0, 0.3],
  },
};
const capaCircuitosDeuda: LayerProps = {
  // Mismo id que el relleno por empresa: el clic (detalle del circuito) y el
  // tooltip siguen funcionando igual con cualquiera de las dos pinturas.
  id: "circuitos-empresa-relleno",
  type: "fill",
  source: "circuitos",
  paint: {
    "fill-color": [
      "case",
      ["<", ["get", "pct_deuda"], 0], "rgba(0,0,0,0)",
      ["interpolate", ["linear"], ["get", "pct_deuda"],
        0, "#199e70", 50, "#f4dc00", 75, "#d95926", 100, "#ff3b30"],
    ],
    "fill-opacity": ["case", ["<", ["get", "pct_deuda"], 0], 0, 0.25],
  },
};

/**
 * Clave del join de barrios por NOMBRE normalizado (minúsculas, sin acentos,
 * espacios colapsados). Se joinea así A PROPÓSITO: el properties.id de
 * public/data/barrios.json viene roto del shapefile original y NO coincide
 * con la PK de la tabla barrios — el nombre es lo único que ambos comparten.
 */
function nombreNormalizado(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ── Capas viales nuevas (GeoJSON municipales estáticos, fetch lazy) ─────────

/** "Avenidas y calles principales": jerarquía vial oficial del municipio.
 *  Primarias con línea firme, secundarias finas — las terciarias ya vienen
 *  filtradas del JSON ("te hacen una mancha"). */
const capaJerarquiaLinea = (p: Paleta): LayerProps => ({
  id: "jerarquia-linea",
  type: "line",
  source: "jerarquia",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": p.jerarquiaVial,
    "line-opacity": 0.8,
    "line-width": ["match", ["get", "jerarquia"], "primaria", 2.5, 1.2],
  },
});
const capaJerarquiaNombre = (p: Paleta): LayerProps => ({
  id: "jerarquia-nombre",
  type: "symbol",
  source: "jerarquia",
  minzoom: 14,
  layout: {
    "symbol-placement": "line",
    "text-field": ["get", "nombre"],
    "text-font": ["Open Sans Bold"],
    "text-size": 10.5,
    "symbol-spacing": 350,
    "text-max-angle": 35,
  },
  paint: { "text-color": p.jerarquiaVial, "text-halo-color": p.halo, "text-halo-width": 1.6 },
});

/** Red vial por tipo de calzada. Tres capas del mismo source (line-dasharray
 *  no admite expresiones por feature): pavimento apenas visible, cordón cuneta
 *  punteado intermedio y el RIPIO encima de todo, bien marcado. */
const capaRedPavimento = (p: Paleta): LayerProps => ({
  id: "red-pavimento",
  type: "line",
  source: "red-vial",
  filter: ["==", ["get", "capa"], "pavimento"],
  paint: {
    "line-color": p.pavimento,
    "line-opacity": 0.5,
    "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 1.4],
  },
});
const capaRedCordon = (p: Paleta): LayerProps => ({
  id: "red-cordon",
  type: "line",
  source: "red-vial",
  filter: ["==", ["get", "capa"], "cordon_cuneta"],
  paint: {
    "line-color": p.cordonCuneta,
    "line-opacity": 0.75,
    "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.9, 16, 2],
    "line-dasharray": [2, 1.8],
  },
});
const capaRedRipio = (p: Paleta): LayerProps => ({
  id: "red-ripio",
  type: "line",
  source: "red-vial",
  filter: ["==", ["get", "capa"], "ripio"],
  paint: {
    "line-color": p.ripio,
    "line-opacity": 0.95,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1.4, 14, 2.6, 17, 4.5],
  },
});

/** Sectores de licitación de hormigón: relleno suave por empresa (mismo hash
 *  de color que los circuitos operativos) con su borde. */
const capaSectoresRelleno = (p: Paleta): LayerProps => ({
  id: "sectores-hormigon-relleno",
  type: "fill",
  source: "sectores",
  filter: ["==", ["get", "tipo"], "hormigon"],
  paint: {
    "fill-color": ["coalesce", ["get", "color_empresa"], "rgba(0,0,0,0)"],
    "fill-opacity": p.opacidadEmpresa,
  },
});
const capaSectoresBorde: LayerProps = {
  id: "sectores-hormigon-borde",
  type: "line",
  source: "sectores",
  filter: ["==", ["get", "tipo"], "hormigon"],
  paint: {
    "line-color": ["coalesce", ["get", "color_empresa"], "#8b94a3"],
    "line-opacity": 0.85,
    "line-width": 1.5,
  },
};
/** Los 4 cuadrantes: borde grueso SIN relleno visible. El relleno transparente
 *  existe solo para que el clic dentro del cuadrante abra su detalle (la
 *  opacidad 0 no lo saca de queryRenderedFeatures, como en circuitos). */
const capaCuadrantesClick: LayerProps = {
  id: "sectores-cuadrante-relleno",
  type: "fill",
  source: "sectores",
  filter: ["==", ["get", "tipo"], "cuadrante"],
  paint: { "fill-color": "rgba(0,0,0,0)", "fill-opacity": 0 },
};
const capaCuadrantesBorde = (p: Paleta): LayerProps => ({
  id: "sectores-cuadrante-borde",
  type: "line",
  source: "sectores",
  filter: ["==", ["get", "tipo"], "cuadrante"],
  paint: {
    "line-color": ["coalesce", ["get", "color_empresa"], p.acento],
    "line-opacity": 0.9,
    "line-width": ["interpolate", ["linear"], ["zoom"], 11, 3, 15, 5],
  },
});
const capaCuadrantesEtiqueta = (p: Paleta): LayerProps => ({
  id: "sectores-cuadrante-nombre",
  type: "symbol",
  source: "sectores",
  filter: ["==", ["get", "tipo"], "cuadrante"],
  layout: {
    // "SECTOR SURESTE · hormigón INGECO / asfalto CONTRATUC" (precalculada)
    "text-field": ["get", "etiqueta"],
    "text-font": ["Open Sans Bold"],
    "text-size": 11,
    "text-letter-spacing": 0.06,
  },
  paint: {
    "text-color": ["coalesce", ["get", "color_empresa"], p.acento],
    "text-halo-color": p.halo,
    "text-halo-width": 2,
  },
});

/** Recorridos de colectivos: la sensibilidad por transporte, líneas finas. */
const capaColectivos = (p: Paleta): LayerProps => ({
  id: "colectivos-linea",
  type: "line",
  source: "colectivos",
  layout: { "line-cap": "round", "line-join": "round" },
  paint: { "line-color": p.colectivo, "line-opacity": 0.7, "line-width": 1 },
});

/**
 * La burbuja de cluster habla el semáforo, no densidad. Antes interpolaba
 * n_sin/point_count entre verde y rojo, y ahí mentía: un cluster de puros
 * 'en_ejecucion' — donde no hay NADA resuelto — daba 0 y se pintaba VERDE, que
 * es el color que la leyenda declara "resuelto". Ahora el clustering suma los
 * TRES pasos por separado (n_sin, n_act = cola + obra, n_hecho) y la burbuja
 * toma el color del paso DOMINANTE, desempatando siempre hacia el peor. Lo que
 * no cae en ninguno (desestimado) deja la burbuja gris, que es lo honesto: no
 * hay deuda ni trabajo que mostrar ahí.
 */
const capaClusters = (p: Paleta): LayerProps => ({
  id: "clusters",
  type: "circle",
  source: "incidentes",
  filter: ["has", "point_count"],
  paint: {
    // Las tres cifras van con coalesce+to-number porque un cluster de una sola
    // categoría no trae las otras claves: sin la guarda, la comparación con
    // null cortocircuita y la burbuja cae en el último caso (gris).
    "circle-color": [
      "case",
      // Rojo si "sin atención" es el paso dominante O si llega a un tercio del
      // cluster: una burbuja no puede verse verde mientras un tercio de lo que
      // agrupa no lo tocó nadie.
      ["all",
        [">", ["to-number", ["coalesce", ["get", "n_sin"], 0]], 0],
        ["any",
          ["all",
            [">=", ["to-number", ["coalesce", ["get", "n_sin"], 0]], ["to-number", ["coalesce", ["get", "n_act"], 0]]],
            [">=", ["to-number", ["coalesce", ["get", "n_sin"], 0]], ["to-number", ["coalesce", ["get", "n_hecho"], 0]]]],
          [">=",
            ["*", 3, ["to-number", ["coalesce", ["get", "n_sin"], 0]]],
            ["max", 1, ["to-number", ["coalesce", ["get", "point_count"], 1]]]]]],
      p.sinAtencion,
      // Activo = en cola + en obra en una sola cifra; se pinta con el ámbar, el
      // paso más avanzado que cubre (mismo criterio que el KPI "En curso").
      ["all",
        [">", ["to-number", ["coalesce", ["get", "n_act"], 0]], 0],
        [">=", ["to-number", ["coalesce", ["get", "n_act"], 0]], ["to-number", ["coalesce", ["get", "n_hecho"], 0]]]],
      p.enObra,
      [">", ["to-number", ["coalesce", ["get", "n_hecho"], 0]], 0], p.resuelto,
      p.inactivo,
    ],
    "circle-radius": ["step", ["get", "point_count"], 14, 10, 19, 60, 26, 200, 33],
    "circle-stroke-width": 2,
    "circle-stroke-color": p.trazoCluster,
  },
});

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
    // Con la burbuja recorriendo verde→ámbar→rojo no hay un color de texto que
    // sirva para todos: blanco con halo oscuro se lee sobre los tres.
    "text-color": "#ffffff",
    "text-halo-color": "rgba(11,15,22,0.75)",
    "text-halo-width": 1.4,
  },
};

const capaIncidentes = (p: Paleta): LayerProps => ({
  id: "incidentes-punto",
  type: "circle",
  source: "incidentes",
  filter: ["!", ["has", "point_count"]],
  paint: {
    // El color sale del ESTADO, no del macro: es el único lugar donde se
    // distinguen los cuatro pasos del semáforo (el macro junta programado y
    // en ejecución en un solo "en curso" y perdería el ámbar).
    "circle-color": [
      "match",
      ["get", "estado"],
      ["detectado", "priorizado"], p.sinAtencion,
      ["programado"], p.enCola,
      ["en_ejecucion"], p.enObra,
      ["reparado", "verificado"], p.resuelto,
      p.inactivo,
    ],
    // Se conserva la jerarquía de tamaño: lo que está pasando ahora (en obra)
    // manda, lo comprometido le sigue y el archivo (resuelto/desestimado) se
    // achica — solo que ahora la escala tiene los cuatro escalones.
    "circle-radius": [
      "interpolate", ["linear"], ["zoom"],
      11, ["match", ["get", "estado"], ["en_ejecucion"], 4.5, ["programado"], 4, ["reparado", "verificado", "desestimado"], 3, 3.5],
      14, ["match", ["get", "estado"], ["en_ejecucion"], 7.5, ["programado"], 6.5, ["reparado", "verificado", "desestimado"], 5, 6],
      17, ["match", ["get", "estado"], ["en_ejecucion"], 11, ["programado"], 9.5, ["reparado", "verificado", "desestimado"], 7.5, 9],
      19.5, ["match", ["get", "estado"], ["en_ejecucion"], 16, ["programado"], 14.5, ["reparado", "verificado", "desestimado"], 11.5, 14],
    ],
    // Anillo CELESTE = obra SIGOV (contratada): es PROCEDENCIA, no estado —
    // el amarillo que usaba antes lo necesita el semáforo. Trazo fuerte =
    // comprometido o en obra; anillo neutro = el resto (CIMBA/planillas).
    "circle-stroke-width": [
      "case",
      ["==", ["get", "origen"], "sigov"], 2,
      ["match", ["get", "estado"], ["programado", "en_ejecucion"], true, false], 2,
      1,
    ],
    "circle-stroke-color": [
      "case",
      ["==", ["get", "origen"], "sigov"], p.sigov,
      ["match", ["get", "estado"], ["programado", "en_ejecucion"], true, false], p.trazoActivo,
      p.trazoPunto,
    ],
  },
  layout: {},
});

/** Anillo de selección: marca exactamente el punto elegido. */
const capaSeleccion = (p: Paleta): LayerProps => ({
  id: "seleccion-anillo",
  type: "circle",
  source: "seleccion",
  paint: {
    "circle-color": "rgba(0,0,0,0)",
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 9, 17, 16],
    "circle-stroke-width": 2.5,
    "circle-stroke-color": p.acento,
  },
});

const capaPulso = (p: Paleta): LayerProps => ({
  id: "incidentes-pulso",
  type: "circle",
  source: "incidentes",
  filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "estado"], "en_ejecucion"]],
  paint: {
    "circle-color": "rgba(0,0,0,0)",
    "circle-radius": 10,
    "circle-stroke-width": 2,
    // El mismo ámbar del punto en obra: el pulso es su eco.
    "circle-stroke-color": p.enObra,
    "circle-stroke-opacity": 0.6,
  },
});

const capaDemandas = (p: Paleta): LayerProps => ({
  id: "demandas-punto",
  type: "circle",
  source: "demandas",
  paint: {
    "circle-color": p.demanda,
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
});

/** Vista Brecha: el color de cada pedido dice si fue atendido o no. */
/** Vista Brecha, sub-modo antigüedad: la deuda envejece a la vista (amarillo
 * reciente → rojo encendido con más de un año esperando; gris = sin fecha). */
const capaDemandasEdad = (p: Paleta): LayerProps => ({
  id: "demandas-punto",
  type: "circle",
  paint: {
    "circle-radius": [
      "case", ["<", ["get", "edad_dias"], 0], 4,
      ["interpolate", ["linear"], ["get", "edad_dias"], 30, 4, 730, 7],
    ],
    "circle-color": [
      "case", ["<", ["get", "edad_dias"], 0], "#6b7280",
      ["interpolate", ["linear"], ["get", "edad_dias"],
        30, p.edadReciente, 180, "#f59e0b", 365, "#d95926", 730, "#ff3b30"],
    ],
    "circle-stroke-color": p.tinta,
    "circle-stroke-width": 1,
    "circle-opacity": 0.92,
  },
});

const capaDemandasBrecha = (p: Paleta): LayerProps => ({
  id: "demandas-punto",
  type: "circle",
  source: "demandas",
  paint: {
    // El semáforo completo: 'en_obra' salió de 'en_cola' (hay un incidente en
    // ejecución a menos de 40 m) y se pinta ámbar. 'atendida' y cualquier
    // valor nuevo caen en gris: no hay deuda que contar ahí.
    "circle-color": [
      "match",
      ["get", "brecha"],
      "sin_atencion", p.sinAtencion,
      "en_cola", p.enCola,
      "en_obra", p.enObra,
      "posible_resuelta", p.resuelto,
      p.inactivo,
    ],
    "circle-opacity": 0.85,
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 2.6, 14, 4.5, 17, 7, 19.5, 10],
    "circle-stroke-width": 0.8,
    "circle-stroke-color": p.trazoBrecha,
  },
});

/**
 * Marca de DESTINO: un pedido que no resuelve bacheo (agua → SAT, ripio o
 * problema de traza → Ingeniería) no habla el idioma del semáforo, porque su
 * estado no es el de la cuadrilla. Se distingue por FORMA — un anillo propio
 * alrededor del punto —, no por color: MapLibre no dibuja formas en las capas
 * circle y el color ya está ocupado por el semáforo. Se monta encima del punto
 * y sin relleno, así el paso del semáforo se sigue leyendo adentro.
 *
 * Los dos destinos se separan además ENTRE SÍ por la forma del anillo, no solo
 * por el matiz: la SAT lleva un aro fino y ceñido al punto, Ingeniería uno
 * grueso y más abierto. `circle-stroke` no admite dasharray, así que el grosor
 * y el radio son las dos únicas variables de forma disponibles — alcanzan para
 * que la marca se lea en escala de grises.
 */
const capaDemandasDestino = (p: Paleta): LayerProps => ({
  id: "demandas-destino-anillo",
  type: "circle",
  source: "demandas",
  filter: ["match", ["get", "destino"], ["sat", "ingenieria"], true, false],
  paint: {
    "circle-color": "rgba(0,0,0,0)",
    "circle-radius": [
      "interpolate", ["linear"], ["zoom"],
      11, ["match", ["get", "destino"], "sat", 5, 6.5],
      14, ["match", ["get", "destino"], "sat", 7.5, 9.5],
      17, ["match", ["get", "destino"], "sat", 11, 13.5],
      19.5, ["match", ["get", "destino"], "sat", 14.5, 17.5],
    ],
    "circle-stroke-width": ["match", ["get", "destino"], "sat", 2, 3.2],
    // Violeta la SAT, magenta Ingeniería: ver el comentario de destinoSat en
    // la paleta — los colores viejos (celeste agua y marrón ripio) chocaban
    // con el celeste SIGOV y con el naranja "en cola".
    "circle-stroke-color": ["match", ["get", "destino"], "sat", p.destinoSat, p.destinoIngenieria],
    "circle-stroke-opacity": 0.95,
  },
});

/** Círculo del analizador de zona. */
const capaZonaRelleno = (p: Paleta): LayerProps => ({
  id: "zona-relleno",
  type: "fill",
  source: "zona",
  paint: { "fill-color": p.acento, "fill-opacity": p.oscuro ? 0.07 : 0.1 },
});
const capaZonaBorde = (p: Paleta): LayerProps => ({
  id: "zona-borde",
  type: "line",
  source: "zona",
  paint: { "line-color": p.acento, "line-width": 2, "line-dasharray": [2, 1.5] },
});

/** Densidad 3D: hexágonos extruidos por cantidad de pedidos (rampa azul secuencial). */
const capaHexagonos = (p: Paleta): LayerProps => ({
  id: "hexagonos-3d",
  type: "fill-extrusion",
  source: "hexbins",
  paint: {
    "fill-extrusion-color": [
      "interpolate", ["linear"], ["get", "n"],
      1, p.rampa[0],
      4, p.rampa[1],
      10, p.rampa[2],
      25, p.rampa[3],
      60, p.rampa[4],
    ],
    "fill-extrusion-height": ["*", ["get", "n"], 45],
    "fill-extrusion-opacity": 0.82,
  },
});

const capaCalor = (p: Paleta): LayerProps => ({
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
      0, p.calorCero,
      0.25, p.rampa[0],
      0.5, p.rampa[1],
      0.72, p.rampa[2],
      0.9, p.rampa[3],
      1, p.rampa[4],
    ],
  },
});

// ── Componente principal ────────────────────────────────────────────────────

const clienteQuery = new QueryClient();

export interface FocoMapa {
  lat: number;
  lon: number;
  zoom: number;
}

export interface InicialMapa {
  /** Acepta también las claves viejas (operativo/historico/analisis/completo)
   *  para que ningún deep-link guardado se rompa: se normalizan al entrar. */
  vista?: Vista | VistaLegado;
  brecha?: string;
  fuente?: string;
  tipo?: string;
  /**
   * Aislar quién resuelve ("mostrame solo lo de la SAT"). A diferencia del
   * resto de los chips, el destino NO se persiste: el mapa abre siempre en la
   * cola de bacheo salvo que el link diga otra cosa.
   * Es `string` y no la unión de los tres valores porque el parámetro admite
   * una LISTA separada por comas ("bacheo,sat") y el atajo "todos": un link de
   * "Copiar link de esta vista" con dos colas prendidas perdía una. Lo parsea
   * el estado `destinos` de abajo; cualquier valor desconocido cae en el
   * default (solo bacheo).
   */
  destino?: string;
  dias?: number;
  calor?: boolean;
  hex?: boolean;
  sat?: boolean;
  top?: boolean;
  modoBrecha?: "categoria" | "antiguedad";
  zona?: { lat: number; lon: number; radio: number };
  /** Cámara de una vista compartida (sin marcador — a diferencia de `foco`,
   *  que sí lo pone: son casos distintos, "mostrame este encuadre" vs. "fijate
   *  este punto"). */
  camara?: { lat: number; lon: number; zoom: number };
  /** Frase para el buscador inteligente apenas carguen los datos — así Migue
   *  (u otro link) puede mandar al mapa una acción en lenguaje natural. */
  buscar?: string;
  /** Aislar un distrito: se filtran los puntos y se encuadra su polígono. */
  distrito?: number;
}

interface CandidatoCotejo {
  id: number;
  tipo: string;
  estado: string;
  macro: string;
  direccion: string | null;
  dist: number;
  lngLat: [number, number];
  cerradoEn: string | null;
  /** true si se cerró ANTES del pedido: es reincidencia, no la respuesta a este pedido. */
  posibleReincidencia: boolean;
}

interface CotejoActivo {
  demanda: Record<string, unknown>;
  lngLat: [number, number];
  candidatos: CandidatoCotejo[];
}

export function MapaCimba(props: {
  kpisIniciales: Kpis;
  rol: RolUsuario;
  iaHabilitada: boolean;
  foco?: FocoMapa | null;
  inicial?: InicialMapa;
}) {
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

function MapaInterno({
  kpisIniciales,
  rol,
  iaHabilitada,
  foco,
  inicial,
}: {
  kpisIniciales: Kpis;
  rol: RolUsuario;
  iaHabilitada: boolean;
  foco?: FocoMapa | null;
  inicial?: InicialMapa;
}) {
  const mapRef = useRef<MapRef>(null);
  // Tema reactivo: cambia el estilo base (positron/dark-matter) y la paleta
  // de las capas propias. Las Sources/Layers declarativas sobreviven al
  // setStyle porque react-map-gl las re-agrega al nuevo estilo.
  const tema = usarTemaMapa();
  const pal = useMemo(() => paleta(tema), [tema]);
  const capas = useMemo(
    () => ({
      avenidasNombre: capaAvenidasNombre(pal),
      distritosHalo: capaDistritosHalo(pal),
      distritosLinea: capaDistritosLinea(pal),
      distritosNombre: capaDistritosNombre(pal),
      circuitosLinea: capaCircuitosLinea(pal),
      circuitosNombre: capaCircuitosNombre(pal),
      circuitosEmpresa: capaCircuitosEmpresa(pal),
      circuitosPrioridad: capaCircuitosPrioridad(pal),
      barriosLinea: capaBarriosLinea(pal),
      barriosNombre: capaBarriosNombre(pal),
      jerarquiaLinea: capaJerarquiaLinea(pal),
      jerarquiaNombre: capaJerarquiaNombre(pal),
      redPavimento: capaRedPavimento(pal),
      redCordon: capaRedCordon(pal),
      redRipio: capaRedRipio(pal),
      sectoresRelleno: capaSectoresRelleno(pal),
      cuadrantesBorde: capaCuadrantesBorde(pal),
      cuadrantesEtiqueta: capaCuadrantesEtiqueta(pal),
      colectivos: capaColectivos(pal),
      pulso: capaPulso(pal),
      clusters: capaClusters(pal),
      incidentes: capaIncidentes(pal),
      seleccion: capaSeleccion(pal),
      demandas: capaDemandas(pal),
      demandasEdad: capaDemandasEdad(pal),
      demandasBrecha: capaDemandasBrecha(pal),
      demandasDestino: capaDemandasDestino(pal),
      zonaRelleno: capaZonaRelleno(pal),
      zonaBorde: capaZonaBorde(pal),
      hexagonos: capaHexagonos(pal),
      calor: capaCalor(pal),
    }),
    [pal],
  );
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);
  const [panelCapas, setPanelCapas] = useState(true);
  // En pantallas chicas el panel de Capas taparía medio mapa: arranca cerrado.
  useEffect(() => {
    if (window.innerWidth < 640) setPanelCapas(false);
  }, []);
  // Recorrido guiado ("?"): el botón pulsa hasta que lo abren por primera vez.
  const [guiaAbierta, setGuiaAbierta] = useState(false);
  const [guiaConocida, setGuiaConocida] = useState(true);
  useEffect(() => {
    try {
      setGuiaConocida(localStorage.getItem("cimba:guia-vista") === "1");
    } catch {
      // sin localStorage: no pulsa, nada más
    }
  }, []);
  const abrirGuia = () => {
    setGuiaAbierta(true);
    setGuiaConocida(true);
    setMenuAcciones(false);
    try {
      localStorage.setItem("cimba:guia-vista", "1");
    } catch {
      // sin persistencia: pulsará de nuevo la próxima, no es grave
    }
  };
  // Menú de acciones en mobile: una sola lista con nombre y explicación,
  // en vez de una hilera de íconos crípticos que se cortaban.
  const [menuAcciones, setMenuAcciones] = useState(false);
  const [marcador, setMarcador] = useState<[number, number] | null>(foco ? [foco.lon, foco.lat] : null);
  const [informe, setInforme] = useState<Informe | null>(null);
  const [generandoInforme, setGenerandoInforme] = useState(false);
  const [errorInforme, setErrorInforme] = useState<string | null>(null);

  // Estado de capas y filtros — arranca en vista HOY (lo accionable)
  const vistaInicial: Vista = normalizarVista(inicial?.vista) ?? "hoy";
  const [vista, setVista] = useState<Vista>(vistaInicial);
  const [verMacro, setVerMacro] = useState<Record<string, boolean>>({ ...VISTAS[vistaInicial].macro });
  const [soloDemandasAbiertas, setSoloDemandasAbiertas] = useState(VISTAS[vistaInicial].demandasAbiertas);
  const [verDemandas, setVerDemandas] = useState(VISTAS[vistaInicial].verDemandas);
  // La densidad de demanda (ex vista Análisis) es una capa más: arranca
  // apagada salvo pedido explícito (?calor=1) o un link viejo de esa vista.
  const [verCalor, setVerCalor] = useState(inicial?.calor ?? inicial?.vista === "analisis");
  const [fuentes, setFuentes] = useState<Record<string, boolean>>({});
  const [tipos, setTipos] = useState<Record<string, boolean>>(() => {
    // ?tipo=bache aísla ese tipo (los demás quedan apagados)
    if (!inicial?.tipo || !(inicial.tipo in ETIQUETA_TIPO)) return {};
    const apagados: Record<string, boolean> = {};
    for (const t of Object.keys(ETIQUETA_TIPO)) apagados[t] = t === inicial.tipo;
    return apagados;
  });
  const [filtroBrecha, setFiltroBrecha] = useState<string | null>(inicial?.brecha ?? null);
  /**
   * Chips de DESTINO: por defecto SOLO bacheo. Esa es la cola real de la
   * Dirección — los ~975 pedidos de agua (SAT) y los ~119 de ripio
   * (Ingeniería) inflaban una deuda que no es suya. A propósito NO se
   * persiste en localStorage: que abrir el mapa sea siempre predecible.
   * Un deep-link ?destino= sí manda: acepta un destino suelto, una LISTA
   * separada por comas ("bacheo,sat" — lo que emite "Copiar link de esta
   * vista" cuando hay más de una cola prendida) o el atajo "todos". Un valor
   * que no se entiende cae en el default en vez de dejar el mapa en blanco.
   */
  const [destinos, setDestinos] = useState<Record<string, boolean>>(() => {
    const soloBacheo = { bacheo: true, sat: false, ingenieria: false };
    const crudo = inicial?.destino?.trim().toLowerCase();
    if (!crudo) return soloBacheo;
    if (crudo === "todos") return { bacheo: true, sat: true, ingenieria: true };
    const pedidos = new Set(
      crudo.split(",").map((v) => v.trim()).filter((v): v is Destino => (DESTINOS as readonly string[]).includes(v)),
    );
    if (pedidos.size === 0) return soloBacheo;
    return { bacheo: pedidos.has("bacheo"), sat: pedidos.has("sat"), ingenieria: pedidos.has("ingenieria") };
  });
  // Analizador de zona (lupa territorial)
  const [modoAnalisis, setModoAnalisis] = useState(false);
  const [zona, setZona] = useState<{ lon: number; lat: number } | null>(
    inicial?.zona ? { lon: inicial.zona.lon, lat: inicial.zona.lat } : null,
  );
  const [radioZona, setRadioZona] = useState(inicial?.zona?.radio ?? 250);
  // Forma de la zona: círculo (mantener y arrastrar) o polígono clic a clic
  // ("analizo estas 8 manzanas"). Los vértices son [lon, lat]; recién cerrado
  // (doble clic o clic sobre el primer vértice) el polígono mide.
  const [formaZona, setFormaZona] = useState<"circulo" | "poligono">("circulo");
  const [vertsZona, setVertsZona] = useState<Array<[number, number]>>([]);
  const [zonaCerrada, setZonaCerrada] = useState(false);
  // Densidad 3D en hexágonos
  const [verHex, setVerHex] = useState(inicial?.hex ?? false);
  // Línea de tiempo
  const [tiempoActivo, setTiempoActivo] = useState(false);
  const [tiempoIdx, setTiempoIdx] = useState(0);
  const [reproduciendo, setReproduciendo] = useState(false);
  // Tooltip al pasar el mouse + acordeón del panel
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lineas: string[] } | null>(null);
  // Acordeón del panel de capas. Las claves quedaron con su nombre histórico
  // aunque los títulos visibles sean otros (demandas → "Lo pedido",
  // incidentes → "Lo hecho"): así no se rompe nada que dependa de ellas.
  // Territorio arranca cerrado (es lo más largo) y Período también — su
  // resumen ("Todo"/"30d") ya dice lo que hay adentro sin abrirlo.
  const [secciones, setSecciones] = useState<Record<string, boolean>>({
    territorio: false,
    incidentes: true,
    demandas: true,
    fondo: true,
    tipos: false,
    periodo: false,
  });
  const barraEstadoRef = useRef<HTMLDivElement>(null);
  const modoAnalisisRef = useRef(false);
  modoAnalisisRef.current = modoAnalisis;
  // Espejos para alClick (useCallback sin dependencias): el dibujo del
  // polígono necesita leer el estado vivo, no el del cierre del callback.
  const formaZonaRef = useRef(formaZona);
  formaZonaRef.current = formaZona;
  const vertsZonaRef = useRef(vertsZona);
  vertsZonaRef.current = vertsZona;
  const zonaCerradaRef = useRef(zonaCerrada);
  zonaCerradaRef.current = zonaCerrada;
  // ?zp=lon,lat;lon,lat;… reproduce un polígono compartido con "Copiar link".
  // Se parsea en el cliente: el círculo (zlat/zlon/zr) ya viaja por la page,
  // pero el polígono es una herramienta de esta isla — no hace falta tocar el
  // server component para llevarle una lista de vértices.
  useEffect(() => {
    try {
      const zp = new URLSearchParams(window.location.search).get("zp");
      if (!zp) return;
      const verts = zp
        .split(";")
        .slice(0, 100)
        .map((par) => par.split(",").map(Number))
        .filter((c): c is [number, number] => c.length === 2 && c.every((n) => Number.isFinite(n)));
      if (verts.length >= 3) {
        setFormaZona("poligono");
        setVertsZona(verts);
        setZonaCerrada(true);
        setZona(null);
      }
    } catch {
      // URL rota: el mapa abre normal, sin polígono
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ?vista=hoy|historial escrito a mano: la page todavía valida las claves
  // viejas y descarta las nuevas, así que se rescatan acá en el cliente
  // (mismo patrón que ?zp=). Los links que genera el propio mapa viajan con
  // clave vieja y entran por la page, sin pasar por acá.
  useEffect(() => {
    if (inicial?.vista) return; // la page ya trajo una vista válida
    try {
      const v = normalizarVista(new URLSearchParams(window.location.search).get("vista"));
      if (v && v !== vistaInicial) aplicarVista(v);
    } catch {
      // URL rota: queda la vista por defecto
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Gesto de dibujo del círculo: mousedown fija el centro, arrastrar agranda
  // el radio con las estadísticas recalculándose en vivo, mouseup lo suelta.
  const dibujandoRef = useRef(false);
  const arrastroRef = useRef(false);
  const [verAvenidas, setVerAvenidas] = useState(true);
  const [verCalles, setVerCalles] = useState(true);
  const [verSatelite, setVerSatelite] = useState(inicial?.sat ?? true);
  // Límites territoriales (distritos, circuitos electorales, barrios): capas de
  // referencia livianas, servidas como GeoJSON estático y cargadas solo si se
  // prenden — nadie quiere pagar el fetch de 327 barrios sin pedirlo.
  // Un link con ?distrito= entra aislando ese distrito: prende su capa, filtra
  // los puntos y encuadra el polígono.
  const [distritoFoco, setDistritoFoco] = useState<number | null>(inicial?.distrito ?? null);
  const [verDistritos, setVerDistritos] = useState(inicial?.distrito != null);
  const [verCoropleta, setVerCoropleta] = useState(true);
  const [verCircuitos, setVerCircuitos] = useState(false);
  const [verBarrios, setVerBarrios] = useState(false);
  const [distritosGeo, setDistritosGeo] = useState<FCPoligono | null>(null);
  const [circuitosGeo, setCircuitosGeo] = useState<FCPoligono | null>(null);
  const [barriosGeo, setBarriosGeo] = useState<FCPoligono | null>(null);
  useEffect(() => {
    if (!verDistritos || distritosGeo) return;
    fetch("/data/distritos.json").then((r) => r.json()).then(setDistritosGeo).catch(() => {});
  }, [verDistritos, distritosGeo]);
  useEffect(() => {
    if (!verCircuitos || circuitosGeo) return;
    fetch("/data/circuitos.json").then((r) => r.json()).then(setCircuitosGeo).catch(() => {});
  }, [verCircuitos, circuitosGeo]);
  // Datos operativos por circuito (empresa/prioridad/pendientes): se piden
  // junto con el toggle y son OPCIONALES — si fallan, los circuitos se ven
  // como siempre, solo sin tinte de empresa ni popup con números.
  const [circuitosOp, setCircuitosOp] = useState<CircuitoResumen[] | null>(null);
  useEffect(() => {
    if (!verCircuitos || circuitosOp) return;
    fetch("/api/circuitos-operativos")
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((datos) => {
        if (Array.isArray(datos)) setCircuitosOp(datos as CircuitoResumen[]);
      })
      .catch(() => {});
  }, [verCircuitos, circuitosOp]);
  // ── Deuda territorial: pintar barrios y circuitos por deuda ─────────────
  // Se pide al prender la capa (y con el sub-toggle activo); es OPCIONAL como
  // lo operativo: si falla, los límites se dibujan igual, solo sin tinte.
  // El rol empresa ni intenta el fetch: /api/deuda-territorial le da 403.
  const puedeVerDeuda = rol !== "empresa";
  const [verDeudaBarrios, setVerDeudaBarrios] = useState(true);
  const [verDeudaCircuitos, setVerDeudaCircuitos] = useState(true);
  const [deudaBarrios, setDeudaBarrios] = useState<DeudaTerritorial[] | null>(null);
  const [deudaCircuitos, setDeudaCircuitos] = useState<DeudaTerritorial[] | null>(null);
  useEffect(() => {
    if (!verBarrios || !verDeudaBarrios || deudaBarrios || !puedeVerDeuda) return;
    fetch("/api/deuda-territorial?nivel=barrio")
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((datos) => {
        if (Array.isArray(datos)) setDeudaBarrios(datos as DeudaTerritorial[]);
      })
      .catch(() => {});
  }, [verBarrios, verDeudaBarrios, deudaBarrios, puedeVerDeuda]);
  useEffect(() => {
    if (!verCircuitos || !verDeudaCircuitos || deudaCircuitos || !puedeVerDeuda) return;
    fetch("/api/deuda-territorial?nivel=circuito")
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((datos) => {
        if (Array.isArray(datos)) setDeudaCircuitos(datos as DeudaTerritorial[]);
      })
      .catch(() => {});
  }, [verCircuitos, verDeudaCircuitos, deudaCircuitos, puedeVerDeuda]);

  // Popup del circuito clickeado (código, empresa, prioridad, carga pendiente)
  const [circuitoSel, setCircuitoSel] = useState<Record<string, unknown> | null>(null);

  /**
   * Join client-side por código: el polígono viene del geojson estático (ya
   * cacheado por el navegador) y lo vivo del endpoint. Un circuito sin match
   * queda tal cual — el render nunca depende de que lo operativo exista.
   */
  const circuitosConOperativa = useMemo<FCPoligono | null>(() => {
    if (!circuitosGeo) return null;
    if (!circuitosOp || circuitosOp.length === 0) return circuitosGeo;
    const porCodigo = new Map(circuitosOp.map((c) => [c.codigo, c]));
    return {
      type: "FeatureCollection",
      features: circuitosGeo.features.map((f) => {
        const op = porCodigo.get(String(f.properties.circuito ?? ""));
        if (!op) return f;
        return {
          ...f,
          properties: {
            ...f.properties,
            op: true,
            empresa: op.empresaNombre,
            // color_empresa solo si hay empresa: la capa de relleno usa
            // ["has","color_empresa"] para dejar transparente lo sin asignar.
            ...(op.empresaNombre ? { color_empresa: colorDeEmpresa(op.empresaNombre) } : {}),
            prioridad: op.prioridad,
            pendientes: op.pendientes,
            demandas_abiertas: op.demandasAbiertas,
            ordenes_activas: op.ordenesActivas,
          },
        };
      }),
    };
  }, [circuitosGeo, circuitosOp]);

  /**
   * Deuda por circuito, encima de lo operativo. El join va por CÓDIGO: el
   * geojson estático no trae el id de la base, pero deudaPorTerritorio
   * devuelve como nombre el codigo del circuito ("15B"), que es exactamente
   * el properties.circuito del geojson — el mismo criterio que ya usa el
   * join de /api/circuitos-operativos.
   */
  const circuitosConDeuda = useMemo<FCPoligono | null>(() => {
    const base = circuitosConOperativa;
    if (!base) return null;
    if (!verDeudaCircuitos || !deudaCircuitos || deudaCircuitos.length === 0) return base;
    const porCodigo = new Map(deudaCircuitos.map((d) => [d.nombre, d]));
    return {
      type: "FeatureCollection",
      features: base.features.map((f) => {
        const deuda = porCodigo.get(String(f.properties.circuito ?? ""));
        return {
          ...f,
          properties: {
            ...f.properties,
            deuda_abiertas: deuda?.abiertas ?? 0,
            deuda_sin: deuda?.sinAtencion ?? 0,
            // -1 = sin pedidos abiertos: la rampa lo deja sin pintar.
            pct_deuda: deuda && deuda.abiertas > 0 ? Math.round(100 * deuda.pct) : -1,
          },
        };
      }),
    };
  }, [circuitosConOperativa, deudaCircuitos, verDeudaCircuitos]);
  useEffect(() => {
    if (!verBarrios || barriosGeo) return;
    fetch("/data/barrios.json").then((r) => r.json()).then(setBarriosGeo).catch(() => {});
  }, [verBarrios, barriosGeo]);

  /**
   * Deuda por barrio. OJO con el join: el properties.id de barrios.json NO es
   * la PK de la tabla barrios (viene roto del shapefile), así que acá se
   * joinea por NOMBRE normalizado (minúsculas, sin acentos, espacios
   * colapsados) — es lo único que el geojson y la base comparten de verdad.
   * Un barrio de la base cuyo nombre no matchee ningún polígono simplemente
   * no se pinta (y viceversa): preferible a pintar el barrio equivocado.
   */
  const barriosConDeuda = useMemo<FCPoligono | null>(() => {
    if (!barriosGeo) return null;
    if (!verDeudaBarrios || !deudaBarrios || deudaBarrios.length === 0) return barriosGeo;
    const porNombre = new Map(deudaBarrios.map((d) => [nombreNormalizado(d.nombre), d]));
    return {
      type: "FeatureCollection",
      features: barriosGeo.features.map((f) => {
        const deuda = porNombre.get(nombreNormalizado(String(f.properties.nombre ?? "")));
        return {
          ...f,
          properties: {
            ...f.properties,
            deuda_abiertas: deuda?.abiertas ?? 0,
            deuda_sin: deuda?.sinAtencion ?? 0,
            pct_deuda: deuda && deuda.abiertas > 0 ? Math.round(100 * deuda.pct) : -1,
          },
        };
      }),
    };
  }, [barriosGeo, deudaBarrios, verDeudaBarrios]);

  // ── Capas viales nuevas: apagadas por defecto, fetch lazy al prenderlas ──
  // (mismo patrón que circuitos/barrios: nadie paga el JSON sin pedirlo —
  // red-vial.json solo ya pesa ~2 MB).
  const [verJerarquia, setVerJerarquia] = useState(false);
  const [verRedVial, setVerRedVial] = useState(false);
  const [verSectores, setVerSectores] = useState(false);
  const [verColectivos, setVerColectivos] = useState(false);
  const [jerarquiaGeo, setJerarquiaGeo] = useState<FCLinea | null>(null);
  const [redVialGeo, setRedVialGeo] = useState<FCLinea | null>(null);
  const [sectoresGeo, setSectoresGeo] = useState<FCPoligono | null>(null);
  const [colectivosGeo, setColectivosGeo] = useState<FCLinea | null>(null);
  const [verBacheoIntegral, setVerBacheoIntegral] = useState(false);
  const [bacheoIntegralGeo, setBacheoIntegralGeo] = useState<FCPoligono | null>(null);
  // Detalle del sector de licitación clickeado (hormigón o cuadrante)
  const [sectorSel, setSectorSel] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (!verJerarquia || jerarquiaGeo) return;
    fetch("/data/jerarquia-vial.json").then((r) => r.json()).then(setJerarquiaGeo).catch(() => {});
  }, [verJerarquia, jerarquiaGeo]);
  useEffect(() => {
    if (!verRedVial || redVialGeo) return;
    fetch("/data/red-vial.json").then((r) => r.json()).then(setRedVialGeo).catch(() => {});
  }, [verRedVial, redVialGeo]);
  useEffect(() => {
    if (!verColectivos || colectivosGeo) return;
    fetch("/data/recorridos-colectivos.json").then((r) => r.json()).then(setColectivosGeo).catch(() => {});
  }, [verColectivos, colectivosGeo]);
  useEffect(() => {
    if (!verBacheoIntegral || bacheoIntegralGeo) return;
    fetch("/data/bacheo-integral.json").then((r) => r.json()).then(setBacheoIntegralGeo).catch(() => {});
  }, [verBacheoIntegral, bacheoIntegralGeo]);
  useEffect(() => {
    if (!verSectores || sectoresGeo) return;
    fetch("/data/sectores-licitacion.json")
      .then((r) => r.json() as Promise<FCPoligono>)
      .then((fc) => {
        // Se precalculan UNA vez: el color estable por empresa (misma función
        // de hash que los circuitos operativos) y la etiqueta del cuadrante
        // ("SECTOR SURESTE · hormigón INGECO / asfalto CONTRATUC") — MapLibre
        // no puede concatenar con mayúsculas, así que se resuelve acá.
        setSectoresGeo({
          type: "FeatureCollection",
          features: fc.features.map((f) => {
            const empresa = f.properties.empresa ? String(f.properties.empresa) : null;
            const asfalto = f.properties.empresaAsfalto ? String(f.properties.empresaAsfalto) : null;
            const detalle =
              f.properties.tipo === "cuadrante"
                ? `hormigón ${empresa?.toUpperCase() ?? "—"} / asfalto ${asfalto?.toUpperCase() ?? "—"}`
                : `hormigón ${empresa?.toUpperCase() ?? "—"}`;
            return {
              ...f,
              properties: {
                ...f.properties,
                ...(empresa ? { color_empresa: colorDeEmpresa(empresa) } : {}),
                detalle,
                etiqueta:
                  f.properties.tipo === "cuadrante"
                    ? `${String(f.properties.sector)} · ${detalle}`
                    : String(f.properties.sector),
              },
            };
          }),
        });
      })
      .catch(() => {});
  }, [verSectores, sectoresGeo]);

  // Al entrar con ?distrito=, encuadrar su polígono apenas esté cargado.
  const encuadreDistritoRef = useRef(false);
  useEffect(() => {
    if (distritoFoco == null || encuadreDistritoRef.current || !distritosGeo) return;
    const f = distritosGeo.features.find((x) => Number(x.properties.id) === distritoFoco);
    if (!f) return;
    encuadreDistritoRef.current = true;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    const recorrer = (c: unknown): void => {
      if (Array.isArray(c) && typeof c[0] === "number") {
        const [lon, lat] = c as [number, number];
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        return;
      }
      if (Array.isArray(c)) for (const x of c) recorrer(x);
    };
    recorrer(f.geometry.coordinates);
    if (Number.isFinite(minLon)) {
      mapRef.current?.getMap()?.fitBounds([[minLon, minLat], [maxLon, maxLat]], {
        padding: 70,
        duration: 1200,
      });
    }
  }, [distritoFoco, distritosGeo]);
  // Si el estilo no trae la capa de nombres, el raster satelital va sin ancla.
  const [hayAnclaEtiquetas, setHayAnclaEtiquetas] = useState(true);
  // ── Recursos de precisión y brecha ──────────────────────────────────────
  const [verTop20, setVerTop20] = useState(inicial?.top ?? false);
  const [modoBrecha, setModoBrecha] = useState<"categoria" | "antiguedad">(inicial?.modoBrecha ?? "categoria");
  const [comparar, setComparar] = useState(false);
  const [vistaComp, setVistaComp] = useState<ViewState | null>(null);
  const snapshotComp = useRef<{ verDemandas: boolean; verMacro: Record<string, boolean> } | null>(null);
  const espejoRef = useRef<MapRef>(null);
  const corteComparaRef = useRef(50);
  const [capturando, setCapturando] = useState(false);
  const [menuExportar, setMenuExportar] = useState(false);
  const [contactosWa, setContactosWa] = useState<Array<{ nombre: string; telefono: string }>>([]);
  const [menuCtx, setMenuCtx] = useState<{ x: number; y: number; lat: number; lon: number } | null>(null);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const [altaRapida, setAltaRapida] = useState<{ lat: number; lon: number } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cotejo, setCotejo] = useState<CotejoActivo | null>(null);
  const [vinculando, setVinculando] = useState(false);
  const [balance, setBalance] = useState<{ pend: number; sinAt: number; m2: number } | null>(null);
  const [zonaA, setZonaA] = useState<{ centro: { lon: number; lat: number }; radio: number } | null>(null);
  const clienteQuery = useQueryClient();
  const vistaRef = useRef(vista);
  vistaRef.current = vista;

  const avisoTimerRef = useRef<number | null>(null);
  const avisar = (texto: string) => {
    if (avisoTimerRef.current) window.clearTimeout(avisoTimerRef.current);
    setAviso(texto);
    avisoTimerRef.current = window.setTimeout(() => setAviso(null), 3500);
  };
  useEffect(() => {
    return () => {
      if (avisoTimerRef.current) window.clearTimeout(avisoTimerRef.current);
    };
  }, []);
  const [dias, setDias] = useState<number | null>(inicial?.dias ?? null); // null = todo
  const [verZonas, setVerZonas] = useState(false);
  // Resultado del buscador en lenguaje natural: puntos marcados con anillo
  const [resaltado, setResaltado] = useState<{
    fc: FeatureCollection<Point, Record<string, unknown>>;
    frase: string;
  } | null>(null);
  /**
   * NIVEL DE DETALLE — "limpiá de la manera más sencilla los índices y los
   * números". Tres escalones, no un interruptor:
   *   completo → todo lo que el mapa sabe dibujar (los 6 KPIs y las cifras
   *              flotantes de deuda por zona, que son el mayor ruido);
   *   esencial → el valor inicial: dos KPIs elegidos por la vista, sin cifras
   *              flotantes, con el balance y la leyenda del semáforo puestos;
   *   limpio   → el viejo "Despejar": el mapa y nada más.
   * `despejado` deriva de acá para no duplicar la mecánica: el botón del ojo y
   * el chip "Mostrar paneles" mueven este estado, y todo el render que ya
   * miraba `despejado` sigue funcionando igual.
   */
  const [detalle, setDetalle] = useState<Detalle>("esencial");
  const despejado = detalle === "limpio";
  /** A qué escalón volver al salir de "limpio" (el ojo es un ida y vuelta). */
  const detalleAntesDeLimpiar = useRef<Detalle>("esencial");
  /**
   * "Limpio" NO se persiste, ni al leer ni al escribir: despejar siempre fue
   * un gesto efímero ("sacame todo un segundo para mirar el mapa") y guardarlo
   * hacía que al día siguiente el mapa abriera vacío, sin paneles y sin ninguna
   * pista de por qué. Se guarda el último nivel REAL — el mismo al que vuelve
   * el ojo —, así que salir despejado y volver mañana abre donde se estaba.
   */
  useEffect(() => {
    try {
      const v = localStorage.getItem("cimba:mapa-detalle");
      if (v === "completo" || v === "esencial") {
        setDetalle(v);
        detalleAntesDeLimpiar.current = v;
      }
    } catch {
      // sin localStorage: queda "esencial", que es el valor inicial
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("cimba:mapa-detalle", detalle === "limpio" ? detalleAntesDeLimpiar.current : detalle);
    } catch {
      // sin persistencia no se pierde nada más que la preferencia
    }
  }, [detalle]);
  const cambiarDetalle = (v: Detalle) => {
    if (v !== "limpio") detalleAntesDeLimpiar.current = v;
    setDetalle(v);
  };
  const alternarDespejado = () => {
    if (despejado) {
      setDetalle(detalleAntesDeLimpiar.current);
      return;
    }
    detalleAntesDeLimpiar.current = detalle;
    setDetalle("limpio");
  };
  // Paneles reubicables: el usuario los arrastra de su cabecera y quedan ahí
  const arrCapas = usePanelArrastrable("capas");
  const arrZonas = usePanelArrastrable("zonas");
  const arrInforme = usePanelArrastrable("informe");
  const arrAnalisis = usePanelArrastrable("analisis");
  const arrHerr = usePanelArrastrable("herramientas");
  // La barra de herramientas envuelve en 1, 2 o 3 líneas según el ancho de
  // pantalla; los KPI se acomodan debajo midiendo su alto real en vez de
  // adivinar un offset fijo que se rompería en algún tamaño intermedio.
  const herrRef = useRef<HTMLDivElement>(null);
  const [altoHerr, setAltoHerr] = useState(0);
  useEffect(() => {
    const el = herrRef.current;
    if (!el) return;
    const medir = () => setAltoHerr(el.offsetHeight);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const panelesMovidos = [arrCapas, arrZonas, arrInforme, arrAnalisis, arrHerr].some((p) => p.movido);
  const reubicarTodos = () => {
    for (const p of [arrCapas, arrZonas, arrInforme, arrAnalisis, arrHerr]) p.reubicar();
  };

  /** Cambiar de vista ajusta incidentes y pedidos, nada más: las capas
   *  transversales (densidad de demanda, 3D, satélite, límites) son del
   *  usuario y sobreviven al cambio, como cualquier toggle del panel. */
  const aplicarVista = (v: Vista) => {
    setVista(v);
    setVerMacro({ ...VISTAS[v].macro });
    setSoloDemandasAbiertas(VISTAS[v].demandasAbiertas);
    setVerDemandas(VISTAS[v].verDemandas);
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
  const dataRef = useRef<GeoDatos | undefined>(undefined);
  dataRef.current = data;
  const puedeVincular = rol === "admin" || rol === "atencion_ciudadana";
  const puedeCargar = ["admin", "atencion_ciudadana", "informacion_estrategica", "planificacion"].includes(rol);

  // Fuentes presentes en los datos (chips dinámicos)
  const fuentesPresentes = useMemo(() => {
    const s = new Set<string>();
    for (const f of data?.demandas.features ?? []) s.add(String(f.properties.fuente));
    return [...s].sort();
  }, [data]);

  // ?fuente=hcd aísla esa fuente apenas conocemos el universo
  useEffect(() => {
    if (!inicial?.fuente || fuentesPresentes.length === 0) return;
    if (!fuentesPresentes.includes(inicial.fuente)) return;
    setFuentes(Object.fromEntries(fuentesPresentes.map((f) => [f, f === inicial.fuente])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fuentesPresentes.length]);

  const corte = dias ? Date.now() - dias * 86_400_000 : null;

  /**
   * Buscador en lenguaje natural que ACCIONA sobre el mapa: interpreta la
   * frase (IA), marca con anillo las coincidencias, encuadra el mapa y ajusta
   * las capas. Si no hay datos que coincidan, geocodifica el lugar y abre el
   * análisis de zona ahí.
   */
  const buscarEnMapa = async (frase: string): Promise<string> => {
    const { interpretacion: inter } = await interpretarBusquedaMapa(frase);
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const lugar = inter.lugar ? norm(inter.lugar) : null;
    const capa = inter.brecha ? "pedidos" : (inter.capa ?? "todo");

    const coincide = (f: { properties: Record<string, unknown> }, esDemanda: boolean) => {
      if (lugar && !norm(String(f.properties.direccion ?? "")).includes(lugar)) return false;
      if (inter.tipo && String(f.properties.tipo) !== inter.tipo) return false;
      if (inter.brecha && esDemanda && String(f.properties.brecha) !== inter.brecha) return false;
      return true;
    };
    const dems = capa !== "trabajos" ? (data?.demandas.features ?? []).filter((f) => coincide(f, true)) : [];
    const incs = capa !== "pedidos" ? (data?.incidentes.features ?? []).filter((f) => coincide(f, false)) : [];
    const todas = [...dems, ...incs];

    // Ajustar las capas para que lo marcado se vea
    if (inter.brecha) {
      aplicarVista("brecha");
      setFiltroBrecha(inter.brecha);
    }
    if (inter.tipo) {
      const t = inter.tipo;
      setTipos(Object.fromEntries(Object.keys(ETIQUETA_TIPO).map((k) => [k, k === t])));
    }
    if (dems.length > 0) {
      setVerDemandas(true);
      // Lo encontrado puede caer en otra cola (agua, ripio): sin prender ese
      // chip el buscador marcaría con anillo puntos que el filtro esconde.
      const presentes = [...new Set(dems.map((f) => destinoDe(f.properties.destino)))];
      setDestinos((v) => ({ ...v, ...Object.fromEntries(presentes.map((d) => [d, true])) }));
    }

    if (todas.length > 0) {
      setResaltado({ fc: { type: "FeatureCollection", features: todas }, frase });
      let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
      for (const f of todas) {
        const [lon, lat] = f.geometry.coordinates;
        if (lon == null || lat == null) continue;
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      }
      const mapa = mapRef.current?.getMap();
      if (mapa) {
        if (maxLon - minLon < 1e-6 && maxLat - minLat < 1e-6) {
          mapa.flyTo({ center: [minLon, minLat], zoom: 16.5, duration: 1100 });
        } else {
          mapa.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 90, maxZoom: 16.5, duration: 1100 });
        }
      }
      const partes = [
        dems.length > 0 ? `${numero(dems.length)} pedido${dems.length === 1 ? "" : "s"}` : null,
        incs.length > 0 ? `${numero(incs.length)} incidente${incs.length === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
      return `Marqué con anillo amarillo ${partes.join(" y ")}${inter.lugar ? ` en “${inter.lugar}”` : ""}${inter.tipo ? ` (${ETIQUETA_TIPO[inter.tipo] ?? inter.tipo})` : ""}. Tocá la ✕ para despejar.`;
    }

    // Nada cargado coincide: volar al lugar y abrir el análisis de zona ahí
    if (inter.lugar) {
      try {
        const res = await fetch(`/api/geocodificar?q=${encodeURIComponent(`${inter.lugar}, San Miguel de Tucumán`)}`);
        const j = (await res.json()) as { resultado: { punto: { lat: number; lon: number } } | null };
        const p = j.resultado?.punto;
        if (p) {
          mapRef.current?.getMap()?.flyTo({ center: [p.lon, p.lat], zoom: 15.8, duration: 1200 });
          setZona({ lon: p.lon, lat: p.lat });
          setRadioZona(400);
          return `No hay direcciones cargadas que digan “${inter.lugar}”, así que te llevé a la zona y abrí el análisis de 400 m alrededor.`;
        }
      } catch {
        // el mensaje de abajo cubre este caso
      }
    }
    return "No encontré nada con esa búsqueda. Probá con el nombre de la calle: “baches en Belgrano”, “qué se arregló en Mate de Luna”.";
  };

  // Migue acciona el mapa: si el chat pide "mostrame X", dispara este evento
  // (misma pantalla) o navega a /mapa?buscar= (otra pantalla) y la frase corre
  // por el MISMO camino que el buscador inteligente: marca, vuela y filtra.
  const buscarEnMapaRef = useRef(buscarEnMapa);
  buscarEnMapaRef.current = buscarEnMapa;
  const avisarRef = useRef(avisar);
  avisarRef.current = avisar;
  useEffect(() => {
    const alAccionar = (e: Event) => {
      const frase = (e as CustomEvent<string>).detail;
      if (typeof frase === "string" && frase.trim())
        void buscarEnMapaRef.current(frase).then((m) => avisarRef.current(m));
    };
    window.addEventListener("cimba:accionar-mapa", alAccionar);
    return () => window.removeEventListener("cimba:accionar-mapa", alAccionar);
  }, []);
  const buscoInicialRef = useRef(false);
  useEffect(() => {
    if (!inicial?.buscar || buscoInicialRef.current || !data) return;
    buscoInicialRef.current = true;
    void buscarEnMapaRef.current(inicial.buscar).then((m) => avisarRef.current(m));
  }, [data, inicial?.buscar]);

  // Meses disponibles para la línea de tiempo (solo fechas confiables)
  const mesesTiempo = useMemo(() => {
    const set = new Set<string>();
    for (const f of data?.demandas.features ?? []) {
      if (f.properties.sin_fecha) continue;
      const m = String(f.properties.creado_en).slice(0, 7);
      if (m.length === 7) set.add(m);
    }
    for (const f of data?.incidentes.features ?? []) {
      if (f.properties.cerrado_en) set.add(String(f.properties.cerrado_en).slice(0, 7));
    }
    return [...set].sort();
  }, [data]);
  const finMesCursor = useMemo(() => {
    if (!tiempoActivo || mesesTiempo.length === 0) return null;
    const mes = mesesTiempo[Math.min(tiempoIdx, mesesTiempo.length - 1)];
    if (!mes) return null;
    const [a, m] = mes.split("-").map(Number);
    return Date.UTC(a ?? 2026, m ?? 1, 0, 23, 59, 59); // último día del mes
  }, [tiempoActivo, tiempoIdx, mesesTiempo]);

  const incidentesFiltrados = useMemo<FC>(() => {
    const features = (data?.incidentes.features ?? []).filter((f) => {
      if (distritoFoco != null && f.properties.distrito !== distritoFoco) return false;
      if (finMesCursor !== null) {
        // Modo película: solo reparaciones ya concretadas a esa fecha
        if (f.properties.macro !== "resuelto") return false;
        if (!f.properties.cerrado_en || Date.parse(String(f.properties.cerrado_en)) > finMesCursor) return false;
        return tipos[String(f.properties.tipo)] !== false;
      }
      if (!verMacro[String(f.properties.macro)]) return false;
      if (tipos[String(f.properties.tipo)] === false) return false;
      if (corte && Date.parse(String(f.properties.detectado_en)) < corte) return false;
      return true;
    });
    return { type: "FeatureCollection", features };
  }, [data, verMacro, tipos, corte, finMesCursor, distritoFoco]);

  /**
   * Los pedidos que pasan todos los filtros de datos MENOS los dos que tienen
   * su propio control visible (destino y brecha). De acá salen las tres cosas
   * que tienen que cerrar entre sí: los puntos del mapa, la cuenta de cada
   * chip de destino y la cuenta de cada categoría de la leyenda de brecha —
   * si cada una filtrara distinto, el usuario vería un número y otro conjunto.
   */
  const demandasBase = useMemo(
    () =>
      (data?.demandas.features ?? []).filter((f) => {
        const fuente = String(f.properties.fuente);
        if (distritoFoco != null && f.properties.distrito !== distritoFoco) return false;
        if (fuentes[fuente] === false) return false;
        if (tipos[String(f.properties.tipo)] === false) return false;
        if (soloDemandasAbiertas && !["recibida", "en_validacion"].includes(String(f.properties.estado)))
          return false;
        if (finMesCursor !== null) {
          if (f.properties.sin_fecha) return false;
          if (Date.parse(String(f.properties.creado_en)) > finMesCursor) return false;
        } else if (corte && Date.parse(String(f.properties.creado_en)) < corte) {
          return false;
        }
        return true;
      }),
    [data, fuentes, tipos, soloDemandasAbiertas, corte, finMesCursor, distritoFoco],
  );

  /** El filtro de brecha solo existe dentro de la vista Brecha. */
  const filtroBrechaActivo = vista === "brecha" ? filtroBrecha : null;

  /** Cuántos pedidos aporta cada destino con los filtros actuales. Sale de los
   *  datos ya cargados: los chips no piden nada al servidor. */
  const cuentasDestino = useMemo(() => {
    const c: Record<Destino, number> = { bacheo: 0, sat: 0, ingenieria: 0 };
    for (const f of demandasBase) {
      if (filtroBrechaActivo && String(f.properties.brecha) !== filtroBrechaActivo) continue;
      c[destinoDe(f.properties.destino)] += 1;
    }
    return c;
  }, [demandasBase, filtroBrechaActivo]);

  const demandasFiltradas = useMemo<FC>(() => {
    const features = demandasBase.filter((f) => {
      if (destinos[destinoDe(f.properties.destino)] !== true) return false;
      if (filtroBrechaActivo && String(f.properties.brecha) !== filtroBrechaActivo) return false;
      return true;
    });
    // edad en días para "la deuda envejece" (-1 = sin fecha confiable).
    // Date.parse del formato Postgres (espacio, no "T") es implementation-
    // defined: Safari puede devolver NaN. Sin guarda, ese NaN llega como
    // null a MapLibre y la capa de antigüedad se pinta con el color/radio
    // por defecto (invisible sobre fondo oscuro) en vez de -1 (gris, honesto).
    const ahora = Date.now();
    const conEdad = features.map((f) => {
      let edadDias = -1;
      if (!f.properties.sin_fecha) {
        const creado = Date.parse(String(f.properties.creado_en).replace(" ", "T"));
        if (Number.isFinite(creado)) edadDias = Math.max(0, Math.round((ahora - creado) / 86400000));
      }
      return { ...f, properties: { ...f.properties, edad_dias: edadDias } };
    });
    return { type: "FeatureCollection", features: conEdad };
  }, [demandasBase, destinos, filtroBrechaActivo]);

  /** Cuántos pedidos pendientes hay en cada categoría de brecha, para la
   *  leyenda de esa vista. Respeta el destino prendido (si no, el chip decía
   *  una cosa y el mapa mostraba otra) y los demás filtros de datos. */
  const cuentasBrecha = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of demandasBase) {
      if (destinos[destinoDe(f.properties.destino)] !== true) continue;
      if (!["recibida", "en_validacion"].includes(String(f.properties.estado))) continue;
      const b = String(f.properties.brecha ?? "");
      c[b] = (c[b] ?? 0) + 1;
    }
    return c;
  }, [demandasBase, destinos]);

  // Memoizados: sin esto, cada render (uno por frame al panear con Comparar
  // activo) recalcula el polígono de la zona entero para nada. La geometría
  // de la zona es el círculo O el polígono cerrado: mismas capas de relleno.
  const geometriaZona = useMemo<Feature<Polygon> | null>(() => {
    if (formaZona === "circulo") return zona ? crearCirculo(zona.lon, zona.lat, radioZona) : null;
    if (zonaCerrada && vertsZona.length >= 3) {
      const primero = vertsZona[0];
      if (!primero) return null;
      return {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[...vertsZona, primero]] },
        properties: {},
      };
    }
    return null;
  }, [formaZona, zona, radioZona, zonaCerrada, vertsZona]);
  const circuloZonaA = useMemo(
    () => (zonaA ? crearCirculo(zonaA.centro.lon, zonaA.centro.lat, zonaA.radio) : null),
    [zonaA],
  );

  // El polígono a medio dibujar: la línea entre vértices y los vértices en sí
  // (el primero, más grande, funciona además como botón de cierre).
  const dibujoPoligono = useMemo<FeatureCollection<LineString | Point, Record<string, unknown>> | null>(() => {
    if (formaZona !== "poligono" || zonaCerrada || vertsZona.length === 0) return null;
    const features: Array<Feature<LineString | Point, Record<string, unknown>>> = vertsZona.map((v, i) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: v },
      properties: { primero: i === 0 },
    }));
    if (vertsZona.length >= 2) {
      features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: vertsZona },
        properties: {},
      });
    }
    return { type: "FeatureCollection", features };
  }, [formaZona, zonaCerrada, vertsZona]);

  /**
   * Versión de los datos para MÉTRICAS (balance, Top 20, cifras de deuda):
   * respeta los filtros de datos reales (tipo/fuente/período) pero, como los
   * KPIs de arriba, IGNORA los interruptores de visibilidad de capa
   * (verMacro/vista) — apagar una capa no hace desaparecer el problema.
   */
  const incidentesParaMetricas = useMemo<FC>(() => {
    const features = (data?.incidentes.features ?? []).filter((f) => {
      if (distritoFoco != null && f.properties.distrito !== distritoFoco) return false;
      if (tipos[String(f.properties.tipo)] === false) return false;
      if (corte && Date.parse(String(f.properties.detectado_en)) < corte) return false;
      return true;
    });
    return { type: "FeatureCollection", features };
  }, [data, tipos, corte, distritoFoco]);

  const demandasParaMetricas = useMemo<FC>(() => {
    const features = (data?.demandas.features ?? []).filter((f) => {
      if (distritoFoco != null && f.properties.distrito !== distritoFoco) return false;
      if (fuentes[String(f.properties.fuente)] === false) return false;
      if (tipos[String(f.properties.tipo)] === false) return false;
      // El DESTINO sí entra acá (a diferencia de la visibilidad de capa):
      // "quién resuelve" es un filtro de datos, como el tipo o el período.
      // Sin esto el balance de abajo y las cifras de deuda por zona seguirían
      // contando el agua y el ripio que los chips acaban de sacar del mapa.
      if (destinos[destinoDe(f.properties.destino)] !== true) return false;
      if (corte && Date.parse(String(f.properties.creado_en)) < corte) return false;
      return true;
    });
    return { type: "FeatureCollection", features };
  }, [data, fuentes, tipos, destinos, corte, distritoFoco]);

  /**
   * Coropletas: pinta cada distrito según qué proporción de sus pedidos
   * abiertos no tiene nada cerca. El cálculo va en el cliente sobre los mismos
   * datos que ya bajó el mapa, así el color respeta los filtros activos
   * (tipo, fuente, período) en vez de mostrar un total que no coincide con lo
   * que se está viendo.
   */
  const distritosConBrecha = useMemo<FCPoligono | null>(() => {
    if (!distritosGeo) return null;
    const abiertas = new Map<number, number>();
    const sinAtencion = new Map<number, number>();
    for (const f of demandasParaMetricas.features) {
      const d = f.properties.distrito;
      if (typeof d !== "number") continue;
      if (!["recibida", "en_validacion"].includes(String(f.properties.estado))) continue;
      abiertas.set(d, (abiertas.get(d) ?? 0) + 1);
      if (f.properties.brecha === "sin_atencion") sinAtencion.set(d, (sinAtencion.get(d) ?? 0) + 1);
    }
    return {
      type: "FeatureCollection",
      features: distritosGeo.features.map((f) => {
        const id = Number(f.properties.id);
        const tot = abiertas.get(id) ?? 0;
        const sin = sinAtencion.get(id) ?? 0;
        return {
          ...f,
          properties: {
            ...f.properties,
            abiertas: tot,
            sin_atencion: sin,
            // -1 = sin pedidos abiertos: no es 0 % de deuda, es "nada que medir".
            pct_brecha: tot > 0 ? Math.round((100 * sin) / tot) : -1,
          },
        };
      }),
    };
  }, [distritosGeo, demandasParaMetricas]);

  /**
   * Reporte imprimible del estado actual: captura el lienzo del mapa (via un
   * repintado, porque el buffer WebGL no se conserva) y arma un documento
   * profesional con la consulta activa, los filtros y el listado preciso.
   */
  const capturarMapa = (): Promise<string | null> =>
    new Promise((resolver) => {
      const mapa = mapRef.current?.getMap();
      if (!mapa) return resolver(null);
      mapa.once("render", () => {
        try {
          resolver(mapa.getCanvas().toDataURL("image/png"));
        } catch {
          resolver(null);
        }
      });
      mapa.triggerRepaint();
    });

  const generarReporte = async () => {
    const imagen = await capturarMapa();
    const enBusqueda = resaltado != null && resaltado.fc.features.length > 0;
    const base = enBusqueda ? resaltado.fc.features : null;
    const dems = (base ? base.filter((f) => f.properties.fuente != null) : verDemandas ? demandasFiltradas.features : []).map(
      (f) => f.properties,
    );
    const incs = (base ? base.filter((f) => f.properties.fuente == null) : incidentesFiltrados.features).map(
      (f) => f.properties,
    );

    const filtros: string[] = [`Vista: ${VISTAS[vista].etiqueta}`];
    const tiposActivos = Object.keys(ETIQUETA_TIPO).filter((t) => tipos[t] !== false);
    if (tiposActivos.length < Object.keys(ETIQUETA_TIPO).length) {
      filtros.push(`Tipo: ${tiposActivos.map((t) => ETIQUETA_TIPO[t as keyof typeof ETIQUETA_TIPO]).join(", ")}`);
    }
    const fuentesApagadas = Object.entries(fuentes).filter(([, v]) => v === false).length;
    if (fuentesApagadas > 0) {
      const activas = fuentesPresentes.filter((f) => fuentes[f] !== false);
      filtros.push(`Fuente: ${activas.map((f) => ETIQUETA_FUENTE[f as keyof typeof ETIQUETA_FUENTE] ?? f).join(", ")}`);
    }
    if (soloDemandasAbiertas && verDemandas) filtros.push("Solo pedidos pendientes");
    const destinosActivos = DESTINOS.filter((d) => destinos[d] === true);
    if (destinosActivos.length < DESTINOS.length) {
      filtros.push(`Resuelve: ${destinosActivos.map((d) => ETIQUETA_DESTINO[d]).join(", ") || "nada"}`);
    }
    if (vista === "brecha" && filtroBrecha) filtros.push(`Brecha: ${filtroBrecha.replaceAll("_", " ")}`);
    if (dias) filtros.push(`Período: últimos ${dias} días`);

    const ok = abrirReporte({
      imagen,
      consulta: enBusqueda ? resaltado.frase : null,
      filtros,
      demandas: dems,
      incidentes: incs,
      generadoPor: rol.replaceAll("_", " "),
    });
    if (!ok) window.alert("El navegador bloqueó la pestaña del reporte: permití las ventanas emergentes para CIMBA.");
  };

  /**
   * Exporta lo visible como GeoJSON (abre directo en QGIS) — si hay una
   * búsqueda activa exporta esos resultados; si no, lo que muestran los
   * filtros. Cada feature lleva `capa: "pedido" | "incidente"`.
   */
  const exportarGeoJson = () => {
    const enBusqueda = resaltado != null && resaltado.fc.features.length > 0;
    const dems = enBusqueda
      ? resaltado.fc.features.filter((f) => f.properties.fuente != null)
      : verDemandas
        ? demandasFiltradas.features
        : [];
    const incs = enBusqueda
      ? resaltado.fc.features.filter((f) => f.properties.fuente == null)
      : incidentesFiltrados.features;
    const fc = {
      type: "FeatureCollection",
      features: [
        ...dems.map((f) => ({ ...f, properties: { capa: "pedido", ...f.properties } })),
        ...incs.map((f) => ({ ...f, properties: { capa: "incidente", ...f.properties } })),
      ],
    };
    const blob = new Blob([JSON.stringify(fc)], { type: "application/geo+json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cimba-mapa-${new Date().toISOString().slice(0, 10)}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /**
   * Link que reproduce la cámara, la vista y los filtros principales — no
   * cada micro-ajuste (selección múltiple de tipo/fuente, "solo pendientes"
   * tocado a mano). Usa clat/clon/cz (cámara) en vez de lat/lon/z: esos
   * quedan reservados para "centrame en este punto" (que además pone un
   * marcador que un link de vista no debería mostrar).
   */
  const construirLinkVista = (): string => {
    const p = new URLSearchParams();
    const mapa = mapRef.current?.getMap();
    if (mapa) {
      const c = mapa.getCenter();
      p.set("clat", c.lat.toFixed(6));
      p.set("clon", c.lng.toFixed(6));
      p.set("cz", mapa.getZoom().toFixed(2));
    }
    // La URL viaja con la clave vieja (hoy→operativo, historial→historico):
    // la page valida ?vista= contra la lista histórica, así el mismo link
    // funciona hoy y seguirá funcionando cuando la page acepte las nuevas.
    p.set("vista", vista === "hoy" ? "operativo" : vista === "historial" ? "historico" : vista);
    if (vista === "brecha" && filtroBrecha) p.set("brecha", filtroBrecha);
    if (vista === "brecha" && modoBrecha === "antiguedad") p.set("modoBrecha", "antiguedad");
    const tiposActivos = Object.keys(ETIQUETA_TIPO).filter((t) => tipos[t] !== false);
    if (tiposActivos.length === 1 && tiposActivos[0]) p.set("tipo", tiposActivos[0]);
    // El destino viaja como LISTA: emitirlo solo cuando quedaba UNO prendido
    // hacía que "bacheo + SAT" llegara al otro lado como el default (solo
    // bacheo) y el link mostrara menos pedidos que la pantalla que lo generó.
    // Con las tres colas prendidas se abrevia "todos". Ninguna prendida no se
    // emite: no hay valor que signifique "nada" y el mapa abriría en blanco.
    const destinosActivos = DESTINOS.filter((d) => destinos[d] === true);
    if (destinosActivos.length === DESTINOS.length) p.set("destino", "todos");
    else if (destinosActivos.length > 0) p.set("destino", destinosActivos.join(","));
    const fuentesActivas = fuentesPresentes.filter((fu) => fuentes[fu] !== false);
    if (fuentesActivas.length === 1 && fuentesActivas[0] && fuentesPresentes.length > 1) p.set("fuente", fuentesActivas[0]);
    if (dias) p.set("dias", String(dias));
    // La densidad de demanda arranca apagada en toda vista, pero un link con
    // vista=analisis (legado) la prendería solo: 0/1 explícito evita dudas.
    p.set("calor", verCalor ? "1" : "0");
    if (verHex) p.set("hex", "1");
    if (verSatelite) p.set("sat", "1");
    if (verTop20) p.set("top", "1");
    if (distritoFoco != null) p.set("distrito", String(distritoFoco));
    if (zona) {
      p.set("zlat", zona.lat.toFixed(6));
      p.set("zlon", zona.lon.toFixed(6));
      p.set("zr", String(radioZona));
    }
    return `${window.location.origin}/mapa?${p.toString()}`;
  };

  const copiarLinkVista = async () => {
    const link = construirLinkVista();
    try {
      await navigator.clipboard.writeText(link);
      avisar("Link de esta vista copiado ✓ — quien lo abra ve la misma cámara y vista");
    } catch {
      // Fallback clásico para contextos sin permiso de portapapeles
      const ta = document.createElement("textarea");
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      avisar(ok ? "Link de esta vista copiado ✓" : "No se pudo copiar al portapapeles");
    }
    setMenuExportar(false);
  };

  const enviarPorWhatsApp = (telefono: string, nombre: string) => {
    const texto = `Mirá esta vista del mapa de CIMBA (cámara y filtros principales): ${construirLinkVista()}`;
    window.open(`https://wa.me/${telefono}?text=${encodeURIComponent(texto)}`, "_blank");
    avisar(`Abriendo WhatsApp para ${nombre}…`);
    setMenuExportar(false);
  };

  /** Cortina «Lo pedido | Lo hecho»: el mapa principal pasa a mostrar lo hecho. */
  const alternarComparar = () => {
    const activo = !comparar;
    const mapa = mapRef.current?.getMap();
    if (activo && mapa) {
      const c = mapa.getCenter();
      setVistaComp({
        longitude: c.lng,
        latitude: c.lat,
        zoom: mapa.getZoom(),
        bearing: mapa.getBearing(),
        pitch: mapa.getPitch(),
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
      });
      snapshotComp.current = { verDemandas, verMacro: { ...verMacro } };
      setVerDemandas(false);
      setVerMacro({ abierto: false, en_curso: true, resuelto: true, inactivo: false });
      setCotejo(null);
      setSeleccion(null);
      avisar("Izquierda: lo pedido (reclamos abiertos). Derecha: lo hecho (reparado o en obra). Arrastrá la línea amarilla — y podés capturarlo como imagen.");
    } else if (!activo && snapshotComp.current) {
      setVerDemandas(snapshotComp.current.verDemandas);
      setVerMacro(snapshotComp.current.verMacro);
    }
    setComparar(activo);
  };

  /**
   * Captura la comparación completa (mapa espejo + principal + divisor +
   * etiquetas) como UNA imagen: compone ambos canvases en uno según dónde
   * esté la cortina en este momento, con la línea y los rótulos dibujados.
   */
  const capturarComparacion = async () => {
    const mapaPrincipal = mapRef.current?.getMap();
    const mapaEspejo = espejoRef.current?.getMap();
    if (!mapaPrincipal || !mapaEspejo) return;
    setCapturando(true);
    try {
      await Promise.all(
        [mapaPrincipal, mapaEspejo].map(
          (m) =>
            new Promise<void>((resolver) => {
              m.once("render", () => resolver());
              m.triggerRepaint();
            }),
        ),
      );
      const canvasP = mapaPrincipal.getCanvas();
      const canvasE = mapaEspejo.getCanvas();
      const ancho = canvasP.width;
      const alto = canvasP.height;
      const salida = document.createElement("canvas");
      salida.width = ancho;
      salida.height = alto;
      const ctx = salida.getContext("2d");
      if (!ctx) return;
      const corteX = Math.round((ancho * corteComparaRef.current) / 100);
      ctx.drawImage(canvasE, 0, 0, canvasE.width, canvasE.height, 0, 0, corteX, alto);
      ctx.drawImage(canvasP, 0, 0, canvasP.width, canvasP.height, corteX, 0, ancho - corteX, alto);
      // línea divisoria amarilla, igual que en pantalla
      ctx.fillStyle = "#f4dc00";
      ctx.fillRect(corteX - 2, 0, 4, alto);
      // rótulos con la misma paleta de la cortina
      const esc = ancho / (canvasP.clientWidth || ancho);
      const chip = (texto: string, x: number, alinear: "left" | "right", color: string) => {
        ctx.font = `bold ${13 * esc}px sans-serif`;
        const anchoTexto = ctx.measureText(texto).width;
        const padX = 10 * esc;
        const px = alinear === "left" ? x : x - anchoTexto - padX * 2;
        ctx.fillStyle = color;
        ctx.fillRect(px, 14 * esc, anchoTexto + padX * 2, 26 * esc);
        ctx.fillStyle = "#ffffff";
        ctx.textBaseline = "middle";
        ctx.fillText(texto, px + padX, 14 * esc + 13 * esc);
      };
      chip("LO PEDIDO", 14 * esc, "left", "#3987e5");
      chip("LO HECHO", ancho - 14 * esc, "right", "#199e70");
      // marca y fecha, discretas, abajo a la derecha (tinta según el fondo del mapa)
      ctx.font = `${11 * esc}px sans-serif`;
      ctx.fillStyle = pal.oscuro ? "rgba(255,255,255,0.85)" : "rgba(22,28,38,0.85)";
      ctx.textAlign = "right";
      ctx.fillText(`CIMBA · ${new Date().toLocaleDateString("es-AR")}`, ancho - 12 * esc, alto - 12 * esc);

      const url = salida.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `cimba-comparacion-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
      avisar("Comparación capturada ✓ — se descargó como imagen");
    } catch {
      avisar("No se pudo capturar la comparación: probá de nuevo.");
    } finally {
      setCapturando(false);
    }
  };

  const vincularDesdeMapa = (demandaId: number, incidenteId: number) => {
    setVinculando(true);
    // Sin confianza fabricada: la puso una persona mirando el mapa, no un
    // cálculo — dejar el campo vacío mantiene auditable qué vínculo fue cuál.
    void vincularDemanda({ demandaId, incidenteId })
      .then(() => {
        avisar(`Pedido #${demandaId} vinculado al incidente #${incidenteId} ✓ — sale de la deuda`);
        setCotejo(null);
        void clienteQuery.invalidateQueries({ queryKey: ["geodata"] });
      })
      .catch(() => avisar("No se pudo vincular: probá de nuevo."))
      .finally(() => setVinculando(false));
  };

  /** Balance vivo de lo que se está viendo: recalcula al mover el mapa. */
  const recalcularBalance = useCallback(() => {
    const mapa = mapRef.current?.getMap();
    if (!mapa) return;
    const b = mapa.getBounds();
    const dentro = (f: { geometry: { coordinates: number[] } }) => {
      const ln = f.geometry.coordinates[0];
      const la = f.geometry.coordinates[1];
      if (ln == null || la == null) return false;
      return ln >= b.getWest() && ln <= b.getEast() && la >= b.getSouth() && la <= b.getNorth();
    };
    const dems = demandasParaMetricas.features.filter(dentro);
    const pend = dems.filter((f) => ["recibida", "en_validacion"].includes(String(f.properties.estado))).length;
    const sinAt = dems.filter((f) => f.properties.brecha === "sin_atencion").length;
    const m2 = incidentesParaMetricas.features
      .filter((f) => dentro(f) && f.properties.macro === "resuelto")
      .reduce((acc, f) => acc + (Number(f.properties.m2) || 0), 0);
    setBalance({ pend, sinAt, m2: Math.round(m2) });
  }, [demandasParaMetricas, incidentesParaMetricas]);

  useEffect(() => {
    recalcularBalance();
  }, [recalcularBalance]);

  // Top 20 urgentes numerados sobre el territorio (independiente de qué
  // capas estén prendidas: si no, en vista Brecha nunca mostraría nada).
  const top20 = useMemo<FC | null>(() => {
    if (!verTop20) return null;
    const urgentes = incidentesParaMetricas.features
      .filter((f) => f.properties.score != null && (f.properties.macro === "abierto" || f.properties.macro === "en_curso"))
      .sort((a, b) => Number(b.properties.score) - Number(a.properties.score))
      .slice(0, 20)
      .map((f, i) => ({ ...f, properties: { ...f.properties, rank: i + 1 } }));
    return { type: "FeatureCollection", features: urgentes };
  }, [verTop20, incidentesParaMetricas]);

  // Cifras de deuda por zona: aparecen solas al alejar el zoom
  const cifrasZona = useMemo<FC>(() => {
    const celdas = new Map<string, { lon: number; lat: number; n: number }>();
    for (const f of demandasParaMetricas.features) {
      if (f.properties.brecha !== "sin_atencion") continue;
      const ln = f.geometry.coordinates[0];
      const la = f.geometry.coordinates[1];
      if (ln == null || la == null) continue;
      const k = `${Math.round(ln / 0.02)}|${Math.round(la / 0.018)}`;
      const c = celdas.get(k) ?? { lon: 0, lat: 0, n: 0 };
      c.lon += ln;
      c.lat += la;
      c.n += 1;
      celdas.set(k, c);
    }
    const features = [...celdas.values()]
      .filter((c) => c.n >= 15)
      .map((c) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [c.lon / c.n, c.lat / c.n] as [number, number] },
        properties: { n: c.n } as Record<string, unknown>,
      }));
    return { type: "FeatureCollection", features };
  }, [demandasParaMetricas]);

  // Hilos del cotejo activo: demanda → candidatos a ≤60 m
  const hilosCotejo = useMemo(() => {
    if (!cotejo || cotejo.candidatos.length === 0) return null;
    return {
      type: "FeatureCollection" as const,
      features: cotejo.candidatos.map((c) => ({
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: [cotejo.lngLat, c.lngLat] },
        properties: {} as Record<string, unknown>,
      })),
    };
  }, [cotejo]);

  // Hexágonos 3D sobre las demandas visibles
  const hexData = useMemo(
    () => (verHex ? hexbins(demandasFiltradas.features, 140) : null),
    [verHex, demandasFiltradas],
  );

  // Cámara inclinada cuando la densidad 3D está activa
  useEffect(() => {
    const mapa = mapRef.current;
    if (!mapa) return;
    mapa.easeTo({ pitch: verHex ? 55 : 0, duration: 700 });
  }, [verHex]);

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
      // Sobre el MISMO conjunto que "Demandas" (ver AYUDA_KPI.sinAtencion): las
      // dos cifras de "Esencial" se leen juntas, así que tienen que medir el
      // mismo universo o la de abajo puede superar a la de arriba.
      sinAtencion: demandasFiltradas.features.filter((f) => f.properties.brecha === "sin_atencion").length,
      abiertos: inc.filter((f) => f.properties.macro === "abierto").length,
      enCurso: inc.filter((f) => f.properties.macro === "en_curso").length,
      resueltos: inc.filter((f) => f.properties.macro === "resuelto").length,
      m2: kpisIniciales.m2Intervenidos,
    };
  }, [data, tipos, corte, demandasFiltradas, kpisIniciales]);

  /** Qué cifras de la fila de arriba sobreviven al nivel de detalle. */
  const verKpi = (clave: string) => detalle === "completo" || KPIS_ESENCIALES[vista].includes(clave);

  /**
   * Callejero legible al hacer zoom, para poder ubicar cualquier dirección y no
   * solo las avenidas. El estilo dark-matter de CARTO es deliberadamente
   * minimalista: rellena las calles menores recién en zoom 15, oculta sus
   * nombres hasta zoom 16 y pinta calles de servicio en #0b0b0b (invisible).
   * Acá se adelantan esos zooms y se sube el contraste, sin tocar el estilo
   * remoto: se ajustan las capas ya presentes cuando el estilo termina de cargar.
   */
  useEffect(() => {
    const oscuro = tema === "oscuro";
    // Colores por tema: sobre dark-matter hay que ACLARAR texto y trazas;
    // sobre positron el texto se oscurece y las trazas se dejan como vienen
    // (el estilo claro ya trae calles legibles — pisarlas con los grises del
    // oscuro las volvería barro). Los zooms adelantados valen en ambos.
    const NOMBRES = oscuro
      ? [
          { id: "roadname_minor", minzoom: 14.5, size: 10.5, color: "#b9c6d8" },
          { id: "roadname_sec", minzoom: 13.5, size: 11, color: "#c8d4e4" },
          { id: "roadname_pri", minzoom: 12.5, size: 11.5, color: "#d6e0ee" },
          { id: "roadname_major", minzoom: 11.5, size: 12, color: "#e2eaf5" },
        ]
      : [
          { id: "roadname_minor", minzoom: 14.5, size: 10.5, color: "#5b6b7d" },
          { id: "roadname_sec", minzoom: 13.5, size: 11, color: "#4d5c6e" },
          { id: "roadname_pri", minzoom: 12.5, size: 11.5, color: "#41505f" },
          { id: "roadname_major", minzoom: 11.5, size: 12, color: "#36434f" },
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
      if (!mapa) return false;
      // OJO: isStyleLoaded() da false mientras quede UNA tesela pendiente
      // (el raster satelital tarda): alcanza con que el estilo esté parseado
      // y sus capas existan para poder pintarlas.
      let capas = 0;
      try {
        capas = mapa.getStyle()?.layers?.length ?? 0;
      } catch {
        capas = 0;
      }
      if (capas === 0) return false;
      if (!mapa.getLayer("roadname_minor")) setHayAnclaEtiquetas(false);

      for (const c of NOMBRES) {
        if (!mapa.getLayer(c.id)) continue;
        mapa.setLayoutProperty(c.id, "visibility", verCalles ? "visible" : "none");
        if (!verCalles) continue;
        mapa.setLayerZoomRange(c.id, c.minzoom, 24);
        mapa.setLayoutProperty(c.id, "text-size", c.size);
        mapa.setPaintProperty(c.id, "text-color", c.color);
        mapa.setPaintProperty(c.id, "text-halo-color", oscuro ? "#070a10" : "#ffffff");
        mapa.setPaintProperty(c.id, "text-halo-width", 1.7);
      }

      // Las trazas se realzan siempre: el toggle es solo de nombres.
      for (const c of TRAZAS) {
        if (!mapa.getLayer(c.id)) continue;
        mapa.setLayerZoomRange(c.id, c.minzoom, 24);
        if (oscuro) mapa.setPaintProperty(c.id, "line-color", c.color);
      }
      return true;
    };

    // SIEMPRE engancharse a styledata (no solo cuando el primer intento
    // falla): el toggle de tema dispara un setStyle que borra estos ajustes,
    // y sin el listener el realce moriría tras el primer cambio de estilo.
    // aplicar() es idempotente (setPaintProperty con el mismo valor no
    // re-emite styledata), así que no hay bucle.
    aplicar();
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
  }, [verCalles, tema]);
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

  // La zona activa del analizador, en un solo valor para el panel: círculo
  // con centro, o polígono (aunque esté a medio dibujar, para que el panel
  // muestre las instrucciones y el conteo de vértices en vivo).
  const zonaActiva = useMemo<ZonaActiva | null>(() => {
    if (formaZona === "circulo") return zona ? { forma: "circulo", centro: zona, radio: radioZona } : null;
    if (modoAnalisis || zonaCerrada || vertsZona.length > 0)
      return { forma: "poligono", vertices: vertsZona, cerrado: zonaCerrada };
    return null;
  }, [formaZona, zona, radioZona, modoAnalisis, zonaCerrada, vertsZona]);

  const cambiarFormaZona = (f: "circulo" | "poligono") => {
    if (f === formaZona) return;
    setFormaZona(f);
    setVertsZona([]);
    setZonaCerrada(false);
    setZonaA(null);
    setModoAnalisis(true);
    if (f === "poligono") {
      setZona(null); // el mapa queda en modo dibujo: clic a clic
    } else {
      // Que el panel no desaparezca al volver: un círculo cómodo en el centro
      // actual, listo para arrastrar otro donde haga falta.
      const c = mapRef.current?.getMap()?.getCenter();
      if (c) setZona({ lon: c.lng, lat: c.lat });
      setRadioZona(250);
    }
  };

  const cerrarAnalisis = () => {
    setZona(null);
    setZonaA(null);
    setModoAnalisis(false);
    setVertsZona([]);
    setZonaCerrada(false);
    setFormaZona("circulo");
  };

  const alClick = useCallback((e: MapLayerMouseEvent) => {
    if (modoAnalisisRef.current) {
      if (formaZonaRef.current === "poligono") {
        // Dibujo clic a clic. Un clic con el polígono ya cerrado arranca uno
        // nuevo; si no, agrega vértice — y sobre el PRIMER vértice, cierra.
        const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (zonaCerradaRef.current) {
          setVertsZona([pt]);
          setZonaCerrada(false);
          return;
        }
        const verts = vertsZonaRef.current;
        const primero = verts[0];
        if (verts.length >= 3 && primero) {
          const px = mapRef.current?.getMap()?.project({ lng: primero[0], lat: primero[1] });
          if (px && Math.hypot(px.x - e.point.x, px.y - e.point.y) <= 12) {
            setZonaCerrada(true);
            return;
          }
        }
        // El doble clic dispara antes dos clics en el mismo punto: el segundo
        // se descarta acá para no duplicar el vértice.
        const ultimo = verts[verts.length - 1];
        if (ultimo && distanciaM(ultimo[0], ultimo[1], pt[0], pt[1]) < 1) return;
        setVertsZona([...verts, pt]);
        return;
      }
      // círculo: el centro lo fija onMouseDown; acá solo evitamos abrir el detalle
      return;
    }
    // Las líneas de colectivos y los barrios son solo informativos (tooltip):
    // un clic sobre ellos no debe abrir ni cerrar nada — se busca el siguiente
    // feature útil.
    const feature = e.features?.find(
      (f) => f.layer.id !== "colectivos-linea" && f.layer.id !== "barrios-relleno" && f.layer.id !== "bacheo-integral-relleno",
    );
    if (!feature) {
      setSeleccion(null);
      setCotejo(null);
      setCircuitoSel(null);
      setSectorSel(null);
      return;
    }
    // El relleno del circuito cubre todo el polígono, pero los puntos se
    // dibujan encima y llegan primero en e.features: este branch solo entra
    // clickeando "campo abierto" adentro de un circuito.
    if (feature.layer.id === "circuitos-empresa-relleno") {
      setSeleccion(null);
      setCotejo(null);
      setSectorSel(null);
      setCircuitoSel(feature.properties ?? {});
      return;
    }
    // Sector de licitación (hormigón o cuadrante): popup con empresa(s) y
    // licitación. El cuadrante entra por su relleno transparente.
    if (feature.layer.id === "sectores-hormigon-relleno" || feature.layer.id === "sectores-cuadrante-relleno") {
      setSeleccion(null);
      setCotejo(null);
      setCircuitoSel(null);
      setSectorSel(feature.properties ?? {});
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
    setCircuitoSel(null);
    setSectorSel(null);
    if (feature.layer.id === "incidentes-punto") {
      setSeleccion({ capa: "incidente", props: feature.properties ?? {}, lngLat });
    } else if (feature.layer.id === "demandas-punto") {
      const props = feature.properties ?? {};
      const brechaProp = String(props.brecha ?? "");
      // Los cuatro pasos del semáforo abren el cotejo: 'en_obra' (la cuadrilla
      // ya está en la calle a menos de 40 m) es justo el caso donde más
      // conviene vincular el pedido al trabajo que lo está resolviendo.
      if (
        vistaRef.current === "brecha" &&
        ["sin_atencion", "en_cola", "en_obra", "posible_resuelta"].includes(brechaProp)
      ) {
        // Cotejo desde el mapa: hilos hacia lo que hay a menos de 60 m.
        // Se excluyen los desestimados (macro inactivo): la gestión decidió
        // no atenderlos, vincular ahí sería sacar un pedido real de la
        // deuda sin que nadie lo haya resuelto.
        const creadoDemanda = props.sin_fecha ? null : Date.parse(String(props.creado_en));
        const candidatos = (dataRef.current?.incidentes.features ?? [])
          .map((fi): CandidatoCotejo | null => {
            if (fi.properties.macro === "inactivo") return null;
            const ln = fi.geometry.coordinates[0];
            const la = fi.geometry.coordinates[1];
            if (ln == null || la == null) return null;
            const dist = distanciaM(lngLat[0], lngLat[1], ln, la);
            if (dist > 60) return null;
            const cerradoEn = (fi.properties.cerrado_en as string | null) ?? null;
            const cierreMs = cerradoEn ? Date.parse(cerradoEn) : null;
            return {
              id: Number(fi.properties.id),
              tipo: String(fi.properties.tipo ?? "otro"),
              estado: String(fi.properties.estado ?? ""),
              macro: String(fi.properties.macro ?? ""),
              direccion: (fi.properties.direccion as string | null) ?? null,
              dist: Math.round(dist),
              lngLat: [ln, la],
              cerradoEn,
              // Se cerró ANTES de que este pedido existiera: es el problema
              // volviendo (reincidencia), no la respuesta a ESTE pedido.
              posibleReincidencia: Boolean(
                cierreMs != null && creadoDemanda != null && Number.isFinite(cierreMs) && cierreMs < creadoDemanda,
              ),
            };
          })
          .filter((c): c is CandidatoCotejo => c != null)
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 5);
        setCotejo({ demanda: props, lngLat, candidatos });
        setSeleccion(null);
      } else {
        setSeleccion({ capa: "demanda", props, lngLat });
      }
    }
    mapRef.current?.easeTo({ center: lngLat, duration: 400, offset: [-140, 0] });
  }, []);

  return (
    <div ref={contenedorRef} className="relative h-full w-full overflow-hidden">
      <MapaGL
        ref={mapRef}
        initialViewState={{
          longitude: foco?.lon ?? inicial?.camara?.lon ?? CENTRO_SMT[0],
          latitude: foco?.lat ?? inicial?.camara?.lat ?? CENTRO_SMT[1],
          zoom: foco?.zoom ?? inicial?.camara?.zoom ?? 12.6,
        }}
        mapStyle={estiloMapa(tema)}
        maxZoom={19.5}
        interactiveLayerIds={[
          // Cada capa opcional entra solo cuando está montada: consultar una
          // capa inexistente haría fallar el query de features.
          "clusters",
          "incidentes-punto",
          "demandas-punto",
          ...(verCircuitos && circuitosConDeuda ? ["circuitos-empresa-relleno"] : []),
          // Barrios: solo tooltip (deuda al pasar el mouse); el clic no abre nada.
          ...(verBarrios && barriosConDeuda ? ["barrios-relleno"] : []),
          ...(verSectores && sectoresGeo ? ["sectores-hormigon-relleno", "sectores-cuadrante-relleno"] : []),
          ...(verColectivos && colectivosGeo ? ["colectivos-linea"] : []),
          ...(verBacheoIntegral && bacheoIntegralGeo ? ["bacheo-integral-relleno"] : []),
        ]}
        onClick={alClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuCtx({ x: e.point.x, y: e.point.y, lat: e.lngLat.lat, lon: e.lngLat.lng });
        }}
        onMove={(e) => {
          if (comparar) setVistaComp(e.viewState);
        }}
        onMoveEnd={recalcularBalance}
        onError={(e) => {
          // Un estilo o capa inválidos dejarían el mapa en negro sin avisar.
          console.error("[mapa] error de MapLibre:", e.error?.message ?? e);
        }}
        onDblClick={(e) => {
          // Cerrar el polígono con doble clic (los dos clics previos ya
          // cayeron en alClick; el segundo se descartó como duplicado).
          if (!modoAnalisisRef.current || formaZonaRef.current !== "poligono") return;
          e.preventDefault(); // sin esto el doble clic además haría zoom
          if (!zonaCerradaRef.current && vertsZonaRef.current.length >= 3) setZonaCerrada(true);
        }}
        onMouseDown={(e) => {
          if (!modoAnalisisRef.current || formaZonaRef.current !== "circulo") return;
          e.preventDefault(); // suspende el paneo del mapa durante el dibujo
          dibujandoRef.current = true;
          arrastroRef.current = false;
          setZona({ lon: e.lngLat.lng, lat: e.lngLat.lat });
          setRadioZona(60);
        }}
        onMouseUp={() => {
          if (!dibujandoRef.current) return;
          dibujandoRef.current = false;
          // clic seco (sin arrastre): radio cómodo por defecto
          if (!arrastroRef.current) setRadioZona(250);
        }}
        onTouchStart={(e) => {
          if (!modoAnalisisRef.current || formaZonaRef.current !== "circulo") return;
          e.preventDefault();
          dibujandoRef.current = true;
          arrastroRef.current = false;
          setZona({ lon: e.lngLat.lng, lat: e.lngLat.lat });
          setRadioZona(60);
        }}
        onTouchMove={(e) => {
          if (!dibujandoRef.current) return;
          e.preventDefault();
          setZona((z) => {
            if (z) {
              arrastroRef.current = true;
              const r = distanciaM(z.lon, z.lat, e.lngLat.lng, e.lngLat.lat);
              setRadioZona(Math.min(2000, Math.max(60, Math.round(r / 10) * 10)));
            }
            return z;
          });
        }}
        onTouchEnd={() => {
          if (!dibujandoRef.current) return;
          dibujandoRef.current = false;
          if (!arrastroRef.current) setRadioZona(250);
        }}
        onMouseEnter={() => {
          const c = mapRef.current?.getCanvas();
          if (c) c.style.cursor = modoAnalisis ? "crosshair" : "pointer";
        }}
        onMouseLeave={() => {
          const c = mapRef.current?.getCanvas();
          if (c) c.style.cursor = modoAnalisis ? "crosshair" : "";
          setTooltip(null);
        }}
        onMouseMove={(e) => {
          if (dibujandoRef.current) {
            // dibujo en vivo: el radio sigue al cursor y el análisis se recalcula
            setZona((z) => {
              if (z) {
                arrastroRef.current = true;
                const r = distanciaM(z.lon, z.lat, e.lngLat.lng, e.lngLat.lat);
                setRadioZona(Math.min(2000, Math.max(60, Math.round(r / 10) * 10)));
              }
              return z;
            });
            return;
          }
          if (barraEstadoRef.current) {
            barraEstadoRef.current.textContent =
              e.lngLat.lat.toFixed(5) + ", " + e.lngLat.lng.toFixed(5) + "  ·  z" +
              (mapRef.current?.getZoom() ?? 0).toFixed(1);
          }
          const f = e.features?.[0];
          if (!f) {
            setTooltip((t) => (t ? null : t));
            return;
          }
          const p = f.properties ?? {};
          let lineas: string[];
          if (f.layer.id === "clusters") {
            lineas = [numero(Number(p.point_count)) + " incidentes", "clic para acercar"];
          } else if (f.layer.id === "incidentes-punto") {
            lineas = [
              String(p.direccion ?? "Incidente #" + String(p.id)),
              (ETIQUETA_TIPO[String(p.tipo) as keyof typeof ETIQUETA_TIPO] ?? String(p.tipo)) +
                " · " + String(p.estado).replaceAll("_", " ") +
                (p.score != null ? " · score " + Number(p.score).toFixed(0) : ""),
            ];
          } else if (f.layer.id === "circuitos-empresa-relleno") {
            // Con la deuda cargada, la segunda línea es la cifra que pinta el
            // polígono: "N abiertos · M sin atención (P%)".
            const pctDeuda = Number(p.pct_deuda ?? -1);
            lineas = [
              "Circuito " + String(p.circuito ?? ""),
              pctDeuda >= 0
                ? numero(Number(p.deuda_abiertas ?? 0)) + " abiertos · " +
                  numero(Number(p.deuda_sin ?? 0)) + " sin atención (" + pctDeuda + "%) · clic para el detalle"
                : p.op
                  ? (p.empresa ? String(p.empresa) : "sin asignar") +
                    " · " + numero(Number(p.pendientes ?? 0)) + " pendientes · clic para el detalle"
                  : "clic para el detalle",
            ];
          } else if (f.layer.id === "barrios-relleno") {
            const pctDeuda = Number(p.pct_deuda ?? -1);
            lineas = [
              "Barrio " + String(p.nombre ?? ""),
              pctDeuda >= 0
                ? numero(Number(p.deuda_abiertas ?? 0)) + " abiertos · " +
                  numero(Number(p.deuda_sin ?? 0)) + " sin atención (" + pctDeuda + "%)"
                : p.pct_deuda != null
                  ? "sin pedidos abiertos"
                  : p.problemas
                    ? "con problemas reportados"
                    : "sin problemas reportados",
            ];
          } else if (f.layer.id === "bacheo-integral-relleno") {
            // La zona del programa: nombre, obra y el detalle del KML (monto,
            // plazo, objetivo) sin tener que entrar a ningún lado.
            lineas = [
              "Bacheo integral — zona " + String(p.nombre ?? "") + (p.obra ? " · Obra " + String(p.obra) : ""),
              String(p.detalle ?? ""),
            ];
          } else if (f.layer.id === "colectivos-linea") {
            // "L4 · MERCOFRUT": la sensibilidad por transporte del ingeniero
            lineas = [String(p.linea ?? "") + " · " + String(p.ramal ?? ""), "recorrido de colectivo"];
          } else if (f.layer.id === "sectores-hormigon-relleno" || f.layer.id === "sectores-cuadrante-relleno") {
            lineas = [String(p.sector ?? ""), String(p.detalle ?? "") + " · clic para el detalle"];
          } else {
            lineas = [
              String(p.direccion ?? "Pedido #" + String(p.id)),
              (ETIQUETA_FUENTE[String(p.fuente) as keyof typeof ETIQUETA_FUENTE] ?? String(p.fuente)) +
                " · " + fechaCorta(String(p.creado_en)),
            ];
          }
          setTooltip({ x: e.point.x, y: e.point.y, lineas });
        }}
        attributionControl={{ compact: true }}
      >
        {verSatelite && (
          <Source
            id="satelite"
            type="raster"
            tiles={["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"]}
            tileSize={256}
            // EL BUG DEL "MAPA QUE COLAPSA" / "Map data not yet available":
            // Esri no cubre SMT completo en z19 (el microcentro devuelve el
            // cartel impreso en el tile) y z20+ es un placeholder gris liso.
            // Se sondeó tile por tile: z18 tiene imagen REAL en toda la
            // ciudad, z19 es mixto. La fuente queda en 18 y MapLibre
            // sobre-escala hasta el zoom máximo de cámara: borroso de cerca
            // antes que un cartel gris tapando el mapa.
            maxzoom={18}
            attribution="Esri, Maxar, Earthstar Geographics"
          >
            {/* Debajo de los nombres de calles: la imagen no tapa las etiquetas */}
            <Layer id="satelite-capa" type="raster" beforeId={hayAnclaEtiquetas ? "roadname_minor" : undefined} />
          </Source>
        )}

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
            <Layer {...capas.avenidasNombre} />
          </>
        )}

        {/* Capas viales nuevas — también debajo de los datos. Orden: red vial
            (contexto), sectores (relleno), jerarquía y colectivos (líneas). */}
        {verRedVial && redVialGeo && (
          <Source id="red-vial" type="geojson" data={redVialGeo}>
            <Layer {...capas.redPavimento} />
            <Layer {...capas.redCordon} />
            <Layer {...capas.redRipio} />
          </Source>
        )}
        {verSectores && sectoresGeo && (
          <Source id="sectores" type="geojson" data={sectoresGeo}>
            <Layer {...capaCuadrantesClick} />
            <Layer {...capas.sectoresRelleno} />
            <Layer {...capaSectoresBorde} />
            <Layer {...capas.cuadrantesBorde} />
            <Layer {...capas.cuadrantesEtiqueta} />
          </Source>
        )}
        {verJerarquia && jerarquiaGeo && (
          <Source id="jerarquia" type="geojson" data={jerarquiaGeo}>
            <Layer {...capas.jerarquiaLinea} />
            <Layer {...capas.jerarquiaNombre} />
          </Source>
        )}
        {verColectivos && colectivosGeo && (
          <Source id="colectivos" type="geojson" data={colectivosGeo}>
            <Layer {...capas.colectivos} />
          </Source>
        )}
        {verBacheoIntegral && bacheoIntegralGeo && (
          <Source id="bacheo-integral" type="geojson" data={bacheoIntegralGeo}>
            <Layer
              id="bacheo-integral-relleno"
              type="fill"
              paint={{ "fill-color": pal.bacheoIntegral, "fill-opacity": pal.oscuro ? 0.08 : 0.1 }}
            />
            <Layer
              id="bacheo-integral-borde"
              type="line"
              paint={{ "line-color": pal.bacheoIntegral, "line-width": 2, "line-dasharray": [3, 1.5] }}
            />
            <Layer
              id="bacheo-integral-etiqueta"
              type="symbol"
              layout={{
                "text-field": ["format",
                  ["get", "nombre"], { "font-scale": 1 },
                  "\nObra ", { "font-scale": 0.8 },
                  ["get", "obra"], { "font-scale": 0.8 }],
                "text-font": ["Montserrat Regular"],
                "text-size": 13,
              }}
              paint={{ "text-color": pal.bacheoIntegral, "text-halo-color": pal.halo, "text-halo-width": 1.6 }}
            />
          </Source>
        )}

        {/* Límites territoriales de referencia — igual, debajo de los datos */}
        {verBarrios && barriosConDeuda && (
          <Source id="barrios" type="geojson" data={barriosConDeuda}>
            {/* Con la deuda cargada se pinta la coropleta (misma rampa que los
                distritos); sin datos, el tinte rojo clásico de "problemas". */}
            {verDeudaBarrios && deudaBarrios && deudaBarrios.length > 0 ? (
              <Layer {...capaBarriosDeuda} />
            ) : (
              <Layer {...capaBarriosRelleno} />
            )}
            <Layer {...capas.barriosLinea} />
            <Layer {...capas.barriosNombre} />
          </Source>
        )}
        {verCircuitos && circuitosConDeuda && (
          <Source id="circuitos" type="geojson" data={circuitosConDeuda}>
            {/* Deuda y empresa comparten id de capa: el clic y el tooltip del
                circuito funcionan igual con cualquiera de las dos pinturas. */}
            {verDeudaCircuitos && deudaCircuitos && deudaCircuitos.length > 0 ? (
              <Layer {...capaCircuitosDeuda} />
            ) : (
              <Layer {...capas.circuitosEmpresa} />
            )}
            <Layer {...capas.circuitosLinea} />
            <Layer {...capas.circuitosPrioridad} />
            <Layer {...capas.circuitosNombre} />
          </Source>
        )}
        {verDistritos && distritosConBrecha && (
          <Source id="distritos" type="geojson" data={distritosConBrecha}>
            {verCoropleta && <Layer {...capaDistritosRelleno} />}
            <Layer {...capas.distritosHalo} />
            <Layer {...capas.distritosLinea} />
            {distritoFoco != null && <Layer {...capaDistritoFoco(distritoFoco, pal)} />}
            <Layer {...capas.distritosNombre} />
          </Source>
        )}

        {/* La densidad de demanda vive en la misma fuente que los puntos pero
            se prende sola: tiene que funcionar aun en vistas sin pedidos
            visibles (Historial) — es una capa transversal, no parte de una vista. */}
        {(verDemandas || verCalor) && (
          <Source id="demandas" type="geojson" data={demandasFiltradas}>
            {verCalor && <Layer {...capas.calor} />}
            {verDemandas && (
              <Layer {...(vista === "brecha" ? (modoBrecha === "antiguedad" ? capas.demandasEdad : capas.demandasBrecha) : capas.demandas)} />
            )}
            {/* El anillo de destino se monta encima del punto y solo si hay
                alguna cola ajena prendida: con solo bacheo no dibuja nada. */}
            {verDemandas && (destinos.sat === true || destinos.ingenieria === true) && (
              <Layer {...capas.demandasDestino} />
            )}
          </Source>
        )}

        {hexData && (
          <Source id="hexbins" type="geojson" data={hexData}>
            <Layer {...capas.hexagonos} />
          </Source>
        )}

        {geometriaZona && (
          <Source id="zona" type="geojson" data={geometriaZona}>
            <Layer {...capas.zonaRelleno} />
            <Layer {...capas.zonaBorde} />
          </Source>
        )}

        {dibujoPoligono && (
          <Source id="zona-dibujo" type="geojson" data={dibujoPoligono}>
            <Layer
              id="zona-dibujo-linea"
              type="line"
              filter={["==", ["geometry-type"], "LineString"]}
              paint={{ "line-color": pal.acento, "line-width": 2, "line-dasharray": [2, 1.5] }}
            />
            <Layer
              id="zona-dibujo-vertice"
              type="circle"
              filter={["==", ["geometry-type"], "Point"]}
              paint={{
                // El primer vértice es más grande: es el "botón" que cierra.
                "circle-radius": ["case", ["boolean", ["get", "primero"], false], 7, 4.5],
                "circle-color": pal.acento,
                "circle-stroke-color": pal.tinta,
                "circle-stroke-width": 2,
              }}
            />
          </Source>
        )}

        {zonaA && circuloZonaA && (
          <Source id="zona-a" type="geojson" data={circuloZonaA}>
            <Layer id="zona-a-relleno" type="fill" paint={{ "fill-color": "#2EB1FF", "fill-opacity": 0.08 }} />
            <Layer id="zona-a-borde" type="line" paint={{ "line-color": "#2EB1FF", "line-width": 2, "line-dasharray": [3, 2] }} />
          </Source>
        )}

        {hilosCotejo && (
          <Source id="cotejo-hilos" type="geojson" data={hilosCotejo}>
            <Layer
              id="cotejo-linea"
              type="line"
              paint={{ "line-color": pal.acento, "line-width": 1.8, "line-dasharray": [2, 1.5], "line-opacity": 0.9 }}
            />
          </Source>
        )}

        {cotejo && cotejo.candidatos.length > 0 && (
          <Source
            id="cotejo-candidatos"
            type="geojson"
            data={{
              type: "FeatureCollection",
              features: cotejo.candidatos.map((c) => ({
                type: "Feature" as const,
                geometry: { type: "Point" as const, coordinates: c.lngLat },
                // El paso del semáforo se resuelve acá, en JS: el candidato ya
                // tiene el estado exacto, así el punto marcado se pinta igual
                // que el mismo incidente en la capa de abajo.
                properties: { color: colorDeEstado(pal, c.estado) },
              })),
            }}
          >
            {/* Los candidatos del cotejo no se ven si su capa está apagada:
                se marcan siempre mientras el panel de cotejo está abierto. */}
            <Layer
              id="cotejo-candidatos-halo"
              type="circle"
              paint={{ "circle-radius": 13, "circle-color": pal.acento, "circle-opacity": 0.18 }}
            />
            <Layer
              id="cotejo-candidatos-punto"
              type="circle"
              paint={{
                "circle-radius": 7,
                "circle-color": ["coalesce", ["get", "color"], pal.inactivo],
                "circle-stroke-color": pal.tinta,
                "circle-stroke-width": 2,
              }}
            />
          </Source>
        )}

        {top20 && top20.features.length > 0 && (
          <Source id="top20" type="geojson" data={top20}>
            <Layer
              id="top20-circulo"
              type="circle"
              paint={{
                // El disco era #f4dc00 y en tema oscuro se fundía con el ámbar
                // "en obra" (#ffc233) — justo el estado de casi todo lo que el
                // Top 20 numera, así que el ranking se leía como un estado más.
                // Ahora es tinta INVERTIDA (disco claro sobre el mapa oscuro y
                // al revés): ningún paso del semáforo se pinta así, el número
                // queda a máximo contraste y el disco se lee como una chapa de
                // ranking, no como un color de estado.
                "circle-radius": 11,
                "circle-color": pal.rankDisco,
                "circle-stroke-color": pal.tinta,
                "circle-stroke-width": 2,
              }}
            />
            <Layer
              id="top20-num"
              type="symbol"
              layout={{
                "text-field": ["to-string", ["get", "rank"]],
                "text-size": 12,
                "text-font": ["Montserrat Regular"],
                "text-allow-overlap": true,
              }}
              paint={{ "text-color": pal.rankNumero }}
            />
          </Source>
        )}

        {/* Las cifras flotantes "N sin respuesta" son el mayor ruido del mapa
            al alejarse: solo se dibujan con el detalle en "Todo". */}
        {detalle === "completo" && cifrasZona.features.length > 0 && (
          <Source id="cifras-zona" type="geojson" data={cifrasZona}>
            <Layer
              id="cifras-zona-texto"
              type="symbol"
              maxzoom={12.8}
              layout={{
                "text-field": ["format", ["to-string", ["get", "n"]], { "font-scale": 1.5 }, "\nsin respuesta", { "font-scale": 0.75 }],
                "text-font": ["Montserrat Regular"],
                "text-size": 14,
              }}
              paint={{ "text-color": pal.acento, "text-halo-color": pal.halo, "text-halo-width": 1.8 }}
            />
          </Source>
        )}

        <Source
          id="incidentes"
          type="geojson"
          data={incidentesFiltrados}
          cluster
          clusterMaxZoom={14}
          clusterRadius={45}
          // Los tres pasos del semáforo contados por el propio clustering, para
          // que la burbuja pueda pintarse por el paso DOMINANTE (ver
          // capaClusters). Con solo n_sin la burbuja mentía: un cluster de
          // puros 'en_ejecucion' daba 0 sin atención y se pintaba verde, que es
          // el color de "resuelto". Lo que no entra en ninguno de los tres
          // (desestimado) queda fuera a propósito: no es deuda ni es trabajo.
          //   n_sin   = detectado + priorizado  (nadie lo tocó)
          //   n_act   = programado + en_ejecucion (en cola + en obra)
          //   n_hecho = reparado + verificado
          clusterProperties={{
            n_sin: ["+", ["case", ["match", ["get", "estado"], ["detectado", "priorizado"], true, false], 1, 0]],
            n_act: ["+", ["case", ["match", ["get", "estado"], ["programado", "en_ejecucion"], true, false], 1, 0]],
            n_hecho: ["+", ["case", ["match", ["get", "estado"], ["reparado", "verificado"], true, false], 1, 0]],
          }}
        >
          <Layer {...capas.pulso} />
          <Layer {...capas.incidentes} />
          <Layer {...capas.clusters} />
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
          <Layer {...capas.seleccion} />
        </Source>

        {resaltado && resaltado.fc.features.length > 0 && (
          <Source id="resaltado" type="geojson" data={resaltado.fc}>
            <Layer
              id="resaltado-halo"
              type="circle"
              paint={{ "circle-radius": 15, "circle-color": pal.acento, "circle-opacity": pal.oscuro ? 0.1 : 0.14 }}
            />
            <Layer
              id="resaltado-anillo"
              type="circle"
              paint={{
                "circle-radius": 10,
                "circle-color": "rgba(0,0,0,0)",
                "circle-stroke-color": pal.acento,
                "circle-stroke-width": 2.5,
                "circle-stroke-opacity": 0.95,
              }}
            />
          </Source>
        )}

        {marcador && (
          <Marker longitude={marcador[0]} latitude={marcador[1]} anchor="bottom">
            <div className="flex flex-col items-center">
              <Crosshair size={26} className="text-amarillo drop-shadow" />
            </div>
          </Marker>
        )}
      </MapaGL>

      {/* Barra de herramientas: buscador, vista y acciones, todo junto en UN
          panel movible (como Migue) — así ya no se amontonan sueltos y el
          usuario los saca de en medio arrastrándolos de un solo lugar. */}
      <div
        ref={herrRef}
        className={`absolute top-3 left-3 right-3 z-20 flex flex-wrap items-start gap-2 ${despejado ? "hidden" : ""}`}
        style={arrHerr.estilo}
      >
        <div
          {...arrHerr.asaProps}
          className="panel-vidrio flex shrink-0 cursor-grab items-center justify-center self-stretch rounded-xl px-1.5 text-texto-3 transition hover:text-texto active:cursor-grabbing"
          title="Arrastrar para mover esta barra de herramientas"
        >
          <GripVertical size={14} />
        </div>

        {/* Buscador en lenguaje natural — congelado durante Comparar: cambiar
            capas ahí rompería la cortina. */}
        {!comparar && (
          <div data-tour="buscador">
            <BuscadorMapa
              alBuscar={buscarEnMapa}
              alLimpiar={() => setResaltado(null)}
              hayResaltado={resaltado != null && resaltado.fc.features.length > 0}
            />
          </div>
        )}

        {/* Aislamiento por distrito (llegó desde el ranking de /brecha) */}
        {distritoFoco != null && (
          <div className="panel-vidrio flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-amarillo ring-1 ring-amarillo/50">
            Solo Distrito {distritoFoco}
            <button
              onClick={() => setDistritoFoco(null)}
              className="text-texto-3 transition hover:text-texto"
              title="Ver toda la ciudad de nuevo"
            >
              <X size={13} />
            </button>
          </div>
        )}

        {/* Selector de vista — reemplazado por el aviso de Comparar mientras dura.
            En mobile no envuelve: se desliza de costado, nada se corta. */}
        {comparar ? (
          <div className="panel-vidrio rounded-xl px-3.5 py-2 text-xs font-semibold text-texto-2">
            Comparando lo pedido vs. lo hecho — salí de <b className="text-texto">Comparar</b> para cambiar filtros
          </div>
        ) : (
          <div data-tour="vistas" className="panel-vidrio flex max-w-[calc(100vw-88px)] flex-col rounded-xl p-1 sm:max-w-none">
            <div className="flex overflow-x-auto sm:flex-wrap sm:overflow-visible">
              {(Object.keys(VISTAS) as Vista[]).map((v) => (
                <button
                  key={v}
                  onClick={() => aplicarVista(v)}
                  title={VISTAS[v].descripcion}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition sm:px-3.5 ${
                    vista === v ? "bg-azul text-white" : "text-texto-2 hover:text-texto"
                  }`}
                >
                  {VISTAS[v].etiqueta}
                </button>
              ))}
            </div>
            {/* QUIÉN RESUELVE: la cola de la Dirección es bacheo. El agua (SAT)
                y el ripio (Ingeniería) se prenden a pedido — mientras están
                apagados no inflan ninguna cifra de deuda. */}
            {/* La fila salía sin rótulo visible —el "quién resuelve" vivía solo
                en el title— y las tres cifras no cambian al apagar un chip, así
                que se leía como tres datos informativos y no como el filtro que
                es. El rótulo lo nombra y el pie aclara qué mide la cifra; los
                dos son texto chico y envuelven, así que entran en 375 px. */}
            <div data-tour="destinos" className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-borde pt-1">
              <span className="text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Resuelve</span>
              {DESTINOS.map((d) => {
                const activo = destinos[d] === true;
                // El color del chip es el de su anillo en el mapa; bacheo no
                // tiene anillo (habla el semáforo) y va con el relleno neutro.
                const marca = d === "sat" ? pal.destinoSat : d === "ingenieria" ? pal.destinoIngenieria : null;
                return (
                  <button
                    key={d}
                    onClick={() => setDestinos((v) => ({ ...v, [d]: !activo }))}
                    aria-pressed={activo}
                    title={`${AYUDA_DESTINO[d]} — ${AYUDA_CUENTA_DESTINO}`}
                    className={`flex items-center gap-1 rounded-lg border px-1.5 py-1 text-[11px] font-semibold whitespace-nowrap transition ${
                      activo ? "border-transparent bg-panel-3 text-texto" : "border-borde-2 text-texto-3 hover:text-texto-2"
                    }`}
                    style={activo && marca ? { borderColor: marca, color: marca } : undefined}
                  >
                    {d === "bacheo" ? <Construction size={12} /> : d === "sat" ? <Droplets size={12} /> : <Ruler size={12} />}
                    {ETIQUETA_DESTINO[d]}
                    <span className="num opacity-70">{numero(cuentasDestino[d])}</span>
                  </button>
                );
              })}
              <span className="basis-full text-[10px] leading-tight text-texto-3" title={AYUDA_CUENTA_DESTINO}>
                Prendé o apagá cada cola · la cifra es el total de la cola, no lo que se ve
              </span>
            </div>
          </div>
        )}

        <div className="ml-auto flex flex-wrap items-start justify-end gap-2">
          {iaHabilitada && (
            <button
              data-tour="informe-ia"
              onClick={() => void generarInforme()}
              disabled={generandoInforme}
              className="panel-vidrio hidden items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] font-semibold text-celeste transition hover:text-texto disabled:opacity-60 sm:flex sm:px-3.5 sm:py-2.5"
              title="Informe ejecutivo generado por IA sobre lo visible en el mapa"
            >
              <Sparkles size={14} className={generandoInforme ? "animate-pulse text-amarillo" : ""} />
              <span className="hidden sm:inline">{generandoInforme ? "Generando…" : "Informe IA"}</span>
            </button>
          )}
          <button
            data-tour="comparar"
            onClick={alternarComparar}
            className={`panel-vidrio items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] font-semibold transition sm:flex sm:px-3.5 sm:py-2.5 ${
              comparar ? "flex text-celeste ring-1 ring-celeste/60" : "hidden text-texto-2 hover:text-texto"
            }`}
            title="Cortina «Lo pedido | Lo hecho»: dos mapas sincronizados divididos por una cortina arrastrable — la brecha convertida en imagen"
          >
            <Columns2 size={14} />
            <span className="hidden sm:inline">Comparar</span>
          </button>
          {comparar && (
            <button
              onClick={() => void capturarComparacion()}
              disabled={capturando}
              className="panel-vidrio flex items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] font-semibold text-amarillo ring-1 ring-amarillo/60 transition hover:text-texto disabled:opacity-60 sm:px-3.5 sm:py-2.5"
              title="Descargar esta comparación como una imagen"
            >
              <Camera size={14} className={capturando ? "animate-pulse" : ""} />
              <span className="hidden sm:inline">{capturando ? "Capturando…" : "Capturar"}</span>
            </button>
          )}
          {panelesMovidos && (
            <button
              onClick={reubicarTodos}
              className="panel-vidrio hidden items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold text-texto-2 transition hover:text-texto sm:flex sm:px-3 sm:py-2.5"
              title="Volver los paneles a su lugar original"
            >
              <RotateCcw size={14} />
            </button>
          )}
          {/* Nivel de detalle: cuánto se muestra encima del mapa. "Limpio" es
              el mismo despejado del ojo de al lado — un solo estado para las
              dos afordancias. */}
          <div
            data-tour="detalle"
            className="panel-vidrio hidden items-center rounded-xl p-1 sm:flex"
            title="Cuánta información se dibuja encima del mapa: Todo (los 6 números y las cifras de deuda por zona), Esencial (los 2 que importan en esta vista) o Limpio (solo el mapa)"
          >
            {(Object.keys(ETIQUETA_DETALLE) as Detalle[]).map((d) => (
              <button
                key={d}
                onClick={() => cambiarDetalle(d)}
                className={`rounded-lg px-2 py-1.5 text-[11px] font-semibold whitespace-nowrap transition ${
                  detalle === d ? "bg-azul text-white" : "text-texto-2 hover:text-texto"
                }`}
              >
                {ETIQUETA_DETALLE[d]}
              </button>
            ))}
          </div>
          <button
            data-tour="despejar"
            onClick={alternarDespejado}
            className={`panel-vidrio hidden items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold transition sm:flex sm:px-3 sm:py-2.5 ${
              despejado ? "text-amarillo ring-1 ring-amarillo/60" : "text-texto-2 hover:text-texto"
            }`}
            title={
              despejado
                ? "Volver a mostrar los paneles y datos sobre el mapa"
                : "Despejar: esconder todos los paneles para ver el mapa limpio"
            }
          >
            <EyeOff size={14} />
          </button>
          <button
            data-tour="analizar-zona"
            onClick={() => {
              const activo = !modoAnalisis;
              setModoAnalisis(activo);
              if (!activo) setZona(null);
            }}
            className={`panel-vidrio items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] font-semibold transition sm:flex sm:px-3.5 sm:py-2.5 ${
              modoAnalisis ? "flex text-amarillo ring-1 ring-amarillo/60" : "hidden text-texto-2 hover:text-texto"
            }`}
            title="Analizador de zona: mantené clic y arrastrá para dibujar un círculo — las estadísticas se calculan en vivo mientras arrastrás"
          >
            <Radar size={14} className={modoAnalisis ? "animate-pulse" : ""} />
            <span className="hidden sm:inline">{modoAnalisis ? "Dibujá el círculo…" : "Analizar zona"}</span>
          </button>
          <button
            data-tour="historia"
            onClick={() => {
              const activo = !tiempoActivo;
              setTiempoActivo(activo);
              setReproduciendo(false);
              if (activo) setTiempoIdx(0);
            }}
            className={`panel-vidrio items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] font-semibold transition sm:flex sm:px-3.5 sm:py-2.5 ${
              tiempoActivo ? "flex text-celeste ring-1 ring-celeste/60" : "hidden text-texto-2 hover:text-texto"
            }`}
            title="Línea de tiempo: reproducí la historia del bacheo mes a mes"
          >
            <History size={14} />
            <span className="hidden sm:inline">Historia</span>
          </button>
          <div className="relative hidden sm:block">
            <button
              data-tour="exportar"
              onClick={() => {
                setMenuExportar((v) => !v);
                if (contactosWa.length === 0) void listarContactosWhatsapp().then(setContactosWa);
              }}
              className={`panel-vidrio flex items-center gap-2 rounded-xl px-2.5 py-2 text-[13px] font-semibold transition sm:px-3.5 sm:py-2.5 ${
                menuExportar ? "text-celeste ring-1 ring-celeste/60" : "text-texto-2 hover:text-texto"
              }`}
              title="Sacar esta vista del mapa: reporte imprimible, GeoJSON para QGIS, o el link de la cámara y filtros para compartir por WhatsApp"
            >
              <Download size={14} />
              <span className="hidden sm:inline">Exportar</span>
              <ChevronDown size={12} className={`transition-transform ${menuExportar ? "rotate-180" : ""}`} />
            </button>
            {menuExportar && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuExportar(false)} />
                <div className="panel-vidrio absolute right-0 z-40 mt-1.5 w-64 rounded-xl p-1.5 text-[13px]">
                  <button
                    onClick={() => {
                      setMenuExportar(false);
                      void generarReporte();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-panel-3"
                  >
                    <Printer size={14} className="text-texto-2" /> Reporte imprimible (PDF)
                  </button>
                  <button
                    onClick={() => {
                      setMenuExportar(false);
                      exportarGeoJson();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-panel-3"
                  >
                    <Download size={14} className="text-texto-2" /> GeoJSON (QGIS / PowerBI)
                  </button>
                  <button
                    onClick={() => void copiarLinkVista()}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-panel-3"
                  >
                    <Link2 size={14} className="text-texto-2" /> Copiar link de esta vista
                  </button>
                  {contactosWa.length > 0 && (
                    <p className="mt-1 border-t border-borde px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
                      Enviar esta vista por WhatsApp
                    </p>
                  )}
                  {contactosWa.map((c) => (
                    <button
                      key={c.telefono}
                      onClick={() => enviarPorWhatsApp(c.telefono, c.nombre)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition hover:bg-panel-3"
                    >
                      <Send size={14} style={{ color: "#199e70" }} /> {c.nombre}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* "?": recorrido guiado de todas las funciones — pulsa hasta el primer uso */}
          <button
            onClick={abrirGuia}
            className={`panel-vidrio flex items-center gap-2 rounded-xl px-2 py-2 text-[13px] font-semibold transition sm:px-3 sm:py-2.5 ${
              guiaConocida ? "text-texto-2 hover:text-texto" : "text-amarillo ring-1 ring-amarillo/60"
            }`}
            title="¿Para qué sirve cada cosa? Recorrido guiado por todas las funciones del mapa"
          >
            <HelpCircle size={14} className={guiaConocida ? "" : "animate-pulse"} />
          </button>

          {/* Menú de acciones (solo mobile): todo con nombre y explicación */}
          <div className="relative sm:hidden">
            <button
              onClick={() => {
                setMenuAcciones((v) => !v);
                if (contactosWa.length === 0) void listarContactosWhatsapp().then(setContactosWa);
              }}
              className={`panel-vidrio flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[13px] font-semibold transition ${
                menuAcciones ? "text-celeste ring-1 ring-celeste/60" : "text-texto-2"
              }`}
              title="Todas las acciones del mapa"
            >
              <Menu size={15} />
              Acciones
            </button>
            {menuAcciones && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenuAcciones(false)} />
                <div className="panel-vidrio absolute right-0 z-40 mt-1.5 max-h-[65vh] w-[min(310px,calc(100vw-48px))] overflow-y-auto rounded-xl p-1.5">
                  {iaHabilitada && (
                    <ItemAccion
                      icono={<Sparkles size={15} />}
                      titulo={generandoInforme ? "Generando informe…" : "Informe IA"}
                      desc="Informe ejecutivo de lo visible en el mapa"
                      onClick={() => {
                        setMenuAcciones(false);
                        void generarInforme();
                      }}
                    />
                  )}
                  <ItemAccion
                    icono={<Columns2 size={15} />}
                    titulo={comparar ? "Salir de Comparar" : "Comparar"}
                    desc="Cortina «Lo pedido | Lo hecho» con sus números"
                    activo={comparar}
                    onClick={() => {
                      setMenuAcciones(false);
                      alternarComparar();
                    }}
                  />
                  <ItemAccion
                    icono={<Radar size={15} />}
                    titulo={modoAnalisis ? "Salir del analizador" : "Analizar zona"}
                    desc="Dibujá un círculo y mirá sus estadísticas al toque"
                    activo={modoAnalisis}
                    onClick={() => {
                      setMenuAcciones(false);
                      const activo = !modoAnalisis;
                      setModoAnalisis(activo);
                      if (!activo) setZona(null);
                    }}
                  />
                  <ItemAccion
                    icono={<History size={15} />}
                    titulo={tiempoActivo ? "Cerrar línea de tiempo" : "Historia"}
                    desc="La película del bacheo, mes a mes"
                    activo={tiempoActivo}
                    onClick={() => {
                      setMenuAcciones(false);
                      const activo = !tiempoActivo;
                      setTiempoActivo(activo);
                      setReproduciendo(false);
                      if (activo) setTiempoIdx(0);
                    }}
                  />
                  {/* Mismo selector de detalle que en la barra de escritorio:
                      en mobile el ojo no está, así que el escalón se elige acá. */}
                  <p className="mt-1 border-t border-borde px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
                    Cuánto se muestra
                  </p>
                  <div className="flex gap-1 px-2 pb-1">
                    {(Object.keys(ETIQUETA_DETALLE) as Detalle[]).map((d) => (
                      <button
                        key={d}
                        onClick={() => {
                          cambiarDetalle(d);
                          if (d === "limpio") setMenuAcciones(false);
                        }}
                        className={`flex-1 rounded-md border px-1 py-1.5 text-[11px] font-semibold transition ${
                          detalle === d ? "border-azul bg-azul/20 text-texto" : "border-borde-2 text-texto-3"
                        }`}
                      >
                        {ETIQUETA_DETALLE[d]}
                      </button>
                    ))}
                  </div>
                  {panelesMovidos && (
                    <ItemAccion
                      icono={<RotateCcw size={15} />}
                      titulo="Volver paneles a su lugar"
                      desc="Devuelve todo lo que moviste a su posición original"
                      onClick={() => {
                        setMenuAcciones(false);
                        reubicarTodos();
                      }}
                    />
                  )}
                  <p className="mt-1 border-t border-borde px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
                    Exportar y compartir
                  </p>
                  <ItemAccion
                    icono={<Printer size={15} />}
                    titulo="Reporte imprimible"
                    desc="PDF con el mapa y el detalle de lo que estás viendo"
                    onClick={() => {
                      setMenuAcciones(false);
                      void generarReporte();
                    }}
                  />
                  <ItemAccion
                    icono={<Download size={15} />}
                    titulo="GeoJSON"
                    desc="Los datos visibles, para QGIS o PowerBI"
                    onClick={() => {
                      setMenuAcciones(false);
                      exportarGeoJson();
                    }}
                  />
                  <ItemAccion
                    icono={<Link2 size={15} />}
                    titulo="Copiar link de esta vista"
                    desc="Quien lo abra ve la misma cámara y filtros"
                    onClick={() => void copiarLinkVista()}
                  />
                  {contactosWa.map((c) => (
                    <ItemAccion
                      key={c.telefono}
                      icono={<Send size={15} style={{ color: "#199e70" }} />}
                      titulo={`WhatsApp a ${c.nombre}`}
                      desc="Le llega el link de esta vista exacta"
                      onClick={() => enviarPorWhatsApp(c.telefono, c.nombre)}
                    />
                  ))}
                  <p className="mt-1 border-t border-borde px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
                    Ayuda
                  </p>
                  <ItemAccion
                    icono={<HelpCircle size={15} />}
                    titulo="¿Para qué sirve cada cosa?"
                    desc="Recorrido guiado por todas las funciones"
                    onClick={() => {
                      setMenuAcciones(false);
                      abrirGuia();
                    }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* El camino de vuelta de "Despejar". El botón que despeja vive DENTRO de
          la barra que se esconde, así que al despejarse desaparecía junto con
          todo lo demás y no había forma visible de volver — el ojito se
          esfumaba. Este chip existe SOLO con el mapa despejado. */}
      {despejado && (
        <button
          onClick={() => setDetalle(detalleAntesDeLimpiar.current)}
          className="panel-vidrio absolute top-3 right-3 z-30 flex items-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-amarillo ring-1 ring-amarillo/60 transition hover:brightness-110"
          title="Volver a mostrar los paneles y datos sobre el mapa"
        >
          <Eye size={14} />
          <span className="hidden sm:inline">Mostrar paneles</span>
        </button>
      )}

      {/* KPIs — fila propia, informativa y fija (no forma parte de la barra movible).
          El top se mide en vivo contra el alto real de la barra de herramientas,
          para no superponerse sin importar en cuántas líneas envuelva esta. */}
      {!despejado && (
        <div
          data-tour="kpis"
          className="pointer-events-auto absolute left-3 right-3 z-10 flex gap-2 overflow-x-auto pb-1 sm:pointer-events-none sm:flex-wrap sm:overflow-visible sm:pb-0"
          style={{ top: altoHerr > 0 ? altoHerr + 24 : 64 }}
        >
          {verKpi("demandas") && (
            <Kpi etiqueta="Demandas" valor={kpis.demandas} color="var(--color-texto-2)" ayuda={AYUDA_KPI.demandas} />
          )}
          {/* Pinta con el ROJO del semáforo, no con el amarillo de marca: es
              literalmente el paso "sin atención" de la leyenda de abajo. */}
          {verKpi("sinAtencion") && (
            <Kpi etiqueta="Sin atención" valor={kpis.sinAtencion} color={SEMAFORO.sin_atencion} ayuda={AYUDA_KPI.sinAtencion} />
          )}
          {verKpi("abiertos") && (
            <Kpi etiqueta="Abiertos" valor={kpis.abiertos} color={SEMAFORO.sin_atencion} ayuda={AYUDA_KPI.abiertos} />
          )}
          {/* "En curso" es el macro: junta en cola y en obra, así que se pinta
              con el ámbar (el paso más avanzado que cubre). */}
          {verKpi("enCurso") && (
            <Kpi etiqueta="En curso" valor={kpis.enCurso} color={SEMAFORO.en_obra} pulso ayuda={AYUDA_KPI.enCurso} />
          )}
          {verKpi("resueltos") && (
            <Kpi etiqueta="Resueltos" valor={kpis.resueltos} color={SEMAFORO.resuelto} ayuda={AYUDA_KPI.resueltos} />
          )}
          {verKpi("m2") && (
            <Kpi etiqueta="m² intervenidos" valor={kpis.m2} color="var(--color-celeste)" ayuda={AYUDA_KPI.m2} />
          )}
        </div>
      )}

      {/* Tooltip instantáneo al pasar el mouse */}
      {tooltip && !modoAnalisis && (
        <div
          className="pointer-events-none absolute z-30 max-w-64 rounded-lg border border-borde-2 bg-panel-2/95 px-2.5 py-1.5 shadow-xl"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          <p className="truncate text-[12px] font-semibold">{tooltip.lineas[0]}</p>
          {tooltip.lineas[1] && <p className="text-[10px] text-texto-2">{tooltip.lineas[1]}</p>}
        </div>
      )}

      {/* Barra de estado: coordenadas y zoom en vivo */}
      <div className="pointer-events-none absolute bottom-1 left-1/2 z-10 -translate-x-1/2">
        <div ref={barraEstadoRef} className="num rounded-md bg-fondo/70 px-2 py-0.5 text-[10px] text-texto-3" />
      </div>

      {/* Balance vivo del encuadre: la brecha de lo que se está viendo */}
      {balance && !comparar && !despejado && (balance.pend > 0 || balance.m2 > 0) && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-10 -translate-x-1/2">
          <div data-tour="balance" className="panel-vidrio max-w-[calc(100vw-24px)] overflow-hidden rounded-full px-4 py-1.5 text-[11px] whitespace-nowrap text-texto-2 max-sm:text-ellipsis">
            {/* Los dos porcentajes son pasos del semáforo, no acentos sueltos:
                "sin respuesta" sale de brecha === 'sin_atencion' (rojo) y los
                m² son trabajo terminado (verde). Con los viejos --color-encurso
                y --color-ok, la pastilla contradecía a la leyenda que tiene a
                centímetros. */}
            En pantalla: <b className="num text-texto">{numero(balance.pend)}</b> pedidos pendientes ·{" "}
            <b className="num" style={{ color: "var(--color-sin-atencion)" }}>
              {balance.pend > 0 ? Math.round((100 * balance.sinAt) / balance.pend) : 0}%
            </b>{" "}
            sin respuesta · <b className="num" style={{ color: "var(--color-hecho)" }}>{numero(balance.m2)} m²</b> hechos
          </div>
        </div>
      )}

      {/* Cortina «Lo pedido | Lo hecho» */}
      {comparar && vistaComp && (
        <CortinaComparar
          vistaMapa={vistaComp}
          demandas={demandasFiltradas}
          espejoRef={espejoRef}
          alCambiarCorte={(c) => {
            corteComparaRef.current = c;
          }}
          balance={balance}
        />
      )}

      {/* Panel de cotejo desde el mapa */}
      {cotejo && !comparar && (
        <aside className="panel-vidrio absolute top-28 right-3 z-20 flex max-h-[calc(100%-8.5rem)] w-80 flex-col rounded-xl">
          <div className="flex items-center justify-between border-b border-borde px-4 py-3">
            <span className="text-sm font-bold">Cotejo: ¿esto ya se atendió?</span>
            <button onClick={() => setCotejo(null)} className="text-texto-3 hover:text-texto">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-[13px]">
            <div>
              <p className="font-semibold">{String(cotejo.demanda.direccion ?? `Pedido #${String(cotejo.demanda.id)}`)}</p>
              <p className="text-[11px] text-texto-3">
                Pedido #{String(cotejo.demanda.id)} ·{" "}
                {ETIQUETA_FUENTE[String(cotejo.demanda.fuente) as keyof typeof ETIQUETA_FUENTE] ?? String(cotejo.demanda.fuente)} ·{" "}
                {cotejo.demanda.sin_fecha ? "sin fecha" : fechaCorta(String(cotejo.demanda.creado_en))}
              </p>
            </div>
            {cotejo.candidatos.length === 0 ? (
              <p className="rounded-lg border border-encurso/40 bg-encurso/10 px-3 py-2.5 text-xs leading-relaxed text-encurso">
                No hay incidentes ni reparaciones a menos de 60 m: <b>brecha real confirmada</b> — nadie tocó esto todavía.
              </p>
            ) : (
              <>
                <p className="text-[11px] leading-relaxed text-texto-3">
                  Los hilos amarillos (y los puntos marcados con anillo) muestran lo que hay cerca. Si alguno ES este
                  mismo problema, vinculalo: el pedido sale de la deuda sin poner un metro de asfalto.
                </p>
                {cotejo.candidatos.map((c) => (
                  <div key={c.id} className="rounded-lg border border-borde bg-panel-2/60 p-2.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ background: SEMAFORO[pasoDeEstado(c.estado as EstadoIncidente)] }}
                      />
                      <span className="truncate text-[12px] font-semibold">
                        {ETIQUETA_TIPO[c.tipo as keyof typeof ETIQUETA_TIPO] ?? c.tipo} · {c.estado.replaceAll("_", " ")}
                      </span>
                      <span className="num ml-auto shrink-0 text-[11px] font-bold text-amarillo">{c.dist} m</span>
                    </div>
                    {c.direccion && <p className="mt-0.5 truncate text-[11px] text-texto-3">{c.direccion}</p>}
                    {c.cerradoEn && (
                      <p className="num mt-0.5 text-[11px] text-texto-3">Cerrado: {fechaCorta(c.cerradoEn)}</p>
                    )}
                    {c.posibleReincidencia && (
                      <p className="mt-1 rounded border border-amarillo/40 bg-amarillo/10 px-2 py-1 text-[10px] leading-snug text-amarillo">
                        Se cerró ANTES de este pedido: puede ser que el problema volvió (reincidencia), no que esto lo
                        haya resuelto. Revisá antes de vincular.
                      </p>
                    )}
                    <div className="mt-1.5 flex items-center gap-2.5">
                      {puedeVincular && (
                        <button
                          onClick={() => vincularDesdeMapa(Number(cotejo.demanda.id), c.id)}
                          disabled={vinculando}
                          className="rounded-md bg-azul px-2.5 py-1 text-[11px] font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                        >
                          {vinculando ? "Vinculando…" : "Vincular acá"}
                        </button>
                      )}
                      <Link href={`/incidentes/${c.id}`} className="text-[11px] font-semibold text-celeste hover:underline">
                        Historia →
                      </Link>
                    </div>
                  </div>
                ))}
                {!puedeVincular && (
                  <p className="text-[10px] text-texto-3">Vincular requiere el rol Atención Ciudadana (o admin).</p>
                )}
              </>
            )}
          </div>
        </aside>
      )}

      {/* Detalle operativo del circuito clickeado */}
      {circuitoSel && !comparar && (
        <aside className="panel-vidrio absolute top-28 right-3 z-20 w-72 max-w-[calc(100vw-24px)] rounded-xl">
          <div className="flex items-center justify-between border-b border-borde px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-bold">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{
                  background: circuitoSel.color_empresa ? String(circuitoSel.color_empresa) : "#34d399",
                  opacity: circuitoSel.color_empresa ? 1 : 0.5,
                }}
              />
              Circuito {String(circuitoSel.circuito ?? "")}
            </span>
            <button onClick={() => setCircuitoSel(null)} className="text-texto-3 hover:text-texto">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-3 px-4 py-4 text-[13px]">
            {circuitoSel.op ? (
              <>
                <Dato
                  etiqueta="Empresa asignada"
                  valor={
                    circuitoSel.empresa ? (
                      <span className="flex items-center gap-2 font-semibold">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ background: String(circuitoSel.color_empresa ?? "#8b94a3") }}
                        />
                        {String(circuitoSel.empresa)}
                      </span>
                    ) : (
                      <span className="text-texto-3">sin asignar</span>
                    )
                  }
                />
                <Dato
                  etiqueta="Prioridad"
                  valor={
                    circuitoSel.prioridad ? (
                      <span
                        className="font-semibold"
                        style={{ color: COLOR_PRIORIDAD[String(circuitoSel.prioridad)] ?? "var(--color-texto-2)" }}
                      >
                        {ETIQUETA_PRIORIDAD[String(circuitoSel.prioridad)] ?? String(circuitoSel.prioridad)}
                      </span>
                    ) : (
                      <span className="text-texto-3">sin definir</span>
                    )
                  }
                />
                <div className="grid grid-cols-3 gap-2 border-t border-borde pt-3 text-center">
                  {(
                    [
                      ["pendientes", "Pendientes", "var(--color-abierto)"],
                      ["demandas_abiertas", "Reclamos", "var(--color-encurso)"],
                      ["ordenes_activas", "OTs activas", "var(--color-amarillo)"],
                    ] as const
                  ).map(([clave, etiqueta, color]) => (
                    <div key={clave}>
                      <div className="num text-lg font-extrabold" style={{ color }}>
                        {numero(Number(circuitoSel[clave] ?? 0))}
                      </div>
                      <div className="text-[9px] font-medium tracking-wider text-texto-3 uppercase">{etiqueta}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs leading-relaxed text-texto-3">
                Sin datos operativos ahora mismo (el mapa muestra solo los límites). Reintentá recargando la
                página; el trazado del circuito no depende de esto.
              </p>
            )}
            {Number(circuitoSel.pct_deuda ?? -1) >= 0 && (
              <p className="border-t border-borde pt-2.5 text-[11px] leading-relaxed text-texto-2">
                Deuda: <b className="num">{numero(Number(circuitoSel.deuda_sin ?? 0))}</b> de{" "}
                <b className="num">{numero(Number(circuitoSel.deuda_abiertas ?? 0))}</b> pedidos abiertos sin
                ninguna reparación cerca (<b className="num">{String(circuitoSel.pct_deuda)}%</b>).
              </p>
            )}
          </div>
        </aside>
      )}

      {/* Detalle del sector de licitación clickeado */}
      {sectorSel && !comparar && (
        <aside className="panel-vidrio absolute top-28 right-3 z-20 w-72 max-w-[calc(100vw-24px)] rounded-xl">
          <div className="flex items-center justify-between border-b border-borde px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-bold">
              <span
                className="inline-block h-3 w-3 rounded-sm"
                style={{ background: sectorSel.color_empresa ? String(sectorSel.color_empresa) : "#8b94a3" }}
              />
              {String(sectorSel.sector ?? "Sector")}
            </span>
            <button onClick={() => setSectorSel(null)} className="text-texto-3 hover:text-texto">
              <X size={16} />
            </button>
          </div>
          <div className="space-y-3 px-4 py-4 text-[13px]">
            <Dato
              etiqueta={sectorSel.tipo === "cuadrante" ? "Empresa (hormigón)" : "Empresa"}
              valor={
                sectorSel.empresa ? (
                  <span className="flex items-center gap-2 font-semibold uppercase">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: String(sectorSel.color_empresa ?? "#8b94a3") }}
                    />
                    {String(sectorSel.empresa)}
                  </span>
                ) : (
                  <span className="text-texto-3">sin asignar</span>
                )
              }
            />
            {sectorSel.tipo === "cuadrante" && (
              <Dato
                etiqueta="Empresa (asfalto)"
                valor={
                  sectorSel.empresaAsfalto ? (
                    <span className="font-semibold uppercase">{String(sectorSel.empresaAsfalto)}</span>
                  ) : (
                    <span className="text-texto-3">sin asignar</span>
                  )
                }
              />
            )}
            <Dato
              etiqueta="Licitación"
              valor={
                sectorSel.licitacion ? (
                  <span className="num font-semibold">N.º {String(sectorSel.licitacion)}</span>
                ) : (
                  <span className="text-texto-3">sin número informado</span>
                )
              }
            />
            {sectorSel.panios != null && (
              <Dato etiqueta="Paños" valor={<span className="num font-semibold">{numero(Number(sectorSel.panios))}</span>} />
            )}
            <p className="border-t border-borde pt-2.5 text-[10px] leading-relaxed text-texto-3">
              {sectorSel.tipo === "cuadrante"
                ? "Cuadrante de licitación: dentro de este borde grueso trabajan la empresa de hormigón y la de asfalto indicadas."
                : "Sector de licitación de HORMIGÓN: el relleno usa el mismo color que esa empresa en los circuitos operativos."}
            </p>
          </div>
        </aside>
      )}

      {/* Menú contextual del clic derecho */}
      {menuCtx && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setMenuCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuCtx(null);
            }}
          />
          <div
            className="panel-vidrio absolute z-40 w-52 rounded-xl p-1.5 text-[13px]"
            style={{
              // Acotado contra el contenedor real del mapa (no window): con
              // sidebar+header, window.innerWidth corta el menú a la mitad.
              left: Math.max(8, Math.min(menuCtx.x, (contenedorRef.current?.clientWidth ?? menuCtx.x) - 216)),
              top: Math.max(8, Math.min(menuCtx.y, (contenedorRef.current?.clientHeight ?? menuCtx.y) - 180)),
            }}
          >
            {puedeCargar && (
              <button
                onClick={() => {
                  if (!dentroDeSMT({ lat: menuCtx.lat, lon: menuCtx.lon })) {
                    avisar("Ese punto está fuera del ejido de San Miguel de Tucumán: no se puede cargar ahí.");
                    setMenuCtx(null);
                    return;
                  }
                  setAltaRapida({ lat: menuCtx.lat, lon: menuCtx.lon });
                  setMenuCtx(null);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-semibold text-amarillo transition hover:bg-panel-3"
              >
                Cargar pedido acá
              </button>
            )}
            <button
              onClick={() => {
                setZona({ lon: menuCtx.lon, lat: menuCtx.lat });
                setRadioZona(300);
                setModoAnalisis(true);
                setMenuCtx(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-panel-3"
            >
              Analizar zona acá
            </button>
            <button
              onClick={() => {
                void navigator.clipboard
                  .writeText(`${menuCtx.lat.toFixed(6)}, ${menuCtx.lon.toFixed(6)}`)
                  .then(() => avisar("Coordenadas copiadas ✓"));
                setMenuCtx(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-panel-3"
            >
              Copiar coordenadas
            </button>
            <button
              onClick={() => {
                window.open(
                  `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${menuCtx.lat},${menuCtx.lon}`,
                  "_blank",
                );
                setMenuCtx(null);
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-panel-3"
            >
              Street View acá
            </button>
          </div>
        </>
      )}

      {/* Alta rápida desde el clic derecho — con fondo modal: evita reabrir
          en otro punto con clic derecho debajo mientras el formulario está abierto */}
      {altaRapida && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setAltaRapida(null)} />
          <AltaRapida
            key={`${altaRapida.lat},${altaRapida.lon}`}
            punto={altaRapida}
            alCerrar={() => setAltaRapida(null)}
            alCreado={(id) => {
              setMarcador([altaRapida.lon, altaRapida.lat]);
              setAltaRapida(null);
              avisar(`Pedido #${id} registrado con coordenada exacta ✓`);
              void clienteQuery.invalidateQueries({ queryKey: ["geodata"] });
            }}
          />
        </>
      )}

      {/* Aviso flotante */}
      {aviso && (
        <div className="pointer-events-none absolute bottom-16 left-1/2 z-50 -translate-x-1/2">
          <div className="panel-vidrio rounded-xl border border-resuelto/40 px-4 py-2 text-[13px] font-semibold">{aviso}</div>
        </div>
      )}

      {/* Analizador de zona: círculo o polígono (zonaActiva discrimina) */}
      {zonaActiva && (
        <AnalisisZona
          zona={zonaActiva}
          setRadio={setRadioZona}
          alCambiarForma={cambiarFormaZona}
          demandas={demandasFiltradas}
          incidentes={incidentesFiltrados}
          zonaA={zonaA}
          alFijarA={() => zona && setZonaA({ centro: zona, radio: radioZona })}
          alQuitarA={() => setZonaA(null)}
          alCerrar={() => {
            setZona(null);
            setZonaA(null);
            setVertsZona([]);
            setZonaCerrada(false);
            setModoAnalisis(false);
          }}
          arr={arrAnalisis}
        />
      )}

      {/* Línea de tiempo */}
      {tiempoActivo && mesesTiempo.length > 0 && (
        <LineaTiempo
          meses={mesesTiempo}
          idx={Math.min(tiempoIdx, mesesTiempo.length - 1)}
          setIdx={setTiempoIdx}
          reproduciendo={reproduciendo}
          setReproduciendo={setReproduciendo}
          alCerrar={() => {
            setTiempoActivo(false);
            setReproduciendo(false);
          }}
          pedidosVisibles={demandasFiltradas.features.length}
          reparacionesVisibles={incidentesFiltrados.features.length}
        />
      )}

      {/* Zonas calientes */}
      <div className={`absolute bottom-6 left-72 z-10 hidden ${despejado ? "" : "md:block"}`} style={arrZonas.estilo}>
        {verZonas ? (
          <div className="panel-vidrio w-72 rounded-xl p-4">
            <div
              {...arrZonas.asaProps}
              className="mb-2 flex items-center justify-between select-none"
              title="Arrastrá de acá para mover el panel"
            >
              <span className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
                <GripVertical size={13} className="text-texto-3" />
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
        <div
          className="panel-vidrio absolute top-28 right-3 z-20 w-96 max-w-[calc(100vw-24px)] rounded-xl"
          style={arrInforme.estilo}
        >
          <div
            {...arrInforme.asaProps}
            className="flex items-center justify-between border-b border-borde px-4 py-3 select-none"
            title="Arrastrá de acá para mover el panel"
          >
            <span className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
              <GripVertical size={13} className="text-texto-3" />
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

      {/* Leyenda de la vista Brecha */}
      {/* Esta leyenda es la de FILTRO de la vista Brecha (con sus cuentas y el
          sub-modo de pintado); la del semáforo, fija y sin controles, vive
          abajo a la izquierda. En "limpio" se va con todo lo demás. */}
      {vista === "brecha" && !despejado && (
        // El top se mide contra la barra de herramientas igual que los KPIs, y
        // se corre otra fila para quedar DEBAJO de ellos: con `top-28` fijo,
        // la fila de chips de destino empujó los KPIs justo encima de este
        // panel y las cifras quedaban tapadas.
        <div
          className="panel-vidrio absolute left-1/2 z-10 max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-xl px-4 py-2"
          style={{ top: (altoHerr > 0 ? altoHerr + 24 : 64) + 58 }}
        >
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] font-medium">
            {/* Los cuatro pasos del semáforo, en orden de avance hacia
                resuelto. 'en_obra' es el paso nuevo: salió de 'en_cola'
                cuando hay una cuadrilla trabajando a menos de 40 m. */}
            {(
              [
                ["sin_atencion", "Sin atención", SEMAFORO.sin_atencion],
                ["en_cola", "En cola", SEMAFORO.en_cola],
                ["en_obra", "En obra", SEMAFORO.en_obra],
                ["posible_resuelta", "Parece resuelta", SEMAFORO.resuelto],
              ] as const
            ).map(([clave, etiqueta, color]) => {
              const n = cuentasBrecha[clave] ?? 0;
              const activo = filtroBrecha === clave;
              return (
                <button
                  key={clave}
                  onClick={() => setFiltroBrecha(activo ? null : clave)}
                  title={activo ? "Quitar filtro" : "Mostrar solo esta categoría"}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 transition ${
                    activo ? "border-celeste bg-celeste/15" : "border-transparent hover:border-borde-2"
                  }`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                  {etiqueta} ({numero(n)})
                </button>
              );
            })}
            <Link href="/brecha" className="font-semibold text-celeste hover:underline">
              Informe →
            </Link>
          </div>
          <div className="mt-1.5 flex items-center justify-center gap-2 border-t border-borde pt-1.5">
            <span className="text-[10px] text-texto-3">Pintar por:</span>
            {(
              [
                ["categoria", "Categoría"],
                ["antiguedad", "Antigüedad de la deuda"],
              ] as const
            ).map(([clave, etiqueta]) => (
              <button
                key={clave}
                onClick={() => setModoBrecha(clave)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-semibold transition ${
                  modoBrecha === clave ? "bg-azul text-white" : "text-texto-2 hover:text-texto"
                }`}
              >
                {etiqueta}
              </button>
            ))}
            {modoBrecha === "antiguedad" && (
              <span className="flex items-center gap-1.5 text-[10px] text-texto-3">
                {/* pal.edadReciente y no --color-amarillo: es el hex exacto con
                    el que la capa arranca la rampa en este tema. */}
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: pal.edadReciente }} /> reciente
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#d95926" }} /> +1 año
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#ff3b30" }} /> +2 años
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#6b7280" }} /> sin fecha
              </span>
            )}
          </div>
          <p className="mt-1 text-center text-[10px] text-texto-3">
            Clic en una categoría para aislarla · clic en un punto para cotejarlo con lo que hay cerca
          </p>
        </div>
      )}

      {/* Columna de abajo a la izquierda: el panel de Capas con la leyenda del
          semáforo ANCLADA DEBAJO, las dos en un solo contenedor. Van juntas a
          propósito — así la leyenda no puede taparle el botón de Capas, que
          vive justo acá, y el arrastre del panel se las lleva a las dos. La
          columna arranca a 4.5rem del piso y no a 1.5rem: esos 3 cm de abajo
          son de la escala de MapLibre y de la pastilla de balance, que en
          mobile ocupa todo el ancho. Las dos se esconden durante Comparar: el
          panel porque togglear capas desincroniza la cortina, y la leyenda
          porque le quedaba encima de la tarjeta "Lo pedido" de la cortina. */}
      {/* El max-w va acá y en % (no en vw dentro de la leyenda): el mapa arranca
          después del riel de navegación, así que 100vw sobra justo lo que mide
          ese riel y la leyenda volvía a llegar hasta los controles. Al ser
          `absolute`, el 100% resuelve contra el contenedor del mapa, que es el
          ancho real disponible; las 4.75rem son la columna derecha de controles
          de MapLibre más aire. Al panel de Capas no lo achica (w-72 manda). */}
      <div
        className={`absolute bottom-[4.5rem] left-3 z-10 flex max-w-[calc(100%-4.75rem)] flex-col items-start gap-2 ${despejado ? "hidden" : ""}`}
        style={arrCapas.estilo}
      >
      <div data-tour="capas" className={comparar ? "hidden" : ""}>
        {panelCapas ? (
          <div className="panel-vidrio max-h-[calc(100vh-20rem)] w-72 overflow-y-auto rounded-xl p-4">
            <div
              {...arrCapas.asaProps}
              className="mb-3 flex items-center justify-between select-none"
              title="Arrastrá de acá para mover el panel"
            >
              <span className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase">
                <GripVertical size={13} className="text-texto-3" />
                <Layers size={14} className="text-celeste" /> Capas
              </span>
              <span className="flex items-center gap-1">
                {/* La vista satelital "la usa siempre": atajo fijo en la
                    cabecera, accesible sin scroll aunque el panel esté largo. */}
                <button
                  onClick={() => setVerSatelite((v) => !v)}
                  className={`rounded-md p-1 transition ${verSatelite ? "text-celeste" : "text-texto-3 hover:text-texto"}`}
                  title={verSatelite ? "Apagar la vista satelital" : "Prender la vista satelital"}
                >
                  <Satellite size={14} />
                </button>
                <button onClick={() => setPanelCapas(false)} className="text-texto-3 hover:text-texto">
                  <X size={14} />
                </button>
              </span>
            </div>

            {/* Grupos pedidos por el Director ("yo necesito simpleza… mucha
                info no te permite ver bien"): LO PEDIDO / LO HECHO /
                TERRITORIO / FONDO. Las claves internas del acordeón conservan
                su nombre histórico (demandas/incidentes/territorio) para no
                tocar el mecanismo existente — solo se agregó "fondo". */}
            <Seccion titulo="Lo pedido" resumen={numero(kpis.demandas)}
              abierta={secciones.demandas ?? false}
              alConmutar={() => setSecciones((v) => ({ ...v, demandas: !v.demandas }))} />
            {secciones.demandas && (<>
            <label className="mb-1 flex cursor-pointer items-center gap-2 text-[13px]" title="Los pedidos (reclamos, intimaciones, notas) como puntos sobre el mapa">
              <input type="checkbox" checked={verDemandas} onChange={(e) => setVerDemandas(e.target.checked)} className="accent-[#0066ff]" />
              <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: pal.demanda }} />
              <span className="min-w-0 truncate">Pedidos (puntos)</span>
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
              <span className="min-w-0 truncate">Solo pendientes</span>
            </label>
            <label
              className="mb-1 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Mapa de calor de los pedidos: dónde se concentra la demanda. Disponible en cualquier vista (era la vieja vista Análisis)."
            >
              <input type="checkbox" checked={verCalor} onChange={(e) => setVerCalor(e.target.checked)} className="accent-[#0066ff]" />
              <span className="min-w-0 truncate">Densidad de demanda</span>
            </label>
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Hexágonos extruidos por cantidad de pedidos: inclina la cámara y muestra dónde se concentra la demanda en 3D"
            >
              <input type="checkbox" checked={verHex} onChange={(e) => setVerHex(e.target.checked)} className="accent-[#0066ff]" />
              <Boxes size={13} className="shrink-0 text-celeste" />
              <span className="min-w-0 truncate">Densidad 3D</span>
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
            </>)}

            <Seccion titulo="Lo hecho" resumen={numero(kpis.abiertos + kpis.enCurso + kpis.resueltos)}
              abierta={secciones.incidentes ?? false}
              alConmutar={() => setSecciones((v) => ({ ...v, incidentes: !v.incidentes }))} />
            {secciones.incidentes && (<>
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
                {/* El puntito copia el color REAL del mapa. OJO con "En
                    curso": el FILTRO sigue siendo por macro (una sola casilla)
                    pero el pintado ahora es por estado, así que ese macro se
                    dibuja en dos colores — de ahí el puntito partido. */}
                {clave === "en_curso" ? (
                  <span
                    className="inline-block h-2.5 w-4 shrink-0 rounded-sm"
                    style={{ background: `linear-gradient(90deg, ${SEMAFORO.en_cola} 50%, ${SEMAFORO.en_obra} 50%)` }}
                  />
                ) : (
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      background:
                        clave === "abierto"
                          ? SEMAFORO.sin_atencion
                          : clave === "resuelto"
                            ? SEMAFORO.resuelto
                            : SEMAFORO.inactivo,
                    }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{etiqueta}</span>
                <span className="num text-[10px] text-texto-3">
                  {numero(clave === "abierto" ? kpis.abiertos : clave === "en_curso" ? kpis.enCurso : clave === "resuelto" ? kpis.resueltos : 0)}
                </span>
              </label>
            ))}
            <p className="mb-1 ml-5 text-[10px] leading-snug text-texto-3">
              «En curso» es una sola casilla pero dos pasos del semáforo: en cola (naranja, hay orden emitida) y en obra
              (ámbar, la cuadrilla está trabajando).
            </p>
            {/* El swatch usa la clase, no pal.sigov: es el mismo celeste
                (--color-celeste) y así se re-tematiza sin estilo inline. */}
            <p className="mt-1 mb-2 flex items-center gap-1.5 text-[10px] text-texto-3">
              <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-celeste" /> anillo celeste = obra SIGOV
              (procedencia, no estado)
            </p>
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Numera del 1 al 20 los incidentes activos con mayor score de prioridad: qué hacemos primero"
            >
              <input type="checkbox" checked={verTop20} onChange={(e) => setVerTop20(e.target.checked)} className="accent-[#0066ff]" />
              {/* Mismo disco de tinta invertida que la capa top20-circulo. */}
              <span className="num rounded bg-texto px-1 text-[10px] font-black text-fondo">1</span>
              <span className="min-w-0 truncate">Top 20 urgentes</span>
            </label>
            </>)}

            <Seccion titulo="Territorio" abierta={secciones.territorio ?? false}
              alConmutar={() => setSecciones((v) => ({ ...v, territorio: !v.territorio }))} />
            {secciones.territorio && (<>
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Jerarquía vial oficial: las primarias bien marcadas y las secundarias finas — las terciarias no se muestran porque hacen una mancha"
            >
              <input type="checkbox" checked={verJerarquia} onChange={(e) => setVerJerarquia(e.target.checked)} className="accent-[#0066ff]" />
              <span className="inline-block h-1 w-4 shrink-0 rounded" style={{ background: pal.jerarquiaVial }} />
              <span className="min-w-0 truncate">Avenidas y calles principales</span>
            </label>
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Las 10.392 cuadras según su calzada. El RIPIO es lo importante: ahí no hay bache, es pasado de máquina."
            >
              <input type="checkbox" checked={verRedVial} onChange={(e) => setVerRedVial(e.target.checked)} className="accent-[#0066ff]" />
              <span className="inline-block h-0.5 w-4 shrink-0 rounded" style={{ background: pal.ripio }} />
              <span className="min-w-0 truncate">Pavimento y ripio</span>
            </label>
            {verRedVial && (
              <p className="mb-2 ml-5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-texto-3">
                <span className="inline-block h-1 w-3 rounded" style={{ background: pal.ripio }} /> ripio
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: pal.pavimento }} /> pavimento
                <span className="inline-block w-3 border-t border-dashed" style={{ borderColor: pal.cordonCuneta }} /> cordón cuneta
              </p>
            )}
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Los 11 sectores de HORMIGÓN teñidos por empresa y los 4 cuadrantes (hormigón + asfalto) con borde grueso. Clic en uno para su detalle."
            >
              <input type="checkbox" checked={verSectores} onChange={(e) => setVerSectores(e.target.checked)} className="accent-[#0066ff]" />
              <span className="inline-block h-2.5 w-4 shrink-0 rounded-sm border border-[#4f9cf9]" style={{ background: "rgba(79,156,249,0.35)" }} />
              <span className="min-w-0 truncate">Sectores de licitación</span>
            </label>
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Las zonas del programa Bacheo integral (SE, SO y Centro-Este) con su n° de obra, monto y plazo — pasá el mouse por una zona para ver el detalle"
            >
              <input type="checkbox" checked={verBacheoIntegral} onChange={(e) => setVerBacheoIntegral(e.target.checked)} className="accent-[#0066ff]" />
              <span className="inline-block h-2.5 w-4 shrink-0 rounded-sm border border-dashed" style={{ borderColor: pal.bacheoIntegral, background: pal.oscuro ? "rgba(45,212,191,0.12)" : "rgba(13,148,136,0.12)" }} />
              <span className="min-w-0 truncate">Bacheo integral (obras)</span>
            </label>
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Recorridos de las líneas de colectivos (sensibilidad por transporte) — pasá el mouse por una línea para ver línea y ramal"
            >
              <input type="checkbox" checked={verColectivos} onChange={(e) => setVerColectivos(e.target.checked)} className="accent-[#0066ff]" />
              <span className="inline-block h-0.5 w-4 shrink-0 rounded" style={{ background: pal.colectivo }} />
              <span className="min-w-0 truncate">Recorridos de colectivos</span>
            </label>
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Los 20 distritos oficiales — de acá sale el distrito_id que ya tienen las demandas e incidentes"
            >
              <input
                type="checkbox"
                checked={verDistritos}
                onChange={(e) => setVerDistritos(e.target.checked)}
                className="accent-[#0066ff]"
              />
              <span className="inline-block h-0.5 w-4 shrink-0 rounded" style={{ background: pal.distritos, borderTop: `1px dashed ${pal.distritos}` }} />
              <span className="min-w-0 truncate">Distritos</span>
            </label>
            {verDistritos && (
              <label
                className="mb-2 ml-5 flex cursor-pointer items-center gap-2 text-[13px]"
                title="Tiñe cada distrito según qué porcentaje de sus pedidos abiertos no tiene ninguna reparación cerca: verde atendido, rojo abandonado"
              >
                <input
                  type="checkbox"
                  checked={verCoropleta}
                  onChange={(e) => setVerCoropleta(e.target.checked)}
                  className="accent-[#0066ff]"
                />
                <span
                  className="inline-block h-2.5 w-4 shrink-0 rounded-sm"
                  style={{ background: "linear-gradient(90deg,#199e70,#f4dc00,#ff3b30)" }}
                />
                <span className="min-w-0 truncate">Pintar por deuda</span>
              </label>
            )}
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Los 47 circuitos de trabajo del bacheo (trazado electoral INDEC). Con órdenes de trabajo cargadas se tiñen por empresa asignada y el borde marca la prioridad: naranja primaria, amarillo secundaria. Clic en un circuito para su detalle."
            >
              <input
                type="checkbox"
                checked={verCircuitos}
                onChange={(e) => setVerCircuitos(e.target.checked)}
                className="accent-[#0066ff]"
              />
              <span className="inline-block h-0.5 w-4 shrink-0 rounded" style={{ background: pal.circuitos }} />
              <span className="min-w-0 truncate">Circuitos de trabajo</span>
            </label>
            {verCircuitos && puedeVerDeuda && (
              <label
                className="mb-2 ml-5 flex cursor-pointer items-center gap-2 text-[13px]"
                title="Tiñe cada circuito según qué porcentaje de sus pedidos abiertos no tiene ninguna reparación cerca: verde atendido, rojo abandonado. Apagalo para volver al tinte por empresa asignada."
              >
                <input
                  type="checkbox"
                  checked={verDeudaCircuitos}
                  onChange={(e) => setVerDeudaCircuitos(e.target.checked)}
                  className="accent-[#0066ff]"
                />
                <span
                  className="inline-block h-2.5 w-4 shrink-0 rounded-sm"
                  style={{ background: "linear-gradient(90deg,#199e70,#f4dc00,#ff3b30)" }}
                />
                <span className="min-w-0 truncate">Pintar por deuda</span>
              </label>
            )}
            {verCircuitos && circuitosOp && !(verDeudaCircuitos && deudaCircuitos) && (
              <p className="mb-2 ml-5 flex items-center gap-1.5 text-[10px] text-texto-3">
                <span className="inline-block h-2 w-3 rounded-sm" style={{ background: "rgba(79,156,249,0.45)" }} />
                relleno = empresa ·
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: "#d95926" }} />
                <span className="inline-block h-0.5 w-3 rounded" style={{ background: "var(--color-amarillo)" }} />
                borde = prioridad
              </p>
            )}
            {verCircuitos && verDeudaCircuitos && deudaCircuitos && (
              <p className="mb-2 ml-5 flex items-center gap-1.5 text-[10px] text-texto-3">
                <span
                  className="inline-block h-2 w-8 rounded-sm"
                  style={{ background: "linear-gradient(90deg,#199e70,#f4dc00,#d95926,#ff3b30)" }}
                />
                relleno = % de pedidos sin atención
              </p>
            )}
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="327 barrios — los que tienen problemas reportados se marcan con un tinte rojo tenue. Etiquetas solo de cerca."
            >
              <input
                type="checkbox"
                checked={verBarrios}
                onChange={(e) => setVerBarrios(e.target.checked)}
                className="accent-[#0066ff]"
              />
              <span className="inline-block h-0.5 w-4 shrink-0 rounded" style={{ background: pal.barrios }} />
              <span className="min-w-0 truncate">Barrios</span>
            </label>
            {verBarrios && puedeVerDeuda && (
              <label
                className="mb-2 ml-5 flex cursor-pointer items-center gap-2 text-[13px]"
                title="Tiñe cada barrio según qué porcentaje de sus pedidos abiertos no tiene ninguna reparación cerca: verde atendido, rojo abandonado. Pasá el mouse por un barrio para ver sus números."
              >
                <input
                  type="checkbox"
                  checked={verDeudaBarrios}
                  onChange={(e) => setVerDeudaBarrios(e.target.checked)}
                  className="accent-[#0066ff]"
                />
                <span
                  className="inline-block h-2.5 w-4 shrink-0 rounded-sm"
                  style={{ background: "linear-gradient(90deg,#199e70,#f4dc00,#ff3b30)" }}
                />
                <span className="min-w-0 truncate">Pintar por deuda</span>
              </label>
            )}
            </>)}

            <Seccion titulo="Fondo" abierta={secciones.fondo ?? false}
              alConmutar={() => setSecciones((v) => ({ ...v, fondo: !v.fondo }))} />
            {secciones.fondo && (<>
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Imagen satelital real (Esri) para ubicar con precisión — los nombres de calles quedan encima. También está el atajo con el ícono de arriba."
            >
              <input
                type="checkbox"
                checked={verSatelite}
                onChange={(e) => setVerSatelite(e.target.checked)}
                className="accent-[#0066ff]"
              />
              <Satellite size={13} className="shrink-0 text-celeste" />
              <span className="min-w-0 truncate">Vista satelital</span>
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
              <span className="shrink-0 text-[10px] text-texto-3">Aa</span>
              <span className="min-w-0 truncate">Nombres de calles</span>
            </label>
            <label
              className="mb-2 flex cursor-pointer items-center gap-2 text-[13px]"
              title="Realce azul de avenidas y corredores según OpenStreetMap (es parte del fondo; la capa oficial está en Territorio)"
            >
              <input
                type="checkbox"
                checked={verAvenidas}
                onChange={(e) => setVerAvenidas(e.target.checked)}
                className="accent-[#0066ff]"
              />
              <span className="inline-block h-0.5 w-4 shrink-0 rounded bg-celeste" />
              <span className="min-w-0 truncate">Realce de avenidas</span>
            </label>
            </>)}

            <Seccion titulo="Tipo de problema" abierta={secciones.tipos ?? false}
              alConmutar={() => setSecciones((v) => ({ ...v, tipos: !v.tipos }))} />
            {secciones.tipos && (
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
            )}

            <Seccion titulo="Período" resumen={dias ? dias + "d" : "Todo"} abierta={secciones.periodo ?? false}
              alConmutar={() => setSecciones((v) => ({ ...v, periodo: !v.periodo }))} />
            {secciones.periodo && (
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
            )}
          </div>
        ) : (
          <button onClick={() => setPanelCapas(true)} className="panel-vidrio rounded-xl p-3 text-celeste transition hover:text-texto" title="Capas">
            <Layers size={18} />
          </button>
        )}
      </div>
      {/* La leyenda se va con Comparar: la cortina «Lo pedido | Lo hecho» tiene
          su propio lenguaje visual (dos mapas rotulados) y la leyenda le
          quedaba encima de la tarjeta "Lo pedido", que vive a bottom-16. */}
      {!comparar && (
        <LeyendaSemaforo
          vista={vista}
          modoBrecha={modoBrecha}
          verMacro={verMacro}
          destinos={destinos}
          colorSat={pal.destinoSat}
          colorIngenieria={pal.destinoIngenieria}
          colorEdadReciente={pal.edadReciente}
        />
      )}
      </div>

      {/* Recorrido guiado: ¿para qué sirve cada cosa? */}
      {guiaAbierta && <GuiaMapa alCerrar={() => setGuiaAbierta(false)} />}

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
      className="panel-vidrio pointer-events-auto flex shrink-0 cursor-help items-center gap-2 rounded-xl px-2.5 py-1.5 sm:gap-2.5 sm:px-3.5 sm:py-2"
      title={ayuda}
    >
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${pulso ? "pulso" : ""}`} style={{ background: color }} />
      <div className="leading-tight">
        <div className="num text-sm font-bold sm:text-base">{numero(valor)}</div>
        <div className="text-[9px] font-medium tracking-wider text-texto-3 uppercase">{etiqueta}</div>
      </div>
    </div>
  );
}

function ItemAccion({
  icono,
  titulo,
  desc,
  onClick,
  activo,
}: {
  icono: React.ReactNode;
  titulo: string;
  desc: string;
  onClick: () => void;
  activo?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-panel-3"
    >
      <span className={`mt-0.5 shrink-0 ${activo ? "text-amarillo" : "text-celeste"}`}>{icono}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{titulo}</span>
        <span className="block text-[10px] leading-snug text-texto-3">{desc}</span>
      </span>
    </button>
  );
}

function PanelDetalle({ seleccion, alCerrar }: { seleccion: Seleccion; alCerrar: () => void }) {
  const p = seleccion.props;
  const esIncidente = seleccion.capa === "incidente";
  const destino = destinoDe(p.destino);

  return (
    <aside className="panel-vidrio absolute top-28 right-3 bottom-6 z-10 flex w-80 flex-col rounded-xl">
      <div className="flex items-center justify-between border-b border-borde px-4 py-3">
        <div className="flex items-center gap-2">
          {esIncidente ? (
            <>
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ background: SEMAFORO[pasoDeEstado(String(p.estado) as EstadoIncidente)] }}
              />
              <span className="text-sm font-bold">Incidente #{String(p.id)}</span>
            </>
          ) : (
            <>
              <span className="inline-block h-3 w-3 rounded-full bg-texto-2" />
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
            {/* "Debería mandarte al pedido": si hay demandas vinculadas, el
                popup lleva directo a la historia del incidente (donde viven
                los pedidos); si no hay, se dice honesto — relevamiento interno. */}
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-texto-3 uppercase">Pedidos detrás</div>
              <div className="mt-0.5">
                {Number(p.demandas ?? 0) > 0 ? (
                  <Link
                    href={`/incidentes/${String(p.id)}`}
                    className="font-semibold text-celeste hover:underline"
                  >
                    ver los pedidos ({numero(Number(p.demandas))}) →
                  </Link>
                ) : (
                  <span className="text-texto-3">sin pedido detrás: relevamiento interno</span>
                )}
              </div>
            </div>
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
            {/* QUIÉN RESUELVE, solo cuando no es bacheo: el pedido no lo va a
                cerrar la cuadrilla, así que el link no va a la bandeja general
                sino a la de tratamiento que corresponde. */}
            {destino !== "bacheo" && (
              <div className="rounded-lg border border-borde-2 p-2.5">
                <div className="text-[10px] font-semibold tracking-wider text-texto-3 uppercase">No lo resuelve bacheo</div>
                <p className="mt-0.5 text-[12px] font-semibold">{ETIQUETA_DESTINO[destino]}</p>
                <p className="mt-1 text-[11px] leading-snug text-texto-2">
                  {destino === "sat"
                    ? "Pérdida de agua, tapa o sumidero: se resuelve por expediente a la SAT."
                    : "No es un bache (calle de ripio, apertura o problema de traza): lo trata Ingeniería."}
                </p>
                {p.expediente != null && p.expediente_id != null ? (
                  <Link
                    href={`/expedientes/${String(p.expediente_id)}`}
                    className="mt-1 inline-block text-[11px] font-semibold text-celeste hover:underline"
                  >
                    Ver el expediente {String(p.expediente)} →
                  </Link>
                ) : (
                  <Link
                    href={`/calidad/tratamiento/${destino === "sat" ? "derivar_sat" : "no_es_bache"}`}
                    className="mt-1 inline-block text-[11px] font-semibold text-celeste hover:underline"
                  >
                    Ver la bandeja de tratamiento →
                  </Link>
                )}
              </div>
            )}
            {p.brecha != null && p.brecha !== "atendida" && (
              <div className="rounded-lg border border-borde bg-panel-2/60 p-2.5">
                <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: SEMAFORO[pasoDeBrecha(String(p.brecha))] }}
                  />
                  {ETIQUETA_BRECHA[String(p.brecha)] ?? String(p.brecha).replaceAll("_", " ")}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-texto-2">
                  {p.brecha === "sin_atencion"
                    ? "No hay reparación ni trabajo en curso a menos de 40 m: este pedido está en la brecha real."
                    : p.brecha === "en_cola"
                      ? "Hay un incidente abierto a menos de 40 m: este pedido debería vincularse a ese trabajo."
                      : p.brecha === "en_obra"
                        ? "Hay una cuadrilla trabajando a menos de 40 m: vinculalo a ese trabajo y sale de la deuda cuando cierre."
                        : "Hay una reparación posterior a menos de 40 m: cotejalo para cerrar el circuito y que cuente como atendido."}
                </p>
              </div>
            )}
          </>
        )}
        <div className="num pt-1 text-[10px] text-texto-3">
          {seleccion.lngLat[1].toFixed(6)}, {seleccion.lngLat[0].toFixed(6)}
        </div>

        {/* La foto de la obra contra cómo se ve la calle, sin salir del mapa */}
        <ComparadorObra
          incidenteId={esIncidente ? Number(p.id) : null}
          lat={seleccion.lngLat[1]}
          lon={seleccion.lngLat[0]}
        />
      </div>

      <div className="border-t border-borde p-3">
        <Link
          href={esIncidente ? `/incidentes?foco=${String(p.id)}` : `/demandas/${String(p.id)}`}
          className="block rounded-lg bg-azul px-3 py-2.5 text-center text-sm font-semibold text-white transition hover:brightness-110"
        >
          {esIncidente
            ? "Gestionar incidente"
            : p.brecha === "posible_resuelta"
              ? "Revisar y cotejar →"
              : "Abrir el pedido →"}
        </Link>
      </div>
    </aside>
  );
}

/**
 * LA LEYENDA DEL SEMÁFORO, siempre a la vista. Hasta ahora el único lugar
 * donde se explicaba el color era el panel de Capas, que está cerrado casi
 * siempre: nadie sabía qué quería decir un punto naranja. Es fija y NO
 * interactiva (los filtros ya viven en la leyenda de Brecha y en el panel de
 * Capas; duplicarlos acá sería otro control que aprender).
 *
 * Muestra solo los pasos que esta vista puede llegar a dibujar: en Brecha, los
 * cuatro de la deuda; en las demás, los que correspondan a las casillas de
 * incidentes prendidas — que es lo que el usuario está mirando de verdad.
 *
 * Y en Brecha + "Antigüedad de la deuda" NO dibuja el semáforo: ahí los puntos
 * los pinta capaDemandasEdad, que es otra rampa entera (amarillo reciente →
 * rojo con más de dos años, gris sin fecha). Sin este caso la leyenda declaraba
 * cuatro pasos que en pantalla no existían.
 */
function LeyendaSemaforo({
  vista,
  modoBrecha,
  verMacro,
  destinos,
  colorSat,
  colorIngenieria,
  colorEdadReciente,
}: {
  vista: Vista;
  modoBrecha: "categoria" | "antiguedad";
  verMacro: Record<string, boolean>;
  destinos: Record<string, boolean>;
  colorSat: string;
  colorIngenieria: string;
  /** El arranque de la rampa de edad cambia por tema (#f4dc00 / #bfa000): la
   *  leyenda lo recibe hecho para pintar exactamente lo que pinta la capa. */
  colorEdadReciente: string;
}) {
  /** Con el mapa pintado por antigüedad el semáforo no aplica: la leyenda
   *  muestra la rampa real de capaDemandasEdad, mismos colores y mismos cortes. */
  const porEdad = vista === "brecha" && modoBrecha === "antiguedad";

  const pasos: Array<[string, string]> =
    porEdad
      ? []
      : vista === "brecha"
      ? [
          [SEMAFORO.sin_atencion, "Sin atención"],
          [SEMAFORO.en_cola, "En cola"],
          [SEMAFORO.en_obra, "En obra"],
          [SEMAFORO.resuelto, "Parece resuelto"],
        ]
      : [
          ...(verMacro.abierto ? ([[SEMAFORO.sin_atencion, "Sin atención"]] as Array<[string, string]>) : []),
          // El macro "en curso" se dibuja en dos pasos: comprometido y en obra.
          ...(verMacro.en_curso
            ? ([
                [SEMAFORO.en_cola, "En cola"],
                [SEMAFORO.en_obra, "En obra"],
              ] as Array<[string, string]>)
            : []),
          ...(verMacro.resuelto ? ([[SEMAFORO.resuelto, "Resuelto"]] as Array<[string, string]>) : []),
          ...(verMacro.inactivo ? ([[SEMAFORO.inactivo, "Desestimado"]] as Array<[string, string]>) : []),
        ];

  /** Las dos colas ajenas, con el MISMO grosor de anillo que usa el mapa: la
   *  SAT fino, Ingeniería grueso (ver capaDemandasDestino). */
  const marcas: Array<[string, string, string]> = [
    ...(destinos.sat === true ? ([[colorSat, "SAT (agua)", "border-2"]] as Array<[string, string, string]>) : []),
    ...(destinos.ingenieria === true
      ? ([[colorIngenieria, "Ingeniería (ripio)", "border-[3px]"]] as Array<[string, string, string]>)
      : []),
  ];

  if (pasos.length === 0 && !porEdad && marcas.length === 0) return null;

  return (
    /* El ancho está acotado a 100vw − 4.75rem y no a 100vw − 1.5rem: con el
       ancho casi completo la leyenda llegaba a x≈363 en 375 px y se metía
       debajo de la columna derecha de controles de MapLibre (zoom, brújula y
       geolocalizar, x≈336..365), que quedaban intocables. Sigue sin capturar el
       puntero (pointer-events-none): es un rótulo, no un control. */
    <div className="panel-vidrio pointer-events-none max-w-[calc(100vw-4.75rem)] rounded-xl px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] font-medium text-texto-2">
        {porEdad ? (
          <>
            {/* La rampa de capaDemandasEdad, no el semáforo: mismos hex y mismos
                cortes que la capa (30 d → 2 años), más el gris de "sin fecha",
                que es un caso aparte y no un extremo de la rampa. */}
            <span className="flex items-center gap-1 whitespace-nowrap">
              <span
                className="inline-block h-2.5 w-10 shrink-0 rounded-full"
                style={{ background: `linear-gradient(90deg,${colorEdadReciente},#f59e0b,#d95926,#ff3b30)` }}
              />
              reciente → +2 años
            </span>
            <span className="flex items-center gap-1 whitespace-nowrap">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: "#6b7280" }} />
              sin fecha
            </span>
          </>
        ) : (
          pasos.map(([color, etiqueta]) => (
            <span key={etiqueta} className="flex items-center gap-1 whitespace-nowrap">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
              {etiqueta}
            </span>
          ))
        )}
        {/* Las colas ajenas se distinguen por FORMA (anillo sin relleno, fino o
            grueso), no solo por color: su estado no es el del bacheo. */}
        {marcas.map(([color, etiqueta, grosor]) => (
          <span key={etiqueta} className="flex items-center gap-1 whitespace-nowrap">
            <span
              className={`inline-block h-3 w-3 shrink-0 rounded-full ${grosor}`}
              style={{ borderColor: color }}
            />
            {etiqueta}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Encabezado de sección del panel de capas (acordeón con resumen vivo). */
function Seccion({
  titulo,
  resumen,
  abierta,
  alConmutar,
}: {
  titulo: string;
  resumen?: string;
  abierta: boolean;
  alConmutar: () => void;
}) {
  return (
    <button
      onClick={alConmutar}
      className="mt-2 mb-1.5 flex w-full items-center gap-1.5 text-[10px] font-semibold tracking-wider text-texto-3 uppercase transition first:mt-0 hover:text-texto"
    >
      <ChevronDown size={12} className={`transition-transform ${abierta ? "" : "-rotate-90"}`} />
      <span className="flex-1 text-left">{titulo}</span>
      {resumen && <span className="num normal-case">{resumen}</span>}
    </button>
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
