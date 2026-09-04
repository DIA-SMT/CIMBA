"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PRIORIDADES_VIALES, type PrioridadVial } from "@cimba/domain";
import { asignarCircuito } from "@/lib/acciones-ordenes";
import { ETIQUETA_PRIORIDAD } from "./etiquetas";

/**
 * Las dos celdas editables de la fila de circuito: prioridad y empresa.
 * Se editan inline (sin pantalla aparte) porque el pedido del Director es
 * literalmente "dar prioridades y ver qué empresa lo trabaja" recorriendo
 * la tabla de arriba a abajo.
 */
export function AsignacionCircuito({
  circuitoId,
  prioridad,
  empresaId,
  empresas,
}: {
  circuitoId: number;
  prioridad: PrioridadVial | null;
  empresaId: number | null;
  empresas: Array<{ id: number; nombre: string }>;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Se manda SOLO el campo tocado: asignarCircuito conserva el otro.
  const cambiar = (cambios: { prioridad?: string | null; empresaId?: number | null }) => {
    setError(null);
    startTransition(async () => {
      try {
        await asignarCircuito({ circuitoId, ...cambios });
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudo guardar");
      }
    });
  };

  const claseSelect =
    "w-full max-w-36 rounded-md border border-borde-2 bg-panel-2 px-2 py-2 text-xs disabled:opacity-50 sm:py-1";

  return (
    <>
      <td className="px-3 py-2">
        <select
          value={prioridad ?? ""}
          disabled={pendiente}
          onChange={(e) => cambiar({ prioridad: e.target.value || null })}
          className={claseSelect}
          title="Prioridad vial del circuito"
        >
          <option value="">— sin prioridad —</option>
          {PRIORIDADES_VIALES.map((p) => (
            <option key={p} value={p}>
              {ETIQUETA_PRIORIDAD[p]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <select
          value={empresaId ?? ""}
          disabled={pendiente}
          onChange={(e) => cambiar({ empresaId: e.target.value ? Number(e.target.value) : null })}
          className={claseSelect}
          title="Empresa contratista asignada al circuito"
        >
          <option value="">— sin empresa —</option>
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre}
            </option>
          ))}
        </select>
        {error && <p className="mt-1 text-[11px] text-peligro">{error}</p>}
      </td>
    </>
  );
}
