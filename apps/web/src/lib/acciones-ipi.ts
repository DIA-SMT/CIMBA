"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { requerirRol, type Sesion } from "./auth";
import { recalcularIpi } from "./ipi";

/**
 * Acciones sobre el ranking IPI. Solo planificación (y admin, que la incluye):
 * el índice es el fundamento técnico del Plan de Obras — no lo recalcula ni lo
 * corrige cualquiera.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

/** Vuelve a medir el estado de cada corredor contra la operación y rehace el índice. */
export async function recalcularRankingIpi() {
  const sesion = await requerirRol("planificacion");
  const r = await recalcularIpi(sesion);
  revalidatePath("/ordenes/ipi");
  return r;
}

const ajusteSchema = z.object({
  corredorId: z.number().int().positive(),
  // Factibilidad de ejecución: sin interferencias 100, menores 50, no
  // factible = excluyente (sale del ranking, no puntúa 0).
  factibilidad: z.enum(["sin_interferencias", "menores", "no_factible"]),
  compromiso: z.boolean(),
  motivo: z.string().trim().max(300).optional(),
});

/**
 * La factibilidad y los compromisos no salen de ningún dato: los pone quien
 * planifica, con informe técnico detrás (interferencias verificadas en campo,
 * factibilidades de SAT/EDET/gas, restricciones dominiales). Queda marcado
 * como ajuste manual para que la reconstrucción de corredores no lo pise.
 */
export async function ajustarCorredor(entrada: z.infer<typeof ajusteSchema>) {
  const sesion = await requerirRol("planificacion");
  const d = ajusteSchema.parse(entrada);
  const valor = d.factibilidad === "sin_interferencias" ? 100 : d.factibilidad === "menores" ? 50 : 0;
  const excluido = d.factibilidad === "no_factible";

  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      update corredores set
        v_factibilidad = ${valor},
        excluido = ${excluido},
        motivo_exclusion = ${excluido ? (d.motivo ?? null) : null},
        compromiso = ${d.compromiso},
        metadata = metadata || jsonb_build_object(
          'ajustado_a_mano', jsonb_build_object('por', ${sesion.nombre}, 'en', now()::text)
        )
      where id = ${d.corredorId}
    `);
  });
  await recalcularIpi(sesion);
  revalidatePath("/ordenes/ipi");
  return { ok: true };
}
