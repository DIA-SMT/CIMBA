import "server-only";
import type { Sesion } from "@/lib/auth";
import { ejecutarHerramientaMigue, HERRAMIENTAS_MIGUE, SISTEMA_MIGUE } from "@/lib/migue";

/**
 * El bucle de Migue, una sola vez para los dos canales.
 *
 * Vivía adentro de /api/migue, que es la puerta del navegador. Cuando apareció
 * el bot de Telegram hubo que elegir entre copiarlo o sacarlo acá: copiado,
 * dos lugares donde arreglar el mismo error y dos Migues que se van
 * pareciendo cada vez menos. El que pregunta cambia; la conversación no.
 *
 * Recibe la sesión por parámetro —no la lee de la cookie— justamente para que
 * sirva a quien llega sin navegador. Las herramientas son todas de lectura y
 * corren con los claims de esa sesión.
 */

export interface MensajeMigue {
  rol: "usuario" | "migue";
  contenido: string;
}

export interface RespuestaMigue {
  respuesta: string;
  herramientas: string[];
  accionMapa?: string;
}

interface MensajeOR {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

/** Cuántas veces puede pedir herramientas antes de tener que contestar. */
const RONDAS = 5;
/** Cuántas herramientas ejecuta por ronda: el resto se descarta. */
const HERRAMIENTAS_POR_RONDA = 4;
/** Sólo los últimos turnos llegan al modelo; lo anterior es peso muerto. */
const TURNOS = 12;

export async function conversarConMigue(
  sesion: Sesion,
  historial: MensajeMigue[],
  sistemaExtra?: string,
): Promise<RespuestaMigue> {
  const mensajes: MensajeOR[] = [
    { role: "system", content: sistemaExtra ? `${SISTEMA_MIGUE}\n\n${sistemaExtra}` : SISTEMA_MIGUE },
    ...historial.slice(-TURNOS).map((m) => ({
      role: m.rol === "usuario" ? "user" : "assistant",
      content: m.contenido,
    })),
  ];

  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const modelo = process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5";
  const herramientasUsadas: string[] = [];
  let accionMapa: string | null = null;

  for (let ronda = 0; ronda < RONDAS; ronda++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "x-title": "CIMBA Migue",
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 1200,
        temperature: 0.3,
        messages: mensajes,
        tools: HERRAMIENTAS_MIGUE,
      }),
    });
    if (!res.ok) {
      const detalle = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(detalle?.error?.message ?? `OpenRouter ${res.status}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: MensajeOR & { content?: string } }> };
    const mensaje = data.choices?.[0]?.message;
    if (!mensaje) throw new Error("respuesta vacía del modelo");

    if (mensaje.tool_calls && mensaje.tool_calls.length > 0) {
      mensajes.push({ role: "assistant", content: mensaje.content ?? null, tool_calls: mensaje.tool_calls });
      for (const llamada of mensaje.tool_calls.slice(0, HERRAMIENTAS_POR_RONDA)) {
        let argumentos: Record<string, unknown> = {};
        try {
          argumentos = JSON.parse(llamada.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          /* argumentos vacíos */
        }
        herramientasUsadas.push(llamada.function.name);
        if (llamada.function.name === "accionar_mapa" && typeof argumentos.frase === "string") {
          accionMapa = argumentos.frase.trim().slice(0, 200) || null;
        }
        let resultado: unknown;
        try {
          resultado = await ejecutarHerramientaMigue(sesion, llamada.function.name, argumentos);
        } catch (e) {
          resultado = { error: e instanceof Error ? e.message.slice(0, 200) : "error de consulta" };
        }
        mensajes.push({
          role: "tool",
          tool_call_id: llamada.id,
          content: JSON.stringify(resultado).slice(0, 12_000),
        });
      }
      continue;
    }

    return {
      respuesta: mensaje.content ?? "…",
      herramientas: [...new Set(herramientasUsadas)],
      ...(accionMapa ? { accionMapa } : {}),
    };
  }

  return {
    respuesta:
      "Uf, me enredé consultando demasiadas cosas a la vez. ¿Podés preguntármelo de una forma más específica?",
    herramientas: [...new Set(herramientasUsadas)],
    ...(accionMapa ? { accionMapa } : {}),
  };
}
