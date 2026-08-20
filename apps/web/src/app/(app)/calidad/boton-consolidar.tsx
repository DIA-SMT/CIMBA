"use client";

import { GitMerge } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { consolidarAutomaticamente, type ResultadoConsolidacion } from "@/lib/acciones-consolidar";
import { numero } from "@/lib/formato";

export function BotonConsolidar({ vinculables }: { vinculables: number }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [resultado, setResultado] = useState<ResultadoConsolidacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const correr = () => {
    setError(null);
    startTransition(async () => {
      try {
        setResultado(await consolidarAutomaticamente());
        router.refresh();
      } catch {
        setError("La consolidación falló a mitad de camino. Volvé a ejecutarla: es segura de repetir (nunca duplica).");
      }
    });
  };

  return (
    <div className="rounded-xl border border-azul/40 bg-azul/5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="max-w-xl">
          <p className="flex items-center gap-2 text-sm font-bold">
            <GitMerge size={16} className="text-celeste" /> Consolidación automática
          </p>
          <p className="mt-1 text-xs leading-relaxed text-texto-2">
            Vincula solo los casos seguros: misma zona (≤ 25 m), mismo tipo de problema y geocodificación confiable
            (≥ 75%). Agrupa demandas repetidas en un único incidente y recalcula prioridades. Todo queda auditado y es
            reversible (desvincular no borra nada).
          </p>
        </div>
        <button
          onClick={correr}
          disabled={pendiente || vinculables === 0}
          className="rounded-xl bg-azul px-5 py-3 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-40"
        >
          {pendiente ? "Consolidando…" : `Ejecutar consolidación (${numero(vinculables)} aptas)`}
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-peligro">{error}</p>}

      {resultado && (
        <div className="mt-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          <Cifra n={resultado.vinculadasAExistentes} etiqueta="unidas a incidentes existentes" />
          <Cifra n={resultado.incidentesCreados} etiqueta="incidentes nuevos creados" />
          <Cifra n={resultado.demandasAgrupadas} etiqueta="demandas agrupadas entre sí" />
          <Cifra n={resultado.scoresActualizados} etiqueta="prioridades recalculadas" />
          {resultado.gruposPendientes > 0 && (
            <p className="col-span-full text-xs text-amarillo">
              Quedaron {resultado.gruposPendientes} grupos por procesar: ejecutá de nuevo para continuar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Cifra({ n, etiqueta }: { n: number; etiqueta: string }) {
  return (
    <div className="rounded-lg border border-borde bg-panel px-2 py-2.5">
      <div className="num text-lg font-extrabold text-resuelto">{numero(n)}</div>
      <div className="text-[10px] leading-tight text-texto-3">{etiqueta}</div>
    </div>
  );
}
