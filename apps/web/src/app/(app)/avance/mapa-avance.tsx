"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExpressionSpecification, FilterSpecification } from "maplibre-gl";
import {
  Layer,
  Map as MapaGL,
  NavigationControl,
  Popup,
  Source,
  type MapLayerMouseEvent,
  type MapRef,
} from "react-map-gl/maplibre";
import {
  fechaLarga,
  type DatosAvance,
  type EnCursoProps,
  type HechoProps,
  type OrdenActiva,
  type PendienteProps,
} from "@/lib/avance-tipos";
import { colorDeEmpresa } from "@/lib/color-empresa";
import { fechaCorta, numero } from "@/lib/formato";
import { estiloMapa, usarTemaMapa } from "@/components/mapa/tema-mapa";

/**
 * EL MAPA DE AVANCE: tres fuentes, cinco capas, en este orden de abajo hacia
 * arriba —áreas de órdenes, pedidos pendientes, trabajo hecho, el latido de lo
 * reciente, los rótulos de las órdenes— para que lo hecho tape lo pendiente y
 * no al revés.
 *
 * El color de la empresa se resuelve acá y viaja como propiedad: MapLibre no
 * puede hashear el nombre adentro de una expresión de pintado. La línea de
 * tiempo y el filtro por empresa son FILTROS de capa, no datos nuevos: cambiar
 * de día no vuelve a subir 3.000 puntos a la GPU.
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

type Seleccion =
  | { tipo: "hecho"; props: HechoProps; lngLat: [number, number] }
  | { tipo: "encurso"; props: EnCursoProps; lngLat: [number, number] }
  | { tipo: "pendiente"; props: PendienteProps; lngLat: [number, number] }
  | { tipo: "orden"; props: OrdenActiva; lngLat: [number, number] };

export function MapaAvance({
  datos,
  empresaSel,
  cursor,
  verPendientes,
  pantalla,
}: {
  datos: DatosAvance;
  empresaSel: string | null;
  /** Día hasta el que se muestra (reproducción); null = todo. */
  cursor: number | null;
  verPendientes: boolean;
  pantalla: boolean;
}) {
  const tema = usarTemaMapa();
  const oscuro = tema === "oscuro";
  const mapRef = useRef<MapRef>(null);
  const [cargado, setCargado] = useState(false);
  const [sel, setSel] = useState<Seleccion | null>(null);
  const [sobre, setSobre] = useState(false);

  const hechos = useMemo<DatosAvance["hechos"]>(
    () => ({
      type: "FeatureCollection",
      features: datos.hechos.features.map((f) => ({
        ...f,
        properties: { ...f.properties, color: colorDeEmpresa(f.properties.empresa) },
      })),
    }),
    [datos.hechos],
  );

  const areas = useMemo<DatosAvance["areas"]>(
    () => ({
      type: "FeatureCollection",
      features: datos.areas.features.map((f) => ({
        ...f,
        properties: { ...f.properties, color: colorDeEmpresa(f.properties.empresa) },
      })),
    }),
    [datos.areas],
  );

  const enCurso = useMemo<DatosAvance["enCurso"]>(
    () => ({
      type: "FeatureCollection",
      features: datos.enCurso.features.map((f) => ({
        ...f,
        properties: { ...f.properties, color: colorDeEmpresa(f.properties.empresa) },
      })),
    }),
    [datos.enCurso],
  );

  /* Los filtros: la línea de tiempo y la empresa elegida. ["all"] vacío es verdadero. */
  const partes = useMemo(() => {
    const p: ExpressionSpecification[] = [];
    if (cursor != null) p.push(["<=", ["get", "dia"], cursor]);
    if (empresaSel) p.push(["==", ["get", "empresa"], empresaSel]);
    return p;
  }, [cursor, empresaSel]);
  const filtroHechos = ["all", ...partes] as unknown as FilterSpecification;
  const filtroPulso = ["all", ["==", ["get", "reciente"], true], ...partes] as unknown as FilterSpecification;
  const filtroAreas = (
    empresaSel ? ["all", ["==", ["get", "empresa"], empresaSel]] : ["all"]
  ) as unknown as FilterSpecification;

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

  const alClick = (e: MapLayerMouseEvent) => {
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

  return (
    <MapaGL
      ref={mapRef}
      initialViewState={{ longitude: CENTRO_SMT[0], latitude: CENTRO_SMT[1], zoom: 12.3 }}
      mapStyle={estiloMapa(tema)}
      maxZoom={19.5}
      attributionControl={{ compact: true }}
      interactiveLayerIds={["av-hechos-punto", "av-encurso-punto", "av-pend-punto", "av-areas-relleno"]}
      onLoad={() => setCargado(true)}
      onClick={alClick}
      onMouseMove={(e) => setSobre((e.features?.length ?? 0) > 0)}
      cursor={sobre ? "pointer" : "grab"}
    >
      {!pantalla && <NavigationControl position="top-right" showCompass={false} />}

      {/* 1. El área real de cada orden activa */}
      <Source key="av-areas" id="av-areas" type="geojson" data={areas}>
        <Layer
          id="av-areas-relleno"
          type="fill"
          filter={filtroAreas}
          paint={{ "fill-color": ["get", "color"], "fill-opacity": 0.08 }}
        />
        <Layer
          id="av-areas-borde"
          type="line"
          filter={filtroAreas}
          paint={{
            "line-color": ["get", "color"],
            "line-width": 1.6,
            "line-opacity": 0.9,
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
            "circle-opacity": 0.5,
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
            "circle-opacity": ["case", ["==", ["get", "reciente"], true], 0.95, 0.78],
            "circle-stroke-width": ["case", ["==", ["get", "reciente"], true], 2.2, oscuro ? 0.6 : 0.9],
            "circle-stroke-color": ["case", ["==", ["get", "reciente"], true], "#2eb1ff", trazo],
            "circle-stroke-opacity": ["case", ["==", ["get", "reciente"], true], 1, 0.6],
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

      {/* 4b. Las obras en curso: un anillo del color de la empresa, del tamaño
          de la obra. No dependen de la ventana ni de la línea de tiempo. */}
      <Source key="av-encurso" id="av-encurso" type="geojson" data={enCurso}>
        <Layer
          id="av-encurso-punto"
          type="circle"
          filter={filtroAreas}
          paint={{
            "circle-color": ["get", "color"],
            "circle-opacity": 0.18,
            "circle-radius": RADIO,
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-width": 2.4,
            "circle-stroke-opacity": 0.95,
          }}
        />
      </Source>

      {/* 5. El número de cada orden, cuando hay zoom para leerlo */}
      <Source key="av-areas-rotulo" id="av-areas-rotulo" type="geojson" data={areas}>
        <Layer
          id="av-areas-texto"
          type="symbol"
          filter={filtroAreas}
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
            {sel.tipo === "hecho" && <FichaHecho p={sel.props} pantalla={pantalla} />}
            {sel.tipo === "encurso" && <FichaEnCurso p={sel.props} />}
            {sel.tipo === "pendiente" && <FichaPendiente p={sel.props} pantalla={pantalla} />}
            {sel.tipo === "orden" && <FichaOrden p={sel.props} pantalla={pantalla} />}
          </div>
        </Popup>
      )}
    </MapaGL>
  );
}

function FichaHecho({ p, pantalla }: { p: HechoProps; pantalla: boolean }) {
  const medida = p.m2 ? `${numero(Math.round(p.m2))} m²` : "sin medida cargada";
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
        {medida}
        {p.toneladas ? ` · ${numero(p.toneladas)} t de mezcla` : ""}
        {p.tipo ? ` · ${ETIQUETA_TIPO[p.tipo] ?? p.tipo.replaceAll("_", " ")}` : ""}
      </p>
      <p className="mt-1 text-xs text-texto-3">
        {p.fuente === "orden"
          ? `Mandado por la orden ${p.orden ?? ""}`
          : "Informado por planilla, por el SIGOV o por la app de la empresa"}
        {p.reciente ? " · cargado en las últimas 48 h" : ""}
      </p>
      {p.foto && (
        // eslint-disable-next-line @next/next/no-img-element -- fotos de Storage/externas
        <img
          src={p.foto}
          alt="El trabajo terminado"
          className="mt-2 h-36 w-full rounded-lg border border-borde object-cover"
          loading="lazy"
        />
      )}
      {!pantalla && p.ordenId != null && (
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

function FichaPendiente({ p, pantalla }: { p: PendienteProps; pantalla: boolean }) {
  return (
    <>
      <p className="pr-5 font-bold">{p.direccion ?? "Sin dirección"}</p>
      <p className="mt-1 text-xs text-texto-2">
        Pedido #{p.id} · espera desde el {fechaCorta(p.fecha)}
      </p>
      <p className="mt-1 text-xs text-texto-3">Todavía no tiene una orden de trabajo. Está en la cola de la Brecha.</p>
      {!pantalla && (
        <Link href={`/demandas/${p.id}`} className="mt-2 inline-block text-xs font-semibold text-celeste">
          Ver el pedido →
        </Link>
      )}
    </>
  );
}

function FichaOrden({ p, pantalla }: { p: OrdenActiva; pantalla: boolean }) {
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
      {!pantalla && (
        <Link href={`/ordenes/${p.id}`} className="mt-2 inline-block text-xs font-semibold text-celeste">
          Ver la orden →
        </Link>
      )}
    </>
  );
}
