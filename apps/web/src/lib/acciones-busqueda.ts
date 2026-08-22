"use server";

import { z } from "zod";
import { ESTADOS_DEMANDA, ESTADOS_INCIDENTE, FUENTES_DEMANDA, TIPOS_PROBLEMA } from "@cimba/domain";
import { leerSesion } from "./auth";
import { completarJson, iaDisponible } from "./ia";

export type DestinoBusqueda = "incidentes" | "demandas" | "intervenciones";

/**
 * Búsqueda en lenguaje natural: convierte una frase hablada o escrita
 * ("baches reparados en avenida mate de luna", "qué pidió la SAT este año")
 * en los filtros estructurados de cada listado. Si la IA no está disponible
 * o falla, cae a búsqueda de texto plano sobre la dirección.
 */
const esquemaIncidentes = z
  .object({
    q: z.string().max(80).nullish().catch(null),
    tipo: z.enum(TIPOS_PROBLEMA).nullish().catch(null),
    estado: z.enum(ESTADOS_INCIDENTE).nullish().catch(null),
    orden: z.enum(["prioridad", "fecha"]).nullish().catch(null),
  })
  .catch({ q: null, tipo: null, estado: null, orden: null });

const esquemaDemandas = z
  .object({
    q: z.string().max(80).nullish().catch(null),
    fuente: z.enum(FUENTES_DEMANDA).nullish().catch(null),
    estado: z.enum(ESTADOS_DEMANDA).nullish().catch(null),
  })
  .catch({ q: null, fuente: null, estado: null });

const esquemaIntervenciones = z
  .object({
    q: z.string().max(80).nullish().catch(null),
    estado: z.enum(["asignada", "en_curso", "finalizada", "anulada"]).nullish().catch(null),
  })
  .catch({ q: null, estado: null });

const CONTEXTOS: Record<DestinoBusqueda, { schema: { parse: (v: unknown) => Record<string, string | null | undefined> }; campos: string }> = {
  incidentes: {
    schema: esquemaIncidentes,
    campos: `- q: texto libre para buscar en la DIRECCIÓN (nombre de calle/avenida, sin número si no lo dijo)
- tipo: uno de ${TIPOS_PROBLEMA.join(", ")}
- estado: uno de ${ESTADOS_INCIDENTE.join(", ")} (pistas: "arreglado/reparado"→reparado, "pendiente/sin atender"→detectado, "en obra/trabajando"→en_ejecucion)
- orden: "prioridad" o "fecha" (pistas: "más nuevos/últimos/recientes"→fecha)`,
  },
  demandas: {
    schema: esquemaDemandas,
    campos: `- q: texto libre para buscar en dirección o descripción
- fuente: ${FUENTES_DEMANDA.join(" | ")} (pistas: "concejo/concejal"→hcd, "aguas/SAT"→sat, "vecinos/147"→atencion_ciudadana, "redes/instagram"→redes_sociales)
- estado: ${ESTADOS_DEMANDA.join(" | ")} (pistas: "sin vincular/pendiente"→recibida)`,
  },
  intervenciones: {
    schema: esquemaIntervenciones,
    campos: `- q: texto libre para buscar en la DIRECCIÓN
- estado: asignada | en_curso | finalizada | anulada (pistas: "terminado/hecho/reparado"→finalizada, "trabajando/en obra"→en_curso)`,
  },
};

/** Interpretación para el buscador del mapa: qué marcar y adónde volar. */
export interface InterpretacionMapa {
  lugar: string | null;
  tipo: (typeof TIPOS_PROBLEMA)[number] | null;
  capa: "pedidos" | "trabajos" | "todo" | null;
  brecha: "sin_atencion" | "en_cola" | "posible_resuelta" | null;
}

const esquemaMapa = z
  .object({
    lugar: z.string().max(120).nullish().catch(null),
    tipo: z.enum(TIPOS_PROBLEMA).nullish().catch(null),
    capa: z.enum(["pedidos", "trabajos", "todo"]).nullish().catch(null),
    brecha: z.enum(["sin_atencion", "en_cola", "posible_resuelta"]).nullish().catch(null),
  })
  .catch({ lugar: null, tipo: null, capa: null, brecha: null });

/** Sin IA: nos quedamos con lo que viene después del último " en " (o toda la frase). */
function lugarHeuristico(frase: string): string {
  const limpia = frase.replace(/[¿?¡!.]/g, " ").replace(/\s+/g, " ").trim();
  const idx = ` ${limpia.toLowerCase()} `.lastIndexOf(" en ");
  const cola = idx >= 0 ? limpia.slice(idx + 3).trim() : limpia;
  return cola.replace(/^(la |el |av\.? |avenida |calle |pasaje |pje\.? )/i, "").trim();
}

