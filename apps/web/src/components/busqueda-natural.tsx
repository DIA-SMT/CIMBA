"use client";

import { Mic, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { interpretarBusqueda, type DestinoBusqueda } from "@/lib/acciones-busqueda";
import { useDictadoVoz } from "@/lib/dictado";

/**
 * Búsqueda en lenguaje natural, escrita o dictada: "baches reparados en
 * mate de luna", "lo que pidió el concejo", "trabajos en curso en barrio sur".
 * La IA la convierte en filtros del listado; sin IA cae a búsqueda de texto.
 */
export function BusquedaNatural({
  destino,
  ejemplo,
  inicial = "",
}: {
  destino: DestinoBusqueda;
  ejemplo: string;
  inicial?: string;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(inicial);
  const [pendiente, startTransition] = useTransition();

  const buscar = (consulta: string) => {
    const frase = consulta.trim();
    if (!frase) {
      router.push(`/${destino}`);
      return;
    }
    startTransition(async () => {
      const r = await interpretarBusqueda(destino, frase);
      const params = new URLSearchParams(r.ok ? r.params : { q: frase });
      router.push(`/${destino}?${params.toString()}`);
    });
  };

  const { hayVoz, escuchando, error: errorVoz, alternar: dictar } = useDictadoVoz((frase) => {
    setTexto(frase);
    buscar(frase);
  });

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 rounded-xl border border-borde-2 bg-panel-2 px-3 py-1 focus-within:border-celeste/60">
        <Sparkles size={15} className="shrink-0 text-celeste" />
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") buscar(texto);
          }}
          placeholder={escuchando ? "Escuchando… hablá ahora" : `Buscá con tus palabras: "${ejemplo}"`}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none placeholder:text-texto-3"
        />
        {hayVoz && (
          <button
            onClick={dictar}
            title={escuchando ? "Dejar de escuchar" : "Buscar por voz (micrófono)"}
            className={`shrink-0 rounded-lg p-2 transition ${escuchando ? "animate-pulse bg-peligro/20 text-peligro" : "text-texto-2 hover:bg-panel-3 hover:text-celeste"}`}
          >
            <Mic size={16} />
          </button>
        )}
        <button
          onClick={() => buscar(texto)}
          disabled={pendiente}
          title="Buscar"
          className="shrink-0 rounded-lg bg-azul p-2 text-white transition hover:brightness-110 disabled:opacity-50"
        >
          <Search size={16} className={pendiente ? "animate-pulse" : ""} />
        </button>
      </div>
      <p className={`mt-1 text-[10px] ${errorVoz ? "text-amarillo" : "text-texto-3"}`}>
        {pendiente
          ? "Interpretando la búsqueda…"
          : errorVoz ?? "Entiende calles, tipos y estados: los filtros de abajo se completan solos."}
      </p>
    </div>
  );
}
