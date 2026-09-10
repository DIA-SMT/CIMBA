"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { requerirRol, type Sesion } from "./auth";
import { REGIMEN } from "./certificacion";

/**
 * Acciones de control de calidad y certificación.
 *
 * Quién puede: supervisión (el cuerpo de inspectores es el dueño natural del
 * muestreo y de las actas) y planificación. La empresa NO firma acá: el acta
 * se imprime y se firma en papel — esto registra esa firma, no la reemplaza.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

const inspeccionSchema = z.object({
  intervencionId: z.number().int().positive(),
  momento: z.enum(["24h", "30d", "90d", "6m"]),
  resultado: z.enum(["conforme", "observado"]),
  observaciones: z.string().trim().max(1000).optional(),
});

/**
 * Registra una inspección de calidad. Un hallazgo "observado" no cierra nada
 * solo: queda como antecedente de la reparación, que es lo que el protocolo
 * pide para el régimen de garantía y para futuras adjudicaciones.
 */
export async function registrarInspeccion(entrada: z.infer<typeof inspeccionSchema>) {
  const sesion = await requerirRol("supervision", "planificacion");
  const d = inspeccionSchema.parse(entrada);
  if (d.resultado === "observado" && !d.observaciones) {
    throw new Error("Una inspección observada necesita decir qué se observó");
  }

  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      insert into inspecciones_calidad (intervencion_id, orden_item_id, momento, resultado, observaciones, inspector, geom)
      select ${d.intervencionId}, oi.id, ${d.momento}::momento_inspeccion, ${d.resultado}::resultado_inspeccion,
             ${d.observaciones ?? null}, ${sesion.sub}::uuid, iv.geom_ejecucion
      from intervenciones iv
      left join orden_items oi on oi.intervencion_id = iv.id
      where iv.id = ${d.intervencionId}
      on conflict (intervencion_id, momento) do nothing
    `);
  });
  revalidatePath("/ordenes/certificacion");
  return { ok: true };
}

const actaSchema = z.object({
  empresaId: z.number().int().positive(),
  /** Lo medido en campo, punto por punto: sin esto no hay acta. */
  mediciones: z
    .array(z.object({ itemId: z.number().int().positive(), m2Medido: z.number().min(0).max(100000) }))
    .min(1)
    .max(500),
  firmaInspector: z.string().trim().min(3).max(120),
  firmaContratista: z.string().trim().min(3).max(120),
  observaciones: z.string().trim().max(2000).optional(),
});

/**
 * Arma y firma el acta de medición conjunta. Congela el detalle en
 * acta_items (igual que expediente_demandas: un acta que cambia sola no
 * respalda nada ante una auditoría) y marca los items como certificados.
 *
 * La desviación entre lo informado y lo medido es el número que gobierna el
 * régimen siguiente: por encima del 5% la empresa vuelve a medición total.
 */
export async function firmarActaMedicion(entrada: z.infer<typeof actaSchema>) {
  const sesion = await requerirRol("supervision", "planificacion");
  const d = actaSchema.parse(entrada);

  return conRls(claims(sesion), async (tx) => {
    // Lista IN parametrizada, nunca concatenada: es el idioma del proyecto
    // (ver relevarCircuito) y además evita el bug de serialización de arrays
    // del driver, que rompe con `= any($n::bigint[])`.
    const pedidos = sql.join(d.mediciones.map((m) => sql`${m.itemId}`), sql`, `);
    const items = (await tx.execute(sql`
      select oi.id, oi.direccion, oi.superficie_m2, oi.geom
      from orden_items oi
      join ordenes_trabajo ot on ot.id = oi.orden_id
      where ot.empresa_id = ${d.empresaId}
        and oi.estado = 'hecho' and oi.acta_id is null
        and oi.id in (${pedidos})
    `)) as unknown as Array<{ id: number; direccion: string | null; superficie_m2: number | null }>;
    if (items.length === 0) throw new Error("Ninguno de esos puntos está pendiente de certificar para esta empresa");

    const medidoDe = new Map(d.mediciones.map((m) => [m.itemId, m.m2Medido]));
    const m2Informados = items.reduce((s, i) => s + Number(i.superficie_m2 ?? 0), 0);
    const m2Medidos = items.reduce((s, i) => s + (medidoDe.get(Number(i.id)) ?? 0), 0);
    // La desviación se mide en valor absoluto: medir de menos y medir de más
    // son el mismo problema de confiabilidad del dato.
    const desviacion = m2Informados > 0 ? Math.abs((m2Medidos - m2Informados) / m2Informados) * 100 : 0;

    const anio = new Date().getFullYear();
    const seq = (await tx.execute(sql`
      select count(*)::int + 1 as n from actas_medicion where extract(year from fecha) = ${anio}
    `)) as unknown as Array<{ n: number }>;
    const numero = `ACTA-${anio}-${String(seq[0]?.n ?? 1).padStart(4, "0")}`;

    // Modalidad declarada según el régimen vigente de la empresa.
    const previas = (await tx.execute(sql`
      select min(fecha) as primera, max(desviacion_pct) filter (where fecha = (
        select max(fecha) from actas_medicion where empresa_id = ${d.empresaId} and estado = 'firmada'
      )) as ultima_desv
      from actas_medicion where empresa_id = ${d.empresaId} and estado = 'firmada'
    `)) as unknown as Array<{ primera: string | null; ultima_desv: number | null }>;
    const primera = previas[0]?.primera ? new Date(previas[0].primera) : null;
    const semanas = primera ? (Date.now() - primera.getTime()) / (7 * 24 * 3600 * 1000) : 0;
    const debeSerTotal =
      !primera ||
      semanas < REGIMEN.semanasMedicionTotal ||
      (previas[0]?.ultima_desv != null && Number(previas[0].ultima_desv) > REGIMEN.desviacionQueObligaTotal);

    const acta = (await tx.execute(sql`
      insert into actas_medicion (
        numero, empresa_id, estado, modalidad, puntos_informados, puntos_medidos,
        m2_informados, m2_medidos, desviacion_pct, observaciones,
        firma_inspector, firma_contratista, firmada_en, creada_por
      ) values (
        ${numero}, ${d.empresaId}, 'firmada', ${debeSerTotal ? "total" : "muestreo"},
        ${items.length}, ${d.mediciones.length},
        ${Math.round(m2Informados * 100) / 100}, ${Math.round(m2Medidos * 100) / 100},
        ${Math.round(desviacion * 100) / 100}, ${d.observaciones ?? null},
        ${d.firmaInspector}, ${d.firmaContratista}, now(), ${sesion.sub}::uuid
      ) returning id
    `)) as unknown as Array<{ id: number }>;
    const actaId = acta[0]?.id;
    if (!actaId) throw new Error("No se pudo registrar el acta");

    for (const i of items) {
      await tx.execute(sql`
        insert into acta_items (acta_id, orden_item_id, direccion, m2_informado, m2_medido, geom)
        select ${actaId}, ${i.id}, ${i.direccion}, ${i.superficie_m2}, ${medidoDe.get(Number(i.id)) ?? null}, oi.geom
        from orden_items oi where oi.id = ${i.id}
      `);
    }
    const certificados = sql.join(items.map((i) => sql`${i.id}`), sql`, `);
    await tx.execute(sql`
      update orden_items set acta_id = ${actaId} where id in (${certificados})
    `);

    revalidatePath("/ordenes/certificacion");
    return { numero, desviacion: Math.round(desviacion * 100) / 100, puntos: items.length };
  });
}
