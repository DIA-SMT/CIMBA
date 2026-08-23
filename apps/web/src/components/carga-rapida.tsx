"use client";

import { Mic, Wand2, X } from "lucide-react";
import { useState } from "react";
import { interpretarCarga } from "@/lib/acciones-busqueda";
import { useDictadoVoz } from "@/lib/dictado";
import { ETIQUETA_TIPO } from "@/lib/formato";

export interface CargaInterpretada {
  tipo: string | null;
  direccion: string | null;
  descripcion: string | null;
  punto: { lat: number; lon: number } | null;
}

/**
 * Carga dictada: "Carga bache en Av. Sarmiento 471" completa el formulario
 * (tipo, dirección, descripción) y ubica el punto en el mapa con el
 * geocodificador. El usuario revisa y confirma — nunca se envía solo.
 */
export function CargaRapida({ alAplicar }: { alAplicar: (r: CargaInterpretada) => void }) {
  const [texto, setTexto] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const interpretar = async (frase: string) => {
    if (!frase.trim() || trabajando) return;
    setTrabajando(true);
    setMensaje(null);
    try {
      const { interpretacion: r } = await interpretarCarga(frase.trim());
      let punto: CargaInterpretada["punto"] = null;
      if (r.direccion) {
        try {
          const res = await fetch(`/api/geocodificar?q=${encodeURIComponent(`${r.direccion}, San Miguel de Tucumán`)}`);
          const j = (await res.json()) as { resultado: { punto: { lat: number; lon: number } } | null };
          punto = j.resultado?.punto ?? null;
        } catch {
          punto = null;
        }
      }
      alAplicar({ tipo: r.tipo, direccion: r.direccion, descripcion: r.descripcion, punto });
      const partes = [
        r.tipo ? (ETIQUETA_TIPO[r.tipo as keyof typeof ETIQUETA_TIPO] ?? r.tipo) : null,
        r.direccion ? `en ${r.direccion}` : null,
      ].filter(Boolean);
      setMensaje(
        partes.length === 0
          ? "No entendí la orden: probá con “Carga bache en Av. Sarmiento 471”."
          : punto
            ? `Entendí: ${partes.join(" ")} — ya lo ubiqué en el mapa. Revisá, completá el resto y registrá.`
            : `Entendí: ${partes.join(" ")} — no pude ubicar la dirección: marcá el punto en el mapa.`,
      );
    } finally {
      setTrabajando(false);
    }
  };

  const { hayVoz, escuchando, error: errorVoz, alternar: dictar, limpiarError } = useDictadoVoz((frase) => {
    setTexto(frase);
    void interpretar(frase);
  });

  return (
    <div className="mb-4 rounded-xl border border-celeste/30 bg-celeste/5 p-3">
      <div className="flex items-center gap-2">
        <Wand2 size={15} className="shrink-0 text-celeste" />
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void interpretar(texto);
          }}
          placeholder={escuchando ? "Escuchando… hablá ahora" : "Carga rápida: “Carga bache en Av. Sarmiento 471”"}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-texto-3"
        />
        {hayVoz && (
          <button
            onClick={dictar}
            title={escuchando ? "Dejar de escuchar" : "Dictar la carga por voz"}
            className={`shrink-0 rounded-lg p-2 transition ${escuchando ? "animate-pulse bg-peligro/20 text-peligro" : "text-texto-2 hover:text-celeste"}`}
          >
            <Mic size={16} />
          </button>
        )}
        <button
          onClick={() => void interpretar(texto)}
          disabled={trabajando}
          className="shrink-0 rounded-lg bg-azul px-3 py-1.5 text-xs font-bold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {trabajando ? "Interpretando…" : "Completar"}
        </button>
      </div>
      {(mensaje || errorVoz) && (
        <p className={`mt-2 flex items-start gap-2 text-xs leading-relaxed ${errorVoz ? "text-amarillo" : "text-texto-2"}`}>
          <span className="flex-1">{errorVoz ?? mensaje}</span>
          <button
            onClick={() => {
              setMensaje(null);
              limpiarError();
            }}
            className="shrink-0 text-texto-3 hover:text-texto"
          >
            <X size={12} />
          </button>
        </p>
      )}
    </div>
  );
}
