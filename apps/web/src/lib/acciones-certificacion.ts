"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { requerirRol, type Sesion } from "./auth";
import { desviacionPct, sortearMuestra } from "@cimba/domain";
import { REGIMEN } from "./certificacion";
import { ErrorVisible } from "./errores";

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
    throw new ErrorVisible("Una inspección observada necesita decir qué se observó");
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
  /** Los puntos que entran en el acta: TODOS se certifican con ella. */
  itemIds: z.array(z.number().int().positive()).min(1).max(1000),
  /** Lo medido en campo: todos (medición total) o al menos la muestra sorteada. */
  mediciones: z
    .array(z.object({ itemId: z.number().int().positive(), m2Medido: z.number().min(0).max(100000) }))
    .max(1000),
  firmaInspector: z.string().trim().min(3).max(120),
  firmaContratista: z.string().trim().min(3).max(120),
  observaciones: z.string().trim().max(2000).optional(),
});

/** El día de hoy en Tucumán, 'YYYY-MM-DD': la fecha del acta y la semilla del sorteo. */
const hoyTucuman = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Tucuman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/**
 * ARMA Y FIRMA EL ACTA DE MEDICIÓN CONJUNTA.
 *
 * Congela el detalle en acta_items (igual que expediente_demandas: un acta que
 * cambia sola no respalda nada ante una auditoría) y marca los puntos como
 * certificados.
 *
 * Lo que cambió el 13/10, cuando el acta tuvo pantalla por primera vez:
 * - TODOS los puntos que entran quedan certificados. Antes el acta solo
 *   tomaba los medidos, así que en régimen de muestreo el 80% que no salía
 *   sorteado no se certificaba nunca. Los medidos se certifican por lo medido;
 *   los no sorteados, por lo informado.
 * - El servidor rehace el sorteo y exige que la muestra esté medida entera: la
 *   pantalla propone, pero lo que cuenta lo decide esto.
 * - El número sale con un candado: el "count(*) + 1" suelto ya había roto dos
 *   veces la numeración de las órdenes, y acá estaba igual.
 *
 * La desviación se mide sobre los puntos medidos y es la que gobierna el
 * régimen siguiente: por encima del 5% la empresa vuelve a medición total.
 */
