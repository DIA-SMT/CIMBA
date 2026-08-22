"use client";

import { Mic, Search, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** API de dictado del navegador (Chrome/Edge la exponen con prefijo webkit). */
interface ReconocimientoVoz {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function crearReconocimiento(): ReconocimientoVoz | null {
  if (typeof window === "undefined") return null;
  const W = window as unknown as Record<string, new () => ReconocimientoVoz>;
  const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = "es-AR";
  r.interimResults = false;
  r.maxAlternatives = 1;
  return r;
}

/**
 * Buscador del mapa en lenguaje natural, escrito o dictado: "¿qué hay
 * reclamado en av. Belgrano?" vuela a la zona, marca las coincidencias y
 * ofrece el análisis. La lógica vive en el mapa; acá solo la caja y el estado.
 */
export function BuscadorMapa({
  alBuscar,
  alLimpiar,
  hayResaltado,
}: {
  alBuscar: (frase: string) => Promise<string>;
  alLimpiar: () => void;
  hayResaltado: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [escuchando, setEscuchando] = useState(false);
  const [hayVoz, setHayVoz] = useState(false);
  const recRef = useRef<ReconocimientoVoz | null>(null);

  useEffect(() => {
    setHayVoz(Boolean(crearReconocimiento()));
  }, []);

  const buscar = async (frase: string) => {
    if (!frase.trim() || buscando) return;
    setBuscando(true);
    setMensaje(null);
    try {
      setMensaje(await alBuscar(frase.trim()));
    } catch {
      setMensaje("La búsqueda falló: probá de nuevo.");
    } finally {
      setBuscando(false);
    }
  };

  const dictar = () => {
    if (escuchando) {
      recRef.current?.stop();
      return;
    }
    const rec = crearReconocimiento();
    if (!rec) return;
    recRef.current = rec;
    rec.onresult = (e) => {
      const frase = e.results[0]?.[0]?.transcript ?? "";
      if (frase) {
        setTexto(frase);
        void buscar(frase);
      }
    };
    rec.onend = () => setEscuchando(false);
    rec.onerror = () => setEscuchando(false);
    setEscuchando(true);
    rec.start();
  };

  const limpiar = () => {
    setTexto("");
    setMensaje(null);
    alLimpiar();
  };

  return (
    <div className="w-[min(300px,calc(100vw-24px))] transition-[width] duration-200 focus-within:w-[min(460px,calc(100vw-24px))]">
      <div className="panel-vidrio flex items-center gap-1.5 rounded-xl px-3 py-0.5">
        <Sparkles size={14} className="shrink-0 text-celeste" />
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void buscar(texto);
          }}
          placeholder={escuchando ? "Escuchando… hablá ahora" : "¿Qué hay reclamado en av. Belgrano?"}
          className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none placeholder:text-texto-3"
        />
        {hayVoz && (
          <button
            onClick={dictar}
            title={escuchando ? "Dejar de escuchar" : "Buscar por voz"}
            className={`shrink-0 rounded-lg p-1.5 transition ${escuchando ? "animate-pulse bg-peligro/20 text-peligro" : "text-texto-2 hover:text-celeste"}`}
          >
            <Mic size={15} />
          </button>
        )}
        <button
          onClick={() => void buscar(texto)}
          disabled={buscando}
          title="Buscar y accionar en el mapa"
          className="shrink-0 rounded-lg bg-azul p-1.5 text-white transition hover:brightness-110 disabled:opacity-50"
        >
          <Search size={15} className={buscando ? "animate-pulse" : ""} />
        </button>
      </div>

      {(mensaje || buscando) && (
        <div className="panel-vidrio mt-1.5 flex items-start gap-2 rounded-xl px-3 py-2 text-xs leading-relaxed">
          <span className="flex-1 text-texto-2">{buscando ? "Interpretando y buscando en el mapa…" : mensaje}</span>
          {!buscando && (
            <button
              onClick={limpiar}
              title={hayResaltado ? "Quitar las marcas del mapa" : "Cerrar"}
              className="shrink-0 rounded p-0.5 text-texto-3 transition hover:text-texto"
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
