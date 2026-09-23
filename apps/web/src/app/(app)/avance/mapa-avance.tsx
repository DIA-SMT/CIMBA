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
  type CapasAvance,
  type DatosAvance,
  type EnCursoProps,
  type Foco,
  type HechoProps,
  type OrdenActiva,
  type PendienteProps,
  type Territorio,
  type TerritorioRef,
} from "@/lib/avance-tipos";
import { colorDeEmpresaEn } from "@/lib/color-empresa";
import { fechaCorta, numero } from "@/lib/formato";
import { AntesDespues } from "@/components/antes-despues";
import type { ParAntesDespues } from "@/components/visor-antes-despues";
import { estiloMapa, usarTemaMapa } from "@/components/mapa/tema-mapa";

/**
 * EL MAPA DE AVANCE, de abajo hacia arriba: contorno del recorte, barrios
 * pintados por trabajo, áreas de órdenes, pedidos pendientes, cuadras
 * arregladas, trabajo hecho (cerca), el latido de lo reciente y de lo que
 * acaba de entrar, obras en curso, el resalte de la empresa señalada, rótulos
 * de las órdenes. Lo hecho tapa lo pendiente y no al revés.
 *
 * TRES DISTANCIAS, sin un botón. A escala ciudad, 3.000 círculos encimados
 * son una mancha; lo que se ve en cambio es:
 *  - LOS BARRIOS, de fondo, en celeste más intenso cuanto más se trabajó; los
 *    que no tuvieron ningún trabajo quedan con borde punteado y sin relleno,
 *    para que "dónde no llegamos" también se vea.
 *  - LAS CUADRAS ARREGLADAS, pintadas del color de la empresa que más hizo en
 *    cada una: de lejos se enciende la red de calles.
 *  - LOS PUNTOS, al acercarse, cada trabajo con su tamaño y su ficha.
 * Todo se cuenta acá, en el cliente, con la ventana, la empresa aislada y la
 * línea de tiempo: al reproducir, las calles se van encendiendo y los barrios
 * se van llenando día por día sin volver a pedirle nada al servidor.
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

/** Entre estos dos zooms llegan los puntos. */
const ZOOM_LEJOS = 12.8;
const ZOOM_CERCA = 13.6;
/** Desde acá el barrio ya no dice nada al pasar el cursor: se está mirando la cuadra. */
const ZOOM_BARRIO = 14;

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

/** Lo que se ve de cerca aparece entre los dos zooms; lo de lejos, al revés. */
const deCerca = (valor: ExpressionSpecification | number): ExpressionSpecification => [
  "interpolate", ["linear"], ["zoom"], ZOOM_LEJOS, 0, ZOOM_CERCA, valor,
];

/**
 * El celeste del barrio según cuántos trabajos tuvo. Los cortes están puestos
 * sobre lo que hay: en un mes, la mitad de los barrios con trabajo tiene menos
 * de cinco y unos pocos pasan de cuarenta.
 */
const N_BARRIO: ExpressionSpecification = ["coalesce", ["feature-state", "n"], 0];
const RELLENO_BARRIO: ExpressionSpecification = [
  "step", N_BARRIO,
  "rgba(46,177,255,0)",
  1, "rgba(46,177,255,0.10)",
  5, "rgba(46,177,255,0.19)",
  15, "rgba(46,177,255,0.29)",
  40, "rgba(46,177,255,0.40)",
];

type GeoArea = CapasAvance["barrios"]["features"][number]["geometry"];

/** Si un punto cae adentro de un anillo (rayo). */
function enAnillo(lon: number, lat: number, anillo: number[][]): boolean {
  let cruza = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i] as [number, number];
    const [xj, yj] = anillo[j] as [number, number];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) cruza = !cruza;
  }
  return cruza;
}

/** Si un punto cae adentro de un barrio: en su borde y fuera de sus agujeros. */
function adentro(lon: number, lat: number, g: GeoArea): boolean {
  const poligonos = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return poligonos.some(
    ([borde, ...agujeros]) => borde != null && enAnillo(lon, lat, borde) && !agujeros.some((a) => enAnillo(lon, lat, a)),
  );
}

type Seleccion =
  | { tipo: "hecho"; props: HechoProps; lngLat: [number, number] }
  | { tipo: "encurso"; props: EnCursoProps; lngLat: [number, number] }
  | { tipo: "pendiente"; props: PendienteProps; lngLat: [number, number] }
  | { tipo: "orden"; props: OrdenActiva; lngLat: [number, number] }
  | { tipo: "barrio"; props: FichaDeBarrio; lngLat: [number, number] };

