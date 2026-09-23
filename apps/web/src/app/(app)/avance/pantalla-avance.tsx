"use client";

import {
  Check,
  ChevronDown,
  ImageDown,
  Link2,
  Loader2,
  MapPin,
  MapPinned,
  Pause,
  Play,
  Printer,
  Search,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapaLibre } from "maplibre-gl";
import type { RolUsuario } from "@cimba/domain";
import {
  type Camara,
  type CapasAvance,
  type DatosAvance,
  type DiasVentana,
  type Foco,
  type HechoProps,
  type ListasTerritorios,
  type PaginaMuro,
  type TerritorioRef,
  VENTANAS,
  etiquetaVentana,
  fechaDeDia,
  nombreRecorte,
} from "@/lib/avance-tipos";
import { colorDeEmpresaEn } from "@/lib/color-empresa";
import { numero } from "@/lib/formato";
import { VisorAntesDespues, type ParAntesDespues } from "@/components/visor-antes-despues";
import { usarTemaMapa } from "@/components/mapa/tema-mapa";
import { MapaAvance } from "./mapa-avance";
import { MuroAntesDespues, parDeMuro } from "./muro-antes-despues";
import { RailAvance } from "./rail-avance";
import {
  compartirArchivo,
  descargar,
  generarTarjeta,
  nombreDeArchivo,
  puedeCompartirArchivos,
} from "./tarjeta-compartir";

/**
 * AVANCE — la pantalla entera: el mapa a la izquierda, la columna de datos a
 * la derecha; en el teléfono, uno debajo del otro.
 *
 * Tres capas con una jerarquía clara, que es lo que la distingue del mapa
 * principal:
 *  - LO HECHO es la protagonista: cada trabajo terminado, un círculo del color
 *    de su empresa y del tamaño de sus m² (de lejos, celdas con la cantidad).
 *  - LO QUE SE HACE AHORA es el pulso: las órdenes activas dibujadas por su
 *    área real, las obras en curso como anillos, lo cargado en las últimas
 *    48 horas latiendo en celeste y lo que acaba de entrar, en amarillo.
 *  - LO QUE FALTA es el fondo: los pedidos que esperan, en gris, siempre
 *    visibles. Se pueden apagar, pero abren prendidos.
 *
 * La ventana por defecto es EL MES, no el día: hay días sin carga y una
 * pantalla que abriera en "Hoy" mostraría una ciudad vacía la mitad de las
 * mañanas, que es lo contrario de lo que tiene que decir.
 *
 * Se puede RECORTAR a un distrito o a un barrio (todo pasa a ser del recorte),
 * BUSCAR una dirección y ver qué se hizo en esa cuadra, y COMPARTIR: el link
 * de la vista exacta, una imagen lista para WhatsApp, o el resumen para
 * imprimir.
 *
 * El mapa y la columna se hablan: pasar el cursor por una empresa o una orden
 * en la columna la resalta en el mapa; tocar una foto abre el antes y el
 * después a pantalla completa; tocar una línea del feed vuela al lugar; tocar
 * una empresa la aísla y la encuadra.
 *
 * La LÍNEA DE TIEMPO pinta la ciudad día por día desde el principio de la
 * ventana hasta hoy —nueve segundos que explican el trabajo de un mes; con
 * "Todo", dieciocho segundos desde marzo— y se puede recorrer con el dedo.
 * Mientras corre se encienden las cuadras arregladas, se llenan los barrios y
 * el rótulo cuenta baches, cuadras y barrios alcanzados.
 *
 * EL MURO del antes y el después se abre desde las fotos de la columna: todos
 * los trabajos con las dos fotos, y un modo en que pasan solas.
 *
 * Con `pantalla` (la ruta /tv) es la misma pantalla sin menú, con reloj, que
 * se recarga sola cada diez minutos y, con `rotar`, va pasando sola de vista:
 * el mes, su película, la película desde marzo, la semana, hoy, las fotos del
 * antes y el después pasando solas, y un distrito distinto en cada vuelta. Con `publico` (la ruta /publico) no hay links hacia
 * adentro ni datos de personas: es para mostrar afuera.
 */

interface Llegada {
  ids: number[];
  muestra: HechoProps[];
}

interface Direccion {
  texto: string;
  lon: number;
  lat: number;
  exacta: boolean;
  hechos: number;
  m2: number;
  pendientes: number;
}