export async function firmarActaMedicion(entrada: z.infer<typeof actaSchema>) {
  const sesion = await requerirRol("supervision", "planificacion");
  const d = actaSchema.parse(entrada);
  const fecha = hoyTucuman();

  const resultado = await conRls(claims(sesion), async (tx) => {
    // Dos actas de la misma empresa a la vez no pueden certificar dos veces el
    // mismo punto: la segunda espera y encuentra los puntos ya con acta.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"acta-empresa-" + d.empresaId}))`);

    // Lista IN parametrizada, nunca concatenada: es el idioma del proyecto
    // (ver relevarPedidos en acciones-ordenes.ts) y además evita el bug de
    // serialización de arrays del driver, que rompe con `= any($n::bigint[])`.
    const pedidos = sql.join(d.itemIds.map((id) => sql`${id}`), sql`, `);
    const items = (await tx.execute(sql`
      select oi.id, oi.direccion, coalesce(oi.superficie_m2, 0) as superficie_m2
      from orden_items oi
      join ordenes_trabajo ot on ot.id = oi.orden_id
      where ot.empresa_id = ${d.empresaId}
        and oi.estado = 'hecho' and oi.acta_id is null
        and oi.id in (${pedidos})
      for update of oi
    `)) as unknown as Array<{ id: number; direccion: string | null; superficie_m2: number }>;
    if (items.length === 0) throw new ErrorVisible("Ninguno de esos puntos está pendiente de certificar para esta empresa");
    if (items.length < new Set(d.itemIds).size) {
      throw new ErrorVisible(
        `${new Set(d.itemIds).size - items.length} de los puntos elegidos ya no están para certificar (se certificaron o se dieron de baja). Volvé a abrir el acta.`,
      );
    }

    // El régimen vigente de la empresa: total o muestreo.
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

    // Lo medido, solo de los puntos que entran.
    const ids = new Set(items.map((i) => Number(i.id)));
    const medidoDe = new Map(d.mediciones.filter((m) => ids.has(m.itemId)).map((m) => [m.itemId, m.m2Medido]));
    const semilla = `${fecha}:${d.empresaId}`;
    const exigidos = debeSerTotal ? [...ids] : sortearMuestra([...ids], semilla, REGIMEN.muestreoMinimoPct);
    const faltan = exigidos.filter((id) => !medidoDe.has(id));
    if (faltan.length > 0) {
      throw new ErrorVisible(
        debeSerTotal
          ? `Esta empresa está en medición total: faltan medir ${faltan.length} de los ${ids.size} puntos.`
          : `Faltan medir ${faltan.length} de los ${exigidos.length} puntos sorteados para la muestra.`,
      );
    }

    const medidos = items
      .filter((i) => medidoDe.has(Number(i.id)))
      .map((i) => ({ informado: Number(i.superficie_m2), medido: medidoDe.get(Number(i.id))! }));
    const desviacion = desviacionPct(medidos);
    const m2Informados = items.reduce((s, i) => s + Number(i.superficie_m2), 0);
    // Lo que se certifica: lo medido donde se midió, lo informado donde no.
    const m2Certificados = items.reduce((s, i) => s + (medidoDe.get(Number(i.id)) ?? Number(i.superficie_m2)), 0);

    // El número, con candado: nadie más numera actas mientras tanto.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('numero-acta-medicion'))`);
    const anio = Number(fecha.slice(0, 4));
    const seq = (await tx.execute(sql`
      select coalesce(max(nullif(split_part(numero, '-', 3), '')::int), 0) + 1 as n
      from actas_medicion where numero like ${`ACTA-${anio}-%`}
    `)) as unknown as Array<{ n: number }>;
    const numero = `ACTA-${anio}-${String(seq[0]?.n ?? 1).padStart(4, "0")}`;

    const acta = (await tx.execute(sql`
      insert into actas_medicion (
        numero, empresa_id, fecha, estado, modalidad, puntos_informados, puntos_medidos,
        m2_informados, m2_medidos, desviacion_pct, observaciones,
        firma_inspector, firma_contratista, firmada_en, creada_por, metadata
      ) values (
        ${numero}, ${d.empresaId}, ${fecha}::date, 'firmada', ${debeSerTotal ? "total" : "muestreo"},
        ${items.length}, ${medidos.length},
        ${Math.round(m2Informados * 100) / 100}, ${Math.round(m2Certificados * 100) / 100},
        ${desviacion}, ${d.observaciones ?? null},
        ${d.firmaInspector}, ${d.firmaContratista}, now(), ${sesion.sub}::uuid,
        ${JSON.stringify(debeSerTotal ? {} : { semilla_muestra: semilla, sorteados: exigidos })}::jsonb
      ) returning id
    `)) as unknown as Array<{ id: number }>;
    const actaId = acta[0]?.id;
    if (!actaId) throw new ErrorVisible("No se pudo registrar el acta");

    for (const i of items) {
      // El punto del item: un tramo es una línea, y acá va su centro.
      await tx.execute(sql`
        insert into acta_items (acta_id, orden_item_id, direccion, m2_informado, m2_medido, geom)
        select ${actaId}, ${i.id}, ${i.direccion}, ${i.superficie_m2}, ${medidoDe.get(Number(i.id)) ?? null},
               st_centroid(oi.geom)
        from orden_items oi where oi.id = ${i.id}
      `);
    }
    const certificados = sql.join(items.map((i) => sql`${i.id}`), sql`, `);
    await tx.execute(sql`
      update orden_items set acta_id = ${actaId} where id in (${certificados})
    `);

    return { actaId: Number(actaId), numero, desviacion, puntos: items.length, medidos: medidos.length };
  });

  revalidatePath("/ordenes/certificacion");
  revalidatePath("/ordenes/control");
  revalidatePath("/empresa/certificacion");
  return resultado;
}
