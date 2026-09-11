"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { aplicarCorreccionPines, proponerCorreccionPines, type PropuestaPin } from "@/lib/acciones-pines";
import { numero } from "@/lib/formato";
import { ChipMiniMapa } from "@/components/mapa/mini-mapa";
import { Panel } from "@/components/ui";
import { mensajeDeError } from "@/lib/errores";

/**
 * La isla del corrector: pide una tanda, muestra la lista con el mini-mapa de
 * cada propuesta, y aplica lo tildado. Todo tildado por defecto — la propuesta
 * ya viene filtrada a confianza ≥ 75% — pero el mini-mapa está a un toque para
 * la que haga dudar, y destildar la manda a corrección manual (queda marcada,
 * no vuelve a aparecer acá).
 */
export function CorrectorPines({ pendientesIniciales }: { pendientesIniciales: number }) {
  const router = useRouter();
  const [propuestas, setPropuestas] = useState<PropuestaPin[]>([]);
  const [tildadas, setTildadas] = useState<Set<number>>(new Set());
  const [quedan, setQuedan] = useState(pendientesIniciales);
  const [sinResultado, setSinResultado] = useState(0);
  const [resultado, setResultado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proponiendo, comenzarProponer] = useTransition();
  const [aplicando, comenzarAplicar] = useTransition();

  const proponer = () =>
    comenzarProponer(async () => {
      setError(null);
      setResultado(null);
      try {
        const r = await proponerCorreccionPines();
        setPropuestas(r.propuestas);
        setTildadas(new Set(r.propuestas.map((p) => p.demandaId)));
        setQuedan(r.quedan);
        setSinResultado(r.sinResultado);
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo geocodificar la tanda"));
      }
    });

  const alternar = (id: number) =>
    setTildadas((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const aplicar = () =>
    comenzarAplicar(async () => {
      setError(null);
      try {
        const aceptadas = propuestas
          .filter((p) => tildadas.has(p.demandaId))
          .map((p) => ({ demandaId: p.demandaId, lat: p.lat, lon: p.lon, confianza: p.confianza, direccion: p.direccionResuelta }));
        const omitidas = propuestas.filter((p) => !tildadas.has(p.demandaId)).map((p) => p.demandaId);
        const r = await aplicarCorreccionPines({ aceptadas, omitidas });
        setResultado(
          `Listo: ${numero(r.aplicadas)} pines corregidos${r.omitidas > 0 ? ` · ${numero(r.omitidas)} enviados a corrección manual` : ""}.`,
        );
        setPropuestas([]);
        setTildadas(new Set());
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudieron aplicar las correcciones"));
      }
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={proponer}
          disabled={proponiendo || aplicando || quedan === 0}
          className="rounded-xl bg-azul px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {proponiendo
            ? "Geocodificando la tanda… (hasta 30 s)"
            : quedan === 0
              ? "No quedan pines para proponer"
              : `Proponer una tanda (20 de ${numero(quedan)})`}
        </button>
        {resultado && <p className="text-sm font-semibold" style={{ color: "var(--color-hecho)" }}>{resultado}</p>}
        {error && <p className="text-sm text-peligro">{error}</p>}
      </div>

      {sinResultado > 0 && propuestas.length >= 0 && !proponiendo && (
        <p className="text-xs text-texto-3">
          De esta tanda, {numero(sinResultado)} direcciones no se pudieron resolver con precisión: quedaron
          marcadas para corrección manual y no vuelven a proponerse.
        </p>
      )}

      {propuestas.length > 0 && (
        <>
          <div className="space-y-2">
            {propuestas.map((p) => {
              const activa = tildadas.has(p.demandaId);
              return (
                <Panel key={p.demandaId} className={`p-3 transition ${activa ? "" : "opacity-50"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                      <input
                        type="checkbox"
                        checked={activa}
                        onChange={() => alternar(p.demandaId)}
                        className="mt-1 accent-[#0066ff]"
                      />
                      <span className="min-w-0 text-[13px]">
                        <b>#{p.demandaId}</b> · <span className="text-texto-2">{p.direccionOriginal}</span>
                        <span className="mt-0.5 block text-[12px] leading-snug">
                          → <b>{p.direccionResuelta}</b>
                        </span>
                        <span className="num mt-0.5 block text-[11px] text-texto-3">
                          confianza {Math.round(p.confianza * 100)}%
                          {p.confianzaAnterior != null && <> (antes {Math.round(p.confianzaAnterior * 100)}%)</>}
                          {p.distanciaM != null && <> · el pin se mueve {numero(p.distanciaM)} m</>}
                          {p.distanciaM == null && <> · el pedido no tenía pin</>}
                        </span>
                      </span>
                    </label>
                    <ChipMiniMapa lat={p.lat} lon={p.lon} etiqueta={p.direccionResuelta} fichaHref={`/demandas/${p.demandaId}`} />
                  </div>
                </Panel>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-borde bg-panel px-4 py-3">
            <p className="text-xs text-texto-3">
              Aplicar corrige <b className="num text-texto-2">{numero(tildadas.size)}</b> pines (recuperan
              barrio, circuito y destino solos); los <b className="num">{numero(propuestas.length - tildadas.size)}</b>{" "}
              destildados van a corrección manual y no vuelven a aparecer acá.
            </p>
            <button
              onClick={aplicar}
              disabled={aplicando || tildadas.size + (propuestas.length - tildadas.size) === 0}
              className="rounded-xl bg-azul px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {aplicando ? "Aplicando…" : `Aplicar ${numero(tildadas.size)} correcciones`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
