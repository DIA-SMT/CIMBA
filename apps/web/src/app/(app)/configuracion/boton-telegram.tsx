"use client";

import { Check, Copy, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { generarCodigoTelegram } from "@/lib/acciones-usuarios";
import { mensajeDeError } from "@/lib/errores";

/**
 * Habilita el bot de Telegram para una persona.
 *
 * Mismo gesto que resetear la clave, y a propósito: emite un código, lo muestra
 * UNA vez, y después solo queda su hash. En claro es una llave para actuar como
 * esa persona en CIMBA.
 *
 * El alta no puede hacerse desde Telegram —ahí cualquiera escribe "soy
 * Fulano"— ni copiando identificadores de chat a mano. Alguien de adentro
 * emite el código, se lo pasa a la persona, y la persona lo canjea mandándoselo
 * al bot. Vence a los 15 minutos.
 */
export function BotonTelegram({ perfilId, nombre }: { perfilId: string; nombre: string }) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [codigo, setCodigo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const generar = () => {
    setError(null);
    startTransition(async () => {
      try {
        const r = await generarCodigoTelegram({ perfilId });
        setCodigo(r.codigo);
        router.refresh();
      } catch (e) {
        setError(mensajeDeError(e, "No se pudo generar el código"));
      }
    });
  };

  const copiar = async () => {
    if (!codigo) return;
    try {
      /* Se copia el mensaje entero y no solo el código: lo que se pega en
         WhatsApp tiene que servir tal cual, sin que nadie tenga que explicar
         qué hacer con esas diez letras. */
      await navigator.clipboard.writeText(
        `Para usar CIMBA por Telegram: buscá @Cimba_smt_bot, mandale /start y después este código:\n\n${codigo}\n\nVence en 15 minutos.`,
      );
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setError("No se pudo copiar solo: seleccionalo y copialo a mano.");
    }
  };

  if (codigo) {
    return (
      <div>
        <div className="flex items-center gap-1.5">
          <code className="num rounded-md border border-celeste/50 bg-celeste/10 px-2 py-0.5 text-xs font-bold tracking-wider text-celeste select-all">
            {codigo}
          </code>
          <button
            onClick={() => void copiar()}
            title="Copiar el mensaje para pasárselo"
            className="rounded-md border border-borde-2 p-1 text-texto-2 transition hover:border-celeste hover:text-celeste"
          >
            {copiado ? <Check size={11} style={{ color: "#199e70" }} /> : <Copy size={11} />}
          </button>
        </div>
        <p className="mt-0.5 text-[10px] text-texto-3">
          {nombre} se lo manda al bot. Vence en 15 min.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        disabled={pendiente}
        onClick={generar}
        title="Genera un código para que esta persona habilite su Telegram"
        className="flex items-center gap-1 rounded-md border border-borde-2 px-2 py-1 text-[10px] font-semibold text-texto-2 transition hover:border-celeste/60 hover:text-celeste disabled:opacity-50"
      >
        <Send size={11} /> {pendiente ? "…" : "Vincular Telegram"}
      </button>
      {error && <p className="mt-0.5 text-[10px] text-peligro">{error}</p>}
    </div>
  );
}
