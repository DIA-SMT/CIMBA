"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** API de dictado del navegador (Chrome/Edge la exponen con prefijo webkit). */
interface ReconocimientoVoz {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
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

/** Motivos reales del navegador (SpeechRecognitionErrorEvent.error), en criollo. */
const MENSAJE_ERROR: Record<string, string> = {
  "not-allowed":
    "El navegador bloqueó el micrófono. Buscá el ícono de micrófono/candado en la barra de direcciones, permitilo para este sitio y volvé a intentar.",
  "service-not-allowed":
    "El navegador bloqueó el micrófono. Buscá el ícono de micrófono/candado en la barra de direcciones, permitilo para este sitio y volvé a intentar.",
  "no-speech": "No te escuché nada: acercate al micrófono y hablá apenas apretás el botón.",
  "audio-capture": "No encontré un micrófono en este dispositivo.",
  network:
    "El dictado necesita conexión a internet (usa un servicio externo de reconocimiento) y no se pudo conectar. Si estás en una red de la Municipalidad, puede estar bloqueado.",
  "language-not-supported": "Este navegador no reconoce voz en español.",
};

/**
 * Dictado por voz con la Web Speech API. Devuelve el estado y una función
 * para alternar escuchar/detener; al reconocer una frase llama a
 * `alTranscribir`. Si falla, expone el MOTIVO REAL (permiso denegado, sin
 * micrófono, sin red, silencio) — antes se perdía silenciosamente y el
 * usuario solo veía "Escuchando…" sin que nada pasara nunca.
 */
export function useDictadoVoz(alTranscribir: (frase: string) => void) {
  const [escuchando, setEscuchando] = useState(false);
  const [hayVoz, setHayVoz] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<ReconocimientoVoz | null>(null);

  useEffect(() => {
    setHayVoz(Boolean(crearReconocimiento()));
  }, []);

  const alternar = useCallback(() => {
    if (escuchando) {
      recRef.current?.stop();
      return;
    }
    const rec = crearReconocimiento();
    if (!rec) return;
    recRef.current = rec;
    setError(null);
    let hayResultado = false;
    let motivoError: string | null = null;

    rec.onresult = (e) => {
      const frase = e.results[0]?.[0]?.transcript ?? "";
      if (frase) {
        hayResultado = true;
        alTranscribir(frase);
      }
    };
    rec.onerror = (e) => {
      if (e.error === "aborted") {
        hayResultado = true; // el usuario lo detuvo a propósito: no es una falla
        return;
      }
      motivoError = MENSAJE_ERROR[e.error] ?? `No se pudo usar el micrófono (${e.error}).`;
    };
    rec.onend = () => {
      setEscuchando(false);
      if (!hayResultado) {
        setError(motivoError ?? "No te escuché nada: acercate al micrófono y hablá apenas apretás el botón.");
      }
    };

    setEscuchando(true);
    try {
      rec.start();
    } catch {
      setEscuchando(false);
      setError("No se pudo iniciar el micrófono. Recargá la página y probá de nuevo.");
    }
  }, [escuchando, alTranscribir]);

  return { hayVoz, escuchando, error, alternar, limpiarError: () => setError(null) };
}
