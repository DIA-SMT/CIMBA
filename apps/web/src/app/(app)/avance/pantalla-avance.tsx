"use client";

import { Play, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RolUsuario } from "@cimba/domain";
import { type DatosAvance, type DiasVentana, type Vivo, VENTANAS, fechaDeDia } from "@/lib/avance-tipos";
import { numero } from "@/lib/formato";
import { MapaAvance } from "./mapa-avance";
import { RailAvance } from "./rail-avance";

/**
 * AVANCE — la pantalla entera: el mapa a la izquierda, la columna de datos a
 * la derecha; en el teléfono, uno debajo del otro.
 *
 * Tres capas con una jerarquía clara, que es lo que la distingue del mapa
 * principal:
 *  - LO HECHO es la protagonista: cada trabajo terminado, un círculo del color
 *    de su empresa y del tamaño de sus m².
 *  - LO QUE SE HACE AHORA es el pulso: las órdenes activas dibujadas por su
 *    área real, y lo cargado en las últimas 48 horas latiendo.
 *  - LO QUE FALTA es el fondo: los pedidos que esperan, en gris, siempre
 *    visibles. Se pueden apagar, pero abren prendidos.
 *
 * La ventana por defecto es EL MES, no el día: hay días sin carga y una
 * pantalla que abriera en "Hoy" mostraría una ciudad vacía la mitad de las
 * mañanas, que es lo contrario de lo que tiene que decir.
 *
 * "Reproducir" pinta la ciudad día por día desde el principio de la ventana
 * hasta hoy: nueve segundos que explican el trabajo de un mes sin hablar. Es
 * la misma capa con un filtro que avanza, no otra cosa.
 *
 * Con `pantalla` (la ruta /tv) es la misma pantalla sin menú, con reloj, que
 * se recarga sola cada diez minutos.
 */
export function PantallaAvance({
  inicial,
  rol,
  pantalla = false,
}: {
  inicial: DatosAvance;
  rol: RolUsuario;
  pantalla?: boolean;
}) {
  const [datos, setDatos] = useState<DatosAvance>(inicial);
  const [dias, setDias] = useState<DiasVentana>(inicial.ventana.dias);
  const diasRef = useRef(dias);
  const [cargando, setCargando] = useState(false);
  const [empresaSel, setEmpresaSel] = useState<string | null>(null);
  const [verPendientes, setVerPendientes] = useState(true);
  const [leyendaAbierta, setLeyendaAbierta] = useState(false);
  /** El día hasta el que se muestra mientras se reproduce; null = todo. */
  const [cursor, setCursor] = useState<number | null>(null);
  const [reproduciendo, setReproduciendo] = useState(false);
  const [vivo, setVivo] = useState<Vivo | null>(null);

  const cargar = useCallback(async (d: DiasVentana, silencioso: boolean) => {
    if (!silencioso) setCargando(true);
    try {
      const r = await fetch(`/api/avance?dias=${d}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as DatosAvance;
      // Si mientras cargaba se cambió de ventana, esto ya no es lo que se mira.
      if (diasRef.current === d) setDatos(j);
    } catch {
      /* sin red: se queda lo último que llegó, que sigue siendo cierto */
    } finally {
      if (!silencioso) setCargando(false);
    }
  }, []);

  const detener = useCallback(() => {
    setReproduciendo(false);
    setCursor(null);
  }, []);

  /** Cambiar la ventana: pide los datos y deja la URL linkeable. */
  const elegirVentana = (d: DiasVentana) => {
    if (d === dias) return;
    detener();
    setDias(d);
    diasRef.current = d;
    try {
      const url = new URL(window.location.href);
      if (d === 30) url.searchParams.delete("dias");
      else url.searchParams.set("dias", String(d));
      window.history.replaceState(null, "", url);
    } catch {
      /* la URL es una comodidad, no un requisito */
    }
    void cargar(d, false);
  };

  /* Cada minuto: los datos con la ventana puesta, y lo vivo (fotos + feed). */
  useEffect(() => {
    const cargarVivo = () =>
      fetch("/api/tv", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: Partial<Vivo> | null) => {
          if (j) setVivo({ fotos: j.fotos ?? [], feed: j.feed ?? [] });
        })
        .catch(() => {});
    cargarVivo();
    const id = window.setInterval(() => {
      void cargar(diasRef.current, true);
      cargarVivo();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [cargar]);

  /* Modo pantalla: la página entera se renueva cada diez minutos, así un
     deploy nuevo entra solo al televisor de la oficina. */
  useEffect(() => {
    if (!pantalla) return;
    const id = window.setTimeout(() => window.location.reload(), 10 * 60_000);
    return () => window.clearTimeout(id);
  }, [pantalla]);

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

  const sinTrabajo = datos.hechos.features.length === 0;

  return (
    <div className={`flex min-h-0 flex-col lg:flex-row ${pantalla ? "h-screen bg-fondo" : "h-full"}`}>
      {/* ── El mapa ─────────────────────────────────────────────────────── */}
      <div className="relative min-h-[58vh] flex-1 lg:min-h-0">
        <MapaAvance
          datos={datos}
          empresaSel={empresaSel}
          cursor={cursor}
          verPendientes={verPendientes}
          pantalla={pantalla}
        />

        {/* Ventana de tiempo + reproducir */}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start gap-2">
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
              onClick={() => (reproduciendo ? detener() : setReproduciendo(true))}
              disabled={sinTrabajo}
              title="Pinta el mapa día por día, desde el principio de la ventana hasta hoy"
              className="flex items-center gap-1.5 rounded-lg border border-amarillo/50 px-3 py-1.5 text-xs font-bold text-amarillo transition hover:bg-amarillo/10 disabled:opacity-40"
            >
              {reproduciendo ? <Square size={12} /> : <Play size={12} />}
              {reproduciendo ? "Detener" : "Reproducir"}
            </button>
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

        {/* La ventana está vacía: se dice, no se deja adivinar. */}
        {sinTrabajo && (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-6">
            <p className="max-w-md rounded-2xl border border-borde bg-panel/95 px-5 py-4 text-center text-sm text-texto-2 shadow-xl backdrop-blur">
              {dias === 1
                ? "Hoy todavía no se cargó ningún trabajo. Las órdenes activas están marcadas con línea punteada; lo que se cargue va a aparecer solo."
                : "No hay trabajo cargado en esta ventana. Probá con una más larga."}
            </p>
          </div>
        )}

        {/* Leyenda, corta y literal. En el teléfono arranca plegada: abierta
            tapaba más de la mitad del mapa. */}
        <div className="pointer-events-none absolute bottom-8 left-3 flex flex-col items-start gap-1.5">
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
          </div>
        </div>
      </div>

      {/* ── La columna de datos ─────────────────────────────────────────── */}
      <RailAvance
        datos={datos}
        dias={dias}
        empresaSel={empresaSel}
        alElegirEmpresa={alternarEmpresa}
        vivo={vivo}
        pantalla={pantalla}
        rol={rol}
      />
    </div>
  );
}
