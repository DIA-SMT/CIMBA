"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Maximize2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExpressionSpecification, FilterSpecification, Map as MapaLibre } from "maplibre-gl";
import {
  Layer,
  Map as MapaGL,
  Marker,
  NavigationControl,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import {
  fechaLarga,
  type Camara,
  type DatosAvance,
  type EnCursoProps,
  type Foco,
  type HechoProps,
  type OrdenActiva,
  type PendienteProps,
  type Territorio,
} from "@/lib/avance-tipos";
import { colorDeEmpresaEn } from "@/lib/color-empresa";
import { fechaCorta, numero } from "@/lib/formato";
import { AntesDespues } from "@/components/antes-despues";
import type { ParAntesDespues } from "@/components/visor-antes-despues";
import { estiloMapa, usarTemaMapa } from "@/components/mapa/tema-mapa";

/**
 * EL MAPA DE AVANCE, de abajo hacia arriba: contorno del recorte, áreas de
 * órdenes, pedidos pendientes, celdas agrupadas (lejos), trabajo hecho
 * (cerca), el latido de lo reciente y de lo que acaba de entrar, obras en
 * curso, el resalte de la empresa señalada, rótulos de las órdenes. Lo hecho
 * tapa lo pendiente y no al revés.
 *
 * LEJOS Y CERCA. A escala ciudad, 3.000 círculos encimados son una mancha:
 * por debajo del zoom 13 el trabajo se junta en celdas de una o dos manzanas,
 * cada una del color de la empresa que más hizo ahí y con la cantidad adentro.
 * Al acercar, las celdas se desvanecen y aparecen los puntos. La agrupación
 * se calcula acá, en el cliente, y respeta la línea de tiempo y la empresa
 * aislada: cambiar de día no vuelve a subir nada al servidor.
 *
 * El color de la empresa se resuelve acá y viaja como propiedad: MapLibre no
 * puede hashear el nombre adentro de una expresión de pintado. En tema claro
 * se usa la variante oscurecida de los colores que se lavan sobre blanco.
 *
 * Al pasar el cursor, una etiqueta chica dice qué es eso. El clic abre la
 * ficha completa, con el antes y el después, que se puede ampliar a pantalla
 * completa.
 */

const CENTRO_SMT: [number, number] = [-65.2226, -26.8241];

const ETIQUETA_TIPO: Record<string, string> = {
  bacheo: "bacheo",
  pano_hormigon: "paño de hormigón",
  carpeta: "carpeta asfáltica",
  enripiado: "enripiado",
};

/** Tamaño de la celda de agrupación: ~275 m, una o dos manzanas. */
const CELDA_LAT = 0.0025;
const CELDA_LON = 0.0028;
/** Entre estos dos zooms las celdas se van y llegan los puntos. */
const ZOOM_LEJOS = 12.8;
const ZOOM_CERCA = 13.6;

/**
 * El radio: 3 px de piso para que un bache sin medida exista igual, más la
 * raíz de los m² (el área del círculo crece con los m², no el radio), con
 * techo para que un tramo de 1.000 m² no tape el barrio. Y escala con el zoom.
 */
const RADIO_BASE: ExpressionSpecification = [
  "min",
  26,
  ["+", 3, ["*", 0.9, ["sqrt", ["max", 0, ["coalesce", ["get", "m2"], 0]]]]],
];
const RADIO: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  10, ["*", 0.35, RADIO_BASE],
  13, ["*", 0.75, RADIO_BASE],
  16, ["*", 1.3, RADIO_BASE],
];
/** El radio de una celda, por cantidad de baches. */
const RADIO_CELDA: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["get", "n"],
  1, 6,
  5, 10,
  20, 15,
  80, 22,
  300, 32,
];

const ES_RECIENTE: ExpressionSpecification = ["==", ["get", "reciente"], true];

/** Lo que se ve de cerca aparece entre los dos zooms; lo de lejos, al revés. */
const deCerca = (valor: ExpressionSpecification | number): ExpressionSpecification => [
  "interpolate", ["linear"], ["zoom"], ZOOM_LEJOS, 0, ZOOM_CERCA, valor,
];
const deLejos = (valor: ExpressionSpecification | number): ExpressionSpecification => [
  "interpolate", ["linear"], ["zoom"], ZOOM_LEJOS, valor, ZOOM_CERCA, 0,
];

type Seleccion =
  | { tipo: "hecho"; props: HechoProps; lngLat: [number, number] }
  | { tipo: "encurso"; props: EnCursoProps; lngLat: [number, number] }
  | { tipo: "pendiente"; props: PendienteProps; lngLat: [number, number] }
  | { tipo: "orden"; props: OrdenActiva; lngLat: [number, number] };

