"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { actualizarCapacidad } from "@/lib/acciones-ordenes";
import { proyectar, type ParametrosCapacidad } from "@/lib/capacidad";
import { numero } from "@/lib/formato";
import { Panel } from "@/components/ui";

/**
 * La pregunta que el Director hace todas las semanas: "con N cuadrillas,
 * ¿cuánto tardo en bajar esto?". Isla cliente para que los números respondan
 * mientras escribe, sin ida y vuelta al servidor.
 */
export function PanelProyeccion({
  parametros,
  bachesIniciales,
  carpetasIniciales,
  cuadrillasIniciales,
  puedeEditar,
}: {
  parametros: ParametrosCapacidad;
  bachesIniciales: number;
  carpetasIniciales: number;
  cuadrillasIniciales: number;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [baches, setBaches] = useState(String(bachesIniciales));
  const [carpetas, setCarpetas] = useState(String(carpetasIniciales));
  const [cuadrillas, setCuadrillas] = useState(String(Math.max(1, cuadrillasIniciales)));
  const [turnos, setTurnos] = useState(String(parametros.turnosPorDia));

  const n = (s: string) => Math.max(0, Number(s.replace(",", ".")) || 0);
  const p = proyectar(
    { baches: n(baches), carpetas: n(carpetas) },
    { cuadrillas: Math.max(1, n(cuadrillas)), turnosPorDia: Math.max(1, n(turnos)) },
    parametros,
  );

  // Edición de los parámetros de la regla (persisten en la tabla `parametros`).
  const [editando, setEditando] = useState(false);
  const [guardando, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pBaches, setPBaches] = useState(String(parametros.bachesPorTurno));
  const [pTurnos, setPTurnos] = useState(String(parametros.turnosPorDia));
  const [pToneladas, setPToneladas] = useState(String(parametros.toneladasPorTurno));
  const [pChicos, setPChicos] = useState(String(parametros.bachesChicosPorTurno));
  const [pCarpetas, setPCarpetas] = useState(String(parametros.carpetasPorTurno));

  const guardar = () => {
    setError(null);
    startTransition(async () => {
      try {
        await actualizarCapacidad({
          bachesPorTurno: n(pBaches),
          turnosPorDia: n(pTurnos),
          toneladasPorTurno: n(pToneladas),
          bachesChicosPorTurno: n(pChicos),
          carpetasPorTurno: n(pCarpetas),
        });
        setEditando(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudieron guardar los parámetros");
      }
    });
  };

  const claseInput =
    "num w-full rounded-lg border border-borde-2 bg-panel-2 px-2.5 py-1.5 text-sm placeholder:text-texto-3";

  return (
    <Panel className="p-5">
      <p className="text-sm font-bold">¿Cuánto cuesta bajar lo pendiente?</p>
      <p className="mt-0.5 mb-3 text-[11px] leading-snug text-texto-3">
        Precargado con lo pendiente de toda la ciudad. Cambiá la dotación y mirá qué pasa.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-texto-2">
          Baches
          <input value={baches} onChange={(e) => setBaches(e.target.value)} inputMode="numeric" className={claseInput} />
        </label>
        <label className="text-[11px] text-texto-2">
          Carpetas
          <input value={carpetas} onChange={(e) => setCarpetas(e.target.value)} inputMode="numeric" className={claseInput} />
        </label>
        <label className="text-[11px] text-texto-2">
          Cuadrillas
          <input value={cuadrillas} onChange={(e) => setCuadrillas(e.target.value)} inputMode="numeric" className={claseInput} />
        </label>
        <label className="text-[11px] text-texto-2">
          Turnos por día
          <input value={turnos} onChange={(e) => setTurnos(e.target.value)} inputMode="numeric" className={claseInput} />
        </label>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-panel-2 px-2 py-3">
          <p className="num text-xl font-extrabold text-celeste">{numero(p.turnos)}</p>
          <p className="text-[10px] tracking-wider text-texto-3 uppercase">turnos</p>
        </div>
        <div className="rounded-lg bg-panel-2 px-2 py-3">
          <p className="num text-xl font-extrabold text-amarillo">{numero(p.toneladas)}</p>
          <p className="text-[10px] tracking-wider text-texto-3 uppercase">toneladas</p>
        </div>
        <div className="rounded-lg bg-panel-2 px-2 py-3">
          <p className="num text-xl font-extrabold" style={{ color: "var(--color-ok)" }}>{numero(p.dias)}</p>
          <p className="text-[10px] tracking-wider text-texto-3 uppercase">días</p>
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-texto-3">
        Regla del Director: {numero(parametros.bachesPorTurno)} baches por turno por cuadrilla; de{" "}
        {numero(parametros.toneladasPorTurno)} t de mezcla salen ~{numero(parametros.bachesChicosPorTurno)}{" "}
        baches chicos o {numero(parametros.carpetasPorTurno)} carpetas por turno.
      </p>

      {puedeEditar && !editando && (
        <button
          onClick={() => setEditando(true)}
          className="mt-2 text-[11px] text-texto-3 underline-offset-2 transition hover:text-celeste hover:underline"
        >
          Editar los parámetros de la regla
        </button>
      )}

      {editando && (
        <div className="mt-3 space-y-2 border-t border-borde pt-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-texto-2">
              Baches / turno / cuadrilla
              <input value={pBaches} onChange={(e) => setPBaches(e.target.value)} inputMode="decimal" className={claseInput} />
            </label>
            <label className="text-[11px] text-texto-2">
              Turnos / día
              <input value={pTurnos} onChange={(e) => setPTurnos(e.target.value)} inputMode="decimal" className={claseInput} />
            </label>
            <label className="text-[11px] text-texto-2">
              Toneladas / turno
              <input value={pToneladas} onChange={(e) => setPToneladas(e.target.value)} inputMode="decimal" className={claseInput} />
            </label>
            <label className="text-[11px] text-texto-2">
              Baches chicos / turno
              <input value={pChicos} onChange={(e) => setPChicos(e.target.value)} inputMode="decimal" className={claseInput} />
            </label>
            <label className="text-[11px] text-texto-2">
              Carpetas / turno
              <input value={pCarpetas} onChange={(e) => setPCarpetas(e.target.value)} inputMode="decimal" className={claseInput} />
            </label>
          </div>
          {error && <p className="text-xs text-peligro">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              onClick={guardar}
              disabled={guardando}
              className="rounded-lg bg-azul px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {guardando ? "Guardando…" : "Guardar parámetros"}
            </button>
            <button onClick={() => setEditando(false)} className="text-xs text-texto-2 hover:text-texto">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}
