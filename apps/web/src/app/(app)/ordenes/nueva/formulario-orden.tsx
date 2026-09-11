"use client";

import { LocateFixed, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PRIORIDADES_VIALES, type FuenteDemanda, type PrioridadVial } from "@cimba/domain";
import { crearOrden } from "@/lib/acciones-ordenes";
import { proyectar, type ParametrosCapacidad } from "@/lib/capacidad";
import { ETIQUETA_FUENTE, ETIQUETA_TIPO, numero } from "@/lib/formato";
// Solo tipos: se borran al compilar, así que no arrastran @cimba/db al cliente.
import type { EmpresaResumen, PendienteCircuito } from "@/lib/ordenes";
import { Panel } from "@/components/ui";
import { ChipMiniMapa, MiniMapa } from "@/components/mapa/mini-mapa";
import { ETIQUETA_PRIORIDAD } from "../etiquetas";
import { mensajeDeError } from "@/lib/errores";

interface CircuitoOpcion {
  id: number;
  codigo: string;
  pendientes: number;
  demandasAbiertas: number;
  empresaId: number | null;
  empresaNombre: string | null;
}

interface OpcionAmbito {
  id: number;
  etiqueta: string;
  pendientes: number;
}

interface ImbornalPend {
  id: number;
  ident: string | null;
  direccion: string | null;
  tipo: string | null;
  estado: string | null;
  observaciones: string | null;
  lat: number;
  lon: number;
  enOrden: boolean;
}

type TipoOrden = "bacheo" | "pano_hormigon" | "carpeta" | "cordon_cuneta" | "imbornales" | "tapas" | "ripio";
type Ambito = "distrito" | "circuito" | "corredor" | "barrio" | "colector";

/** Qué trabajo se manda a hacer. De esto depende a qué empresa puede ir. */
const TIPOS_ORDEN: Array<{ valor: TipoOrden; etiqueta: string; desc: string }> = [
  { valor: "bacheo", etiqueta: "Bacheo", desc: "El trabajo de todos los días" },
  { valor: "pano_hormigon", etiqueta: "Paño de hormigón", desc: "Cambio de paño — Obra Tipo C" },
  { valor: "carpeta", etiqueta: "Carpeta", desc: "Repavimentación — Obra Tipo A" },
  { valor: "cordon_cuneta", etiqueta: "Cordón cuneta", desc: "Reparación o construcción" },
  { valor: "imbornales", etiqueta: "Imbornales", desc: "Limpieza y reparación de bocas de tormenta" },
  { valor: "tapas", etiqueta: "Tapas", desc: "Reposición o reparación de tapas de cámara" },
  { valor: "ripio", etiqueta: "Ripio", desc: "Pasado de máquina y enripiado" },
];

/**
 * Las cuatro formas de delimitar el trabajo. El colector aparece solo para lo
 * pluvial: una orden de imbornales no se define por circuito sino por a dónde
 * descargan las bocas.
 */
const AMBITOS: Array<{ valor: Ambito; etiqueta: string; soloPluvial?: boolean }> = [
  { valor: "circuito", etiqueta: "Circuito" },
  { valor: "distrito", etiqueta: "Distrito" },
  { valor: "corredor", etiqueta: "Corredor" },
  { valor: "barrio", etiqueta: "Barrio" },
  { valor: "colector", etiqueta: "Colector", soloPluvial: true },
];

const ES_PLUVIAL = (t: TipoOrden) => t === "imbornales" || t === "tapas";

interface Tramo {
  direccion: string;
  tipoTrabajo: "bache" | "carpeta" | "tramo";
  lat?: number;
  lon?: number;
  /** Segundo extremo, cuando el tramo se dicta por intervalo de altura. */
  latHasta?: number;
  lonHasta?: number;
  alturaDesde?: string;
  alturaHasta?: string;
  resuelta?: string;
  resueltaHasta?: string;
  ubicando?: boolean;
  sinResultado?: boolean;
  /** Recorrido dibujado en el mapa: [[lon, lat], …]. */
  recorrido?: Array<[number, number]>;
}

const claseInput =
  "rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3";

/**
 * El armado de la orden completo en el cliente: la selección de baches, los
 * tramos a mano, la empresa y la estimación tienen que reaccionar al instante
 * — el único viaje al servidor es traer los pendientes del circuito elegido
 * y el crearOrden final.
 */
