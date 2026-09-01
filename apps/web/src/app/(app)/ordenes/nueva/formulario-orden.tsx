"use client";

import { LocateFixed, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PRIORIDADES_VIALES, type PrioridadVial } from "@cimba/domain";
import { crearOrden } from "@/lib/acciones-ordenes";
import { proyectar, type ParametrosCapacidad } from "@/lib/capacidad";
import { ETIQUETA_TIPO, numero } from "@/lib/formato";
// Solo tipos: se borran al compilar, así que no arrastran @cimba/db al cliente.
import type { EmpresaResumen, PendienteCircuito } from "@/lib/ordenes";
import { Panel } from "@/components/ui";
import { ETIQUETA_PRIORIDAD } from "../etiquetas";

interface CircuitoOpcion {
  id: number;
  codigo: string;
  pendientes: number;
  demandasAbiertas: number;
  empresaId: number | null;
  empresaNombre: string | null;
}

interface Tramo {
  direccion: string;
  tipoTrabajo: "bache" | "carpeta" | "tramo";
  lat?: number;
  lon?: number;
  resuelta?: string;
  ubicando?: boolean;
  sinResultado?: boolean;
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
  empresas,
  parametros,
}: {
  circuitos: CircuitoOpcion[];
  empresas: EmpresaResumen[];
  parametros: ParametrosCapacidad;
}) {
  const router = useRouter();

  // ── La demanda ─────────────────────────────────────────────────────────────
  const [circuitoId, setCircuitoId] = useState<number>(0);
  const [pendientes, setPendientes] = useState<PendienteCircuito[]>([]);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [tramos, setTramos] = useState<Tramo[]>([]);
  // Evita que una respuesta lenta de un circuito anterior pise a la actual.
  const pedidoRef = useRef(0);

  // ── La oferta y el papel ───────────────────────────────────────────────────
  const [empresaId, setEmpresaId] = useState<number>(0);
  const [prioridad, setPrioridad] = useState<PrioridadVial>("primaria");
  const [titulo, setTitulo] = useState("");
  const [indicaciones, setIndicaciones] = useState("");
  const [venceEn, setVenceEn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creando, startTransition] = useTransition();

  const elegirCircuito = async (id: number) => {
    setCircuitoId(id);
    setSeleccion(new Set());
    setPendientes([]);
    setErrorCarga(null);
    if (!id) return;
    const pedido = ++pedidoRef.current;
    setCargando(true);
    try {
      const r = await fetch(`/api/ordenes/pendientes?circuito=${id}`);
      if (!r.ok) throw new Error("No se pudieron cargar los pendientes del circuito");
      const j = (await r.json()) as { pendientes: PendienteCircuito[] };
      if (pedido !== pedidoRef.current) return;
      setPendientes(j.pendientes);
      // Si el circuito ya tiene empresa asignada, se propone sola.
      const c = circuitos.find((x) => x.id === id);
      if (c?.empresaId && !empresaId) setEmpresaId(c.empresaId);
    } catch (e) {
      if (pedido !== pedidoRef.current) return;
      setErrorCarga(e instanceof Error ? e.message : "Error al cargar");
    } finally {
      if (pedido === pedidoRef.current) setCargando(false);
    }
  };

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

  const ubicarTramo = async (i: number) => {
    const t = tramos[i];
    if (!t || t.direccion.trim().length < 4) return;
    actualizarTramo(i, { ubicando: true, sinResultado: false });
    try {
      const r = await fetch(`/api/geocodificar?q=${encodeURIComponent(t.direccion.trim())}`);
      const j = (await r.json()) as {
        resultado: { punto: { lat: number; lon: number }; confianza: number; direccionResuelta: string } | null;
      };
      if (j.resultado) {
        actualizarTramo(i, {
          ubicando: false,
          lat: j.resultado.punto.lat,
          lon: j.resultado.punto.lon,
          resuelta: j.resultado.direccionResuelta,
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
          circuitoId: circuitoId || undefined,
          prioridad,
          titulo: titulo.trim() || undefined,
          indicaciones: indicaciones.trim() || undefined,
          venceEn: venceEn || undefined,
          incidenteIds: [...seleccion],
          tramos: tramosValidos.map((t) => ({
            direccion: t.direccion.trim(),
            tipoTrabajo: t.tipoTrabajo,
            lat: t.lat,
            lon: t.lon,
          })),
        });
        router.push(`/ordenes/${res.ordenId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo crear la orden");
      }
    });
  };

  const diasDesde = (iso: string) => Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_360px]">
      {/* ══ LA DEMANDA ══ */}
      <div className="min-w-0 space-y-4">
        <Panel className="p-5">
          <p className="mb-2 text-sm font-bold">1 · El circuito</p>
          <select
            value={circuitoId || ""}
            onChange={(e) => void elegirCircuito(Number(e.target.value) || 0)}
            className={`${claseInput} w-full max-w-md`}
          >
            <option value="">Elegí un circuito…</option>
            {circuitos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.codigo} — {numero(c.pendientes)} pendientes · {numero(c.demandasAbiertas)} reclamos
                {c.empresaNombre ? ` · ${c.empresaNombre}` : ""}
              </option>
            ))}
          </select>
          {errorCarga && <p className="mt-2 text-xs text-peligro">{errorCarga}</p>}
        </Panel>

        {circuitoId > 0 && (
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-borde px-4 py-3">
              <p className="text-sm font-bold">
                2 · La demanda{" "}
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

            {cargando ? (
              <p className="px-4 py-8 text-center text-sm text-texto-3">Cargando pendientes…</p>
            ) : pendientes.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-texto-3">
                Este circuito no tiene pendientes con ubicación. Podés cargar tramos a mano abajo.
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
                            <span className="block truncate" title={p.direccion ?? undefined}>
                              {p.direccion ?? `Incidente #${p.incidenteId}`}
                            </span>
                            {p.enOrden && <span className="text-[10px] text-texto-3">ya está en otra orden activa</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-texto-2">{ETIQUETA_TIPO[p.tipo]}</td>
                          <td className="num px-3 py-2 text-right text-xs text-texto-2">
                            {p.score != null ? p.score.toFixed(1) : "—"}
                          </td>
                          <td className="num px-3 py-2 text-right text-base font-extrabold" style={{ color: p.reclamos > 0 ? "#f4dc00" : "#5c6b84" }}>
                            {numero(p.reclamos)}
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
                  placeholder="Dirección (calle y altura, o esquina)"
                  className={`${claseInput} min-w-52 flex-1`}
                />
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
                {t.lat != null && (
                  <span className="w-full text-[11px] text-texto-3" style={{ color: "#199e70" }}>
                    ✓ {t.resuelta ?? "ubicado"}
                  </span>
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
          <p className="mb-3 text-sm font-bold">3 · La empresa</p>
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
          <p className="text-sm font-bold">4 · El papel</p>
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
            {numero(seleccion.size)} baches del circuito + {numero(tramosValidos.length)} tramos a mano
            {m2Seleccionados > 0 && <> · ~{numero(Math.round(m2Seleccionados))} m² estimados</>}
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
              Elegí baches y una empresa para ver cuánto costaría en turnos, toneladas y días.
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