interface Sobrevuelo {
  x: number;
  y: number;
  capa: string;
  props: Record<string, unknown>;
}

const medida = (m2: unknown) => (typeof m2 === "number" && m2 > 0 ? `${numero(Math.round(m2))} m²` : "sin medida");

/** La caja de un polígono o multipolígono, para encuadrarlo. */
function cajaDe(g: Territorio["contorno"]): [[number, number], [number, number]] | null {
  const anillos = g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const anillo of anillos) {
    for (const [lon, lat] of anillo as Array<[number, number]>) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return Number.isFinite(minLon) ? [[minLon, minLat], [maxLon, maxLat]] : null;
}

export function MapaAvance({
  datos,
  empresaSel,
  resaltada,
  ordenResaltada,
  cursor,
  nuevos,
  verPendientes,
  foco,
  camaraInicial,
  alListo,
  alAmpliar,
  pantalla,
  publico,
}: {
  datos: DatosAvance;
  /** Empresa aislada (clic en la columna): solo ella se dibuja. */
  empresaSel: string | null;
  /** Empresa bajo el cursor en la columna: las demás se atenúan. */
  resaltada: string | null;
  /** Orden bajo el cursor en la columna: su área se engrosa. */
  ordenResaltada: number | null;
  /** Día hasta el que se muestra (línea de tiempo); null = todo. */
  cursor: number | null;
  /** Los trabajos que entraron en el último refresco: laten en amarillo. */
  nuevos: ReadonlySet<number>;
  verPendientes: boolean;
  /** A dónde ir (una foto, una línea del feed, una dirección). */
  foco: Foco | null;
  /** La cámara con la que abre (de un link compartido). */
  camaraInicial: Camara | null;
  /** El mapa ya cargó: quien lo necesite (compartir) se lo guarda. */
  alListo?: (mapa: MapaLibre) => void;
  /** Abrir el antes y el después a pantalla completa. */
  alAmpliar?: (par: ParAntesDespues) => void;
  pantalla: boolean;
  publico: boolean;
}) {
  const tema = usarTemaMapa();
  const oscuro = tema === "oscuro";
  const mapRef = useRef<MapRef>(null);
  const [cargado, setCargado] = useState(false);
  const [sel, setSel] = useState<Seleccion | null>(null);
  const [sobre, setSobre] = useState<Sobrevuelo | null>(null);
  const [marcador, setMarcador] = useState<{ lon: number; lat: number } | null>(null);
  const sinLinks = pantalla || publico;
  const color = (empresa: string) => colorDeEmpresaEn(empresa, tema);

  const conColor = <T extends { properties: { empresa: string } }>(fc: { type: "FeatureCollection"; features: T[] }) => ({
    type: "FeatureCollection" as const,
    features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, color: color(f.properties.empresa) } })),
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hechos = useMemo(() => conColor(datos.hechos), [datos.hechos, tema]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const areas = useMemo(() => conColor(datos.areas), [datos.areas, tema]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const enCurso = useMemo(() => conColor(datos.enCurso), [datos.enCurso, tema]);
  const contorno = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: datos.territorio
        ? [{ type: "Feature" as const, geometry: datos.territorio.contorno, properties: { nombre: datos.territorio.nombre } }]
        : [],
    }),
    [datos.territorio],
  );

  /**
   * LAS CELDAS: lo hecho agrupado en cuadrículas de una o dos manzanas, para
   * verlo de lejos. Respetan la línea de tiempo y la empresa aislada.
   */
  const celdas = useMemo(() => {
    const acumulado = new Map<string, { n: number; m2: number; lon: number; lat: number; por: Map<string, number> }>();
    for (const f of datos.hechos.features) {
      const p = f.properties;
      if (cursor != null && p.dia > cursor) continue;
      if (empresaSel && p.empresa !== empresaSel) continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const clave = `${Math.floor(lat / CELDA_LAT)}:${Math.floor(lon / CELDA_LON)}`;
      let c = acumulado.get(clave);
      if (!c) {
        c = { n: 0, m2: 0, lon: 0, lat: 0, por: new Map() };
        acumulado.set(clave, c);
      }
      c.n++;
      c.m2 += p.m2 ?? 0;
      c.lon += lon;
      c.lat += lat;
      c.por.set(p.empresa, (c.por.get(p.empresa) ?? 0) + 1);
    }
    return {
      type: "FeatureCollection" as const,
      features: [...acumulado.values()].map((c) => {
        let empresa = "Otros";
        let max = -1;
        for (const [e, n] of c.por) {
          if (n > max) {
            max = n;
            empresa = e;
          }
        }
        return {
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [c.lon / c.n, c.lat / c.n] },
          properties: {
            n: c.n,
            m2: Math.round(c.m2),
            empresa,
            otras: c.por.size - 1,
            color: color(empresa),
            etiqueta: c.n > 1 ? numero(c.n) : "",
          },
        };
      }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos.hechos, cursor, empresaSel, tema]);

  /* Los filtros: la línea de tiempo y la empresa aislada. ["all"] vacío es verdadero. */
  const partes = useMemo(() => {
    const p: ExpressionSpecification[] = [];
    if (cursor != null) p.push(["<=", ["get", "dia"], cursor]);
    if (empresaSel) p.push(["==", ["get", "empresa"], empresaSel]);
    return p;
  }, [cursor, empresaSel]);
  const filtroHechos = ["all", ...partes] as unknown as FilterSpecification;
  const filtroPulso = ["all", ES_RECIENTE, ...partes] as unknown as FilterSpecification;
  const filtroPorEmpresa = (
    empresaSel ? ["all", ["==", ["get", "empresa"], empresaSel]] : ["all"]
  ) as unknown as FilterSpecification;
  const idsNuevos = useMemo(() => [...nuevos], [nuevos]);
  const filtroNuevos = ["all", ["in", ["get", "id"], ["literal", idsNuevos]], ...partes] as unknown as FilterSpecification;
  /* El resalte desde la columna: una capa aparte que dibuja solo la empresa
     señalada a pleno, mientras las capas base bajan a un fondo. Cambiar de
     empresa cambia un filtro, que es instantáneo. */
  const filtroResalte = ["all", ["==", ["get", "empresa"], resaltada ?? ""], ...partes] as unknown as FilterSpecification;
  const filtroResalteEmpresa = ["all", ["==", ["get", "empresa"], resaltada ?? ""]] as unknown as FilterSpecification;
  const hayResalte = resaltada != null;

  /**
   * LOS LATIDOS: lo cargado en las últimas 48 horas late en celeste; lo que
   * acaba de entrar en este refresco, en amarillo y más grande. Se animan
   * cambiando dos propiedades de pintado por cuadro; con movimiento reducido
   * quedan anillos fijos.
   */
  useEffect(() => {
    if (!cargado) return;
    const mapa = mapRef.current?.getMap();
    if (!mapa) return;
    const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    const inicio = performance.now();
    const paso = (t: number) => {
      /* El primer cuadro puede traer un tiempo anterior al del arranque; la
         fase se acota a [0, 1) para que la opacidad nunca pase de 1, que
         MapLibre rechaza con un error. */
      const fase = Math.min(0.999, Math.max(0, ((((t - inicio) % 1800) + 1800) % 1800) / 1800));
      if (mapa.getLayer("av-hechos-pulso")) {
        mapa.setPaintProperty("av-hechos-pulso", "circle-radius", reducido ? 11 : 6 + fase * 18);
        mapa.setPaintProperty("av-hechos-pulso", "circle-stroke-opacity", reducido ? 0.6 : 0.9 * (1 - fase));
      }
      if (mapa.getLayer("av-hechos-nuevo")) {
        mapa.setPaintProperty("av-hechos-nuevo", "circle-radius", reducido ? 16 : 8 + fase * 30);
        mapa.setPaintProperty("av-hechos-nuevo", "circle-stroke-opacity", reducido ? 0.8 : 1 - fase);
      }
      if (!reducido) raf = requestAnimationFrame(paso);
    };
    raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [cargado, tema]);

  /* Aislar una empresa también encuadra su trabajo: si no, "Solo Sercovial"
     puede dejar dos puntos fuera de pantalla y parecer que no hizo nada. */
  useEffect(() => {
    if (!empresaSel || !cargado) return;
    const mapa = mapRef.current?.getMap();
    if (!mapa) return;
    const puntos = [...datos.hechos.features, ...datos.enCurso.features]
      .filter((f) => f.properties.empresa === empresaSel)
      .map((f) => f.geometry.coordinates);
    if (puntos.length === 0) return;
    if (puntos.length === 1) {
      mapa.flyTo({ center: puntos[0] as [number, number], zoom: 15, duration: 900 });
      return;
    }
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const [lon, lat] of puntos as Array<[number, number]>) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    mapa.fitBounds([[minLon, minLat], [maxLon, maxLat]], { padding: 70, maxZoom: 15.5, duration: 900 });
    // Solo al elegir: un refresco de datos no tiene que mover la cámara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaSel, cargado]);

  /* El recorte: al elegir un distrito o un barrio, la cámara lo encuadra; al
     quitarlo, vuelve a la ciudad. */
  const recorteAnterior = useRef<string | null>(null);
  useEffect(() => {
    if (!cargado) return;
    const mapa = mapRef.current?.getMap();
    if (!mapa) return;
    const clave = datos.territorio ? `${datos.territorio.tipo}-${datos.territorio.id}` : null;
    if (clave === recorteAnterior.current) return;
    const habia = recorteAnterior.current;
    recorteAnterior.current = clave;
    if (datos.territorio) {
      const caja = cajaDe(datos.territorio.contorno);
      if (caja) mapa.fitBounds(caja, { padding: 50, maxZoom: 16, duration: 1000 });
    } else if (habia) {
      mapa.flyTo({ center: CENTRO_SMT, zoom: 12.3, duration: 1000 });
    }
  }, [datos.territorio, cargado]);

  /* Ir a un lugar (una foto, una línea del feed, una dirección): vuela, marca,
     y si el trabajo está en la ventana abre su ficha. */
  useEffect(() => {
    if (!foco || !cargado) return;
    const mapa = mapRef.current?.getMap();
    if (!mapa) return;
    mapa.flyTo({ center: [foco.lon, foco.lat], zoom: Math.max(mapa.getZoom(), 16), duration: 1100 });
    setMarcador({ lon: foco.lon, lat: foco.lat });
    const f = foco.id != null ? datos.hechos.features.find((x) => x.properties.id === foco.id) : undefined;
    setSel(f ? { tipo: "hecho", props: f.properties, lngLat: [foco.lon, foco.lat] } : null);
    const id = window.setTimeout(() => setMarcador(null), 6000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco?.clave, cargado]);

  const alMover = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f) {
      if (sobre) setSobre(null);
      return;
    }
    setSobre({ x: e.point.x, y: e.point.y, capa: f.layer.id, props: f.properties as Record<string, unknown> });
  };

  const alClick = (e: MapLayerMouseEvent) => {
    setMarcador(null);
    const f = e.features?.[0];
    if (!f) {
      setSel(null);
      return;
    }
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    const props = f.properties as Record<string, unknown>;
    if (f.layer.id === "av-celda") {
      /* Una celda se abre: la cámara se acerca hasta donde se ven los puntos. */
      const mapa = mapRef.current?.getMap();
      const g = f.geometry;
      if (mapa && g.type === "Point") {
        mapa.easeTo({ center: g.coordinates as [number, number], zoom: Math.max(mapa.getZoom() + 1.6, ZOOM_CERCA + 0.6), duration: 700 });
      }
      setSobre(null);
      return;
    }
    if (f.layer.id === "av-hechos-punto" || f.layer.id === "av-hechos-resalte") setSel({ tipo: "hecho", props: props as unknown as HechoProps, lngLat });
    else if (f.layer.id === "av-encurso-punto") setSel({ tipo: "encurso", props: props as unknown as EnCursoProps, lngLat });
    else if (f.layer.id === "av-pend-punto") setSel({ tipo: "pendiente", props: props as unknown as PendienteProps, lngLat });
    else if (f.layer.id === "av-areas-relleno") setSel({ tipo: "orden", props: props as unknown as OrdenActiva, lngLat });
  };

  const trazo = oscuro ? "#070a10" : "#16202e";
  /* La etiqueta flotante no se muestra sobre lo que ya tiene la ficha abierta. */
  const etiqueta = sobre && !(sel && sel.props.id === sobre.props.id) ? sobre : null;
  const anchoMapa = mapRef.current?.getMap()?.getContainer().clientWidth ?? 800;

  return (
    <MapaGL
      ref={mapRef}
      initialViewState={{
        longitude: camaraInicial?.lon ?? CENTRO_SMT[0],
        latitude: camaraInicial?.lat ?? CENTRO_SMT[1],
        zoom: camaraInicial?.zoom ?? 12.3,
      }}
      mapStyle={estiloMapa(tema)}
      maxZoom={19.5}
      canvasContextAttributes={{ preserveDrawingBuffer: true }}
      attributionControl={{ compact: true }}
      interactiveLayerIds={["av-celda", "av-hechos-punto", "av-hechos-resalte", "av-encurso-punto", "av-pend-punto", "av-areas-relleno"]}
      onLoad={(e) => {
        setCargado(true);
        alListo?.(e.target);
      }}
      onClick={alClick}
      onMouseMove={alMover}
      onMouseOut={() => setSobre(null)}
      cursor={sobre ? "pointer" : "grab"}
    >
      {!pantalla && <NavigationControl position="top-right" showCompass={false} />}

      {/* 0. El contorno del recorte, en el amarillo de la marca */}
      <Source key="av-terr" id="av-terr" type="geojson" data={contorno}>
        <Layer id="av-terr-relleno" type="fill" paint={{ "fill-color": "#f4dc00", "fill-opacity": 0.04 }} />
        <Layer id="av-terr-borde" type="line" paint={{ "line-color": "#f4dc00", "line-width": 2.2, "line-opacity": 0.9 }} />
      </Source>

      {/* 1. El área real de cada orden activa */}
      <Source key="av-areas" id="av-areas" type="geojson" data={areas}>
        <Layer
          id="av-areas-relleno"
          type="fill"
          filter={filtroPorEmpresa}
          paint={{ "fill-color": ["get", "color"], "fill-opacity": hayResalte ? 0.02 : 0.08 }}
        />
        <Layer
          id="av-areas-borde"
          type="line"
          filter={filtroPorEmpresa}
          paint={{
            "line-color": ["get", "color"],
            "line-width": ordenResaltada != null ? ["case", ["==", ["get", "id"], ordenResaltada], 3.4, 1.6] : 1.6,
            "line-opacity": hayResalte ? 0.25 : 0.9,
            "line-dasharray": [2.2, 1.6],
          }}
        />
        <Layer
          id="av-areas-resalte"
          type="line"
          filter={filtroResalteEmpresa}
          layout={{ visibility: hayResalte ? "visible" : "none" }}
          paint={{ "line-color": ["get", "color"], "line-width": 2.4, "line-opacity": 0.95, "line-dasharray": [2.2, 1.6] }}
        />
      </Source>

      {/* 2. Lo que falta, de fondo: gris, chico, apagable */}
      <Source key="av-pend" id="av-pend" type="geojson" data={datos.pendientes}>
        <Layer
          id="av-pend-punto"
          type="circle"
          layout={{ visibility: verPendientes ? "visible" : "none" }}
          paint={{
            "circle-color": oscuro ? "#9aa3b2" : "#6b7280",
            "circle-opacity": hayResalte ? 0.2 : 0.5,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.4, 14, 2.6, 17, 4.5],
          }}
        />
      </Source>

      {/* 3. De lejos: las celdas, con la cantidad adentro */}
      <Source key="av-celdas" id="av-celdas" type="geojson" data={celdas}>
        <Layer
          id="av-celda"
          type="circle"
          maxzoom={ZOOM_CERCA + 0.01}
          paint={{
            "circle-color": ["get", "color"],
            "circle-radius": RADIO_CELDA,
            "circle-opacity": deLejos(hayResalte ? ["case", ["==", ["get", "empresa"], resaltada ?? ""], 0.9, 0.12] : 0.88),
            "circle-stroke-color": trazo,
            "circle-stroke-width": 1.2,
            "circle-stroke-opacity": deLejos(0.7),
          }}
        />
        <Layer
          id="av-celda-n"
          type="symbol"
          maxzoom={ZOOM_CERCA + 0.01}
          layout={{
            "text-field": ["get", "etiqueta"],
            "text-font": ["Open Sans Bold"],
            "text-size": ["interpolate", ["linear"], ["get", "n"], 2, 10, 80, 13],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          }}
          paint={{
            "text-color": "#ffffff",
            "text-halo-color": "rgba(0,0,0,0.55)",
            "text-halo-width": 1,
            "text-opacity": deLejos(hayResalte ? ["case", ["==", ["get", "empresa"], resaltada ?? ""], 1, 0.15] : 1),
          }}
        />
      </Source>

      {/* 4 a 6. De cerca: lo hecho, el latido de lo reciente, el de lo nuevo */}
      <Source key="av-hechos" id="av-hechos" type="geojson" data={hechos}>
        <Layer
          id="av-hechos-punto"
          type="circle"
          filter={filtroHechos}
          minzoom={ZOOM_LEJOS - 0.01}
          paint={{
            "circle-color": ["get", "color"],
            "circle-radius": RADIO,
            "circle-opacity": deCerca(hayResalte ? 0.12 : ["case", ES_RECIENTE, 0.95, 0.78]),
            "circle-stroke-width": ["case", ES_RECIENTE, 2.2, oscuro ? 0.6 : 0.9],
            "circle-stroke-color": ["case", ES_RECIENTE, "#2eb1ff", trazo],
            "circle-stroke-opacity": deCerca(hayResalte ? 0.1 : ["case", ES_RECIENTE, 1, 0.6]),
          }}
        />
        <Layer
          id="av-hechos-pulso"
          type="circle"
          filter={filtroPulso}
          paint={{
            "circle-color": "#2eb1ff",
            "circle-opacity": 0,
            "circle-radius": 11,
            "circle-stroke-color": "#2eb1ff",
            "circle-stroke-width": 1.5,
            "circle-stroke-opacity": 0.6,
          }}
        />
        <Layer
          id="av-hechos-nuevo"
          type="circle"
          filter={filtroNuevos}
          layout={{ visibility: idsNuevos.length > 0 ? "visible" : "none" }}
          paint={{
            "circle-color": "#f4dc00",
            "circle-opacity": 0,
            "circle-radius": 16,
            "circle-stroke-color": "#f4dc00",
            "circle-stroke-width": 2.5,
            "circle-stroke-opacity": 0.8,
          }}
        />
        <Layer
          id="av-hechos-resalte"
          type="circle"
          filter={filtroResalte}
          minzoom={ZOOM_LEJOS - 0.01}
          layout={{ visibility: hayResalte ? "visible" : "none" }}
          paint={{
            "circle-color": ["get", "color"],
            "circle-radius": RADIO,
            "circle-opacity": deCerca(0.98),
            "circle-stroke-width": 1.2,
            "circle-stroke-color": trazo,
            "circle-stroke-opacity": deCerca(0.9),
          }}
        />
      </Source>

      {/* 7. Las obras en curso: un anillo del color de la empresa, del tamaño
          de la obra. No dependen de la ventana ni de la línea de tiempo. */}
      <Source key="av-encurso" id="av-encurso" type="geojson" data={enCurso}>
        <Layer
          id="av-encurso-punto"
          type="circle"
          filter={filtroPorEmpresa}
          paint={{
            "circle-color": ["get", "color"],
            "circle-opacity": hayResalte ? 0.04 : 0.18,
            "circle-radius": RADIO,
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 2.4,
            "circle-stroke-opacity": hayResalte ? 0.15 : 0.95,
          }}
        />
        <Layer
          id="av-encurso-resalte"
          type="circle"
          filter={filtroResalteEmpresa}
          layout={{ visibility: hayResalte ? "visible" : "none" }}
          paint={{
            "circle-color": ["get", "color"],
            "circle-opacity": 0.22,
            "circle-radius": RADIO,
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 2.6,
            "circle-stroke-opacity": 1,
          }}
        />
      </Source>

      {/* 8. El número de cada orden, cuando hay zoom para leerlo */}
      <Source key="av-areas-rotulo" id="av-areas-rotulo" type="geojson" data={areas}>
        <Layer
          id="av-areas-texto"
          type="symbol"
          filter={filtroPorEmpresa}
          minzoom={12.5}
          layout={{
            "text-field": ["get", "numero"],
            "text-font": ["Open Sans Bold"],
            "text-size": 11,
            "text-anchor": "top",
            "text-offset": [0, 0.4],
          }}
          paint={{
            "text-color": oscuro ? "#edf2fa" : "#16202e",
            "text-halo-color": oscuro ? "#070a10" : "#ffffff",
            "text-halo-width": 1.2,
          }}
        />
      </Source>

      {/* El lugar al que se acaba de ir: un anillo amarillo que late unos segundos */}
      {marcador && (
        <Marker longitude={marcador.lon} latitude={marcador.lat} anchor="center">
          <div className="pointer-events-none relative h-7 w-7" aria-hidden="true">
            <span className="absolute inset-0 animate-ping rounded-full bg-amarillo/50" />
            <span className="absolute inset-1.5 rounded-full border-2 border-amarillo" />
          </div>
        </Marker>
      )}

      {/* La etiqueta al pasar el cursor: qué es, de quién, dónde, cuánto */}
      {etiqueta && (
        <div
          className="pointer-events-none absolute z-20 w-64 rounded-xl border border-borde bg-panel/95 px-3 py-2 text-xs shadow-xl backdrop-blur"
          style={
            etiqueta.x > anchoMapa - 290
              ? { right: anchoMapa - etiqueta.x + 14, top: etiqueta.y + 14 }
              : { left: etiqueta.x + 14, top: etiqueta.y + 14 }
          }
        >
          <Etiqueta capa={etiqueta.capa} props={etiqueta.props} color={color} />
        </div>
      )}

      {sel && (
        <Popup
          longitude={sel.lngLat[0]}
          latitude={sel.lngLat[1]}
          /* Sin anchor fijo: MapLibre elige el lado que deja la ficha entera
             adentro del mapa. El z-index la pone por encima de los botones
             flotantes (ventanas, leyenda), que si no la tapaban. */
          offset={14}
          closeOnClick={false}
          closeButton={false}
          onClose={() => setSel(null)}
          maxWidth="320px"
          className="popup-avance"
          style={{ zIndex: 30 }}
        >
          <div className="w-72 p-3 text-sm text-texto">
            <button
              type="button"
              onClick={() => setSel(null)}
              aria-label="Cerrar"
              className="absolute top-2 right-2 rounded-md px-1.5 text-texto-3 hover:text-texto"
            >
              ×
            </button>
            {sel.tipo === "hecho" && (
              <FichaHecho
                p={sel.props}
                sinLinks={sinLinks}
                color={color}
                alAmpliar={
                  alAmpliar && sel.props.foto
                    ? () =>
                        alAmpliar({
                          antes: sel.props.fotoAntes,
                          despues: sel.props.foto!,
                          titulo: sel.props.direccion ?? "Sin dirección",
                          sub: `${sel.props.empresa} · ${fechaLarga(sel.props.fecha, true)} · ${medida(sel.props.m2)}`,
                          lon: sel.lngLat[0],
                          lat: sel.lngLat[1],
                          id: sel.props.id,
                        })
                    : undefined
                }
              />
            )}
            {sel.tipo === "encurso" && <FichaEnCurso p={sel.props} color={color} />}
            {sel.tipo === "pendiente" && <FichaPendiente p={sel.props} sinLinks={sinLinks} publico={publico} />}
            {sel.tipo === "orden" && <FichaOrden p={sel.props} sinLinks={sinLinks} color={color} />}
          </div>
        </Popup>
      )}
    </MapaGL>
  );
}

