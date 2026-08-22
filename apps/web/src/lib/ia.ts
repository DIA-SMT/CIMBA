import "server-only";
import { z } from "zod";

/**
 * Cruce de datos con IA vía OpenRouter (server-only).
 *
 * Reglas:
 *  - La API key vive SOLO en el servidor (OPENROUTER_API_KEY).
 *  - Al modelo nunca se le envían datos personales (contacto): solo tipo,
 *    descripción, dirección, fechas y agregados.
 *  - Toda respuesta se valida con Zod; si el modelo devuelve cualquier cosa,
 *    la acción falla limpia y no se persiste nada.
 */

const URL_OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";

function configuracion() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY no configurada");
  return { apiKey, modelo: process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5" };
}

export function iaDisponible(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export async function completarJson<T>(
  sistema: string,
  usuario: string,
  schema: { parse: (v: unknown) => T },
): Promise<T> {
  const { apiKey, modelo } = configuracion();
  const res = await fetch(URL_OPENROUTER, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-title": "CIMBA - SMT",
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 900,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sistema },
        { role: "user", content: usuario },
      ],
    }),
  });
  if (!res.ok) {
    const detalle = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(`OpenRouter ${res.status}: ${detalle?.error?.message ?? "error"}`);
  }
  const cuerpo = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const texto = cuerpo.choices?.[0]?.message?.content ?? "";
  const limpio = texto.replace(/^```json?\s*/i, "").replace(/```\s*$/, "").trim();
  return schema.parse(JSON.parse(limpio));
}

// ── Análisis de demanda: clasificación + duplicado semántico ────────────────

export const analisisDemandaSchema = z.object({
  // .catch("otro"): si el modelo inventa un tipo fuera del catálogo (p. ej.
  // "señalización"), degrada a "otro" en vez de romper el análisis.
  tipo_sugerido: z
    .enum([
      "bache", "pavimento_deteriorado", "hundimiento", "fisura",
      "sumidero", "tapa_registro", "perdida_agua", "otro",
    ])
    .catch("otro"),
  confianza_tipo: z.number().min(0).max(1).catch(0.3),
  duplicado_de: z.number().int().nullable().catch(null),
  confianza_duplicado: z.number().min(0).max(1).catch(0),
  razonamiento: z.string().transform((s) => (s.length > 600 ? `${s.slice(0, 599)}…` : s)),
});
export type AnalisisDemanda = z.infer<typeof analisisDemandaSchema>;

export interface DemandaParaIA {
  id: number;
  tipo: string | null;
  descripcion: string | null;
  direccion: string | null;
  fuente: string;
  fecha: string | null;
}

export interface CandidatoParaIA {
  incidenteId: number;
  tipo: string;
  estado: string;
  direccion: string | null;
  distanciaM: number;
  demandasVinculadas: number;
}

export async function analizarDemandaIA(
  demanda: DemandaParaIA,
  candidatos: CandidatoParaIA[],
): Promise<AnalisisDemanda> {
  const sistema = `Sos el asistente de deduplicación de CIMBA, el sistema de bacheo de San Miguel de Tucumán.
Analizás una demanda ciudadana y decidís: (1) el tipo de problema vial, (2) si corresponde al MISMO problema físico que alguno de los incidentes cercanos listados (misma esquina escrita distinto, misma rotura descripta con otras palabras).
Sé conservador: ante la duda, duplicado_de = null. Nunca inventes IDs: duplicado_de debe ser uno de los incidenteId listados o null.
tipo_sugerido debe ser EXACTAMENTE uno de: bache, pavimento_deteriorado, hundimiento, fisura, sumidero, tapa_registro, perdida_agua, otro. Si el problema no encaja en el catálogo (señalización, alumbrado, arbolado…), usá "otro" y explicalo en el razonamiento.
Respondé SOLO un objeto JSON con: tipo_sugerido, confianza_tipo (0-1), duplicado_de (número o null), confianza_duplicado (0-1), razonamiento (breve, en español).`;

  const usuario = JSON.stringify({
    demanda: {
      tipo_declarado: demanda.tipo,
      descripcion: demanda.descripcion,
      direccion: demanda.direccion,
      fuente: demanda.fuente,
      fecha: demanda.fecha,
    },
    incidentes_cercanos: candidatos.map((c) => ({
      incidenteId: c.incidenteId,
      tipo: c.tipo,
      estado: c.estado,
      direccion: c.direccion,
      distancia_metros: Math.round(c.distanciaM),
      demandas_ya_vinculadas: c.demandasVinculadas,
    })),
  });

  const analisis = await completarJson(sistema, usuario, analisisDemandaSchema);
  // Cinturón: el modelo solo puede señalar candidatos reales
  if (analisis.duplicado_de !== null && !candidatos.some((c) => c.incidenteId === analisis.duplicado_de)) {
    return { ...analisis, duplicado_de: null, confianza_duplicado: 0 };
  }
  return analisis;
}

// ── Informe ejecutivo del mapa ───────────────────────────────────────────────

const recortar = (max: number) => z.string().transform((s) => (s.length > max ? `${s.slice(0, max - 1)}…` : s));

export const informeSchema = z.object({
  titulo: recortar(120),
  resumen: recortar(1200),
  focos: z.array(recortar(300)).max(5),
  recomendaciones: z.array(recortar(300)).max(4),
});
export type InformeIA = z.infer<typeof informeSchema>;

export async function generarInformeIA(agregados: Record<string, unknown>): Promise<InformeIA> {
  const sistema = `Sos el analista territorial de CIMBA (bacheo, San Miguel de Tucumán). Recibís agregados del estado actual del territorio (conteos por estado, tipo, fuente, zonas calientes). Escribí un informe ejecutivo corto en español rioplatense, tono profesional municipal, sin inventar números que no estén en los datos.
Respondé SOLO JSON: { "titulo", "resumen" (2-4 frases), "focos" (hasta 5 bullets de UNA frase corta cada uno), "recomendaciones" (hasta 4 acciones concretas de una frase) }.`;
  return completarJson(sistema, JSON.stringify(agregados), informeSchema);
}
