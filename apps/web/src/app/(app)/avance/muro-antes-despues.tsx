"use client";

import { Loader2, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fechaLarga, type PaginaMuro, type ParMuro, type TerritorioRef } from "@/lib/avance-tipos";
import { numero } from "@/lib/formato";
import type { ParAntesDespues } from "@/components/visor-antes-despues";

/**
 * EL MURO DEL ANTES Y EL DESPUÉS: todos los trabajos con las dos fotos, del
 * más nuevo al más viejo, en una grilla que ocupa la pantalla. Cada tarjeta
 * muestra el después; al pasar el cursor, el antes. Tocar una la abre grande
 * (el mismo visor de la columna) y "Pasar solas" las va mostrando una tras
 * otra, para el televisor o una reunión.
 *
 * Respeta el recorte de la pantalla y se filtra por empresa. Carga de a 48 a
 * medida que se baja: son más de mil fotos y no se piden todas de una.
 */

export function parDeMuro(p: ParMuro): ParAntesDespues {
  return {
    antes: p.antes,
    despues: p.despues,
    titulo: p.direccion ?? "Trabajo terminado",
    sub: `${p.empresa} · ${fechaLarga(p.fecha, true)}${p.m2 ? ` · ${numero(Math.round(p.m2))} m²` : ""}`,
    lon: p.lon,
    lat: p.lat,
    id: p.id,
  };
}

export function MuroAntesDespues({
  ruta,
  territorio,
  nombreRecorte,
  empresaInicial,
  color,
  alCerrar,
  alVer,
  tapado = false,
}: {
  /** /api/avance/fotos o su versión pública. */
  ruta: string;
  territorio: TerritorioRef | null;
  nombreRecorte: string;
  empresaInicial: string | null;
  color: (empresa: string) => string;
  alCerrar: () => void;
  /** Abrir el visor grande con estos pares, desde uno; `pasar` = que avance solo. */
  alVer: (pares: ParAntesDespues[], indice: number, pasar: boolean) => void;
  /** El visor grande está abierto encima: su Escape es suyo, no del muro. */
  tapado?: boolean;
}) {
  const [empresa, setEmpresa] = useState<string | null>(empresaInicial);
  const [pares, setPares] = useState<ParMuro[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [empresas, setEmpresas] = useState<PaginaMuro["empresas"]>(null);
  const [pagina, setPagina] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);
  const pedido = useRef(0);
  const fin = useRef<HTMLDivElement>(null);

  const cargar = useCallback(
    async (p: number, e: string | null) => {
      const yo = ++pedido.current;
      setCargando(true);
      setError(false);
      try {
        const q = new URLSearchParams({ pagina: String(p) });
        if (e) q.set("empresa", e);
        if (territorio) q.set(territorio.tipo, String(territorio.id));
        const r = await fetch(`${ruta}?${q.toString()}`);
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as PaginaMuro;
        if (yo !== pedido.current) return;
        setPares((prev) => (p === 0 ? j.pares : [...prev, ...j.pares]));
        if (p === 0) setTotal(j.total);
        if (j.empresas) setEmpresas(j.empresas);
        setPagina(p);
      } catch {
        if (yo === pedido.current) setError(true);
      } finally {
        if (yo === pedido.current) setCargando(false);
      }
    },
    [ruta, territorio],
  );

  useEffect(() => {
    setPares([]);
    setTotal(null);
    void cargar(0, empresa);
  }, [cargar, empresa]);

  const hayMas = total != null && pares.length < total;

  /* Al llegar al final de la grilla, la página siguiente. */
  useEffect(() => {
    const el = fin.current;
    if (!el || !hayMas) return;
    const obs = new IntersectionObserver((entradas) => {
      if (entradas.some((x) => x.isIntersecting) && !cargando) void cargar(pagina + 1, empresa);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hayMas, cargando, cargar, pagina, empresa]);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !tapado) alCerrar();
    };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [alCerrar, tapado]);

  if (typeof document === "undefined") return null;
  const todos = empresas?.reduce((s, x) => s + x.n, 0) ?? null;

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-fondo" role="dialog" aria-modal="true" aria-label="Antes y después">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-borde px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-[0.14em] text-texto-3 uppercase">{nombreRecorte} · todas las fechas</p>
          <h2 className="num text-xl font-extrabold tracking-tight sm:text-2xl">
            {total == null ? "Antes y después" : `${numero(total)} ${total === 1 ? "trabajo" : "trabajos"}, antes y después`}
          </h2>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => alVer(pares.map(parDeMuro), 0, true)}
            disabled={pares.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-amarillo/50 px-3 py-1.5 text-xs font-bold text-amarillo transition hover:bg-amarillo/10 disabled:opacity-40"
          >
            <Play size={12} />
            Pasar solas
          </button>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="rounded-lg p-2 text-texto-3 transition hover:bg-panel-2 hover:text-texto">
            <X size={18} />
          </button>
        </div>
        {empresas && empresas.length > 1 && (
          <div className="flex w-full flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setEmpresa(null)}
              aria-pressed={empresa == null}
              className={`num rounded-full px-3 py-1 text-xs font-semibold transition ${
                empresa == null ? "bg-azul text-white" : "border border-borde-2 text-texto-2 hover:text-texto"
              }`}
            >
              Todas{todos != null ? ` · ${numero(todos)}` : ""}
            </button>
            {empresas.map((x) => (
              <button
                key={x.empresa}
                type="button"
                onClick={() => setEmpresa((e) => (e === x.empresa ? null : x.empresa))}
                aria-pressed={empresa === x.empresa}
                className={`num flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
                  empresa === x.empresa ? "bg-panel-3 text-texto ring-1 ring-celeste" : "border border-borde-2 text-texto-2 hover:text-texto"
                }`}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color(x.empresa) }} aria-hidden="true" />
                {x.empresa} · {numero(x.n)}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        {total === 0 && !cargando && (
          <p className="mx-auto mt-16 max-w-md text-center text-sm text-texto-2">
            No hay trabajos con foto del antes y del después {empresa ? `de ${empresa} ` : ""}en {nombreRecorte.toLowerCase()}.
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-6">
          {pares.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => alVer(pares.map(parDeMuro), i, false)}
              className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-borde bg-panel-3 text-left transition hover:border-celeste/60 focus:border-celeste focus:outline-none"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- fotos de Storage/externas */}
              <img src={p.despues} alt={p.direccion ?? "Trabajo terminado"} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
              {/* eslint-disable-next-line @next/next/no-img-element -- fotos de Storage/externas */}
              <img
                src={p.antes}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover opacity-0 transition duration-300 group-hover:opacity-100 group-focus:opacity-100"
                loading="lazy"
              />
              <span className="absolute top-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-white uppercase">
                <span className="group-hover:hidden group-focus:hidden">después</span>
                <span className="hidden group-hover:inline group-focus:inline">antes</span>
              </span>
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pt-5 pb-1.5 text-white">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color(p.empresa) }} aria-hidden="true" />
                  <span className="truncate">{p.direccion ?? "Sin dirección"}</span>
                </span>
                <span className="num block text-[10px] text-white/70">
                  {p.empresa} · {fechaLarga(p.fecha)}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div ref={fin} className="flex h-16 items-center justify-center text-xs text-texto-3">
          {cargando && <Loader2 size={16} className="animate-spin" />}
          {error && (
            <button type="button" onClick={() => void cargar(pares.length === 0 ? 0 : pagina + 1, empresa)} className="font-semibold text-celeste">
              No se pudieron traer las fotos. Probá de nuevo.
            </button>
          )}
          {!hayMas && !cargando && pares.length > 0 && <span>Son todas.</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