/** La etiqueta flotante, por capa. Una línea de título y una de datos: nada más. */
function Etiqueta({ capa, props, color }: { capa: string; props: Record<string, unknown>; color: (e: string) => string }) {
  const empresa = typeof props.empresa === "string" ? props.empresa : null;
  const direccion = typeof props.direccion === "string" ? props.direccion : null;
  const chip = empresa ? (
    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color(empresa) }} aria-hidden="true" />
  ) : null;

  if (capa === "av-celda") {
    const n = Number(props.n ?? 0);
    const otras = Number(props.otras ?? 0);
    return (
      <>
        <p className="flex items-center gap-1.5 font-bold">
          {chip}
          <span className="num">
            {numero(n)} {n === 1 ? "bache" : "baches"}
          </span>
          <span className="ml-auto shrink-0 font-normal text-texto-3">{medida(props.m2)}</span>
        </p>
        <p className="text-texto-2">
          {otras > 0 ? `La mayoría de ${empresa}, y ${numero(otras)} ${otras === 1 ? "empresa más" : "empresas más"}` : `Todos de ${empresa}`}
        </p>
        <p className="text-texto-3">Tocá para acercarte y ver cada punto.</p>
      </>
    );
  }
  if (capa === "av-hechos-punto" || capa === "av-hechos-resalte") {
    return (
      <>
        <p className="flex items-center gap-1.5 font-bold">
          {chip}
          <span className="truncate">{empresa}</span>
          <span className="ml-auto shrink-0 font-normal text-texto-3">{props.reciente === true ? "últimas 48 h" : "hecho"}</span>
        </p>
        <p className="truncate text-texto-2">{direccion ?? "Sin dirección"}</p>
        <p className="num text-texto-3">
          {typeof props.fecha === "string" ? fechaLarga(props.fecha) : ""} · {medida(props.m2)}
          {props.fuente === "orden" && typeof props.orden === "string" ? ` · ${props.orden}` : ""}
          {typeof props.fotoAntes === "string" && typeof props.foto === "string" ? " · antes y después" : ""}
        </p>
      </>
    );
  }
  if (capa === "av-encurso-punto") {
    return (
      <>
        <p className="flex items-center gap-1.5 font-bold">
          {chip}
          <span className="truncate">{empresa}</span>
          <span className="ml-auto shrink-0 font-normal text-texto-3">obra en curso</span>
        </p>
        <p className="truncate text-texto-2">{direccion ?? "Sin dirección"}</p>
        <p className="num text-texto-3">
          {medida(props.m2)}
          {typeof props.tipo === "string" ? ` · ${ETIQUETA_TIPO[props.tipo] ?? props.tipo}` : ""}
        </p>
      </>
    );
  }
  if (capa === "av-areas-relleno") {
    return (
      <>
        <p className="flex items-center gap-1.5 font-bold">
          {chip}
          <span className="num">{String(props.numero ?? "")}</span>
          <span className="truncate font-normal text-texto-2">{empresa}</span>
        </p>
        <p className="num text-texto-3">
          {numero(Number(props.hechos ?? 0))} de {numero(Number(props.items ?? 0))} baches hechos · orden activa
        </p>
      </>
    );
  }
  return (
    <>
      <p className="font-bold text-texto-2">Pedido que espera</p>
      {direccion && <p className="truncate text-texto-2">{direccion}</p>}
      <p className="num text-texto-3">desde el {typeof props.fecha === "string" ? fechaCorta(props.fecha) : "—"}</p>
    </>
  );
}

