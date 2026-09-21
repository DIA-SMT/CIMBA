"use client";

import { ChevronRight, FileSignature, HelpCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { OrdenResumen } from "@/lib/ordenes";
import { numero } from "@/lib/formato";
import { Panel } from "@/components/ui";
import { FormularioLibre } from "./formulario-libre";

/**
 * "¿DE QUÉ ORDEN ES ESTE BACHE?" — la pregunta que faltaba.
 *
 * Calleri cargó 90 baches como "puntos sueltos" mientras trabajaba la
 * OT-2026-0006. No fue descuido: la portada tenía un botón grande y azul que
 * decía "Cargar sin orden" y las órdenes debajo. La pantalla le pedía que lo
 * hiciera así.
 *
 * Ahora la carga arranca preguntando a qué orden pertenece el trabajo. Si la
 * empresa tiene órdenes activas, esas son las opciones; el bache entra a la
 * orden como propuesto y Bacheo lo valida, que es el circuito normal. "No es
 * de ninguna orden" queda al final, explicado, y pide decir por qué: es la
 * excepción —una urgencia, un pedido directo de un inspector— y tiene que
 * costar una frase, no un toque.
 *
 * Sin órdenes activas la pregunta no tiene sentido y se pasa derecho al
 * formulario libre.
 */
export function ElegirOrden({
  activas,
  empresaId,
  sufijoEspejo,
}: {
  activas: OrdenResumen[];
  empresaId: number | null;
  sufijoEspejo: string;
}) {
  const [sinOrden, setSinOrden] = useState(activas.length === 0);

  if (sinOrden) {
    return (
      <div>
        {activas.length > 0 && (
          <Panel className="mb-4 border-amarillo/40 bg-amarillo/5 p-4 text-sm leading-relaxed text-texto-2">
            <b className="text-amarillo">Ojo:</b> esto NO va a entrar en ninguna de tus{" "}
            {numero(activas.length)} órdenes activas ni en su certificación. Si el bache lo tapaste
            trabajando una orden,{" "}
            <button
              type="button"
              onClick={() => setSinOrden(false)}
              className="font-bold text-celeste underline"
            >
              volvé y elegí la orden
            </button>
            .
          </Panel>
        )}
        <FormularioLibre empresaId={empresaId} exigirMotivo={activas.length > 0} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-texto-2">
        Elegí la orden en la que estás trabajando. El bache entra ahí, Bacheo lo valida y se
        certifica con el resto.
      </p>
      {activas.map((o) => (
        <Link
          key={o.id}
          href={`/empresa/orden/${o.id}?proponer=1${sufijoEspejo ? `&${sufijoEspejo.slice(1)}` : ""}`}
          className="block"
        >
          <Panel className="flex items-center gap-3 p-4 transition active:scale-[0.99]">
            <FileSignature size={22} className="shrink-0 text-celeste" />
            <span className="min-w-0 flex-1">
              <span className="num block text-lg font-extrabold">{o.numero}</span>
              <span className="block truncate text-sm text-texto-2">
                {o.titulo ?? o.ambitoNombre ?? "Sin título"}
                {" · "}
                <span className="num">
                  {numero(o.hechos)} de {numero(o.enPlan)} hechos
                </span>
              </span>
            </span>
            <ChevronRight size={20} className="shrink-0 text-texto-3" />
          </Panel>
        </Link>
      ))}

      <button
        type="button"
        onClick={() => setSinOrden(true)}
        className="flex w-full items-center gap-3 rounded-xl border border-dashed border-borde-2 px-4 py-3 text-left text-sm text-texto-2 transition hover:border-celeste/60"
      >
        <HelpCircle size={18} className="shrink-0 text-texto-3" />
        <span>
          <span className="block font-semibold">No es de ninguna orden</span>
          <span className="block text-xs text-texto-3">
            Una urgencia o un pedido directo de un inspector. Queda marcado aparte.
          </span>
        </span>
      </button>
    </div>
  );
}
