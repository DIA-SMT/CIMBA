"use client";

import { ArrowLeftRight, CheckCircle2, Printer, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { EstadoOrden } from "@cimba/domain";
import { anularOrden, cerrarOrden, emitirOrden, reasignarOrden } from "@/lib/acciones-ordenes";
import { mensajeDeError } from "@/lib/errores";
import { hoyISO } from "@/lib/formato";

/**
 * Los botones del ciclo de vida: emitir (borrador → empresa), anular con
 * motivo, e imprimir. window.print() usa la hoja de impresión que la página
 * server ya dejó lista.
 */
export function AccionesOrden({
  ordenId,
  estado,
  puedePlanificar,
  itemsPendientes = 0,
  emitidaEn,
  empresaId,
  empresas = [],
}: {
  ordenId: number;
  estado: EstadoOrden;
  puedePlanificar: boolean;
  /** Lo que quedaría sin hacer si se cierra ahora: se dice antes de cerrar. */
  itemsPendientes?: number;
  /** Día en que se emitió, 'YYYY-MM-DD': el cierre no puede ser anterior. */
  emitidaEn?: string | null;
  /** Para reasignar: quién la tiene hoy y a quién se le puede pasar. */
  empresaId?: number;
  empresas?: Array<{ id: number; nombre: string }>;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [cerrando, setCerrando] = useState(false);
  const [fecha, setFecha] = useState(hoyISO());
  const [observacion, setObservacion] = useState("");
  const [reasignando, setReasignando] = useState(false);
  const [nuevaEmpresa, setNuevaEmpresa] = useState("");
  const [motivoReasignacion, setMotivoReasignacion] = useState("");

  const ejecutar = (fn: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        setAnulando(false);
        setCerrando(false);
        setReasignando(false);
        setMotivo("");
        setObservacion("");
        setMotivoReasignacion("");
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "Error"));
      }
    });
  };

  const anulable = estado === "borrador" || estado === "emitida" || estado === "en_ejecucion";
  /**
   * Cerrar a mano solo tiene sentido con la orden en la calle. En borrador no
   * hay nada que cerrar y una completada ya lo está; anular es otra cosa (ahí
   * la orden nunca existió para la certificación).
   */
  const cerrable = estado === "emitida" || estado === "en_ejecucion";
  /** Reasignar vale mientras la orden siga viva; una cerrada o anulada ya
   *  tiene su historia escrita y cambiarle el dueño la falsearía. */
  const reasignable =
    empresas.length > 0 && (estado === "borrador" || estado === "emitida" || estado === "en_ejecucion");

  return (
    <div className="flex flex-col items-end gap-2 print:hidden">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {puedePlanificar && estado === "borrador" && (
          <button
            disabled={pendiente}
            onClick={() => ejecutar(() => emitirOrden({ ordenId }))}
            className="flex items-center gap-2 rounded-xl bg-azul px-5 py-2.5 font-semibold text-white transition hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
          >
            <Send size={15} /> Emitir a la empresa
          </button>
        )}
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 rounded-lg border border-borde-2 px-4 py-2.5 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste"
          title="Imprimir la orden en papel (o guardarla como PDF)"
        >
          <Printer size={15} /> Imprimir
        </button>
        {/* Cerrar va ANTES que anular y con más peso visual: es lo que pasa
            al final de casi todas las órdenes, mientras que anular es la
            excepción (la orden que nunca tendría que haber salido). */}
        {puedePlanificar && cerrable && !cerrando && (
          <button
            disabled={pendiente}
            onClick={() => setCerrando(true)}
            className="flex items-center gap-2 rounded-lg border border-resuelto/50 px-4 py-2.5 text-sm font-semibold text-resuelto transition hover:bg-resuelto/10 disabled:opacity-50"
            title="Dar la orden por terminada, con la fecha real en que se dejó de trabajar"
          >
            <CheckCircle2 size={15} /> Cerrar orden
          </button>
        )}
        {/* Reasignar: existe mientras la orden esté viva, incluso en
            borrador (ahí es simplemente corregir a quién se le iba a dar). */}
        {puedePlanificar && reasignable && !reasignando && (
          <button
            disabled={pendiente}
            onClick={() => setReasignando(true)}
            className="flex items-center gap-2 rounded-lg border border-borde-2 px-4 py-2.5 text-sm font-semibold text-texto-2 transition hover:border-celeste/50 hover:text-celeste disabled:opacity-50"
            title="Pasarle esta orden a otra empresa"
          >
            <ArrowLeftRight size={15} /> Cambiar de empresa
          </button>
        )}
        {puedePlanificar && anulable && !anulando && (
          <button
            disabled={pendiente}
            onClick={() => setAnulando(true)}
            className="rounded-lg border border-peligro/40 px-4 py-2.5 text-sm font-semibold text-peligro transition hover:bg-peligro/10 disabled:opacity-50"
          >
            Anular
          </button>
        )}
      </div>

      {reasignando && (
        <div className="w-full max-w-md rounded-xl border border-borde-2 bg-panel p-3 text-left">
          <p className="text-sm font-bold">Pasarle la orden a otra empresa</p>
          <p className="mt-0.5 text-[12px] leading-snug text-texto-2">
            Lo que la empresa actual ya reportó sigue contando para ella: cambia de manos lo que
            falta. Queda escrito quién la pasó, cuándo y por qué.
          </p>
          <select
            value={nuevaEmpresa}
            onChange={(e) => setNuevaEmpresa(e.target.value)}
            className="mt-2 w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm"
          >
            <option value="">Elegí la empresa…</option>
            {empresas
              .filter((e) => e.id !== empresaId)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
          </select>
          <input
            value={motivoReasignacion}
            onChange={(e) => setMotivoReasignacion(e.target.value)}
            placeholder="Motivo (opcional): por qué cambia de empresa"
            className="mt-2 w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              disabled={pendiente || !nuevaEmpresa}
              onClick={() =>
                ejecutar(() =>
                  reasignarOrden({
                    ordenId,
                    empresaId: Number(nuevaEmpresa),
                    motivo: motivoReasignacion.trim() || undefined,
                  }),
                )
              }
              className="rounded-lg bg-azul px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {pendiente ? "Pasando…" : "Confirmar el cambio"}
            </button>
            <button
              onClick={() => setReasignando(false)}
              className="text-sm text-texto-2 hover:text-texto"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {cerrando && (
        <div className="w-full max-w-md rounded-xl border border-resuelto/40 bg-resuelto/5 p-3 text-left">
          <p className="text-sm font-bold text-resuelto">Cerrar la orden</p>
          <p className="mt-0.5 text-[12px] leading-snug text-texto-2">
            Lo cargado queda firme y se certifica igual.{" "}
            {itemsPendientes > 0 ? (
              <>
                Los <b className="num">{itemsPendientes}</b> item(s) que quedan sin hacer vuelven a la
                cola de la ciudad para poder entrar en otra orden.
              </>
            ) : (
              <>No queda nada pendiente.</>
            )}
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-texto-2">
                Día en que se terminó de trabajar
              </span>
              <input
                type="date"
                value={fecha}
                /* El cierre no puede ser futuro ni anterior a la emisión: los
                   mismos dos límites que valida el servidor, acá para que el
                   calendario ni siquiera los ofrezca. */
                max={hoyISO()}
                min={emitidaEn ?? undefined}
                onChange={(e) => setFecha(e.target.value)}
                className="num rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <textarea
            value={observacion}
            onChange={(e) => setObservacion(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Observación (opcional): por qué se cierra, qué quedó sin hacer…"
            className="mt-2 w-full resize-y rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              disabled={pendiente || !fecha}
              onClick={() =>
                ejecutar(() =>
                  cerrarOrden({
                    ordenId,
                    fecha,
                    observacion: observacion.trim() || undefined,
                  }),
                )
              }
              className="rounded-lg bg-resuelto px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              {pendiente ? "Cerrando…" : "Confirmar el cierre"}
            </button>
            <button onClick={() => setCerrando(false)} className="text-sm text-texto-2 hover:text-texto">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {anulando && (
        <div className="flex w-full max-w-md items-center gap-2">
          <input
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Motivo de la anulación (obligatorio)"
            className="flex-1 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
          />
          <button
            disabled={pendiente || motivo.trim().length < 3}
            onClick={() => ejecutar(() => anularOrden({ ordenId, motivo: motivo.trim() }))}
            className="rounded-lg bg-peligro/90 px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
          >
            {pendiente ? "Anulando…" : "Confirmar"}
          </button>
          <button onClick={() => setAnulando(false)} className="text-sm text-texto-2 hover:text-texto">
            Cancelar
          </button>
        </div>
      )}

      {error && <p className="text-xs text-peligro">{error}</p>}
    </div>
  );
}