export async function interpretarBusquedaMapa(
  consulta: string,
): Promise<{ ok: boolean; interpretacion: InterpretacionMapa }> {
  const sesion = await leerSesion();
  const frase = consulta.trim().slice(0, 200);
  const respaldo: InterpretacionMapa = { lugar: lugarHeuristico(frase) || null, tipo: null, capa: null, brecha: null };
  if (!sesion || frase.length < 2) return { ok: false, interpretacion: respaldo };
  if (!iaDisponible()) return { ok: true, interpretacion: respaldo };

  try {
    const r = await completarJson(
      `Convertís frases en español rioplatense en una acción sobre el mapa de bacheo de San Miguel de Tucumán. Respondé SOLO un objeto JSON con estos campos (null si la frase no lo menciona):
- lugar: el nombre distintivo de la calle, avenida, pasaje, esquina o barrio, SIN los prefijos "av", "avenida", "calle" (ej: "¿qué hay reclamado en av. Belgrano?" → "Belgrano"; "esquina de Corrientes y Junín" → "Corrientes"). Sirve para matchear contra direcciones guardadas.
- tipo: uno de ${TIPOS_PROBLEMA.join(", ")} (pistas: "baches/pozos"→bache, "hundido"→hundimiento, "tapa"→tapa_registro, "agua/pérdida"→perdida_agua)
- capa: "pedidos" (reclamos, demandas, lo que pide la gente), "trabajos" (reparaciones, arreglos, obras hechas) o "todo" (ambas). "¿Qué hay reclamado…?"→pedidos; "¿qué se arregló…?"→trabajos.
- brecha: "sin_atencion" (pistas: sin atender, sin respuesta, abandonados), "en_cola" (en proceso), "posible_resuelta" (ya resueltos sin cerrar). Solo si la frase habla de eso.`,
      frase,
      esquemaMapa,
    );
    return {
      ok: true,
      interpretacion: {
        lugar: r.lugar ?? respaldo.lugar,
        tipo: r.tipo ?? null,
        capa: r.capa ?? null,
        brecha: r.brecha ?? null,
      },
    };
  } catch {
    return { ok: true, interpretacion: respaldo };
  }
}

/** Interpretación de una carga dictada: "Carga bache en Av. Sarmiento 471". */
export interface InterpretacionCarga {
  tipo: (typeof TIPOS_PROBLEMA)[number] | null;
  direccion: string | null;
  descripcion: string | null;
}

const esquemaCarga = z
  .object({
    tipo: z.enum(TIPOS_PROBLEMA).nullish().catch(null),
    direccion: z.string().max(200).nullish().catch(null),
    descripcion: z.string().max(500).nullish().catch(null),
  })
  .catch({ tipo: null, direccion: null, descripcion: null });

const TIPO_POR_PALABRA: Array<[RegExp, (typeof TIPOS_PROBLEMA)[number]]> = [
  [/hundimient|hundid/i, "hundimiento"],
  [/tapa|registro/i, "tapa_registro"],
  [/p[eé]rdida|agua|ca[ñn]o/i, "perdida_agua"],
  [/fisura|grieta/i, "fisura"],
  [/sumidero|boca de tormenta/i, "sumidero"],
  [/pavimento|calzada|asfalto/i, "pavimento_deteriorado"],
  [/bache|pozo/i, "bache"],
];

export async function interpretarCarga(
  consulta: string,
): Promise<{ ok: boolean; interpretacion: InterpretacionCarga }> {
  const sesion = await leerSesion();
  const frase = consulta.trim().slice(0, 300);
  const respaldo: InterpretacionCarga = {
    tipo: TIPO_POR_PALABRA.find(([re]) => re.test(frase))?.[1] ?? null,
    direccion: lugarHeuristico(frase) || null,
    descripcion: null,
  };
  if (!sesion || frase.length < 4) return { ok: false, interpretacion: respaldo };
  if (!iaDisponible()) return { ok: true, interpretacion: respaldo };

  try {
    const r = await completarJson(
      `Convertís una orden de carga dictada en español rioplatense en los campos de un pedido de bacheo de San Miguel de Tucumán (ej: "Carga bache en Av. Sarmiento 471", "hay un hundimiento grande en Corrientes al 800, frente a la escuela"). Respondé SOLO un objeto JSON:
- tipo: uno de ${TIPOS_PROBLEMA.join(", ")} (pistas: "pozo"→bache, "tapa"→tapa_registro, "agua/caño roto"→perdida_agua)
- direccion: la dirección COMPLETA como se cargaría (con altura o esquina si la dijo, ej: "Av. Sarmiento 471")
- descripcion: el detalle extra que agregue la frase (tamaño, referencia, urgencia), o null si solo dijo tipo y dirección. No repitas la dirección acá.`,
      frase,
      esquemaCarga,
    );
    return {
      ok: true,
      interpretacion: {
        tipo: r.tipo ?? respaldo.tipo,
        direccion: r.direccion ?? respaldo.direccion,
        descripcion: r.descripcion ?? null,
      },
    };
  } catch {
    return { ok: true, interpretacion: respaldo };
  }
}

export async function interpretarBusqueda(
  destino: DestinoBusqueda,
  consulta: string,
): Promise<{ ok: true; params: Record<string, string> } | { ok: false; error: string }> {
  const sesion = await leerSesion();
  if (!sesion) return { ok: false, error: "Sesión vencida: recargá la página." };
  const frase = consulta.trim().slice(0, 200);
  if (frase.length < 2) return { ok: false, error: "Escribí o dictá qué buscás." };

  const limpiar = (r: Record<string, string | null | undefined>) =>
    Object.fromEntries(Object.entries(r).filter(([, v]) => v != null && v !== "")) as Record<string, string>;

  if (!iaDisponible()) return { ok: true, params: { q: frase } };

  const ctx = CONTEXTOS[destino];
  try {
    const r = await completarJson(
      `Convertís frases en español rioplatense a filtros de búsqueda del listado de ${destino} de un sistema municipal de bacheo (San Miguel de Tucumán). Respondé SOLO un objeto JSON con estos campos (usá null cuando la frase no lo menciona):
${ctx.campos}
No inventes valores fuera de las listas. Si solo hay un lugar, usá q.`,
      frase,
      ctx.schema,
    );
    const params = limpiar(r);
    // Nunca devolver vacío: que al menos busque el texto tal cual.
    return { ok: true, params: Object.keys(params).length > 0 ? params : { q: frase } };
  } catch {
    return { ok: true, params: { q: frase } };
  }
}
