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
  maxTokens = 900,
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
      max_tokens: maxTokens,
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

/** Si el modelo se entusiasma y manda bullets de más, se recortan en vez de
 *  tirar el informe entero (un .max() acá haría fallar todo el pedido). */
const bullets = (max: number) => z.array(recortar(300)).transform((a) => a.slice(0, max));

export const informeSchema = z.object({
  titulo: recortar(120),
  resumen: recortar(1200),
  focos: bullets(6),
  recomendaciones: bullets(4),
});
export type InformeIA = z.infer<typeof informeSchema>;

/** Segmento opcional del informe: en vez de informar TODO el territorio,
 *  recorta a una fuente, un distrito, un destino de resolución o un tipo. */
export interface SegmentoInforme {
  dimension: "fuente" | "distrito" | "destino" | "tipo";
  valor: string;
}

export async function generarInformeIA(
  agregados: Record<string, unknown>,
  segmento?: SegmentoInforme | null,
): Promise<InformeIA> {
  const sistema = `Sos el analista territorial de CIMBA (bacheo, San Miguel de Tucumán). Recibís agregados del territorio: los visibles en el mapa y los calculados en el servidor (deuda_que_quema, deuda_por_destino, pedidos por origen, trabajo_hecho). Escribí un informe ejecutivo corto en español rioplatense, tono profesional municipal.

REGLAS (en orden de importancia):
1. DEUDA QUE QUEMA: los focos salen de "deuda_que_quema", que ya viene ordenada por score_prioridad (pondera antigüedad del pedido, reclamos detrás y si está sobre avenida primaria/secundaria o corredor de colectivos). NUNCA priorices por cantidad bruta de veces pedido: un bache de 300 días sobre una avenida quema más que diez pedidos nuevos en una cortada. En cada foco decí POR QUÉ quema (días abierto, reclamos, corredor).
2. SEPARAR POR DESTINO: cada foco empieza con su etiqueta entre corchetes: [BACHEO], [SAT], [INGENIERÍA] o [GENERAL] si aplica a todo (destino null o sin_clasificar cuenta como [BACHEO] salvo dato en contra). La deuda de la SAT o de ingeniería NO es deuda de bacheo: si hay volumen que pertenece a otra área, decilo explícito en el resumen para que no se le impute al área equivocada.
3. VECINAL vs INTERNO: el resumen SIEMPRE informa los dos totales de "pedidos" — vecinales (atención ciudadana, redes, HCD, SAT) e internos (cuadrilla, secretaría, carga manual, BachIA) — y cuánto del trabajo terminado se hizo SIN denuncia vecinal ("trabajo_hecho.sin_pedido_vecinal"): ese número muestra el volumen de trabajo de oficio.
4. Si viene "segmento", el informe es SOLO de ese recorte: el título lo nombra y no saques conclusiones de datos de afuera del segmento ("contexto_global" es solo para dimensionar, no para focos).
5. No inventes números que no estén en los datos. Si un agregado viene vacío, decilo sin dramatizar.

Respondé SOLO JSON: { "titulo", "resumen" (3-5 frases), "focos" (hasta 6 bullets de UNA frase corta cada uno, etiquetados por destino), "recomendaciones" (hasta 4 acciones concretas de una frase) }.`;
  const datos = segmento ? { segmento, ...agregados } : agregados;
  return completarJson(sistema, JSON.stringify(datos), informeSchema, 1400);
}