/** Lo que dice la ficha de un barrio: sus números en la ventana y lo que espera. */
interface FichaDeBarrio {
  id: number;
  nombre: string;
  n: number;
  m2: number;
  cuadras: number;
  pendientes: number;
}

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
  capas,
  alListo,
  alAmpliar,
  alElegirTerritorio,
  pantalla,
  publico,
}: {
  datos: DatosAvance;
  /** Barrios, cuadras arregladas y a qué cuadra y barrio va cada trabajo (llega aparte). */
  capas: CapasAvance | null;
  /** Recortar la pantalla a un barrio, desde su ficha. */
  alElegirTerritorio?: (t: TerritorioRef) => void;
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

  /** A qué cuadra y a qué barrio va cada trabajo. */
  const asignacion = useMemo(() => {
    const m = new Map<number, { clave: string | null; cuadra: number | null; barrio: number | null }>();
    for (const [id, clave, cuadra, barrio] of capas?.trabajos ?? []) m.set(id, { clave, cuadra, barrio });
    return m;
  }, [capas]);

  /**
   * LAS CUADRAS ARREGLADAS de la ventana (y de la empresa aislada, si hay):
   * cada una del color de la empresa que más hizo ahí, y con el primer día en
   * que se trabajó, para que la línea de tiempo las vaya encendiendo con un
   * filtro, sin rehacer nada.
   */
  const calles = useMemo(() => {
    if (!capas) return { type: "FeatureCollection" as const, features: [] };
    const porClave = new Map<string, { n: number; m2: number; desde: number; por: Map<string, number> }>();
    for (const f of datos.hechos.features) {
      const p = f.properties;
      if (empresaSel && p.empresa !== empresaSel) continue;
      const clave = asignacion.get(p.id)?.clave;
      if (!clave) continue;
      let c = porClave.get(clave);
      if (!c) {
        c = { n: 0, m2: 0, desde: p.dia, por: new Map() };
        porClave.set(clave, c);
      }
      c.n++;
      c.m2 += p.m2 ?? 0;
      if (p.dia < c.desde) c.desde = p.dia;
      c.por.set(p.empresa, (c.por.get(p.empresa) ?? 0) + 1);
    }
    const features = [];
    for (const f of capas.cuadras.features) {
      const c = porClave.get(f.properties.clave);
      if (!c) continue;
      let empresa = "Otros";
      let max = -1;
      for (const [e, n] of c.por) {
        if (n > max) {
          max = n;
          empresa = e;
        }
      }
      features.push({
        ...f,
        properties: {
          ...f.properties,
          n: c.n,
          m2: Math.round(c.m2),
          desde: c.desde,
          empresa,
          otras: c.por.size - 1,
          color: color(empresa),
        },
      });
    }
    return { type: "FeatureCollection" as const, features };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capas, asignacion, datos.hechos, empresaSel, tema]);

  /**
   * LOS BARRIOS: cuántos trabajos, m² y cuadras en cada uno hasta el cursor.
   * Cambia con cada paso de la línea de tiempo, así que no rearma la capa:
   * se escribe en el estado de cada polígono, que el mapa pinta al instante.
   */
  const conteoBarrios = useMemo(() => {
    const m = new Map<number, { n: number; m2: number; cuadras: Set<number> }>();
    for (const f of datos.hechos.features) {
      const p = f.properties;
      if (cursor != null && p.dia > cursor) continue;
      if (empresaSel && p.empresa !== empresaSel) continue;
      const a = asignacion.get(p.id);
      if (a?.barrio == null) continue;
      let c = m.get(a.barrio);
      if (!c) {
        c = { n: 0, m2: 0, cuadras: new Set() };
        m.set(a.barrio, c);
      }
      c.n++;
      c.m2 += p.m2 ?? 0;
      if (a.cuadra != null) c.cuadras.add(a.cuadra);
    }
    return m;
  }, [datos.hechos, asignacion, cursor, empresaSel]);
  const conteoRef = useRef(conteoBarrios);
  conteoRef.current = conteoBarrios;

  useEffect(() => {
    if (!cargado || !capas) return;
    const mapa = mapRef.current?.getMap();
    if (!mapa) return;
    const aplicar = () => {
      if (!mapa.getSource("av-barrios")) return;
      const conteo = conteoRef.current;
      for (const f of capas.barrios.features) {
        mapa.setFeatureState({ source: "av-barrios", id: f.properties.id }, { n: conteo.get(f.properties.id)?.n ?? 0 });
      }
    };
    aplicar();
    /* La fuente puede terminar de cargar después (o volver a crearse al
       cambiar de tema): se vuelve a escribir cuando está lista. */
    const alCargarFuente = (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (e.sourceId === "av-barrios" && e.isSourceLoaded) aplicar();
    };
    mapa.on("sourcedata", alCargarFuente);
    return () => {
      mapa.off("sourcedata", alCargarFuente);
    };
  }, [cargado, capas, conteoBarrios, tema]);

  /* Con un recorte, solo sus barrios: los de afuera no están en cero, están fuera de la cuenta. */
  const filtroBarrios = (
    datos.territorio?.tipo === "distrito"
      ? ["==", ["get", "distrito"], datos.territorio.id]
      : datos.territorio?.tipo === "barrio"
        ? ["==", ["get", "id"], datos.territorio.id]
        : ["all"]
  ) as unknown as FilterSpecification;

  /** Los pedidos que esperan adentro de un barrio (para su etiqueta y su ficha). */
  const pendientesCache = useRef(new Map<number, number>());
  useEffect(() => {
    pendientesCache.current = new Map();
  }, [datos.pendientes, capas]);
  const pendientesDe = (id: number): number => {
    const hit = pendientesCache.current.get(id);
    if (hit != null) return hit;
    const g = capas?.barrios.features.find((f) => f.properties.id === id)?.geometry;
    let n = 0;
    if (g) {
      for (const f of datos.pendientes.features) {
        const [lon, lat] = f.geometry.coordinates as [number, number];
        if (adentro(lon, lat, g)) n++;
      }
    }
    pendientesCache.current.set(id, n);
    return n;
  };
  const fichaDeBarrio = (props: Record<string, unknown>): FichaDeBarrio => {
    const id = Number(props.id);
    const c = conteoBarrios.get(id);
    return {
      id,
      nombre: String(props.nombre ?? ""),
      n: c?.n ?? 0,
      m2: Math.round(c?.m2 ?? 0),
      cuadras: c?.cuadras.size ?? 0,
      pendientes: pendientesDe(id),
    };
  };

  /* Los filtros: la línea de tiempo y la empresa aislada. ["all"] vacío es verdadero. */
  const partes = useMemo(() => {
    const p: ExpressionSpecification[] = [];
    if (cursor != null) p.push(["<=", ["get", "dia"], cursor]);
    if (empresaSel) p.push(["==", ["get", "empresa"], empresaSel]);
    return p;
  }, [cursor, empresaSel]);
  const filtroHechos = ["all", ...partes] as unknown as FilterSpecification;
  /* Las cuadras se encienden el primer día que se trabajó en ellas. */
  const filtroCalles = (cursor != null ? ["<=", ["get", "desde"], cursor] : ["all"]) as unknown as FilterSpecification;
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

  /** Lo que está bajo el cursor; el barrio solo cuenta de lejos (de cerca se mira la cuadra). */
  const bajoElCursor = (e: MapLayerMouseEvent) => {
    const lejos = e.target.getZoom() < ZOOM_BARRIO;
    return e.features?.find((f) => f.layer.id !== "av-barrio-relleno" || lejos);
  };

  const alMover = (e: MapLayerMouseEvent) => {
    const f = bajoElCursor(e);
    if (!f) {
      if (sobre) setSobre(null);
      return;
    }
    const props = f.properties as Record<string, unknown>;
    setSobre({
      x: e.point.x,
      y: e.point.y,
      capa: f.layer.id,
      props: f.layer.id === "av-barrio-relleno" ? { ...fichaDeBarrio(props) } : props,
    });
  };

  const alClick = (e: MapLayerMouseEvent) => {
    setMarcador(null);
    const f = bajoElCursor(e);
    if (!f) {
      setSel(null);
      return;
    }
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    const props = f.properties as Record<string, unknown>;
    if (f.layer.id === "av-calle") {
      /* Una cuadra de lejos se abre: la cámara se acerca hasta ver cada
         trabajo. De cerca, tocar la calle y no un punto no hace nada. */
      if (e.target.getZoom() < ZOOM_CERCA) {
        e.target.easeTo({ center: [e.lngLat.lng, e.lngLat.lat], zoom: ZOOM_CERCA + 1.4, duration: 700 });
      }
      setSobre(null);
      setSel(null);
      return;
    }
    if (f.layer.id === "av-barrio-relleno") {
      setSel({ tipo: "barrio", props: fichaDeBarrio(props), lngLat });
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
      interactiveLayerIds={["av-barrio-relleno", "av-calle", "av-hechos-punto", "av-hechos-resalte", "av-encurso-punto", "av-pend-punto", "av-areas-relleno"]}
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

      {/* 0b. Los barrios, según cuánto se trabajó; los que no, con borde punteado */}
      {capas && (
        <Source key="av-barrios" id="av-barrios" type="geojson" data={capas.barrios} promoteId="id">
          <Layer
            id="av-barrio-relleno"
            type="fill"
            filter={filtroBarrios}
            paint={{
              "fill-color": RELLENO_BARRIO,
              "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12.5, hayResalte ? 0.4 : 1, 15, 0.25],
            }}
          />
          <Layer
            id="av-barrio-borde"
            type="line"
            filter={filtroBarrios}
            paint={{
              "line-color": oscuro ? "#8b96a8" : "#64748b",
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.4, 14, 1],
              "line-opacity": ["case", [">", N_BARRIO, 0], 0.28, 0.5],
              "line-dasharray": [2, 2],
            }}
          />
        </Source>
      )}

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

      {/* 3. Las cuadras arregladas, del color de la empresa que más hizo en cada una */}
      <Source key="av-calles" id="av-calles" type="geojson" data={calles}>
        <Layer
          id="av-calle"
          type="line"
          filter={filtroCalles}
          layout={{ "line-cap": "round", "line-join": "round" }}
          paint={{
            "line-color": ["get", "color"],
            "line-width": ["interpolate", ["linear"], ["zoom"], 10.5, 1.4, 12.5, 2.6, 14.5, 4.2, 17, 7],
            "line-opacity": hayResalte
              ? ["case", ["==", ["get", "empresa"], resaltada ?? ""], 0.95, 0.1]
              : ["interpolate", ["linear"], ["zoom"], 12, 0.92, 16, 0.6],
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
            {sel.tipo === "barrio" && (
              <FichaBarrio
                p={sel.props}
                recortado={datos.territorio?.tipo === "barrio" && datos.territorio.id === sel.props.id}
                alRecortar={
                  alElegirTerritorio
                    ? () => {
                        setSel(null);
                        alElegirTerritorio({ tipo: "barrio", id: sel.props.id });
                      }
                    : undefined
                }
              />
            )}
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

  if (capa === "av-calle") {
    const n = Number(props.n ?? 0);
    const otras = Number(props.otras ?? 0);
    return (
      <>
        <p className="flex items-center gap-1.5 font-bold">
          {chip}
          <span className="truncate">{direccion ?? "Cuadra arreglada"}</span>
        </p>
        <p className="num text-texto-2">
          {numero(n)} {n === 1 ? "trabajo" : "trabajos"} · {medida(props.m2)}
        </p>
        <p className="text-texto-3">
          {otras > 0 ? `La mayoría de ${empresa}, y ${numero(otras)} ${otras === 1 ? "empresa más" : "empresas más"}` : `De ${empresa}`}
        </p>
      </>
    );
  }
  if (capa === "av-barrio-relleno") {
    const n = Number(props.n ?? 0);
    const cuadras = Number(props.cuadras ?? 0);
    const pendientes = Number(props.pendientes ?? 0);
    return (
      <>
        <p className="font-bold">{String(props.nombre ?? "Barrio")}</p>
        <p className="num text-texto-2">
          {n === 0
            ? "Sin trabajos en lo que se está mirando"
            : `${numero(n)} ${n === 1 ? "trabajo" : "trabajos"} · ${numero(cuadras)} ${cuadras === 1 ? "cuadra" : "cuadras"} · ${medida(props.m2)}`}
        </p>
        <p className="num text-texto-3">
          {pendientes === 0 ? "Ningún pedido esperando" : `${numero(pendientes)} ${pendientes === 1 ? "pedido esperando" : "pedidos esperando"}`} · tocá para ver más
        </p>
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

function FichaBarrio({ p, recortado, alRecortar }: { p: FichaDeBarrio; recortado: boolean; alRecortar?: () => void }) {
  return (
    <>
      <p className="pr-5 font-bold">Barrio {p.nombre}</p>
      {p.n > 0 ? (
        <p className="num mt-1 text-xs text-texto-2">
          <b className="text-texto">{numero(p.n)}</b> {p.n === 1 ? "trabajo" : "trabajos"} ·{" "}
          <b className="text-texto">{numero(p.cuadras)}</b> {p.cuadras === 1 ? "cuadra" : "cuadras"}
          {p.m2 > 0 ? ` · ${numero(p.m2)} m²` : ""}
        </p>
      ) : (
        <p className="mt-1 text-xs text-texto-2">Todavía sin trabajos en lo que se está mirando.</p>
      )}
      <p className="num mt-1 text-xs text-texto-3">
        {p.pendientes === 0
          ? "Ningún pedido de bacheo esperando."
          : `${numero(p.pendientes)} ${p.pendientes === 1 ? "pedido de bacheo esperando" : "pedidos de bacheo esperando"}.`}
      </p>
      {alRecortar && !recortado && (
        <button type="button" onClick={alRecortar} className="mt-2 text-xs font-semibold text-celeste">
          Ver solo este barrio →
        </button>
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
