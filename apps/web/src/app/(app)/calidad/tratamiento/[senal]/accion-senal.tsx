"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cambiarDestinoDemanda, derivarAIngenieria, marcarDuplicada, marcarYaResuelta } from "@/lib/acciones-tratamiento";
import type { SenalTratamiento } from "@/lib/tratamiento";
import { mensajeDeError } from "@/lib/errores";

/**
 * El botón de confirmación de cada señal, con doble paso inline (nada de
 * window.confirm: no anda en los webviews). El sistema propone, la persona
 * firma; al confirmar, la fila desaparece de la bandeja con el refresh.
 */
/* punto_dudoso queda afuera como derivar_sat: su acción no es confirmar una
   derivación sino mover el pin, y eso lo hace <MoverAlDomicilio>. */
const ROTULO: Record<
  Exclude<SenalTratamiento, "derivar_sat" | "punto_dudoso">,
  { boton: string; confirmar: (ref: number | null) => string }
> = {
  no_es_bache: { boton: "→ Ingeniería", confirmar: () => "¿Derivar a Ingeniería (pasado de máquina)?" },
  duplicada: { boton: "Duplicada", confirmar: (ref) => `¿Descartar como duplicada del reclamo #${ref}?` },
  ya_resuelta: { boton: "Ya resuelta", confirmar: (ref) => `¿Vincular al incidente #${ref} ya reparado?` },
  /* Va al mismo lugar que "no es bache" —Ingeniería— pero por otro motivo, y
     el rótulo lo dice: no es que el punto esté mal, es que el vecino está
     pidiendo otra cosa. */
  pide_pavimento: {
    boton: "→ Obra nueva",
    confirmar: () => "¿Derivar a Ingeniería como pedido de pavimentación?",
  },
};

/**
 * LA SEÑAL "NO ES BACHE" PUEDE ESTAR MAL. Sale de la red vial, y la red vial
 * tiene cuadras de hormigón marcadas como cordón cuneta (Estados Unidos 1288,
 * 14/10). Si la foto o el que conoce la cuadra dicen que hay pavimento, el
 * pedido vuelve a la cola de Bacheo con el nombre de quien lo decidió, y la
 * señal deja de saltar para ese pedido.
 */
export function HayPavimento({ demandaId }: { demandaId: number }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  const ejecutar = () => {
    setError(null);
    iniciar(async () => {
      try {
        await cambiarDestinoDemanda({
          demandaId,
          destino: "bacheo",
          motivo: "Tratamiento: la cuadra tiene pavimento (la red vial la marca sin pavimentar)",
        });
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo pasar a Bacheo"));
        setConfirmando(false);
      }
    });
  };

  if (confirmando) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="hidden text-[11px] text-texto-3 sm:inline">¿Tiene pavimento? Vuelve a la cola de Bacheo</span>
        <button
          onClick={ejecutar}
          disabled={pendiente}
          className="rounded-lg bg-azul px-2.5 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {pendiente ? "…" : "Sí"}
        </button>
        <button
          onClick={() => setConfirmando(false)}
          disabled={pendiente}
          className="px-1.5 py-1.5 text-xs text-texto-3 hover:text-texto"
        >
          no
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        onClick={() => setConfirmando(true)}
        className="rounded-lg border border-borde-2 px-2.5 py-1.5 text-xs font-semibold text-texto-2 transition hover:border-celeste/60 hover:text-celeste"
        title="La cuadra sí está pavimentada: el pedido es de Bacheo"
      >
        Hay pavimento → Bacheo
      </button>
      {error && <span className="max-w-48 text-right text-[10px] text-peligro">{error}</span>}
    </span>
  );
}

export function AccionSenal({
  senal,
  demandaId,
  referenciaId,
}: {
  senal: Exclude<SenalTratamiento, "derivar_sat" | "punto_dudoso">;
  demandaId: number;
  referenciaId: number | null;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, iniciar] = useTransition();

  /* Duplicada y ya-resuelta necesitan la referencia; sin ella no hay acción
     válida (la señal existe pero el detalle no cargó — caso rarísimo). Las
     otras dos derivan a Ingeniería y no dependen de ninguna referencia. */
  const necesitaReferencia = senal === "duplicada" || senal === "ya_resuelta";
  if (necesitaReferencia && referenciaId == null) return null;

  const ejecutar = () => {
    setError(null);
    iniciar(async () => {
      try {
        if (senal === "no_es_bache" || senal === "pide_pavimento") {
          /* Los dos van a Ingeniería, por motivos distintos: uno porque ahí no
             hay pavimento que parchar, el otro porque el vecino está pidiendo
             que lo haya. El motivo queda escrito en la derivación. */
          await derivarAIngenieria({
            demandaId,
            motivo: senal === "pide_pavimento" ? "pedido_pavimentacion" : undefined,
          });
        }
        else if (senal === "duplicada") await marcarDuplicada({ demandaId, duplicadaDe: referenciaId! });
        else await marcarYaResuelta({ demandaId, incidenteId: referenciaId! });
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo aplicar"));
        setConfirmando(false);
      }
    });
  };

  if (confirmando) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="hidden text-[11px] text-texto-3 sm:inline">{ROTULO[senal].confirmar(referenciaId)}</span>
        <button
          onClick={ejecutar}
          disabled={pendiente}
          className="rounded-lg bg-azul px-2.5 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {pendiente ? "…" : "Sí"}
        </button>
        <button
          onClick={() => setConfirmando(false)}
          disabled={pendiente}
          className="px-1.5 py-1.5 text-xs text-texto-3 hover:text-texto"
        >
          no
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        onClick={() => setConfirmando(true)}
        className="rounded-lg border border-amarillo/40 px-2.5 py-1.5 text-xs font-semibold text-amarillo transition hover:border-amarillo hover:bg-amarillo/10"
      >
        {ROTULO[senal].boton}
      </button>
      {error && <span className="max-w-48 text-right text-[10px] text-peligro">{error}</span>}
    </span>
  );
}
