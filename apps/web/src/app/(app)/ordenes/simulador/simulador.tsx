"use client";

import { useMemo, useState } from "react";
import type { ParametrosCapacidad } from "@/lib/capacidad";
import { numero } from "@/lib/formato";
import { Panel } from "@/components/ui";
import { PanelTabla } from "@/components/tabla-deslizable";

/**
 * La matemática del simulador, a la vista (nada de caja negra):
 *   capacidad diaria = cuadrillas × turnos/día × baches/turno
 *   días para un circuito = sus pendientes ÷ la capacidad que le toque
 * El reparto de cuadrillas entre circuitos es proporcional a la deuda de cada
 * uno (como reparte un planificador razonable); la columna «con 1 cuadrilla»
 * muestra el caso de dedicarle una completa, que es la decisión típica.
 * Los pendientes se cuentan como baches promedio: una carpeta cuesta ~3,5
 * baches de turno — por eso está la palanca de "% carpetas".
 */
export function Simulador({
  circuitos,
  capacidad,
  cuadrillasActivas,
}: {
  circuitos: Array<{ codigo: string; pendientes: number; empresa: string | null }>;
  capacidad: ParametrosCapacidad;
  cuadrillasActivas: number;
}) {
  const [cuadrillas, setCuadrillas] = useState(Math.max(1, cuadrillasActivas));
  const [turnos, setTurnos] = useState(capacidad.turnosPorDia);
  const [bachesTurno, setBachesTurno] = useState(capacidad.bachesPorTurno);
  const [pctCarpetas, setPctCarpetas] = useState(10);

  const r = useMemo(() => {
    const deuda = circuitos.reduce((a, c) => a + c.pendientes, 0);
    // El costo en "baches equivalentes": la fracción que son carpetas rinde
    // bachesPorTurno/carpetasPorTurno veces menos por turno.
    const factorCarpeta = capacidad.bachesPorTurno / Math.max(1, capacidad.carpetasPorTurno);
    const deudaEquivalente = Math.round(deuda * (1 - pctCarpetas / 100) + deuda * (pctCarpetas / 100) * factorCarpeta);
    const porDia = cuadrillas * turnos * bachesTurno;
    const dias = porDia > 0 ? Math.ceil(deudaEquivalente / porDia) : Infinity;
    // Días corridos: 5 días hábiles por semana.
    const corridos = Number.isFinite(dias) ? Math.ceil((dias * 7) / 5) : Infinity;
    const fin = Number.isFinite(corridos) ? new Date(Date.now() + corridos * 86400000) : null;
    const toneladasDia = Math.round(cuadrillas * turnos * capacidad.toneladasPorTurno * 10) / 10;
    return { deuda, deudaEquivalente, porDia, dias, fin, toneladasDia, factorCarpeta };
  }, [circuitos, cuadrillas, turnos, bachesTurno, pctCarpetas, capacidad]);

  const top = useMemo(() => [...circuitos].sort((a, b) => b.pendientes - a.pendientes).slice(0, 10), [circuitos]);
  const porDiaUnaCuadrilla = turnos * bachesTurno;

  return (
    <div className="space-y-4">
      {/* Las palancas */}
      <Panel className="p-5">
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Palanca
            etiqueta="Cuadrillas trabajando"
            valor={cuadrillas}
            min={1}
            max={20}
            alCambiar={setCuadrillas}
            nota={`hoy hay ${numero(cuadrillasActivas)} declaradas entre todos los ejecutores`}
          />
          <Palanca etiqueta="Turnos por día" valor={turnos} min={1} max={3} alCambiar={setTurnos} nota="mañana / tarde / noche" />
          <Palanca
            etiqueta="Baches por turno y cuadrilla"
            valor={bachesTurno}
            min={4}
            max={18}
            alCambiar={setBachesTurno}
            nota={`la regla del Director: ${capacidad.bachesPorTurno}`}
          />
          <Palanca
            etiqueta="% del trabajo que son carpetas"
            valor={pctCarpetas}
            min={0}
            max={60}
            paso={5}
            alCambiar={setPctCarpetas}
            nota={`una carpeta cuesta ~${(capacidad.bachesPorTurno / Math.max(1, capacidad.carpetasPorTurno)).toFixed(1)} baches de turno`}
            sufijo="%"
          />
        </div>
      </Panel>

      {/* El veredicto */}
      <Panel className="p-5">
        <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
          <div>
            <p className="num text-3xl font-extrabold text-celeste">{numero(r.porDia)}</p>
            <p className="mt-0.5 text-[10px] font-bold tracking-wider text-texto-3 uppercase">baches por día</p>
          </div>
          <div>
            <p className="num text-3xl font-extrabold">{numero(r.toneladasDia)} t</p>
            <p className="mt-0.5 text-[10px] font-bold tracking-wider text-texto-3 uppercase">mezcla por día</p>
          </div>
          <div>
            <p className="num text-3xl font-extrabold" style={{ color: "var(--color-en-cola)" }}>
              {Number.isFinite(r.dias) ? numero(r.dias) : "—"}
            </p>
            <p className="mt-0.5 text-[10px] font-bold tracking-wider text-texto-3 uppercase">días hábiles p/ la deuda</p>
          </div>
          <div>
            <p className="num text-3xl font-extrabold" style={{ color: "var(--color-hecho)" }}>
              {r.fin ? r.fin.toLocaleDateString("es-AR", { day: "numeric", month: "short" }) : "—"}
            </p>
            <p className="mt-0.5 text-[10px] font-bold tracking-wider text-texto-3 uppercase">terminaría el</p>
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] leading-relaxed text-texto-3">
          Deuda actual: <b className="num text-texto-2">{numero(r.deuda)}</b> pendientes en circuitos
          {pctCarpetas > 0 && (
            <>
              {" "}
              (≈ <b className="num text-texto-2">{numero(r.deudaEquivalente)}</b> baches equivalentes con{" "}
              {pctCarpetas}% de carpetas)
            </>
          )}
          . Cuenta 5 días hábiles por semana y la deuda de HOY: lo que entre mañana corre la fecha.
        </p>
      </Panel>

      {/* Circuito por circuito */}
      <PanelTabla className="p-0">
        <p className="px-5 pt-4 pb-2 text-sm font-bold">Los 10 circuitos con más deuda</p>
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-borde text-left text-[10px] font-bold tracking-wider text-texto-3 uppercase">
              <th className="px-5 py-2">Circuito</th>
              <th className="px-3 py-2">Empresa asignada</th>
              <th className="px-3 py-2 text-right">Pendientes</th>
              <th className="px-3 py-2 text-right" title="Si el total de cuadrillas se reparte proporcional a la deuda">Días (reparto proporcional)</th>
              <th className="px-5 py-2 text-right" title="Si le dedicás una cuadrilla completa solo a este circuito">Días con 1 cuadrilla dedicada</th>
            </tr>
          </thead>
          <tbody>
            {top.map((c) => {
              const propor = r.deuda > 0 && Number.isFinite(r.dias) ? r.dias : null;
              const dedicada = porDiaUnaCuadrilla > 0 ? Math.ceil(c.pendientes / porDiaUnaCuadrilla) : null;
              return (
                <tr key={c.codigo} className="border-b border-borde/60">
                  <td className="num px-5 py-2.5 font-bold">{c.codigo}</td>
                  <td className="px-3 py-2.5 text-texto-2">{c.empresa ?? <span className="text-texto-3">sin asignar</span>}</td>
                  <td className="num px-3 py-2.5 text-right font-bold">{numero(c.pendientes)}</td>
                  <td className="num px-3 py-2.5 text-right">{propor != null ? `${numero(propor)} d` : "—"}</td>
                  <td className="num px-5 py-2.5 text-right text-celeste">{dedicada != null ? `${numero(dedicada)} d` : "—"}</td>
                </tr>
              );
            })}
            {top.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-texto-3">No hay circuitos con pendientes.</td></tr>
            )}
          </tbody>
        </table>
        <p className="px-5 py-3 text-[11px] leading-relaxed text-texto-3">
          «Reparto proporcional»: todas las cuadrillas repartidas según la deuda de cada circuito — todos
          terminan a la vez. «1 cuadrilla dedicada»: cuántos días le lleva a UNA cuadrilla limpiar ese
          circuito sola, con los turnos y el ritmo de las palancas.
        </p>
      </PanelTabla>
    </div>
  );
}

function Palanca({
  etiqueta,
  valor,
  min,
  max,
  paso = 1,
  alCambiar,
  nota,
  sufijo = "",
}: {
  etiqueta: string;
  valor: number;
  min: number;
  max: number;
  paso?: number;
  alCambiar: (v: number) => void;
  nota?: string;
  sufijo?: string;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-xs font-semibold tracking-wider text-texto-3 uppercase">{etiqueta}</span>
        <span className="num text-xl font-extrabold text-celeste">
          {numero(valor)}
          {sufijo}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={paso}
        value={valor}
        onChange={(e) => alCambiar(Number(e.target.value))}
        className="mt-1 w-full accent-[#0066ff]"
      />
      {nota && <span className="text-[11px] text-texto-3">{nota}</span>}
    </label>
  );
}
