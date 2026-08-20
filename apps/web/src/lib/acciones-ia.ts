"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { requerirRol } from "./auth";
import { sugerenciasParaDemanda } from "./consultas";
import { analizarDemandaIA, iaDisponible, type AnalisisDemanda } from "./ia";

/**
 * Cruce con IA de una demanda: clasifica el tipo de problema y detecta si es
 * el mismo problema físico que un incidente cercano (duplicado semántico).
 * El resultado queda en demandas.metadata.ia; si la demanda no tenía tipo y la
 * confianza es alta, se completa el tipo. La vinculación SIEMPRE la decide
 * una persona: la IA solo sugiere.
 */
export async function analizarDemandaConIA(entrada: { demandaId: number }): Promise<AnalisisDemanda> {
  const sesion = await requerirRol("atencion_ciudadana", "planificacion");
  const { demandaId } = z.object({ demandaId: z.number().int() }).parse(entrada);
  if (!iaDisponible()) throw new Error("La integración de IA no está configurada (OPENROUTER_API_KEY)");

  const claims = { sub: sesion.sub, rol_cimba: sesion.rol_cimba, id_persona: sesion.id_persona };

  const demanda = await conRls(claims, async (tx) => {
    const filas = (await tx.execute(sql`
      select d.id, d.fuente, d.tipo, d.descripcion,
             coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
             d.creado_en
      from demandas d where d.id = ${demandaId}
    `)) as unknown as Array<Record<string, unknown>>;
    return filas[0] ?? null;
  });
  if (!demanda) throw new Error("Demanda inexistente");

  const sugerencias = await sugerenciasParaDemanda(sesion, demandaId);

  // ⚠ Nunca se envía `contacto` (datos personales) al modelo.
  const analisis = await analizarDemandaIA(
    {
      id: Number(demanda.id),
      tipo: (demanda.tipo as string) ?? null,
      descripcion: (demanda.descripcion as string) ?? null,
      direccion: (demanda.direccion as string) ?? null,
      fuente: String(demanda.fuente),
      fecha: demanda.creado_en != null ? String(demanda.creado_en) : null,
    },
    sugerencias.map((s) => ({
      incidenteId: s.incidenteId,
      tipo: s.tipo,
      estado: s.estado,
      direccion: s.direccion,
      distanciaM: s.distanciaM,
      demandasVinculadas: s.demandasVinculadas,
    })),
  );

  await conRls(claims, async (tx) => {
    await tx.execute(sql`
      update demandas set
        metadata = metadata || jsonb_build_object('ia', ${JSON.stringify({
          ...analisis,
          modelo: process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4.5",
          analizado_en: new Date().toISOString(),
        })}::jsonb),
        tipo = case
          when tipo is null and ${analisis.confianza_tipo} >= 0.8
          then ${analisis.tipo_sugerido}::tipo_problema
          else tipo end
      where id = ${demandaId}
    `);
  });

  revalidatePath(`/demandas/${demandaId}`);
  return analisis;
}