/** Distancia en metros entre dos puntos, suficiente para "en esta cuadra". */
function metros(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function PantallaAvance({
  inicial,
  rol,
  territorios,
  empresaInicial = null,
  camaraInicial = null,
  pantalla = false,
  rotar = false,
  publico = false,
}: {
  inicial: DatosAvance;
  rol: RolUsuario;
  territorios: ListasTerritorios;
  empresaInicial?: string | null;
  camaraInicial?: Camara | null;
  pantalla?: boolean;
  rotar?: boolean;
  publico?: boolean;
}) {
  const [datos, setDatos] = useState<DatosAvance>(inicial);
  const [dias, setDias] = useState<DiasVentana>(inicial.ventana.dias);
  const [territorio, setTerritorio] = useState<TerritorioRef | null>(
    inicial.territorio ? { tipo: inicial.territorio.tipo, id: inicial.territorio.id } : null,
  );
  const vistaRef = useRef({ dias, territorio });
  const mapaRef = useRef<MapaLibre | null>(null);
  const [cargando, setCargando] = useState(false);
  const [empresaSel, setEmpresaSel] = useState<string | null>(
    empresaInicial && inicial.porEmpresa.some((e) => e.empresa === empresaInicial) ? empresaInicial : null,
  );
  const [resaltada, setResaltada] = useState<string | null>(null);
  const [ordenResaltada, setOrdenResaltada] = useState<number | null>(null);
  const [foco, setFoco] = useState<Foco | null>(null);
  const [verPendientes, setVerPendientes] = useState(true);
  const [leyendaAbierta, setLeyendaAbierta] = useState(false);
  const [menu, setMenu] = useState<"recorte" | "compartir" | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [armando, setArmando] = useState(false);
  const [visor, setVisor] = useState<{ pares: ParAntesDespues[]; indice: number; pasar?: boolean } | null>(null);
  const [muroAbierto, setMuroAbierto] = useState(false);
  /** Barrios, cuadras arregladas y a qué cuadra y barrio va cada trabajo: llega aparte, una vez. */
  const [capas, setCapas] = useState<CapasAvance | null>(null);
  const tema = usarTemaMapa();
  const colorEmpresa = useCallback((e: string) => colorDeEmpresaEn(e, tema), [tema]);
  const [llegada, setLlegada] = useState<Llegada | null>(null);
  const [direccion, setDireccion] = useState<Direccion | null>(null);
  const [busquedaDir, setBusquedaDir] = useState("");
  const [buscandoDir, setBuscandoDir] = useState(false);
  /** El día hasta el que se muestra en la línea de tiempo; null = todo, sin línea. */
  const [cursor, setCursor] = useState<number | null>(null);
  const cursorRef = useRef<number | null>(null);
  cursorRef.current = cursor;
  const [reproduciendo, setReproduciendo] = useState(false);

  const rutaDatos = publico ? "/api/publico/avance" : "/api/avance";
  const rutaFotos = publico ? "/api/publico/avance/fotos" : "/api/avance/fotos";

  /* Las capas de alcance, una vez al abrir. Si no llegan, el mapa sigue con
     los puntos: es un agregado, no una condición. */
  useEffect(() => {
    let vivo = true;
    fetch(publico ? "/api/publico/avance/capas" : "/api/avance/capas")
      .then((r) => (r.ok ? (r.json() as Promise<CapasAvance>) : null))
      .then((c) => {
        if (vivo && c) setCapas(c);
      })
      .catch(() => {
        /* sin capas: quedan los puntos */
      });
    return () => {
      vivo = false;
    };
  }, [publico]);

  /** A qué cuadra y a qué barrio va cada trabajo, para las cuentas de alcance. */
  const asignacion = useMemo(() => {
    const m = new Map<number, { cuadra: number | null; barrio: number | null }>();
    for (const [id, , cuadra, barrio] of capas?.trabajos ?? []) m.set(id, { cuadra, barrio });
    return m;
  }, [capas]);
  const parametros = (d: DiasVentana, t: TerritorioRef | null) => {
    const p = new URLSearchParams();
    if (d !== 30) p.set("dias", String(d));
    if (t) p.set(t.tipo, String(t.id));
    return p;
  };

  const cargar = useCallback(
    async (d: DiasVentana, t: TerritorioRef | null, silencioso: boolean) => {
      if (!silencioso) setCargando(true);
      try {
        const p = parametros(d, t);
        p.set("dias", String(d));
        const r = await fetch(`${rutaDatos}?${p.toString()}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as DatosAvance;
        // Si mientras cargaba se cambió de vista, esto ya no es lo que se mira.
        const v = vistaRef.current;
        if (v.dias === d && v.territorio?.tipo === t?.tipo && v.territorio?.id === t?.id) setDatos(j);
      } catch {
        /* sin red: se queda lo último que llegó, que sigue siendo cierto */
      } finally {
        if (!silencioso) setCargando(false);
      }
    },
    [rutaDatos],
  );

  const cerrarLinea = useCallback(() => {
    setReproduciendo(false);
    setCursor(null);
  }, []);

  /* La URL describe la vista: ventana, recorte y empresa. Así el link del
     navegador ya sirve para volver a lo mismo. */
  const primeraVez = useRef(true);
  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    try {
      const url = new URL(window.location.href);
      const p = parametros(dias, territorio);
      if (empresaSel) p.set("empresa", empresaSel);
      url.search = p.toString();
      window.history.replaceState(null, "", url);
    } catch {
      /* la URL es una comodidad, no un requisito */
    }
  }, [dias, territorio, empresaSel]);

  const elegirVentana = useCallback(
    (d: DiasVentana) => {
      if (d === vistaRef.current.dias) return;
      cerrarLinea();
      setDias(d);
      vistaRef.current = { ...vistaRef.current, dias: d };
      void cargar(d, vistaRef.current.territorio, false);
    },
    [cargar, cerrarLinea],
  );

  const elegirTerritorio = useCallback(
    (t: TerritorioRef | null) => {
      cerrarLinea();
      setMenu(null);
      setBusqueda("");
      setDireccion(null);
      setTerritorio(t);
      vistaRef.current = { ...vistaRef.current, territorio: t };
      void cargar(vistaRef.current.dias, t, false);
    },
    [cargar, cerrarLinea],
  );

  /* Cada minuto, los datos con la vista puesta. Todo lo vivo (feed, fotos)
     viene en el mismo paquete: una sola fuente, un solo refresco. */
  useEffect(() => {
    const id = window.setInterval(() => void cargar(vistaRef.current.dias, vistaRef.current.territorio, true), 60_000);
    return () => window.clearInterval(id);
  }, [cargar]);

  /**
   * LO QUE ACABA DE ENTRAR. Cuando un refresco trae trabajos que el anterior
   * no tenía (misma ventana, mismo recorte), se marcan durante un minuto y
   * medio: laten en amarillo en el mapa y un cartel dice qué llegó. Para el
   * televisor es la diferencia entre un mapa y una transmisión.
   */
  const idsPrevios = useRef<{ clave: string; ids: Set<number> } | null>(null);
  useEffect(() => {
    const clave = `${datos.ventana.dias}|${datos.territorio?.tipo ?? ""}|${datos.territorio?.id ?? ""}`;
    const ids = new Set(datos.hechos.features.map((f) => f.properties.id));
    const previo = idsPrevios.current;
    idsPrevios.current = { clave, ids };
    if (!previo || previo.clave !== clave) return;
    const nuevos = datos.hechos.features.filter((f) => !previo.ids.has(f.properties.id));
    if (nuevos.length === 0) return;
    setLlegada({ ids: nuevos.map((f) => f.properties.id), muestra: nuevos.slice(0, 3).map((f) => f.properties) });
  }, [datos]);
  useEffect(() => {
    if (!llegada) return;
    const id = window.setTimeout(() => setLlegada(null), 90_000);
    return () => window.clearTimeout(id);
  }, [llegada]);
  const nuevos = useMemo(() => new Set(llegada?.ids ?? []), [llegada]);

  /* Modo pantalla: la página entera se renueva cada diez minutos, así un
     deploy nuevo entra solo al televisor de la oficina. */
  useEffect(() => {
    if (!pantalla) return;
    const id = window.setTimeout(() => window.location.reload(), 10 * 60_000);
    return () => window.clearTimeout(id);
  }, [pantalla]);

  /**
   * LA PANTALLA QUE SE MUEVE SOLA (televisor): cada 50 segundos pasa de vista
   * —el mes de toda la ciudad, su reproducción, la semana, hoy, y un distrito
   * distinto en cada vuelta— y vuelve a empezar. Los números suben al cambiar,
   * así se ve que está viva desde el otro lado de la oficina.
   */
  const elegirVentanaRef = useRef(elegirVentana);
  elegirVentanaRef.current = elegirVentana;
  const elegirTerritorioRef = useRef(elegirTerritorio);
  elegirTerritorioRef.current = elegirTerritorio;
  const distritoTurno = useRef(0);
  /** Reproducir apenas lleguen los datos de "Todo" (el televisor lo pide antes de tenerlos). */
  const reproducirAlCargar = useRef(false);
  useEffect(() => {
    if (reproducirAlCargar.current && datos.ventana.dias === 0) {
      reproducirAlCargar.current = false;
      setReproduciendo(true);
    }
  }, [datos]);
  const rutaFotosRef = useRef(rutaFotos);
  rutaFotosRef.current = rutaFotos;
  useEffect(() => {
    if (!pantalla || !rotar) return;
    const pasos: Array<() => void> = [
      () => {
        elegirTerritorioRef.current(null);
        elegirVentanaRef.current(30);
      },
      () => setReproduciendo(true),
      () => {
        reproducirAlCargar.current = true;
        elegirVentanaRef.current(0);
      },
      () => elegirVentanaRef.current(7),
      () => elegirVentanaRef.current(1),
      () => {
        /* Las fotos del antes y el después, pasando solas, de toda la ciudad. */
        void fetch(`${rutaFotosRef.current}?pagina=0`)
          .then((r) => (r.ok ? (r.json() as Promise<PaginaMuro>) : null))
          .then((j) => {
            if (j && j.pares.length > 0) setVisor({ pares: j.pares.slice(0, 8).map(parDeMuro), indice: 0, pasar: true });
          })
          .catch(() => {
            /* sin fotos, se queda en el mapa */
          });
      },
      () => {
        const lista = territorios.distritos;
        if (lista.length === 0) return;
        const d = lista[distritoTurno.current % lista.length]!;
        distritoTurno.current++;
        elegirVentanaRef.current(30);
        elegirTerritorioRef.current({ tipo: "distrito", id: d.id });
      },
    ];
    let i = 0;
    const id = window.setInterval(() => {
      i = (i + 1) % pasos.length;
      setVisor(null);
      pasos[i]!();
    }, 50_000);
    return () => window.clearInterval(id);
  }, [pantalla, rotar, territorios.distritos]);

  /** Desde qué día arranca la línea de tiempo: el de la ventana, o el primer trabajo si es "Todo". */
  const desdeDia = useMemo(() => {
    if (datos.ventana.desdeDia != null) return datos.ventana.desdeDia;
    let min = datos.hoyDia;
    for (const f of datos.hechos.features) if (f.properties.dia < min) min = f.properties.dia;
    return min;
  }, [datos]);
  const inicioLinea = Math.min(desdeDia, datos.hoyDia);
  const finLinea = datos.hoyDia;

  /* La reproducción: el cursor avanza a ritmo fijo (~9 s en total, sea una
     semana o seis meses). Arranca desde donde esté el cursor —si se lo dejó a
     mitad de camino, sigue de ahí— y al terminar se queda en hoy, con la
     línea a la vista para volver atrás con el dedo. */
  useEffect(() => {
    if (!reproduciendo) return;
    const pasos = Math.max(1, finLinea - inicioLinea + 1);
    /* "Todo" son seis meses: el doble de tiempo, para que se lea. */
    const ms = Math.max(45, Math.round((datos.ventana.dias === 0 ? 18_000 : 9000) / pasos));
    let actual = cursorRef.current == null || cursorRef.current >= finLinea ? inicioLinea : cursorRef.current;
    setCursor(actual);
    const id = window.setInterval(() => {
      actual += 1;
      if (actual >= finLinea) {
        window.clearInterval(id);
        setCursor(finLinea);
        setReproduciendo(false);
        return;
      }
      setCursor(actual);
    }, ms);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reproduciendo, inicioLinea, finLinea]);

  /** Lo acumulado hasta el cursor, para el rótulo que acompaña la línea de tiempo. */
  const acumulado = useMemo(() => {
    if (cursor == null) return null;
    let n = 0;
    let m2 = 0;
    const cuadras = new Set<number>();
    const barrios = new Set<number>();
    for (const f of datos.hechos.features) {
      const p = f.properties;
      if (p.dia <= cursor && (!empresaSel || p.empresa === empresaSel)) {
        n++;
        m2 += p.m2 ?? 0;
        const a = asignacion.get(p.id);
        if (a?.cuadra != null) cuadras.add(a.cuadra);
        if (a?.barrio != null) barrios.add(a.barrio);
      }
    }
    return { n, m2, cuadras: cuadras.size, barrios: barrios.size };
  }, [cursor, datos, empresaSel, asignacion]);

  /**
   * EL ALCANCE de lo que se mira: en cuántas cuadras distintas y en cuántos
   * barrios hubo trabajo, contra el total de barrios del recorte. Sin capas,
   * no se muestra (no se inventa).
   */
  const alcance = useMemo(() => {
    if (!capas) return null;
    const cuadras = new Set<number>();
    const barrios = new Set<number>();
    for (const f of datos.hechos.features) {
      const p = f.properties;
      if (empresaSel && p.empresa !== empresaSel) continue;
      const a = asignacion.get(p.id);
      if (a?.cuadra != null) cuadras.add(a.cuadra);
      if (a?.barrio != null) barrios.add(a.barrio);
    }
    const t = datos.territorio;
    const totalBarrios =
      t?.tipo === "barrio"
        ? null
        : capas.barrios.features.filter((b) => !t || b.properties.distrito === t.id).length;
    return { cuadras: cuadras.size, barrios: barrios.size, totalBarrios };
  }, [capas, asignacion, datos.hechos, datos.territorio, empresaSel]);

  const alternarEmpresa = useCallback((e: string) => setEmpresaSel((s) => (s === e ? null : e)), []);
  const enfocar = useCallback(
    (lugar: { lon: number; lat: number; id: number | null }) => setFoco({ ...lugar, clave: Date.now() }),
    [],
  );

  /* El aviso corto ("Link copiado") se va solo. */
  useEffect(() => {
    if (!aviso) return;
    const id = window.setTimeout(() => setAviso(null), 3200);
    return () => window.clearTimeout(id);
  }, [aviso]);

  /** El antes y el después a pantalla completa, desde las fotos de la columna. */
  const ampliarFotos = useCallback(
    (indice: number) => {
      const pares: ParAntesDespues[] = datos.fotos.map((f) => ({
        antes: f.urlAntes,
        despues: f.url,
        titulo: f.direccion ?? "Trabajo terminado",
        sub: f.empresa,
        lon: f.lon,
        lat: f.lat,
        id: f.intervencionId,
      }));
      if (pares.length > 0) setVisor({ pares, indice: Math.min(indice, pares.length - 1) });
    },
    [datos.fotos],
  );

  /**
   * BUSCAR UNA DIRECCIÓN: el callejero municipal la ubica, el mapa vuela y se
   * cuenta lo que hay a 120 metros —una cuadra— en la ventana: baches hechos,
   * m², pedidos que esperan. Es la respuesta al vecino que llama.
   */
  const buscarDireccion = async () => {
    const q = busquedaDir.trim();
    if (q.length < 4 || buscandoDir) return;
    setBuscandoDir(true);
    try {
      const r = await fetch(`/api/geocodificar?q=${encodeURIComponent(q)}`);
      const j = (await r.json()) as { resultado: { punto: { lat: number; lon: number }; precision?: string } | null };
      const res = j.resultado;
      if (!res?.punto) {
        setAviso("No encontré esa dirección. Probá con calle y altura, o dos calles que se cruzan.");
        return;
      }
      const { lat, lon } = res.punto;
      let hechos = 0;
      let m2 = 0;
      for (const f of datos.hechos.features) {
        const [flon, flat] = f.geometry.coordinates as [number, number];
        if (metros(lat, lon, flat, flon) <= 120) {
          hechos++;
          m2 += f.properties.m2 ?? 0;
        }
      }
      let pendientes = 0;
      for (const f of datos.pendientes.features) {
        const [flon, flat] = f.geometry.coordinates as [number, number];
        if (metros(lat, lon, flat, flon) <= 120) pendientes++;
      }
      setDireccion({ texto: q, lon, lat, exacta: res.precision === "exacta", hechos, m2: Math.round(m2), pendientes });
      setMenu(null);
      enfocar({ lon, lat, id: null });
    } catch {
      setAviso("No se pudo buscar la dirección. Probá de nuevo.");
    } finally {
      setBuscandoDir(false);
    }
  };

  /** El link de ESTA vista: ventana, recorte, empresa y cámara. */
  const linkDeLaVista = () => {
    const url = new URL(window.location.href);
    const p = parametros(dias, territorio);
    if (empresaSel) p.set("empresa", empresaSel);
    const m = mapaRef.current;
    if (m) {
      const c = m.getCenter();
      p.set("c", `${c.lat.toFixed(5)},${c.lng.toFixed(5)},${m.getZoom().toFixed(1)}`);
    }
    url.search = p.toString();
    return url.toString();
  };

  const copiarLink = async () => {
    setMenu(null);
    try {
      await navigator.clipboard.writeText(linkDeLaVista());
      setAviso("Link copiado: abre esta misma vista, con el encuadre.");
    } catch {
      setAviso("No se pudo copiar. Copiá la dirección de la barra del navegador.");
    }
  };

  const armarImagen = async (): Promise<Blob | null> => {
    const m = mapaRef.current;
    if (!m) {
      setAviso("El mapa todavía no terminó de cargar.");
      return null;
    }
    setArmando(true);
    try {
      return await generarTarjeta({ mapa: m, datos, dias, empresa: empresaSel });
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No se pudo armar la imagen.");
      return null;
    } finally {
      setArmando(false);
    }
  };

  const bajarImagen = async () => {
    setMenu(null);
    const blob = await armarImagen();
    if (!blob) return;
    descargar(blob, nombreDeArchivo(datos));
    setAviso("Imagen guardada: lista para mandar por WhatsApp.");
  };

  const compartirImagen = async () => {
    setMenu(null);
    const blob = await armarImagen();
    if (!blob) return;
    const texto = `Avance de bacheo · ${nombreRecorte(datos.territorio)} · ${numero(datos.cifras.ventana.n)} baches reparados`;
    const ok = await compartirArchivo(blob, nombreDeArchivo(datos), texto);
    if (!ok) descargar(blob, nombreDeArchivo(datos));
  };

  const imprimir = () => {
    setMenu(null);
    window.open(`/imprimir?${parametros(dias, territorio).toString()}`, "_blank", "noopener");
  };

  const sinTrabajo = datos.hechos.features.length === 0;
  const recorte = nombreRecorte(datos.territorio);

  const barriosFiltrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    const lista = q ? territorios.barrios.filter((b) => normalizar(b.nombre).includes(q)) : territorios.barrios;
    return lista.slice(0, 40);
  }, [busqueda, territorios.barrios]);

  const empresasLlegada = llegada ? [...new Set(llegada.muestra.map((h) => h.empresa))] : [];

  return (
    <div className={`flex min-h-0 flex-col lg:flex-row ${pantalla ? "h-screen bg-fondo" : "h-full"}`}>
      {/* ── El mapa ─────────────────────────────────────────────────────── */}
      <div className="relative min-h-[58vh] flex-1 lg:min-h-0">
        <MapaAvance
          datos={datos}
          empresaSel={empresaSel}
          resaltada={resaltada}
          ordenResaltada={ordenResaltada}
          cursor={cursor}
          nuevos={nuevos}
          verPendientes={verPendientes}
          foco={foco}
          camaraInicial={camaraInicial}
          capas={capas}
          alElegirTerritorio={elegirTerritorio}
          alListo={(m) => {
            mapaRef.current = m;
          }}
          alAmpliar={(par) => setVisor({ pares: [par], indice: 0 })}
          pantalla={pantalla}
          publico={publico}
        />

        {/* Ventana de tiempo, recorte, línea de tiempo y compartir. Va por
            encima de la leyenda (z-20 contra z-10): sus paneles la tapan. */}
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-col items-start gap-1.5">
          <div className="flex flex-wrap items-start gap-2">
            <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-borde bg-panel/90 p-1 shadow-lg backdrop-blur">
              {VENTANAS.map((v) => (
                <button
                  key={v.dias}
                  type="button"
                  onClick={() => elegirVentana(v.dias)}
                  aria-pressed={dias === v.dias}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    dias === v.dias ? "bg-azul text-white" : "text-texto-2 hover:bg-panel-2 hover:text-texto"
                  }`}
                >
                  {v.etiqueta}
                </button>
              ))}
              <span className="mx-1 h-5 w-px bg-borde" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setMenu((m) => (m === "recorte" ? null : "recorte"))}
                aria-expanded={menu === "recorte"}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  territorio ? "bg-celeste/15 text-celeste" : "text-texto-2 hover:bg-panel-2 hover:text-texto"
                }`}
              >
                <MapPinned size={13} />
                {recorte}
                <ChevronDown size={12} className={menu === "recorte" ? "rotate-180 transition" : "transition"} />
              </button>
              <span className="mx-1 h-5 w-px bg-borde" aria-hidden="true" />
              <button
                type="button"
                onClick={() => (reproduciendo ? setReproduciendo(false) : setReproduciendo(true))}
                disabled={sinTrabajo}
                title="Pinta el mapa día por día, desde el principio de la ventana hasta hoy"
                aria-label={reproduciendo ? "Pausar la línea de tiempo" : "Reproducir la línea de tiempo"}
                className="flex items-center gap-1.5 rounded-lg border border-amarillo/50 px-2.5 py-1.5 text-xs font-bold text-amarillo transition hover:bg-amarillo/10 disabled:opacity-40 sm:px-3"
              >
                {reproduciendo ? <Pause size={12} /> : <Play size={12} />}
                {/* En el teléfono, solo el ícono: la barra no puede ocupar tres renglones del mapa. */}
                <span className="hidden sm:inline">{reproduciendo ? "Pausar" : "Reproducir"}</span>
              </button>
              {!pantalla && (
                <button
                  type="button"
                  onClick={() => setMenu((m) => (m === "compartir" ? null : "compartir"))}
                  aria-expanded={menu === "compartir"}
                  aria-label="Compartir"
                  disabled={armando}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-texto-2 transition hover:bg-panel-2 hover:text-texto disabled:opacity-60 sm:px-3"
                >
                  {armando ? <Loader2 size={13} className="animate-spin" /> : <Share2 size={13} />}
                  <span className="hidden sm:inline">{armando ? "Armando…" : "Compartir"}</span>
                </button>
              )}
              {cargando && <span className="px-2 text-[11px] text-texto-3">cargando…</span>}
            </div>

            {empresaSel && (
              <button
                type="button"
                onClick={() => setEmpresaSel(null)}
                className="pointer-events-auto flex items-center gap-1.5 rounded-xl border border-borde bg-panel/90 px-3 py-2 text-xs font-semibold text-texto shadow-lg backdrop-blur"
              >
                Solo {empresaSel}
                <X size={12} className="text-texto-3" />
                <span className="text-texto-3">ver todas</span>
              </button>
            )}
          </div>

          {/* La línea de tiempo: el día hasta el que se muestra, y el dedo para moverlo */}
          {cursor != null && acumulado && (
            <div className="pointer-events-auto w-[min(26rem,calc(100vw-24px))] rounded-xl border border-amarillo/40 bg-panel/95 px-3 py-2 shadow-lg backdrop-blur">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold tracking-[0.12em] text-texto-3 uppercase">Hasta el</p>
                  <p className="text-sm font-bold">{fechaDeDia(cursor)}</p>
                  <p className="num text-xs text-texto-2">
                    {numero(acumulado.n)} baches · {numero(Math.round(acumulado.m2))} m²
                    {capas && (
                      <>
                        {" "}· <b className="text-texto">{numero(acumulado.cuadras)}</b> {acumulado.cuadras === 1 ? "cuadra" : "cuadras"} ·{" "}
                        <b className="text-texto">{numero(acumulado.barrios)}</b> {acumulado.barrios === 1 ? "barrio" : "barrios"}
                      </>
                    )}
                  </p>
                </div>
                <button type="button" onClick={cerrarLinea} aria-label="Cerrar la línea de tiempo" className="rounded-md p-1 text-texto-3 hover:text-texto">
                  <X size={14} />
                </button>
              </div>
              <input
                type="range"
                min={inicioLinea}
                max={finLinea}
                step={1}
                value={cursor}
                onChange={(e) => {
                  setReproduciendo(false);
                  setCursor(Number(e.target.value));
                }}
                aria-label="Recorrer la línea de tiempo"
                className="mt-1.5 w-full accent-amarillo"
              />
              <div className="flex justify-between text-[10px] text-texto-3">
                <span>{fechaDeDia(inicioLinea)}</span>
                <span>hoy</span>
              </div>
            </div>
          )}

          {/* Lo que acaba de entrar */}
          {llegada && (
            <div className="pointer-events-auto flex max-w-[min(30rem,calc(100vw-24px))] items-start gap-2 rounded-xl border border-amarillo/60 bg-panel/95 px-3 py-2 shadow-lg backdrop-blur">
              <Sparkles size={16} className="mt-0.5 shrink-0 text-amarillo" />
              <div className="min-w-0 flex-1 text-xs">
                <p className="font-bold">
                  {llegada.ids.length === 1 ? "Acaba de entrar un trabajo" : `Acaban de entrar ${numero(llegada.ids.length)} trabajos`}
                  {empresasLlegada.length > 0 ? ` · ${empresasLlegada.join(", ")}` : ""}
                </p>
                <p className="truncate text-texto-2">
                  {llegada.muestra[0]?.direccion ?? "Sin dirección"}
                  {llegada.ids.length > 1 ? ` y ${numero(llegada.ids.length - 1)} más` : ""}
                </p>
              </div>
              {llegada.muestra[0] && (
                <button
                  type="button"
                  onClick={() => {
                    const h = llegada.muestra[0]!;
                    const f = datos.hechos.features.find((x) => x.properties.id === h.id);
                    if (f) {
                      const [lon, lat] = f.geometry.coordinates as [number, number];
                      enfocar({ lon, lat, id: h.id });
                    }
                  }}
                  className="shrink-0 rounded-lg bg-amarillo/15 px-2 py-1 text-xs font-bold text-amarillo"
                >
                  Ver
                </button>
              )}
              <button type="button" onClick={() => setLlegada(null)} aria-label="Cerrar" className="shrink-0 p-1 text-texto-3 hover:text-texto">
                <X size={13} />
              </button>
            </div>
          )}

          {/* La dirección buscada y lo que hay en su cuadra */}
          {direccion && (
            <div className="pointer-events-auto flex max-w-[min(30rem,calc(100vw-24px))] items-start gap-2 rounded-xl border border-celeste/50 bg-panel/95 px-3 py-2 shadow-lg backdrop-blur">
              <MapPin size={16} className="mt-0.5 shrink-0 text-celeste" />
              <div className="min-w-0 flex-1 text-xs">
                <p className="truncate font-bold">
                  {direccion.texto}
                  <span className="ml-1.5 font-normal text-texto-3">{direccion.exacta ? "ubicación exacta" : "ubicación aproximada"}</span>
                </p>
                <p className="num text-texto-2">
                  En esta cuadra, {etiquetaVentana(dias, datos.cifras.total.desde).toLowerCase()}:{" "}
                  <b className="text-texto">{numero(direccion.hechos)}</b> {direccion.hechos === 1 ? "bache hecho" : "baches hechos"}
                  {direccion.m2 > 0 ? ` (${numero(direccion.m2)} m²)` : ""} ·{" "}
                  <b className="text-texto">{numero(direccion.pendientes)}</b> {direccion.pendientes === 1 ? "pedido esperando" : "pedidos esperando"}
                </p>
              </div>
              <button type="button" onClick={() => setDireccion(null)} aria-label="Cerrar" className="shrink-0 p-1 text-texto-3 hover:text-texto">
                <X size={13} />
              </button>
            </div>
          )}

          {/* El recorte: distritos como chips, barrios con buscador, y una dirección */}
          {menu === "recorte" && (
            <div className="pointer-events-auto w-[min(24rem,calc(100vw-24px))] rounded-xl border border-borde bg-panel/95 p-3 shadow-xl backdrop-blur">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold tracking-[0.14em] text-texto-3 uppercase">Recortar a</p>
                <button
                  type="button"
                  onClick={() => elegirTerritorio(null)}
                  className={`rounded-lg px-2 py-1 text-[11px] font-semibold ${
                    territorio ? "text-celeste hover:bg-panel-2" : "text-texto-3"
                  }`}
                >
                  {territorio ? "Toda la ciudad" : "Toda la ciudad ✓"}
                </button>
              </div>
              <p className="mt-2 text-[11px] font-semibold text-texto-2">Distrito</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {territorios.distritos.map((d) => {
                  const activo = territorio?.tipo === "distrito" && territorio.id === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => elegirTerritorio({ tipo: "distrito", id: d.id })}
                      aria-pressed={activo}
                      title={d.nombre}
                      className={`num min-w-8 rounded-lg px-2 py-1 text-xs font-bold transition ${
                        activo ? "bg-azul text-white" : "border border-borde-2 text-texto-2 hover:border-celeste/60 hover:text-texto"
                      }`}
                    >
                      {d.nombre.replace(/^Distrito\s+/i, "")}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[11px] font-semibold text-texto-2">Barrio</p>
              <input
                type="search"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Escribí el nombre del barrio…"
                className="mt-1 w-full rounded-lg border border-borde-2 bg-panel px-3 py-1.5 text-sm outline-none focus:border-celeste"
              />
              <ul className="mt-1 max-h-36 overflow-y-auto">
                {barriosFiltrados.map((b) => {
                  const activo = territorio?.tipo === "barrio" && territorio.id === b.id;
                  return (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => elegirTerritorio({ tipo: "barrio", id: b.id })}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-sm transition hover:bg-panel-2 ${
                          activo ? "font-bold text-celeste" : "text-texto-2"
                        }`}
                      >
                        {b.nombre}
                        {activo && <Check size={13} />}
                      </button>
                    </li>
                  );
                })}
                {barriosFiltrados.length === 0 && <li className="px-2 py-1 text-xs text-texto-3">Ningún barrio con ese nombre.</li>}
              </ul>
              {!publico && (
                <>
                  <p className="mt-3 text-[11px] font-semibold text-texto-2">Una dirección</p>
                  <form
                    className="mt-1 flex gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void buscarDireccion();
                    }}
                  >
                    <input
                      type="search"
                      value={busquedaDir}
                      onChange={(e) => setBusquedaDir(e.target.value)}
                      placeholder="Colombia 4500, o San Martín y Muñecas"
                      className="min-w-0 flex-1 rounded-lg border border-borde-2 bg-panel px-3 py-1.5 text-sm outline-none focus:border-celeste"
                    />
                    <button
                      type="submit"
                      disabled={buscandoDir || busquedaDir.trim().length < 4}
                      className="flex items-center gap-1 rounded-lg bg-azul px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {buscandoDir ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                      Ir
                    </button>
                  </form>
                  <p className="mt-1 text-[10px] text-texto-3">Vuela a la cuadra y dice qué se hizo ahí y qué espera.</p>
                </>
              )}
            </div>
          )}

          {/* Compartir: el link exacto, la imagen para WhatsApp, el resumen para imprimir */}
          {menu === "compartir" && (
            <div className="pointer-events-auto w-[min(22rem,calc(100vw-24px))] rounded-xl border border-borde bg-panel/95 p-2 shadow-xl backdrop-blur">
              <button
                type="button"
                onClick={() => void copiarLink()}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-panel-2"
              >
                <Link2 size={16} className="shrink-0 text-celeste" />
                <span>
                  <span className="block font-semibold">Copiar el link de esta vista</span>
                  <span className="block text-[11px] text-texto-3">Ventana, recorte, empresa y encuadre, tal como está.</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => void bajarImagen()}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-panel-2"
              >
                <ImageDown size={16} className="shrink-0 text-celeste" />
                <span>
                  <span className="block font-semibold">Bajar la imagen para WhatsApp</span>
                  <span className="block text-[11px] text-texto-3">El mapa como lo ves, las cifras, quién produjo y la fecha.</span>
                </span>
              </button>
              {puedeCompartirArchivos() && (
                <button
                  type="button"
                  onClick={() => void compartirImagen()}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-panel-2"
                >
                  <Share2 size={16} className="shrink-0 text-celeste" />
                  <span>
                    <span className="block font-semibold">Compartir la imagen…</span>
                    <span className="block text-[11px] text-texto-3">Directo a WhatsApp o a donde elijas.</span>
                  </span>
                </button>
              )}
              {!publico && (
                <button
                  type="button"
                  onClick={imprimir}
                  className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-panel-2"
                >
                  <Printer size={16} className="shrink-0 text-celeste" />
                  <span>
                    <span className="block font-semibold">Imprimir el resumen</span>
                    <span className="block text-[11px] text-texto-3">Una hoja A4 con el mapa, las cifras y quién produjo, para una reunión.</span>
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* La ventana está vacía: se dice, no se deja adivinar. */}
        {sinTrabajo && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-6">
            <p className="max-w-md rounded-2xl border border-borde bg-panel/95 px-5 py-4 text-center text-sm text-texto-2 shadow-xl backdrop-blur">
              {dias === 1
                ? `Hoy todavía no se cargó ningún trabajo${datos.territorio ? ` en ${recorte}` : ""}. Las órdenes activas están marcadas con línea punteada; lo que se cargue va a aparecer solo.`
                : `No hay trabajo cargado en esta ventana${datos.territorio ? ` en ${recorte}` : ""}. Probá con una más larga${datos.territorio ? " o con toda la ciudad" : ""}.`}
            </p>
          </div>
        )}

        {/* El aviso corto de abajo */}
        {aviso && (
          <div className="pointer-events-none absolute inset-x-0 bottom-20 z-20 flex justify-center px-4">
            <p className="rounded-xl border border-celeste/40 bg-panel/95 px-4 py-2 text-sm font-semibold text-texto shadow-xl backdrop-blur">
              {aviso}
            </p>
          </div>
        )}

        {/* La leyenda: una línea, y el detalle si se pide. Plegada tapaba
            seis renglones del mapa en el escritorio y medio mapa en el teléfono. */}
        <div className="pointer-events-none absolute bottom-8 left-3 z-10 flex max-w-[calc(100%-24px)] flex-col items-start gap-1.5">
          {leyendaAbierta && (
            <div className="pointer-events-auto rounded-xl border border-borde bg-panel/90 px-3 py-2 text-[11px] leading-relaxed text-texto-2 shadow-lg backdrop-blur">
              <p className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-celeste/80" aria-hidden="true" />
                Trabajo hecho: tamaño según m², color según empresa.
              </p>
              <p className="flex items-center gap-2">
                <span className="inline-block h-0 w-3 border-t-[3px] border-celeste" aria-hidden="true" />
                Cuadra arreglada, del color de la empresa que más hizo en ella
              </p>
              <p className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm bg-celeste/30" aria-hidden="true" />
                Barrio: más celeste, más trabajos. Punteado sin relleno: ninguno todavía
              </p>
              <p className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-celeste" aria-hidden="true" />
                Borde celeste: cargado en las últimas 48 h
              </p>
              <p className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-amarillo" aria-hidden="true" />
                Anillo amarillo: acaba de entrar
              </p>
              <p className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full border-2 border-texto-2" aria-hidden="true" />
                Anillo: obra en curso (paño de hormigón, carpeta)
              </p>
              <p className="flex items-center gap-2">
                <span className="inline-block h-0 w-3 border-t-2 border-dashed border-texto-2" aria-hidden="true" />
                Punteado: área de una orden activa
              </p>
              {datos.territorio && (
                <p className="flex items-center gap-2">
                  <span className="inline-block h-0 w-3 border-t-2 border-amarillo" aria-hidden="true" />
                  Amarillo: el contorno de {recorte}
                </p>
              )}
              <p className="flex items-center gap-2">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-texto-3" aria-hidden="true" />
                Gris: pedido que espera ({numero(datos.cifras.pendientes.pedidos)})
              </p>
              <p className="mt-1 text-texto-3">Pasá el cursor para ver qué es cada cosa; tocá para abrir la ficha.</p>
            </div>
          )}
          <div className="pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-borde bg-panel/90 px-3 py-1.5 text-[11px] text-texto-2 shadow-lg backdrop-blur">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-celeste/80" aria-hidden="true" />
              Hecho
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-celeste" aria-hidden="true" />
              48 h
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-texto-2" aria-hidden="true" />
              En curso
            </span>
            <span className="hidden items-center gap-1.5 sm:flex">
              <span className="inline-block h-0 w-3 border-t-2 border-dashed border-texto-2" aria-hidden="true" />
              Orden
            </span>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={verPendientes}
                onChange={(e) => setVerPendientes(e.target.checked)}
                className="h-3 w-3 accent-celeste"
              />
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-texto-3" aria-hidden="true" />
              Pendientes
            </label>
            <button
              type="button"
              onClick={() => setLeyendaAbierta((v) => !v)}
              aria-expanded={leyendaAbierta}
              className="font-semibold text-celeste"
            >
              {leyendaAbierta ? "Menos" : "Detalle"}
            </button>
          </div>
        </div>
      </div>

      {/* ── La columna de datos ─────────────────────────────────────────── */}
      <RailAvance
        datos={datos}
        dias={dias}
        empresaSel={empresaSel}
        alElegirEmpresa={alternarEmpresa}
        alResaltarEmpresa={setResaltada}
        alResaltarOrden={setOrdenResaltada}
        alEnfocar={enfocar}
        alElegirTerritorio={elegirTerritorio}
        alAmpliarFotos={ampliarFotos}
        alAbrirMuro={() => setMuroAbierto(true)}
        alcance={alcance}
        pantalla={pantalla}
        publico={publico}
        rol={rol}
      />

      {muroAbierto && (
        <MuroAntesDespues
          ruta={rutaFotos}
          territorio={territorio}
          nombreRecorte={recorte}
          empresaInicial={empresaSel}
          color={colorEmpresa}
          alCerrar={() => setMuroAbierto(false)}
          alVer={(pares, indice, pasar) => setVisor({ pares, indice, pasar })}
          tapado={visor != null}
        />
      )}

      {visor && (
        <VisorAntesDespues
          key={`${visor.indice}-${visor.pasar ? "p" : "m"}-${visor.pares.length}`}
          pares={visor.pares}
          indiceInicial={visor.indice}
          pasar={visor.pasar}
          alCerrar={() => setVisor(null)}
          alIrAlMapa={(lugar) => {
            setMuroAbierto(false);
            enfocar(lugar);
          }}
        />
      )}
    </div>
  );
}
