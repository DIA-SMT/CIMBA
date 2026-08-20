"use client";

import Image from "next/image";
import { Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Mensaje {
  rol: "usuario" | "migue";
  contenido: string;
  herramientas?: string[];
}

/** Render mínimo: **texto** → negrita real (sin librerías de markdown). */
function ConNegritas({ texto }: { texto: string }) {
  const partes = texto.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {partes.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-bold">{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

const SUGERENCIAS = [
  "¿Cuál es el panorama general del bacheo hoy?",
  "¿Cuáles son las zonas más reclamadas?",
  "¿Dónde hay reincidencias de baches ya reparados?",
  "¿Cuántos m² hizo cada contratista?",
];

/** Migue — el asistente municipal, especializado en bacheo — flotante en toda la app. */
export function MigueChat() {
  const [abierto, setAbierto] = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, pensando]);

  const enviar = async (contenido: string) => {
    const limpio = contenido.trim();
    if (!limpio || pensando) return;
    const nuevos: Mensaje[] = [...mensajes, { rol: "usuario", contenido: limpio }];
    setMensajes(nuevos);
    setTexto("");
    setPensando(true);
    try {
      const res = await fetch("/api/migue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mensajes: nuevos.map(({ rol, contenido }) => ({ rol, contenido })) }),
      });
      const data = (await res.json()) as { respuesta?: string; herramientas?: string[]; error?: string };
      setMensajes((m) => [
        ...m,
        {
          rol: "migue",
          contenido: data.respuesta ?? `Perdón, tuve un problema: ${data.error ?? "error desconocido"}. Probá de nuevo.`,
          herramientas: data.herramientas,
        },
      ]);
    } catch {
      setMensajes((m) => [...m, { rol: "migue", contenido: "Se me cortó la conexión. ¿Probás de nuevo?" }]);
    } finally {
      setPensando(false);
    }
  };

  return (
    <>
      {/* Botón flotante */}
      {!abierto && (
        <button
          onClick={() => setAbierto(true)}
          className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full border border-celeste/40 bg-panel-2 py-2 pr-4 pl-2 shadow-2xl transition hover:border-celeste hover:shadow-celeste/20"
          title="Preguntale a Migue sobre los datos de bacheo"
        >
          <Image src="/marca/migue.png" alt="Migue" width={36} height={36} className="rounded-full" />
          <span className="text-sm font-semibold">Migue</span>
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-resuelto" />
        </button>
      )}

      {/* Panel de chat */}
      {abierto && (
        <div className="panel-vidrio fixed right-4 bottom-4 z-40 flex h-[540px] w-[380px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-borde bg-panel-2/60 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Image src="/marca/migue.png" alt="Migue" width={34} height={34} className="rounded-full" />
              <div className="leading-tight">
                <div className="text-sm font-bold">Migue</div>
                <div className="flex items-center gap-1.5 text-[10px] text-texto-3">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-resuelto" />
                  Online · experto en bacheo y asfalto
                </div>
              </div>
            </div>
            <button onClick={() => setAbierto(false)} className="text-texto-3 hover:text-texto">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {mensajes.length === 0 && (
              <div className="space-y-2">
                <p className="px-1 text-[13px] text-texto-2">
                  ¡Hola! Soy Migue 👋 Preguntame lo que quieras sobre los datos de bacheo de la ciudad: demandas,
                  incidentes, obras, zonas críticas…
                </p>
                {SUGERENCIAS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void enviar(s)}
                    className="block w-full rounded-lg border border-borde-2 bg-panel-2 px-3 py-2 text-left text-xs text-texto-2 transition hover:border-celeste/50 hover:text-texto"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {mensajes.map((m, i) => (
              <div key={i} className={`flex ${m.rol === "usuario" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed whitespace-pre-wrap ${
                    m.rol === "usuario"
                      ? "rounded-br-sm bg-azul text-white"
                      : "rounded-bl-sm border border-borde bg-panel-2 text-texto"
                  }`}
                >
                  <ConNegritas texto={m.contenido} />
                  {m.herramientas && m.herramientas.length > 0 && (
                    <div className="mt-1.5 text-[9px] text-texto-3">
                      consultó: {m.herramientas.join(", ").replaceAll("_", " ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {pensando && (
              <div className="flex items-center gap-2 px-1 text-xs text-texto-3">
                <Image src="/marca/migue.png" alt="" width={20} height={20} className="animate-pulse rounded-full" />
                Migue está consultando la base…
              </div>
            )}
            <div ref={finRef} />
          </div>

          <div className="border-t border-borde p-2.5">
            <div className="flex items-center gap-2">
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && void enviar(texto)}
                placeholder="Preguntale a Migue…"
                className="flex-1 rounded-xl border border-borde-2 bg-panel-2 px-3 py-2.5 text-[13px] outline-none placeholder:text-texto-3 focus:border-celeste/50"
              />
              <button
                onClick={() => void enviar(texto)}
                disabled={pensando || texto.trim().length === 0}
                className="rounded-xl bg-azul p-2.5 text-white transition hover:brightness-110 disabled:opacity-40"
              >
                <Send size={15} />
              </button>
            </div>
            <p className="mt-1.5 text-center text-[9px] text-texto-3">
              Responde solo con datos reales de la base · sin datos personales
            </p>
          </div>
        </div>
      )}
    </>
  );
}