function FichaHecho({
  p,
  sinLinks,
  color,
  alAmpliar,
}: {
  p: HechoProps;
  sinLinks: boolean;
  color: (e: string) => string;
  alAmpliar?: () => void;
}) {
  return (
    <>
      <div className="flex items-start gap-2 pr-5">
        <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: color(p.empresa) }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{p.direccion ?? "Sin dirección"}</p>
          <p className="text-xs text-texto-2">
            {p.empresa} · {fechaLarga(p.fecha, true)}
          </p>
        </div>
      </div>
      <p className="num mt-2 text-xs text-texto-2">
        {p.m2 ? `${numero(Math.round(p.m2))} m²` : "sin medida cargada"}
        {p.toneladas ? ` · ${numero(p.toneladas)} t de mezcla` : ""}
        {p.tipo ? ` · ${ETIQUETA_TIPO[p.tipo] ?? p.tipo.replaceAll("_", " ")}` : ""}
      </p>
      <p className="mt-1 text-xs text-texto-3">
        {p.fuente === "orden"
          ? `Mandado por la orden ${p.orden ?? ""}`
          : "Informado por planilla, por el SIGOV o por la app de la empresa"}
        {p.reciente ? " · cargado en las últimas 48 h" : ""}
      </p>
      {p.foto && p.fotoAntes ? (
        <AntesDespues antes={p.fotoAntes} despues={p.foto} alt="El bache antes y después" className="mt-2 aspect-[4/3] w-full" />
      ) : p.foto ? (
        // eslint-disable-next-line @next/next/no-img-element -- fotos de Storage/externas
        <img
          src={p.foto}
          alt="El trabajo terminado"
          className="mt-2 h-36 w-full rounded-lg border border-borde object-cover"
          loading="lazy"
        />
      ) : null}
      <div className="mt-2 flex items-center gap-3">
        {alAmpliar && (
          <button type="button" onClick={alAmpliar} className="flex items-center gap-1 text-xs font-semibold text-celeste">
            <Maximize2 size={12} />
            Ver grande
          </button>
        )}
        {!sinLinks && p.ordenId != null && (
          <Link href={`/ordenes/${p.ordenId}`} className="text-xs font-semibold text-celeste">
            Ver la orden →
          </Link>
        )}
      </div>
    </>
  );
}

