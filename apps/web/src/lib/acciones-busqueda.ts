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
