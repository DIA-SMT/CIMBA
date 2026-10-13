"use client";

import { useRef, useState } from "react";
import { BITS_FOTO_REPETIDA, distanciaHuellas } from "@cimba/domain";
import { fechaCorta } from "@/lib/formato";
import { revisarFoto, type AvisoFotoRepetida } from "@/lib/huella-navegador";

/**
 * EL AVISO DE FOTO REPETIDA en los formularios del portal.
 *
 * "Avisa y deja cargar" (Dirección de Bacheo, 12/10): apenas se elige la foto,
 * si ya se usó en otro bache —o si la del antes y la del después son la
 * misma—, la empresa lo ve y puede cambiarla. Si la sube igual, la carga entra
 * y el inspector la ve marcada en «Control de lo cargado». No frena nada.
 */

type Revision = { huella: string | null; usada: AvisoFotoRepetida | null };

/** Revisa cada foto elegida, por cuadro ("antes", "despues"…). */
export function useFotosUsadas() {
  const [revisiones, setRevisiones] = useState<Record<string, Revision>>({});
  /* La última elección de cada cuadro manda: una respuesta lenta de una foto
     ya reemplazada no pisa a la nueva. */
  const turno = useRef<Record<string, number>>({});

  const revisar = (cuadro: string, foto: Blob | null) => {
    const n = (turno.current[cuadro] ?? 0) + 1;
    turno.current[cuadro] = n;
    if (!foto) {
      setRevisiones((v) => {
        const sin = { ...v };
        delete sin[cuadro];
        return sin;
      });
      return;
    }
    void revisarFoto(foto).then((r) => {
      if (turno.current[cuadro] !== n) return;
      setRevisiones((v) => ({ ...v, [cuadro]: r }));
    });
  };

  return { revisiones, revisar };
}

export function AvisosFotoUsada({
  revisiones,
  nombres,
}: {
  revisiones: Record<string, Revision>;
  /** Cómo se dice cada cuadro: { antes: "del antes", despues: "del después" }. */
  nombres: Record<string, string>;
}) {
  const avisos: string[] = [];
  const antes = revisiones.antes?.huella;
  const despues = revisiones.despues?.huella;
  if (antes && despues && distanciaHuellas(antes, despues) <= BITS_FOTO_REPETIDA) {
    avisos.push("La foto del antes y la del después son la misma.");
  }
  for (const [cuadro, r] of Object.entries(revisiones)) {
    if (!r.usada) continue;
    const donde = r.usada.direccion ? ` (${r.usada.direccion})` : "";
    const cuando = r.usada.fecha ? ` del ${fechaCorta(r.usada.fecha)}` : "";
    avisos.push(`La foto ${nombres[cuadro] ?? ""} ya se usó en otro bache${cuando}${donde}.`);
  }
  if (avisos.length === 0) return null;

  return (
    <div className="rounded-xl border border-amarillo/50 bg-amarillo/10 px-3 py-2.5 text-[13px] leading-snug">
      {avisos.map((a) => (
        <b key={a} className="block text-amarillo">
          {a}
        </b>
      ))}
      <span className="text-texto-2">
        Si te equivocaste de foto, tocá el cuadro y cambiala. Si la subís igual, se carga y el inspector la va a
        revisar.
      </span>
    </div>
  );
}
