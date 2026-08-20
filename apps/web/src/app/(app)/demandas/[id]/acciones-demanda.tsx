"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { crearIncidenteDesdeDemanda, descartarDemanda, vincularDemanda } from "@/lib/acciones";
import type { SugerenciaIncidente } from "@/lib/consultas";
import { ETIQUETA_ESTADO_INCIDENTE, ETIQUETA_TIPO } from "@/lib/formato";
import { BadgeEstadoIncidente, Panel } from "@/components/ui";

export function AccionesDemanda({
  demandaId,
  estado,
  tieneUbicacion,
  sugerencias,
  puedeGestionar,
}: {
  demandaId: number;
  estado: string;
  tieneUbicacion: boolean;
  sugerencias: SugerenciaIncidente[];
  puedeGestionar: boolean;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");

  const ejecutar = (fn: () => Promise<unknown>) => {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error inesperado");
      }
    });
  };

  const yaVinculada = estado === "vinculada" || estado === "descartada";

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-peligro/40 bg-peligro/10 px-4 py-3 text-sm text-peligro">{error}</div>
      )}

      {sugerencias.length > 0 ? (
        <Panel className="divide-y divide-borde/60">
          {sugerencias.map((s) => (
            <div key={s.incidenteId} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">#{s.incidenteId}</span>
                  <BadgeEstadoIncidente estado={s.estado} />
                  {s.esReincidencia && (
                    <span className="rounded bg-amarillo/15 px-1.5 py-0.5 text-[10px] font-bold text-amarillo">
                      REINCIDENCIA
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-texto-2">
                  {s.direccion ?? ETIQUETA_TIPO[s.tipo]} · {ETIQUETA_TIPO[s.tipo]} · {s.demandasVinculadas} demanda(s)
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="num text-sm font-bold text-celeste">{s.distanciaM.toFixed(0)} m</div>
                  <div className="num text-[10px] text-texto-3">score {s.score.toFixed(2)}</div>
                </div>
                {puedeGestionar && !yaVinculada && (
                  <button
                    disabled={pendiente}
                    onClick={() => ejecutar(() => vincularDemanda({ demandaId, incidenteId: s.incidenteId, confianza: s.score }))}
                    className="rounded-lg border border-celeste/50 bg-celeste/10 px-3 py-1.5 text-xs font-semibold text-celeste transition hover:bg-celeste/20 disabled:opacity-50"
                  >
                    Vincular
                  </button>
                )}
              </div>
            </div>
          ))}
        </Panel>
      ) : (
        <Panel className="px-4 py-6 text-center text-sm text-texto-3">
          {tieneUbicacion
            ? "No hay incidentes abiertos ni recientes a menos de 40 m. Es un problema nuevo."
            : "La demanda no tiene ubicación válida: corregí el punto antes de vincular."}
        </Panel>
      )}

      {puedeGestionar && !yaVinculada && (
        <div className="flex flex-wrap items-center gap-3">
          {tieneUbicacion && (
            <button
              disabled={pendiente}
              onClick={() => ejecutar(() => crearIncidenteDesdeDemanda({ demandaId }))}
              className="rounded-lg bg-azul px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              Crear incidente nuevo
            </button>
          )}
          <div className="flex items-center gap-2">
            <input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Motivo de descarte…"
              className="w-48 rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-sm placeholder:text-texto-3"
            />
            <button
              disabled={pendiente || motivo.trim().length < 3}
              onClick={() => ejecutar(() => descartarDemanda({ demandaId, motivo }))}
              className="rounded-lg border border-peligro/40 px-3 py-2 text-sm font-semibold text-peligro transition hover:bg-peligro/10 disabled:opacity-40"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {yaVinculada && (
        <p className="text-sm text-texto-3">
          Esta demanda ya fue {estado === "vinculada" ? "vinculada a un incidente" : "descartada"}.
        </p>
      )}
    </div>
  );
}
