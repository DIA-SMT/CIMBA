"use client";

import "maplibre-gl/dist/maplibre-gl.css";
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
import { colorDeEmpresa } from "@/lib/color-empresa";
import { fechaCorta, numero } from "@/lib/formato";
import { AntesDespues } from "@/components/antes-despues";
import { estiloMapa, usarTemaMapa } from "@/components/mapa/tema-mapa";

/**
 * EL MAPA DE AVANCE: cinco fuentes, siete capas, en este orden de abajo hacia
 * arriba —contorno del recorte, áreas de órdenes, pedidos pendientes, trabajo
 * hecho, el latido de lo reciente, obras en curso, rótulos de las órdenes—
 * para que lo hecho tape lo pendiente y no al revés.
 *
 * El color de la empresa se resuelve acá y viaja como propiedad: MapLibre no
 * puede hashear el nombre adentro de una expresión de pintado. La línea de
 * tiempo, el filtro por empresa y el resaltado son FILTROS y expresiones de
 * pintado, no datos nuevos: cambiar de día no vuelve a subir 3.000 puntos.
 *
 * Al pasar el cursor, una etiqueta chica dice qué es eso (empresa, lugar,
 * fecha, medida). El clic abre la ficha completa, con el antes y el después.
 *
 * `preserveDrawingBuffer` está prendido para poder copiar el canvas a la
 * imagen que se comparte; cuesta un poco de memoria de video y nada más.
 */

const CENTRO_SMT: [number, number] = [-65.2226, -26.8241];

const ETIQUETA_TIPO: Record<string, string> = {
  bacheo: "bacheo",
  pano_hormigon: "paño de hormigón",
  carpeta: "carpeta asfáltica",
  enripiado: "enripiado",
};

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

