"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { TIPOS_INTERVENCION, type TipoIntervencion } from "@cimba/domain";
import { corregirTipoIntervencion } from "@/lib/acciones-ordenes";
import { ETIQUETA_TIPO_INTERVENCION } from "./tipos-intervencion";

/**
 * Select inline para corregir CÓMO se resolvió un item ya reportado — "capaz
 * que empieza como bacheo y al final se ha hecho cambio de paño". Optimista:
 * muestra el valor nuevo al toque y, si la acción falla, vuelve al anterior.
 */
export function SelectTipoIntervencion({
  intervencionId,
  tipo,
}: {
  intervencionId: number;
  tipo: TipoIntervencion;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [valor, setValor] = useState<TipoIntervencion>(tipo);
  const [error, setError] = useState<string | null>(null);

  const cambiar = (nuevo: TipoIntervencion) => {
    const anterior = valor;
    setValor(nuevo);
    setError(null);
    startTransition(async () => {
      try {
        await corregirTipoIntervencion({ intervencionId, tipo: nuevo });
        router.refresh();
      } catch (e) {
        setValor(anterior);
        setError(e instanceof Error ? e.message : "No se pudo corregir");
      }
    });
  };

  return (
    <span className="inline-flex flex-col gap-0.5">
      <select
        value={valor}
        disabled={pendiente}
        onChange={(e) => cambiar(e.target.value as TipoIntervencion)}
        title="Corregir cómo se resolvió realmente este punto"
        className="rounded-md border border-borde-2 bg-panel-2 px-1.5 py-1 text-xs disabled:opacity-50"
      >
        {TIPOS_INTERVENCION.map((t) => (
          <option key={t} value={t}>
            {ETIQUETA_TIPO_INTERVENCION[t]}
          </option>
        ))}
      </select>
      {error && <span className="text-[10px] text-peligro">{error}</span>}
    </span>
  );
}
