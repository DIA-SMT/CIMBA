"use client";

import { Check, ChevronDown, ImageDown, Link2, Loader2, MapPinned, Play, Share2, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapaLibre } from "maplibre-gl";
import type { RolUsuario } from "@cimba/domain";
import {
  type Camara,
  type DatosAvance,
  type DiasVentana,
  type Foco,
  type ListasTerritorios,
  type TerritorioRef,
  VENTANAS,
  fechaDeDia,
  nombreRecorte,
} from "@/lib/avance-tipos";
import { numero } from "@/lib/formato";
import { MapaAvance } from "./mapa-avance";
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
 *    de su empresa y del tamaño de sus m².
 *  - LO QUE SE HACE AHORA es el pulso: las órdenes activas dibujadas por su
 *    área real, las obras en curso como anillos, y lo cargado en las últimas
 *    48 horas latiendo.
 *  - LO QUE FALTA es el fondo: los pedidos que esperan, en gris, siempre
 *    visibles. Se pueden apagar, pero abren prendidos.
 *
 * La ventana por defecto es EL MES, no el día: hay días sin carga y una
 * pantalla que abriera en "Hoy" mostraría una ciudad vacía la mitad de las
 * mañanas, que es lo contrario de lo que tiene que decir.
 *
 * Se puede RECORTAR a un distrito o a un barrio (todo pasa a ser del recorte)
 * y COMPARTIR: el link de la vista exacta, o una imagen con el mapa y las
 * cifras lista para WhatsApp.
 *
 * El mapa y la columna se hablan: pasar el cursor por una empresa o una orden
 * en la columna la resalta en el mapa; tocar una foto o una línea del feed
 * vuela al lugar; tocar una empresa la aísla y la encuadra.
 *
 * "Reproducir" pinta la ciudad día por día desde el principio de la ventana
 * hasta hoy: nueve segundos que explican el trabajo de un mes sin hablar.
 *
 * Con `pantalla` (la ruta /tv) es la misma pantalla sin menú, con reloj, que
 * se recarga sola cada diez minutos y, con `rotar`, va pasando sola de vista.
 * Con `publico` (la ruta /publico) no hay links hacia adentro ni datos de
 * personas: es para mostrar afuera.
 */
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
  /** El día hasta el que se muestra mientras se reproduce; null = todo. */
  const [cursor, setCursor] = useState<number | null>(null);
  const [reproduciendo, setReproduciendo] = useState(false);

  const rutaDatos = publico ? "/api/publico/avance" : "/api/avance";
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

  const detener = useCallback(() => {
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
      detener();
      setDias(d);
      vistaRef.current = { ...vistaRef.current, dias: d };
      void cargar(d, vistaRef.current.territorio, false);
    },
    [cargar, detener],
  );

  const elegirTerritorio = useCallback(
    (t: TerritorioRef | null) => {
      detener();
      setMenu(null);
      setBusqueda("");
      setTerritorio(t);
      vistaRef.current = { ...vistaRef.current, territorio: t };
      void cargar(vistaRef.current.dias, t, false);
    },
    [cargar, detener],
  );

  /* Cada minuto, los datos con la vista puesta. Todo lo vivo (feed, fotos)
     viene en el mismo paquete: una sola fuente, un solo refresco. */
  useEffect(() => {
    const id = window.setInterval(() => void cargar(vistaRef.current.dias, vistaRef.current.territorio, true), 60_000);
    return () => window.clearInterval(id);
  }, [cargar]);

  /* Modo pantalla: la página entera se renueva cada diez minutos, así un
     deploy nuevo entra solo al televisor de la oficina. */
  useEffect(() => {
    if (!pantalla) return;
    const id = window.setTimeout(() => window.location.reload(), 10 * 60_000);
    return () => window.clearTimeout(id);
  }, [pantalla]);

  /**
   * LA PANTALLA QUE SE MUEVE SOLA (televisor): cada 50 segundos pasa de vista
   * —el mes, la reproducción del mes, la semana, hoy— y vuelve a empezar. Los
   * números suben al cambiar, así se ve que está viva desde el otro lado de
   * la oficina.
   */
  const elegirVentanaRef = useRef(elegirVentana);
  elegirVentanaRef.current = elegirVentana;
  useEffect(() => {
    if (!pantalla || !rotar) return;
    const pasos: Array<() => void> = [
      () => elegirVentanaRef.current(30),
      () => setReproduciendo(true),
      () => elegirVentanaRef.current(7),
      () => elegirVentanaRef.current(1),
    ];
    let i = 0;
    const id = window.setInterval(() => {
      i = (i + 1) % pasos.length;
      pasos[i]!();
    }, 50_000);
    return () => window.clearInterval(id);
  }, [pantalla, rotar]);

  /** Desde qué día arranca la reproducción: el de la ventana, o el primer trabajo si es "Todo". */
  const desdeDia = useMemo(() => {
    if (datos.ventana.desdeDia != null) return datos.ventana.desdeDia;
    let min = datos.hoyDia;
    for (const f of datos.hechos.features) if (f.properties.dia < min) min = f.properties.dia;
    return min;
  }, [datos]);

  /* La reproducción: un cursor de día que avanza a ritmo fijo (~9 s en total,
     sea una semana o seis meses) y al terminar se levanta el filtro. */
  useEffect(() => {
    if (!reproduciendo) return;
    const inicio = Math.min(desdeDia, datos.hoyDia);
    const fin = datos.hoyDia;
    const pasos = Math.max(1, fin - inicio + 1);
    const ms = Math.max(45, Math.round(9000 / pasos));
    let actual = inicio;
    setCursor(actual);
    const id = window.setInterval(() => {
      actual += 1;
      if (actual >= fin) {
        window.clearInterval(id);
        setCursor(null);
        setReproduciendo(false);
        return;
      }
      setCursor(actual);
    }, ms);
    return () => window.clearInterval(id);
  }, [reproduciendo, desdeDia, datos.hoyDia]);

  /** Lo acumulado hasta el cursor, para el rótulo que acompaña la reproducción. */
  const acumulado = useMemo(() => {
    if (cursor == null) return null;
    let n = 0;
    let m2 = 0;
    for (const f of datos.hechos.features) {
      const p = f.properties;
      if (p.dia <= cursor && (!empresaSel || p.empresa === empresaSel)) {
        n++;
        m2 += p.m2 ?? 0;
      }
    }
    return { n, m2 };
  }, [cursor, datos, empresaSel]);

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

  const sinTrabajo = datos.hechos.features.length === 0;
  const recorte = nombreRecorte(datos.territorio);

  const normalizar = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  const barriosFiltrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    const lista = q ? territorios.barrios.filter((b) => normalizar(b.nombre).includes(q)) : territorios.barrios;
    return lista.slice(0, 40);
  }, [busqueda, territorios.barrios]);

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
          verPendientes={verPendientes}
          foco={foco}
          camaraInicial={camaraInicial}
          alListo={(m) => {
            mapaRef.current = m;
          }}
          pantalla={pantalla}
          publico={publico}
        />

        {/* Ventana de tiempo, recorte, reproducir y compartir. Va por encima de
            la leyenda (z-20 contra z-10): sus paneles desplegados la tapan. */}
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
                onClick={() => (reproduciendo ? detener() : setReproduciendo(true))}
                disabled={sinTrabajo}
                title="Pinta el mapa día por día, desde el principio de la ventana hasta hoy"
                aria-label={reproduciendo ? "Detener la reproducción" : "Reproducir"}
                className="flex items-center gap-1.5 rounded-lg border border-amarillo/50 px-2.5 py-1.5 text-xs font-bold text-amarillo transition hover:bg-amarillo/10 disabled:opacity-40 sm:px-3"
              >
                {reproduciendo ? <Square size={12} /> : <Play size={12} />}
                {/* En el teléfono, solo el ícono: la barra no puede ocupar tres renglones del mapa. */}
                <span className="hidden sm:inline">{reproduciendo ? "Detener" : "Reproducir"}</span>
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

            {cursor != null && acumulado && (
              <div className="pointer-events-auto rounded-xl border border-amarillo/40 bg-panel/95 px-3 py-2 shadow-lg backdrop-blur">
                <p className="text-[10px] font-bold tracking-[0.12em] text-texto-3 uppercase">Hasta el</p>
                <p className="text-sm font-bold">{fechaDeDia(cursor)}</p>
                <p className="num text-xs text-texto-2">
                  {numero(acumulado.n)} baches · {numero(Math.round(acumulado.m2))} m²
                </p>
              </div>
            )}
          </div>

          {/* El recorte: distritos como chips, barrios con buscador */}
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
                autoFocus
                className="mt-1 w-full rounded-lg border border-borde-2 bg-panel px-3 py-1.5 text-sm outline-none focus:border-celeste"
              />
              <ul className="mt-1 max-h-44 overflow-y-auto">
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
            </div>
          )}

          {/* Compartir: el link exacto, o la imagen para WhatsApp */}
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
          <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center px-4">
            <p className="rounded-xl border border-celeste/40 bg-panel/95 px-4 py-2 text-sm font-semibold text-texto shadow-xl backdrop-blur">
              {aviso}
            </p>
          </div>
        )}

        {/* Leyenda, corta y literal. En el teléfono arranca plegada: abierta
            tapaba más de la mitad del mapa. */}
        <div className="pointer-events-none absolute bottom-8 left-3 z-10 flex flex-col items-start gap-1.5">
          <button
            type="button"
            onClick={() => setLeyendaAbierta((v) => !v)}
            aria-expanded={leyendaAbierta}
            className="pointer-events-auto rounded-xl border border-borde bg-panel/90 px-3 py-1.5 text-[11px] font-semibold text-texto-2 shadow-lg backdrop-blur sm:hidden"
          >
            {leyendaAbierta ? "Ocultar leyenda" : "Leyenda"}
          </button>
          <div
            className={`pointer-events-auto rounded-xl border border-borde bg-panel/90 px-3 py-2 text-[11px] leading-relaxed text-texto-2 shadow-lg backdrop-blur ${
              leyendaAbierta ? "" : "hidden sm:block"
            }`}
          >
            <p className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full bg-celeste/80" aria-hidden="true" />
              Trabajo hecho: tamaño según m², color según empresa
            </p>
            <p className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full border-2 border-celeste" aria-hidden="true" />
              Borde celeste: cargado en las últimas 48 h
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
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={verPendientes}
                onChange={(e) => setVerPendientes(e.target.checked)}
                className="h-3 w-3 accent-celeste"
              />
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-texto-3" aria-hidden="true" />
              Gris: pedido que espera ({numero(datos.cifras.pendientes.pedidos)})
            </label>
            <p className="mt-1 text-texto-3">Pasá el cursor para ver qué es cada cosa; tocá para abrir la ficha.</p>
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
        pantalla={pantalla}
        publico={publico}
        rol={rol}
      />
    </div>
  );
}