function FichaEnCurso({ p, color }: { p: EnCursoProps; color: (e: string) => string }) {
  return (
    <>
      <div className="flex items-start gap-2 pr-5">
        <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full border-2" style={{ borderColor: color(p.empresa) }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{p.direccion ?? "Sin dirección"}</p>
          <p className="text-xs text-texto-2">
            {p.empresa} · obra en curso
            {p.iniciada ? ` desde el ${fechaLarga(p.iniciada)}` : ""}
          </p>
        </div>
      </div>
      <p className="num mt-2 text-xs text-texto-2">
        {p.m2 ? `${numero(Math.round(p.m2))} m²` : "sin medida cargada"}
        {p.tipo ? ` · ${ETIQUETA_TIPO[p.tipo] ?? p.tipo.replaceAll("_", " ")}` : ""}
      </p>
      <p className="mt-1 text-xs text-texto-3">Empezada y no terminada según la planilla de la empresa.</p>
    </>
  );
}

function FichaPendiente({ p, sinLinks, publico }: { p: PendienteProps; sinLinks: boolean; publico: boolean }) {
  return (
    <>
      <p className="pr-5 font-bold">{publico ? "Un pedido que espera" : (p.direccion ?? "Sin dirección")}</p>
      <p className="mt-1 text-xs text-texto-2">
        {publico ? "Pedido de un vecino" : `Pedido #${p.id}`} · espera desde el {fechaCorta(p.fecha)}
      </p>
      <p className="mt-1 text-xs text-texto-3">Todavía no tiene una orden de trabajo. Está en la cola de la Brecha.</p>
      {!sinLinks && (
        <Link href={`/demandas/${p.id}`} className="mt-2 inline-block text-xs font-semibold text-celeste">
          Ver el pedido →
        </Link>
      )}
    </>
  );
}

function FichaOrden({ p, sinLinks, color }: { p: OrdenActiva; sinLinks: boolean; color: (e: string) => string }) {
  return (
    <>
      <div className="flex items-start gap-2 pr-5">
        <span className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: color(p.empresa) }} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="num font-bold">{p.numero}</p>
          <p className="text-xs text-texto-2">
            {p.empresa} · {p.estado === "en_ejecucion" ? "en ejecución" : "emitida"}
          </p>
        </div>
      </div>
      <p className="num mt-2 text-xs text-texto-2">
        {numero(p.hechos)} de {numero(p.items)} baches hechos
        {p.ultimo ? ` · último reporte ${fechaCorta(p.ultimo)}` : " · sin reportes todavía"}
      </p>
      {!sinLinks && (
        <Link href={`/ordenes/${p.id}`} className="mt-2 inline-block text-xs font-semibold text-celeste">
          Ver la orden →
        </Link>
      )}
    </>
  );
}