const ES_RECIENTE: ExpressionSpecification = ["==", ["get", "reciente"], true];

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
  verPendientes,
  foco,
  camaraInicial,
  alListo,
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
  /** Día hasta el que se muestra (reproducción); null = todo. */
  cursor: number | null;
  verPendientes: boolean;
  /** A dónde ir (una foto, una línea del feed). */
  foco: Foco | null;
  /** La cámara con la que abre (de un link compartido). */
  camaraInicial: Camara | null;
  /** El mapa ya cargó: quien lo necesite (compartir) se lo guarda. */
  alListo?: (mapa: MapaLibre) => void;
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

  const conColor = <T extends { properties: { empresa: string } }>(fc: { type: "FeatureCollection"; features: T[] }) => ({
    type: "FeatureCollection" as const,
    features: fc.features.map((f) => ({
      ...f,
      properties: { ...f.properties, color: colorDeEmpresa(f.properties.empresa) },
    })),
  });
  const hechos = useMemo(() => conColor(datos.hechos), [datos.hechos]);
  const areas = useMemo(() => conColor(datos.areas), [datos.areas]);
  const enCurso = useMemo(() => conColor(datos.enCurso), [datos.enCurso]);
  const contorno = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: datos.territorio
        ? [{ type: "Feature" as const, geometry: datos.territorio.contorno, properties: { nombre: datos.territorio.nombre } }]
        : [],
    }),
    [datos.territorio],
  );

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

  /* El resaltado desde la columna: lo de la empresa señalada a pleno, el resto atenuado. */
  const atenuar = (normal: ExpressionSpecification | number, tenue: number): ExpressionSpecification | number =>
    resaltada ? ["case", ["==", ["get", "empresa"], resaltada], normal, tenue] : normal;

  /**
   * EL LATIDO de lo cargado en las últimas 48 horas: un anillo que crece y se
   * desvanece cada 1,8 s. Se anima cambiando dos propiedades de pintado por
   * cuadro; con movimiento reducido queda un anillo fijo.
   */
  useEffect(() => {
    if (!cargado) return;
    const mapa = mapRef.current?.getMap();
    if (!mapa) return;
    const reducido = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let raf = 0;
    const inicio = performance.now();
    const paso = (t: number) => {
      if (mapa.getLayer("av-hechos-pulso")) {
        const fase = ((t - inicio) % 1800) / 1800;
        mapa.setPaintProperty("av-hechos-pulso", "circle-radius", reducido ? 11 : 6 + fase * 18);
        mapa.setPaintProperty("av-hechos-pulso", "circle-stroke-opacity", reducido ? 0.6 : 0.9 * (1 - fase));
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

  /* Ir a un lugar (una foto, una línea del feed): vuela, marca, y si el
     trabajo está en la ventana abre su ficha. */
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
    if (f.layer.id === "av-hechos-punto") setSel({ tipo: "hecho", props: props as unknown as HechoProps, lngLat });
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
      interactiveLayerIds={["av-hechos-punto", "av-encurso-punto", "av-pend-punto", "av-areas-relleno"]}
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
        <Layer
          id="av-terr-borde"
          type="line"
          paint={{ "line-color": "#f4dc00", "line-width": 2.2, "line-opacity": 0.9 }}
        />
      </Source>

      {/* 1. El área real de cada orden activa */}
      <Source key="av-areas" id="av-areas" type="geojson" data={areas}>
        <Layer
          id="av-areas-relleno"
          type="fill"
          filter={filtroPorEmpresa}
          paint={{ "fill-color": ["get", "color"], "fill-opacity": atenuar(0.08, 0.02) }}
        />
        <Layer
          id="av-areas-borde"
          type="line"
          filter={filtroPorEmpresa}
          paint={{
            "line-color": ["get", "color"],
            "line-width": ordenResaltada != null ? ["case", ["==", ["get", "id"], ordenResaltada], 3.4, 1.6] : 1.6,
            "line-opacity": atenuar(0.9, 0.25),
            "line-dasharray": [2.2, 1.6],
          }}
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
            "circle-opacity": resaltada ? 0.2 : 0.5,
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.4, 14, 2.6, 17, 4.5],
          }}
        />
      </Source>

      {/* 3 y 4. Lo hecho, y el latido de lo reciente */}
      <Source key="av-hechos" id="av-hechos" type="geojson" data={hechos}>
        <Layer
          id="av-hechos-punto"
          type="circle"
          filter={filtroHechos}
          paint={{
            "circle-color": ["get", "color"],
            "circle-radius": RADIO,
            "circle-opacity": atenuar(["case", ES_RECIENTE, 0.95, 0.78], 0.12),
            "circle-stroke-width": ["case", ES_RECIENTE, 2.2, oscuro ? 0.6 : 0.9],
            "circle-stroke-color": ["case", ES_RECIENTE, "#2eb1ff", trazo],
            "circle-stroke-opacity": atenuar(["case", ES_RECIENTE, 1, 0.6], 0.1),
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
      </Source>

      {/* 5. Las obras en curso: un anillo del color de la empresa, del tamaño
          de la obra. No dependen de la ventana ni de la línea de tiempo. */}
      <Source key="av-encurso" id="av-encurso" type="geojson" data={enCurso}>
        <Layer
          id="av-encurso-punto"
          type="circle"
          filter={filtroPorEmpresa}
          paint={{
            "circle-color": ["get", "color"],
            "circle-opacity": atenuar(0.18, 0.04),
            "circle-radius": RADIO,
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 2.4,
            "circle-stroke-opacity": atenuar(0.95, 0.15),
          }}
        />
      </Source>

      {/* 6. El número de cada orden, cuando hay zoom para leerlo */}
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
          <Etiqueta capa={etiqueta.capa} props={etiqueta.props} />
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
            {sel.tipo === "hecho" && <FichaHecho p={sel.props} sinLinks={sinLinks} />}
            {sel.tipo === "encurso" && <FichaEnCurso p={sel.props} />}
            {sel.tipo === "pendiente" && <FichaPendiente p={sel.props} sinLinks={sinLinks} publico={publico} />}
            {sel.tipo === "orden" && <FichaOrden p={sel.props} sinLinks={sinLinks} />}
          </div>
        </Popup>
      )}
    </MapaGL>
  );
}

/** La etiqueta flotante, por capa. Una línea de título y una de datos: nada más. */
function Etiqueta({ capa, props }: { capa: string; props: Record<string, unknown> }) {
  const empresa = typeof props.empresa === "string" ? props.empresa : null;
  const direccion = typeof props.direccion === "string" ? props.direccion : null;
  const chip = empresa ? (
    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorDeEmpresa(empresa) }} aria-hidden="true" />
  ) : null;

  if (capa === "av-hechos-punto") {
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

function FichaHecho({ p, sinLinks }: { p: HechoProps; sinLinks: boolean }) {
  return (
    <>
      <div className="flex items-start gap-2 pr-5">
        <span
          className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ background: colorDeEmpresa(p.empresa) }}
          aria-hidden="true"
        />
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
      {!sinLinks && p.ordenId != null && (
        <Link href={`/ordenes/${p.ordenId}`} className="mt-2 inline-block text-xs font-semibold text-celeste">
          Ver la orden →
        </Link>
      )}
    </>
  );
}

function FichaEnCurso({ p }: { p: EnCursoProps }) {
  return (
    <>
      <div className="flex items-start gap-2 pr-5">
        <span
          className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full border-2"
          style={{ borderColor: colorDeEmpresa(p.empresa) }}
          aria-hidden="true"
        />
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

function FichaOrden({ p, sinLinks }: { p: OrdenActiva; sinLinks: boolean }) {
  return (
    <>
      <div className="flex items-start gap-2 pr-5">
        <span
          className="mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ background: colorDeEmpresa(p.empresa) }}
          aria-hidden="true"
        />
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