export function FormularioOrden({
  circuitos,
  distritos,
  barrios,
  corredores,
  colectores,
  empresas,
  parametros,
  recorrido,
}: {
  circuitos: CircuitoOpcion[];
  distritos: OpcionAmbito[];
  barrios: OpcionAmbito[];
  corredores: OpcionAmbito[];
  colectores: Array<{ colector: string; total: number; malos: number }>;
  empresas: EmpresaResumen[];
  parametros: ParametrosCapacidad;
  /** Trazado dibujado en el mapa: entra como un tramo ya armado. */
  recorrido?: Array<[number, number]>;
}) {
  const router = useRouter();

  // ── La demanda ─────────────────────────────────────────────────────────────
  // QUÉ trabajo y POR DÓNDE: los dos primeros pasos de la orden (Leo, 10/9).
  const [tipo, setTipo] = useState<TipoOrden>("bacheo");
  const [ambito, setAmbito] = useState<Ambito>("circuito");
  const [colector, setColector] = useState("");
  const [imbornales, setImbornales] = useState<ImbornalPend[]>([]);
  const [circuitoId, setCircuitoId] = useState<number>(0);
  const [pendientes, setPendientes] = useState<PendienteCircuito[]>([]);
  // Pedidos ROJOS limpios del circuito que todavía no son incidentes: el
  // botón de relevar los convierte en cola de un paso.
  const [rojas, setRojas] = useState(0);
  const [relevando, setRelevando] = useState(false);
  const [avisoRelevar, setAvisoRelevar] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  // Si vino un recorrido del mapa, el formulario abre con ese tramo puesto.
  const [tramos, setTramos] = useState<Tramo[]>(
    recorrido ? [{ direccion: "Recorrido dibujado en el mapa", tipoTrabajo: "tramo", recorrido }] : [],
  );
  // Evita que una respuesta lenta de un circuito anterior pise a la actual.
  const pedidoRef = useRef(0);

  // ── La oferta y el papel ───────────────────────────────────────────────────
  const [empresaId, setEmpresaId] = useState<number>(0);
  const [prioridad, setPrioridad] = useState<PrioridadVial>("primaria");
  const [titulo, setTitulo] = useState("");
  const [indicaciones, setIndicaciones] = useState("");
  const [contratoDecreto, setContratoDecreto] = useState("");
  const [venceEn, setVenceEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creando, startTransition] = useTransition();

  /** Trae lo pendiente del ámbito elegido: incidentes de calzada, o las bocas
   *  de tormenta del colector cuando la orden es pluvial. */
  const elegirAmbitoRef = async (ref: number | string) => {
    setCircuitoId(typeof ref === "number" ? ref : 0);
    setColector(typeof ref === "string" ? ref : "");
    setSeleccion(new Set());
    setPendientes([]);
    setImbornales([]);
    setErrorCarga(null);
    setRojas(0);
    setAvisoRelevar(null);
    if (!ref) return;
    const pedido = ++pedidoRef.current;
    setCargando(true);
    try {
      const r = await fetch(`/api/ordenes/pendientes?ambito=${ambito}&ref=${encodeURIComponent(String(ref))}`);
      if (!r.ok) throw new Error("No se pudo cargar lo pendiente de esa zona");
      const j = (await r.json()) as {
        pendientes?: PendienteCircuito[];
        imbornales?: ImbornalPend[];
        rojas?: number;
      };
      if (pedido !== pedidoRef.current) return;
      setPendientes(j.pendientes ?? []);
      setImbornales(j.imbornales ?? []);
      setRojas(j.rojas ?? 0);
      // Si el circuito ya tiene empresa asignada, se propone sola.
      if (ambito === "circuito") {
        const c = circuitos.find((x) => x.id === ref);
        if (c?.empresaId && !empresaId) setEmpresaId(c.empresaId);
      }
    } catch (e) {
      if (pedido !== pedidoRef.current) return;
      setErrorCarga(mensajeDeError(e, "Error al cargar"));
    } finally {
      if (pedido === pedidoRef.current) setCargando(false);
    }
  };

  const elegirCircuito = elegirAmbitoRef;

  /** Cambiar el tipo o el ámbito invalida lo elegido: no se puede armar media
   *  orden de bacheo por circuito y terminarla como imbornales por colector. */
  const cambiarTipo = (t: TipoOrden) => {
    setTipo(t);
    setAmbito(ES_PLUVIAL(t) ? "colector" : "circuito");
    void elegirAmbitoRef(0);
  };
  const cambiarAmbito = (a: Ambito) => {
    setAmbito(a);
    void elegirAmbitoRef(0);
  };

  /** Las opciones del ámbito activo, ya con su número de pendientes. */
  const opciones: Array<{ ref: number | string; etiqueta: string }> =
    ambito === "circuito"
      ? circuitos.map((c) => ({
          ref: c.id,
          etiqueta: `${c.codigo} — ${numero(c.pendientes)} pendientes · ${numero(c.demandasAbiertas)} reclamos${c.empresaNombre ? ` · ${c.empresaNombre}` : ""}`,
        }))
      : ambito === "distrito"
        ? distritos.map((o) => ({ ref: o.id, etiqueta: `${o.etiqueta} — ${numero(o.pendientes)} pendientes` }))
        : ambito === "barrio"
          ? barrios.map((o) => ({ ref: o.id, etiqueta: `${o.etiqueta} — ${numero(o.pendientes)} pendientes` }))
          : ambito === "corredor"
            ? corredores.map((o) => ({ ref: o.id, etiqueta: `${o.etiqueta} — ${numero(o.pendientes)} pendientes` }))
            : colectores.map((c) => ({
                ref: c.colector,
                etiqueta: `${c.colector} — ${numero(c.total)} bocas · ${numero(c.malos)} en mal estado`,
              }));

  const alternarSeleccion = (id: number) => {
    setSeleccion((s) => {
      const nuevo = new Set(s);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  };

  // La consulta ya viene ordenada por reclamos desc + score desc: el "top"
  // es simplemente los primeros N que no estén en otra orden.
  const elegirTop = (n: number) => {
    setSeleccion(new Set(pendientes.filter((p) => !p.enOrden).slice(0, n).map((p) => p.incidenteId)));
  };

  const actualizarTramo = (i: number, cambios: Partial<Tramo>) =>
    setTramos((ts) => ts.map((t, j) => (j === i ? { ...t, ...cambios } : t)));

  const geocodificar = async (q: string) => {
    const r = await fetch(`/api/geocodificar?q=${encodeURIComponent(q)}`);
    const j = (await r.json()) as {
      resultado: { punto: { lat: number; lon: number }; confianza: number; direccionResuelta: string } | null;
    };
    return j.resultado;
  };

  /**
   * Ubica el tramo. Si vienen las dos alturas, geocodifica los DOS extremos y
   * el item queda como una línea — "Corrientes del 400 al 1000", que es como
   * se dicta el trabajo en la calle. Con una sola dirección, sigue siendo un
   * punto como siempre.
   */
  const ubicarTramo = async (i: number) => {
    const t = tramos[i];
    if (!t || t.direccion.trim().length < 4) return;
    actualizarTramo(i, { ubicando: true, sinResultado: false });
    const calle = t.direccion.trim();
    const desde = (t.alturaDesde ?? "").trim();
    const hasta = (t.alturaHasta ?? "").trim();
    try {
      if (desde && hasta) {
        const [a, b] = await Promise.all([
          geocodificar(`${calle} ${desde}`),
          geocodificar(`${calle} ${hasta}`),
        ]);
        if (a && b) {
          actualizarTramo(i, {
            ubicando: false,
            lat: a.punto.lat,
            lon: a.punto.lon,
            latHasta: b.punto.lat,
            lonHasta: b.punto.lon,
            resuelta: a.direccionResuelta,
            resueltaHasta: b.direccionResuelta,
          });
          return;
        }
        actualizarTramo(i, { ubicando: false, sinResultado: true });
        return;
      }
      const r = await geocodificar(calle);
      if (r) {
        actualizarTramo(i, {
          ubicando: false,
          lat: r.punto.lat,
          lon: r.punto.lon,
          latHasta: undefined,
          lonHasta: undefined,
          resuelta: r.direccionResuelta,
          resueltaHasta: undefined,
        });
      } else {
        actualizarTramo(i, { ubicando: false, lat: undefined, lon: undefined, resuelta: undefined, sinResultado: true });
      }
    } catch {
      actualizarTramo(i, { ubicando: false, sinResultado: true });
    }
  };

  // ── Estimación en vivo ─────────────────────────────────────────────────────
  const seleccionados = pendientes.filter((p) => seleccion.has(p.incidenteId));
  const tramosValidos = tramos.filter((t) => t.direccion.trim().length >= 3);
  // Misma regla que crearOrden: pavimento deteriorado → carpeta, el resto →
  // bache. Un "tramo" manual se estima como carpeta (el costo alto), mejor
  // pasarse que quedarse cortos con la mezcla.
  const baches =
    seleccionados.filter((p) => p.tipo !== "pavimento_deteriorado").length +
    tramosValidos.filter((t) => t.tipoTrabajo === "bache").length;
  const carpetas =
    seleccionados.filter((p) => p.tipo === "pavimento_deteriorado").length +
    tramosValidos.filter((t) => t.tipoTrabajo !== "bache").length;
  const empresa = empresas.find((e) => e.id === empresaId) ?? null;
  const estimacion =
    empresa && baches + carpetas > 0
      ? proyectar({ baches, carpetas }, { cuadrillas: empresa.cuadrillas, turnosPorDia: empresa.turnosPorDia }, parametros)
      : null;
  const m2Seleccionados = seleccionados.reduce((a, p) => a + (p.superficieM2 ?? 0), 0);
  const totalItems = seleccion.size + tramosValidos.length;

  const crear = () => {
    setError(null);
    startTransition(async () => {
      try {
        const res = await crearOrden({
          empresaId,
          tipo,
          ambito,
          ambitoRef: ambito === "colector" ? colector : circuitoId || undefined,
          circuitoId: ambito === "circuito" ? circuitoId || undefined : undefined,
          prioridad,
          titulo: titulo.trim() || undefined,
          indicaciones: indicaciones.trim() || undefined,
          contratoDecreto: contratoDecreto.trim() || undefined,
          venceEn: venceEn || undefined,
          // En una orden pluvial lo tildado son bocas de tormenta, no
          // incidentes de calzada: viajan por su propia lista.
          incidenteIds: ambito === "colector" ? [] : [...seleccion],
          imbornalIds: ambito === "colector" ? [...seleccion] : [],
          tramos: tramosValidos.map((t) => ({
            direccion: t.direccion.trim(),
            tipoTrabajo: t.tipoTrabajo,
            lat: t.lat,
            lon: t.lon,
            latHasta: t.latHasta,
            lonHasta: t.lonHasta,
            alturaDesde: t.alturaDesde ? Number(t.alturaDesde) : undefined,
            alturaHasta: t.alturaHasta ? Number(t.alturaHasta) : undefined,
            recorrido: t.recorrido,
          })),
        });
        router.push(`/ordenes/${res.ordenId}`);
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo crear la orden"));
      }
    });
  };

  const diasDesde = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
      {/* ══ LA DEMANDA ══ */}
      <div className="min-w-0 space-y-4">
        <Panel className="p-5">
          <p className="mb-2 text-sm font-bold">1 · Qué trabajo es</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {TIPOS_ORDEN.map((t) => (
              <button
                key={t.valor}
                type="button"
                onClick={() => cambiarTipo(t.valor)}
                title={t.desc}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  tipo === t.valor
                    ? "border-azul bg-azul text-white"
                    : "border-borde-2 text-texto-2 hover:border-celeste/60 hover:text-celeste"
                }`}
              >
                {t.etiqueta}
              </button>
            ))}
          </div>

          <p className="mb-2 text-sm font-bold">2 · Por dónde se define</p>
          <div className="mb-2 flex flex-wrap gap-2">
            {AMBITOS.filter((a) => (ES_PLUVIAL(tipo) ? a.valor === "colector" : !a.soloPluvial)).map((a) => (
              <button
                key={a.valor}
                type="button"
                onClick={() => cambiarAmbito(a.valor)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  ambito === a.valor
                    ? "border-celeste bg-celeste/15 text-celeste"
                    : "border-borde-2 text-texto-2 hover:border-celeste/60 hover:text-celeste"
                }`}
              >
                {a.etiqueta}
              </button>
            ))}
          </div>
          <select
            value={ambito === "colector" ? colector : circuitoId || ""}
            onChange={(e) => void elegirAmbitoRef(ambito === "colector" ? e.target.value : Number(e.target.value) || 0)}
            className={`${claseInput} w-full max-w-xl`}
          >
            <option value="">
              {ambito === "colector" ? "Elegí un colector…" : `Elegí un ${ambito}…`}
            </option>
            {opciones.map((o) => (
              <option key={String(o.ref)} value={o.ref}>
                {o.etiqueta}
              </option>
            ))}
          </select>
          {opciones.length === 0 && (
            <p className="mt-2 text-xs text-texto-3">
              No hay {ambito === "colector" ? "colectores relevados" : `${ambito}s con trabajo pendiente`}.
            </p>
          )}
          {errorCarga && <p className="mt-2 text-xs text-peligro">{errorCarga}</p>}
        </Panel>

        {/* La lista de bocas de tormenta reemplaza a la de baches cuando la
            orden es pluvial: es otro trabajo, con otro criterio de urgencia. */}
        {ambito === "colector" && colector && (
          <Panel className="overflow-hidden">
            <div className="border-b border-borde px-4 py-3">
              <p className="text-sm font-bold">
                3 · Las bocas del colector{" "}
                <span className="font-normal text-texto-3">
                  — {numero(imbornales.length)} relevadas, peor estado primero
                </span>
              </p>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {imbornales.map((im) => (
                <label
                  key={im.id}
                  className={`flex cursor-pointer items-start gap-2.5 border-b border-borde/60 px-4 py-2 text-[13px] ${im.enOrden ? "opacity-40" : ""}`}
                >
                  <input
                    type="checkbox"
                    disabled={im.enOrden}
                    checked={seleccion.has(im.id)}
                    onChange={() => alternarSeleccion(im.id)}
                    className="mt-1 accent-[#0066ff]"
                  />
                  <span className="min-w-0 flex-1">
                    <b>{im.ident ?? `#${im.id}`}</b>
                    {im.direccion && <span className="text-texto-2"> · {im.direccion}</span>}
                    <span className="mt-0.5 block text-[11px] text-texto-3">
                      {im.tipo ?? "imbornal"}
                      {im.estado && ` · estado ${im.estado}`}
                      {im.observaciones && ` · ${im.observaciones.toLowerCase()}`}
                      {im.enOrden && " · ya está en otra orden"}
                    </span>
                  </span>
                </label>
              ))}
              {imbornales.length === 0 && !cargando && (
                <p className="px-4 py-6 text-center text-sm text-texto-3">
                  Ese colector no tiene bocas relevadas.
                </p>
              )}
            </div>
          </Panel>
        )}

        {circuitoId === 0 && ambito !== "colector" && (
          <Panel className="px-4 py-6">
            <p className="text-sm font-bold">3 · La demanda</p>
            <p className="mt-1 text-sm text-texto-3">
              Elegí arriba por dónde se define la orden y acá aparece lo pendiente para elegir.
            </p>
          </Panel>
        )}

        {circuitoId > 0 && (
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-borde px-4 py-3">
              <p className="text-sm font-bold">
                3 · La demanda{" "}
                <span className="font-normal text-texto-3">
                  — {numero(pendientes.length)} pendientes; los reclamos detrás de cada bache mandan
                </span>
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => elegirTop(10)}
                  disabled={pendientes.length === 0}
                  className="rounded-md border border-amarillo/50 bg-amarillo/10 px-2.5 py-1 text-[11px] font-semibold text-amarillo transition hover:bg-amarillo/20 disabled:opacity-40"
                  title="Los 10 con más reclamos detrás y mejor score"
                >
                  Top 10
                </button>
                <button
                  onClick={() => elegirTop(20)}
                  disabled={pendientes.length === 0}
                  className="rounded-md border border-amarillo/50 bg-amarillo/10 px-2.5 py-1 text-[11px] font-semibold text-amarillo transition hover:bg-amarillo/20 disabled:opacity-40"
                  title="Los 20 con más reclamos detrás y mejor score"
                >
                  Top 20
                </button>
                {seleccion.size > 0 && (
                  <button onClick={() => setSeleccion(new Set())} className="text-[11px] text-texto-3 hover:text-texto">
                    limpiar
                  </button>
                )}
              </div>
            </div>

            {/* La brecha roja del circuito, convertible en cola con un botón:
                sin esto, cada pedido rojo era una ficha a mano. */}
            {!cargando && rojas > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-borde bg-encurso/10 px-4 py-2.5">
                <p className="text-xs leading-snug text-texto-2">
                  Este circuito tiene <b className="num text-encurso">{numero(rojas)}</b> pedidos{" "}
                  <b>sin atención</b> que todavía no son incidentes (ubicación confiable, tipo claro, nada
                  trabajándose cerca). Relevarlos los agrupa (~25 m) y los suma a esta lista, ya priorizados
                  y con sus reclamos vinculados.
                </p>
                <button
                  type="button"
                  disabled={relevando}
                  onClick={async () => {
                    setRelevando(true);
                    setAvisoRelevar(null);
                    try {
                      const { relevarCircuito } = await import("@/lib/acciones-ordenes");
                      const r = await relevarCircuito({ circuitoId });
                      // elegirCircuito limpia el aviso: el mensaje va DESPUÉS.
                      await elegirCircuito(circuitoId);
                      setAvisoRelevar(
                        `Relevado: ${r.demandas} pedidos agrupados en ${r.incidentes} incidentes, ya en la lista.`,
                      );
                    } catch (e) {
                      setAvisoRelevar(mensajeDeError(e, "No se pudo relevar el circuito"));
                    } finally {
                      setRelevando(false);
                    }
                  }}
                  className="shrink-0 rounded-lg bg-azul px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {relevando ? "Relevando…" : `Relevar el circuito (${numero(rojas)})`}
                </button>
              </div>
            )}
            {avisoRelevar && (
              <p className="border-b border-borde px-4 py-2 text-xs font-semibold" style={{ color: "var(--color-hecho)" }}>
                {avisoRelevar}
              </p>
            )}
            {cargando ? (
              <p className="px-4 py-8 text-center text-sm text-texto-3">Cargando pendientes…</p>
            ) : pendientes.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-texto-3">
                {ambito === "circuito" ? "Este circuito" : "Lo que elegiste"} no tiene pendientes con
                ubicación. Podés cargar tramos a mano abajo.
              </p>
            ) : (
              <div className="max-h-[420px] overflow-x-auto overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-panel">
                    <tr className="border-b border-borde text-left text-[10px] font-semibold tracking-wider text-texto-3 uppercase">
                      <th className="px-3 py-2.5" />
                      <th className="px-3 py-2.5">Dirección</th>
                      <th className="px-3 py-2.5">Tipo</th>
                      <th className="num px-3 py-2.5 text-right">Score</th>
                      <th className="num px-3 py-2.5 text-right text-amarillo" title="Reclamos de vecinos e instituciones detrás de este bache">
                        Reclamos detrás
                      </th>
                      <th className="num px-3 py-2.5 text-right">m²</th>
                      <th className="num px-3 py-2.5 text-right">Antigüedad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendientes.map((p) => {
                      const marcado = seleccion.has(p.incidenteId);
                      return (
                        <tr
                          key={p.incidenteId}
                          onClick={() => !p.enOrden && alternarSeleccion(p.incidenteId)}
                          className={`border-b border-borde/60 transition ${
                            p.enOrden ? "opacity-40" : "cursor-pointer hover:bg-panel-2"
                          } ${marcado ? "bg-celeste/5" : ""}`}
                        >
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={marcado}
                              disabled={p.enOrden}
                              onChange={() => alternarSeleccion(p.incidenteId)}
                              onClick={(e) => e.stopPropagation()}
                              className="accent-[#2eb1ff]"
                            />
                          </td>
                          <td className="max-w-56 px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              {/* Verificar el punto ANTES de incluirlo en la orden
                                  (el chip frena la propagación: no alterna la fila) */}
                              <ChipMiniMapa
                                lat={p.lat}
                                lon={p.lon}
                                etiqueta={p.direccion ?? `Incidente #${p.incidenteId}`}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate" title={p.direccion ?? undefined}>
                                  {p.direccion ?? `Incidente #${p.incidenteId}`}
                                </span>
                                {p.enOrden && (
                                  <span className="text-[10px] text-texto-3">ya está en otra orden activa</span>
                                )}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-texto-2">{ETIQUETA_TIPO[p.tipo]}</td>
                          <td className="num px-3 py-2 text-right text-xs text-texto-2">
                            {p.score != null ? p.score.toFixed(1) : "—"}
                          </td>
                          <td className="num px-3 py-2 text-right">
                            <span className="text-base font-extrabold" style={{ color: p.reclamos > 0 ? "var(--color-amarillo)" : "var(--color-texto-3)" }}>
                              {numero(p.reclamos)}
                            </span>
                            {/* De dónde vienen: "me gustaría que aparezca de dónde viene el reclamo" (el Director) */}
                            {p.fuentes.length > 0 && (
                              <span className="ml-auto block max-w-36 text-[9px] leading-tight font-normal text-texto-3">
                                {p.fuentes.map((fu) => ETIQUETA_FUENTE[fu as FuenteDemanda] ?? fu).join(" · ")}
                              </span>
                            )}
                          </td>
                          <td className="num px-3 py-2 text-right text-xs text-texto-2">
                            {p.superficieM2 != null ? numero(Math.round(p.superficieM2)) : "—"}
                          </td>
                          <td className="num px-3 py-2 text-right text-xs text-texto-2">{numero(diasDesde(p.detectadoEn))} d</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        )}

        {/* Tramos manuales */}
        <Panel className="p-5">
          <p className="text-sm font-bold">
            Tramos a mano{" "}
            <span className="font-normal text-texto-3">— lo que el Director pide y no figura como incidente</span>
          </p>
          <div className="mt-3 space-y-2">
            {tramos.map((t, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  value={t.direccion}
                  onChange={(e) =>
                    actualizarTramo(i, { direccion: e.target.value, lat: undefined, lon: undefined, resuelta: undefined, sinResultado: false })
                  }
                  placeholder={t.recorrido ? "Nombre del recorrido" : "Calle (o esquina, o dirección completa)"}
                  className={`${claseInput} min-w-52 flex-1`}
                />
                {/* Intervalo de altura: con los dos números el tramo deja de
                    ser un pin y se convierte en el segmento de calle real. */}
                {!t.recorrido && (
                  <>
                    <input
                      value={t.alturaDesde ?? ""}
                      onChange={(e) => actualizarTramo(i, { alturaDesde: e.target.value, lat: undefined, lon: undefined })}
                      placeholder="del"
                      inputMode="numeric"
                      className={`${claseInput} w-20`}
                      title="Altura desde — dejalo vacío si es un punto suelto"
                    />
                    <input
                      value={t.alturaHasta ?? ""}
                      onChange={(e) => actualizarTramo(i, { alturaHasta: e.target.value, latHasta: undefined, lonHasta: undefined })}
                      placeholder="al"
                      inputMode="numeric"
                      className={`${claseInput} w-20`}
                      title="Altura hasta — con las dos alturas el tramo sale como línea"
                    />
                  </>
                )}
                <select
                  value={t.tipoTrabajo}
                  onChange={(e) => actualizarTramo(i, { tipoTrabajo: e.target.value as Tramo["tipoTrabajo"] })}
                  className={claseInput}
                >
                  <option value="bache">Bache</option>
                  <option value="carpeta">Carpeta</option>
                  <option value="tramo">Tramo</option>
                </select>
                <button
                  onClick={() => void ubicarTramo(i)}
                  disabled={t.ubicando || t.direccion.trim().length < 4}
                  className="flex items-center gap-1.5 rounded-lg border border-borde-2 px-3 py-2 text-xs font-semibold text-celeste transition hover:border-celeste disabled:opacity-40"
                  title="Geocodificar la dirección para que el punto caiga en el mapa"
                >
                  <LocateFixed size={13} /> {t.ubicando ? "Ubicando…" : "Ubicar"}
                </button>
                <button
                  onClick={() => setTramos((ts) => ts.filter((_, j) => j !== i))}
                  className="rounded-md p-1.5 text-texto-3 transition hover:text-peligro"
                  title="Quitar tramo"
                >
                  <X size={14} />
                </button>
                {t.lat != null && t.lon != null && (
                  <div className="w-full">
                    <span className="text-[11px]" style={{ color: "#199e70" }}>
                      ✓ {t.resuelta ?? "ubicado"}
                    </span>
                    {/* El geocodificador le pifia media cuadra seguido: el pin se
                        afina a mano y ese lat/lon ajustado es el que viaja en
                        crearOrden (actualizarTramo pisa t.lat/t.lon). */}
                    <div className="mt-1.5">
                      <MiniMapa
                        lat={t.lat}
                        lon={t.lon}
                        etiqueta={t.resuelta ?? t.direccion}
                        alto={220}
                        alMover={({ lat, lon }) => actualizarTramo(i, { lat, lon })}
                      />
                    </div>
                  </div>
                )}
                {t.sinResultado && (
                  <span className="w-full text-[11px] text-amarillo">
                    No se encontró la dirección: la orden sale igual, sin punto en el mapa.
                  </span>
                )}
              </div>
            ))}
          </div>
          <button
            onClick={() => setTramos((ts) => [...ts, { direccion: "", tipoTrabajo: "bache" }])}
            className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-celeste hover:underline"
          >
            <Plus size={13} /> Agregar tramo
          </button>
        </Panel>
      </div>

      {/* ══ LA OFERTA Y EL PAPEL ══ */}
      <div className="space-y-4">
        <Panel className="p-5">
          <p className="mb-3 text-sm font-bold">4 · La empresa</p>
          <div className="space-y-2">
            {empresas.map((e) => (
              <label
                key={e.id}
                className={`block cursor-pointer rounded-xl border p-3 transition ${
                  empresaId === e.id
                    ? "border-celeste/60 bg-celeste/10"
                    : "border-borde hover:border-borde-2"
                } ${!e.activa ? "cursor-not-allowed opacity-40" : ""}`}
              >
                <div className="flex items-center gap-2.5">
                  <input
                    type="radio"
                    name="empresa"
                    checked={empresaId === e.id}
                    disabled={!e.activa}
                    onChange={() => setEmpresaId(e.id)}
                    className="accent-[#2eb1ff]"
                  />
                  <span className="text-sm font-bold">{e.nombre}</span>
                  {!e.activa && <span className="text-[10px] text-texto-3">inactiva</span>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 pl-6 text-[11px] text-texto-2">
                  <span className="num">{numero(e.cuadrillas)} cuadrillas</span>
                  <span className="num">{numero(e.turnosPorDia)} turnos/día</span>
                  <span className="num" style={{ color: e.itemsPendientes > 0 ? "#d95926" : undefined }}>
                    {numero(e.itemsPendientes)} items en carga
                  </span>
                </div>
                {e.circuitosAsignados.length > 0 && (
                  <p className="mt-0.5 truncate pl-6 text-[10px] text-texto-3" title={e.circuitosAsignados.join(", ")}>
                    Circuitos: {e.circuitosAsignados.join(", ")}
                  </p>
                )}
              </label>
            ))}
            {empresas.length === 0 && (
              <p className="text-sm text-texto-3">No hay empresas cargadas todavía.</p>
            )}
          </div>
        </Panel>

        <Panel className="space-y-3 p-5">
          <p className="text-sm font-bold">5 · El papel</p>
          <label className="block text-[11px] text-texto-2">
            Prioridad
            <select
              value={prioridad}
              onChange={(e) => setPrioridad(e.target.value as PrioridadVial)}
              className={`${claseInput} mt-1 w-full`}
            >
              {PRIORIDADES_VIALES.map((p) => (
                <option key={p} value={p}>
                  {ETIQUETA_PRIORIDAD[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] text-texto-2">
            Título (opcional)
            <input
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="p. ej. Bacheo circuito 15B — semana 36"
              className={`${claseInput} mt-1 w-full`}
            />
          </label>
          <label className="block text-[11px] text-texto-2">
            Indicaciones para la empresa (opcional)
            <textarea
              value={indicaciones}
              onChange={(e) => setIndicaciones(e.target.value)}
              rows={3}
              placeholder="Horarios, cortes, tipo de mezcla, con quién coordinar…"
              className={`${claseInput} mt-1 w-full resize-y`}
            />
          </label>
          <label className="block text-[11px] text-texto-2">
            N° de contrato / decreto (opcional)
            <input
              value={contratoDecreto}
              onChange={(e) => setContratoDecreto(e.target.value)}
              maxLength={100}
              placeholder="p. ej. Decreto 1234/26"
              className={`${claseInput} mt-1 w-full`}
            />
          </label>
          <label className="block text-[11px] text-texto-2">
            Vence el (opcional)
            <input
              type="date"
              value={venceEn}
              onChange={(e) => setVenceEn(e.target.value)}
              className={`${claseInput} mt-1 w-full`}
            />
          </label>
        </Panel>

        {/* Estimación en vivo */}
        <Panel className="p-5">
          <p className="text-sm font-bold">La cuenta</p>
          <p className="num mt-1 text-xs text-texto-2">
            {ambito === "colector" ? (
              <>{numero(seleccion.size)} bocas de tormenta</>
            ) : (
              <>
                {numero(seleccion.size)} baches + {numero(tramosValidos.length)} tramos a mano
                {m2Seleccionados > 0 && <> · ~{numero(Math.round(m2Seleccionados))} m² estimados</>}
              </>
            )}
          </p>
          {estimacion && empresa ? (
            <p className="mt-2 text-sm leading-relaxed">
              Esta orden ≈{" "}
              <b className="num text-celeste">{numero(estimacion.turnos)} turnos</b> ·{" "}
              <b className="num text-amarillo">{numero(estimacion.toneladas)} t</b> de mezcla ·{" "}
              <b className="num" style={{ color: "#199e70" }}>
                {numero(estimacion.dias)} días
              </b>{" "}
              con la dotación de {empresa.nombre} ({numero(empresa.cuadrillas)} cuadrillas ×{" "}
              {numero(empresa.turnosPorDia)} turnos/día).
            </p>
          ) : (
            <p className="mt-2 text-xs text-texto-3">
              {ambito === "colector"
                ? "La estimación de turnos y toneladas es del bacheo: una orden de bocas de tormenta se mide distinto."
                : "Elegí baches y una empresa para ver cuánto costaría en turnos, toneladas y días."}
            </p>
          )}
        </Panel>

        {error && <p className="text-sm text-peligro">{error}</p>}
        <button
          onClick={crear}
          disabled={creando || !empresaId || totalItems === 0}
          className="w-full rounded-xl bg-azul px-4 py-3.5 font-semibold text-white transition hover:brightness-110 active:scale-[0.99] disabled:opacity-40"
        >
          {creando ? "Creando…" : `Crear la orden (${numero(totalItems)} items)`}
        </button>
        <p className="text-center text-[11px] text-texto-3">
          Se crea en borrador: la empresa no la ve hasta que la emitas.
        </p>
      </div>
    </div>
  );
}
