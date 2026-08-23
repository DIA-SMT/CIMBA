import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { leerSesion } from "@/lib/auth";
import { iaDisponible } from "@/lib/ia";
import { ejecutarHerramientaMigue, HERRAMIENTAS_MIGUE, SISTEMA_MIGUE } from "@/lib/migue";

export const maxDuration = 60;

/**
 * Migue conversacional sobre los datos de bacheo: loop de tool-calling
 * (máx. 5 rondas) contra herramientas de solo lectura. La sesión CIMBA es
 * obligatoria; las consultas corren con los claims del usuario (RLS).
 */

const entradaSchema = z.object({
  mensajes: z
    .array(
      z.object({
        rol: z.enum(["usuario", "migue"]),
        contenido: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30),
});

interface MensajeOR {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export async function POST(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (!iaDisponible()) return NextResponse.json({ error: "IA no configurada" }, { status: 501 });

  const cuerpo = entradaSchema.safeParse(await req.json());
  if (!cuerpo.success) return NextResponse.json({ error: "mensajes inválidos" }, { status: 400 });

  const mensajes: MensajeOR[] = [
    { role: "system", content: SISTEMA_MIGUE },
    ...cuerpo.data.mensajes.slice(-12).map((m) => ({
      role: m.rol === "usuario" ? "user" : "assistant",
      content: m.contenido,
    })),
  ];

  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const modelo = process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5";
  const herramientasUsadas: string[] = [];
  // Si Migue llama accionar_mapa, la frase viaja al navegador y el mapa la
  // ejecuta por el mismo camino que su buscador inteligente.
  let accionMapa: string | null = null;

  try {
    for (let ronda = 0; ronda < 5; ronda++) {
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
      const data = (await res.json()) as {
        choices?: Array<{ message?: MensajeOR & { content?: string } }>;
      };
      const mensaje = data.choices?.[0]?.message;
      if (!mensaje) throw new Error("respuesta vacía del modelo");

      if (mensaje.tool_calls && mensaje.tool_calls.length > 0) {
        mensajes.push({ role: "assistant", content: mensaje.content ?? null, tool_calls: mensaje.tool_calls });
        for (const llamada of mensaje.tool_calls.slice(0, 4)) {
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

      return NextResponse.json({
        respuesta: mensaje.content ?? "…",
        herramientas: [...new Set(herramientasUsadas)],
        ...(accionMapa ? { accionMapa } : {}),
      });
    }
    return NextResponse.json({
      respuesta:
        "Uf, me enredé consultando demasiadas cosas a la vez. ¿Podés preguntármelo de una forma más específica?",
      herramientas: [...new Set(herramientasUsadas)],
      ...(accionMapa ? { accionMapa } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Migue no pudo responder" },
      { status: 502 },
    );
  }
}
