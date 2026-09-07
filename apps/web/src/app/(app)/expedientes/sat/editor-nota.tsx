"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, RotateCcw } from "lucide-react";
import { generarNotaSat } from "@/lib/acciones-tratamiento";
import type { RenglonNota } from "@/lib/expedientes";
import { numero } from "@/lib/formato";
import { CUERPO_MODELO_SAT, FIRMAS_NOTA, NotaSat, type FirmaNota } from "../nota-sat";

/**
 * La previsualización EDITABLE de la nota a la SAT — el pedido del Director:
 * poder retocar la escritura, dejar afuera algún reclamo que por alguna razón
 * no deba salir en el papel, y elegir quién firma. La contracara es la regla
 * de siempre: de esta gestión queda archivo y trazabilidad — las exclusiones
 * se registran en el expediente con nombre y fecha, y el reclamo excluido NO
 * desaparece: sigue abierto y entra en la próxima nota.
 */
export function EditorNota({
  renglones,
  destinatario,
  puedeGenerar,
}: {
  renglones: RenglonNota[];
  destinatario: string;
  puedeGenerar: boolean;
}) {
  const router = useRouter();
  const [excluidos, setExcluidos] = useState<Set<number>>(new Set());
  const [cuerpo, setCuerpo] = useState(CUERPO_MODELO_SAT);
  const [firma, setFirma] = useState<FirmaNota>("direccion");
  const [observaciones, setObservaciones] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const incluidos = useMemo(
    () => renglones.filter((r) => !excluidos.has(r.demandaId)),
    [renglones, excluidos],
  );

  const alternar = (id: number) =>
    setExcluidos((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  const generar = () => {
    setError(null);
    iniciar(async () => {
      try {
        const r = await generarNotaSat({
          observaciones: observaciones.trim() || undefined,
          cuerpo: cuerpo.trim() !== CUERPO_MODELO_SAT.trim() ? cuerpo.trim() : undefined,
          firma,
          excluirIds: excluidos.size > 0 ? [...excluidos] : undefined,
        });
        router.push(`/expedientes/${r.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo registrar la nota");
        setConfirmando(false);
      }
    });
  };

  return (
    <div className="space-y-4">
      {/* Controles de edición — no salen en la impresión */}
      <div className="panel-vidrio rounded-2xl p-4 print:hidden">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 flex items-center justify-between text-xs font-semibold tracking-wider text-texto-3 uppercase">
              Cuerpo de la nota
              {cuerpo.trim() !== CUERPO_MODELO_SAT.trim() && (
                <button
                  type="button"
                  onClick={() => setCuerpo(CUERPO_MODELO_SAT)}
                  className="flex items-center gap-1 text-[10px] font-semibold text-celeste hover:underline"
                >
                  <RotateCcw size={10} /> volver al texto modelo
                </button>
              )}
            </label>
            <textarea
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              rows={6}
              maxLength={4000}
              className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-celeste/50"
            />
          </div>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold tracking-wider text-texto-3 uppercase">Firma</label>
              <select
                value={firma}
                onChange={(e) => setFirma(e.target.value as FirmaNota)}
                className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-sm outline-none focus:border-celeste/50"
              >
                {(Object.keys(FIRMAS_NOTA) as FirmaNota[]).map((f) => (
                  <option key={f} value={f}>
                    {FIRMAS_NOTA[f]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold tracking-wider text-texto-3 uppercase">
                Párrafo adicional (opcional)
              </label>
              <textarea
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Ej.: Se solicita priorizar los casos con pérdida activa sobre calzada."
                className="w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-2 text-[13px] outline-none placeholder:text-texto-3 focus:border-celeste/50"
              />
            </div>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-texto-3">
          Para dejar un reclamo afuera de la nota, usá el botón de cada renglón del anexo de abajo. El
          reclamo excluido <b className="text-texto-2">sigue abierto</b> (entra en la próxima nota) y la
          exclusión queda registrada en el expediente con tu nombre: se puede sacar del papel, no del
          sistema.
        </p>
      </div>

      {/* El anexo editable: cada renglón se puede excluir con un toque */}
      <div className="print:hidden">
        <p className="mb-2 text-xs font-semibold tracking-wider text-texto-3 uppercase">
          Anexo — {numero(incluidos.length)} incluidos
          {excluidos.size > 0 && <> · {numero(excluidos.size)} excluidos</>}
        </p>
        <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-borde bg-panel p-2">
          {renglones.map((r) => {
            const fuera = excluidos.has(r.demandaId);
            return (
              <div
                key={r.demandaId}
                className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[12px] ${fuera ? "opacity-45" : ""}`}
              >
                <span className="min-w-0 truncate">
                  <b>#{r.demandaId}</b>
                  {r.ticket && <span className="text-texto-3"> · ticket {r.ticket}</span>} ·{" "}
                  {r.direccion ?? "sin dirección"}
                  {fuera && <b className="text-peligro"> — excluido de esta nota</b>}
                </span>
                <button
                  type="button"
                  onClick={() => alternar(r.demandaId)}
                  title={
                    fuera
                      ? "Volver a incluirlo en la nota"
                      : "Dejarlo afuera de esta nota (queda abierto y registrado)"
                  }
                  className={`flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition ${
                    fuera
                      ? "border-celeste/50 text-celeste hover:bg-celeste/10"
                      : "border-borde-2 text-texto-3 hover:border-peligro/50 hover:text-peligro"
                  }`}
                >
                  <EyeOff size={11} /> {fuera ? "incluir" : "excluir"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* La nota, viva: refleja cada edición al instante */}
      <NotaSat
        numero={null}
        destinatario={destinatario}
        observaciones={observaciones.trim() || null}
        renglones={incluidos}
        cuerpo={cuerpo.trim() !== CUERPO_MODELO_SAT.trim() ? cuerpo.trim() : null}
        firma={firma}
      />

      {/* El acto administrativo */}
      {puedeGenerar ? (
        <div className="panel-vidrio mx-auto max-w-3xl rounded-2xl p-5 print:hidden">
          {error && <p className="mb-2 text-center text-xs text-peligro">{error}</p>}
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
            <p className="text-xs text-texto-3">
              Al registrar: la nota queda numerada e inmutable y los <b>{numero(incluidos.length)}</b>{" "}
              reclamos incluidos salen de la cola de bacheo con esa referencia.
              {excluidos.size > 0 && <> Los {numero(excluidos.size)} excluidos siguen abiertos.</>}
            </p>
            {confirmando ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={generar}
                  disabled={pendiente}
                  className="rounded-xl bg-azul px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {pendiente ? "Registrando…" : `Sí, registrar la nota (${numero(incluidos.length)})`}
                </button>
                <button
                  onClick={() => setConfirmando(false)}
                  disabled={pendiente}
                  className="px-2 py-2 text-sm text-texto-3 hover:text-texto"
                >
                  no
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmando(true)}
                className="rounded-xl bg-azul px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
              >
                Generar y registrar la nota
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-center text-xs text-texto-3 print:hidden">
          Registrar la nota es tarea de planificación o atención ciudadana; tu rol solo puede verla.
        </p>
      )}
    </div>
  );
}
