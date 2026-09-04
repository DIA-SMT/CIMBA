"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { tipoProblemaSchema } from "@cimba/domain";
import { requerirRol, type Sesion } from "./auth";

/**
 * Acciones del centro de tratamiento. El criterio de qué se automatiza en
 * lote y qué queda uno a uno:
 *  - DERIVAR A LA SAT en lote: sí — es interno (el expediente viaja aparte) y
 *    el propio Director lo pidió: "es refácil que nos saquemos estos de encima".
 *  - Duplicadas y ya-resueltas: UNA A UNA — descartar el reclamo de un vecino
 *    por proximidad es una decisión con nombre y apellido; el sistema la deja
 *    servida (referencia + distancia) pero la confirma una persona.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

// La derivación a la SAT NO tiene un camino "suelto": solo existe a través de
// generarNotaSat (más abajo) — así SIEMPRE queda el expediente registrado,
// que es la regla del Director: "debe quedar registro de la nota que se hace".

/** Descartar un reclamo como duplicado de otro, con la referencia guardada. */
export async function marcarDuplicada(entrada: { demandaId: number; duplicadaDe: number }) {
  const sesion = await requerirRol("planificacion", "atencion_ciudadana");
  const datos = z
    .object({ demandaId: z.number().int().positive(), duplicadaDe: z.number().int().positive() })
    .refine((v) => v.demandaId !== v.duplicadaDe, { message: "Un reclamo no puede duplicarse a sí mismo" })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    // El original tiene que seguir vivo (abierto o ya vinculado a una obra):
    // descartar apuntando a un reclamo muerto dejaría al vecino sin nadie
    // que "junte la prioridad de ambos".
    const orig = (await tx.execute(sql`
      select id from demandas
      where id = ${datos.duplicadaDe} and estado in ('recibida', 'en_validacion', 'vinculada')
    `)) as unknown as Array<{ id: number }>;
    if (!orig[0]) throw new Error(`El reclamo original #${datos.duplicadaDe} ya no está vigente: refrescá la bandeja`);

    const r = (await tx.execute(sql`
      update demandas set
        estado = 'descartada',
        metadata = metadata || ${JSON.stringify({
          duplicada_de: datos.duplicadaDe,
          descartada_por: sesion.nombre,
          descartada_en: new Date().toISOString(),
        })}::jsonb
      where id = ${datos.demandaId} and estado in ('recibida', 'en_validacion')
      returning id
    `)) as unknown as Array<{ id: number }>;
    if (!r[0]) throw new Error("El reclamo no está abierto");
  });
  revalidatePath("/calidad");
  revalidatePath("/demandas");
  return { ok: true };
}

/**
 * Corregir el tipo de un reclamo mal tipificado (el clásico: dice "bache"
 * pero cae en calle de ripio). El trigger de destino se re-evalúa solo al
 * tocar el tipo; la marca deja constancia de que fue una decisión humana.
 */
export async function corregirTipoDemanda(entrada: { demandaId: number; tipo: string }) {
  const sesion = await requerirRol("planificacion", "atencion_ciudadana");
  const datos = z
    .object({ demandaId: z.number().int().positive(), tipo: tipoProblemaSchema })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    const r = (await tx.execute(sql`
      update demandas set
        tipo = ${datos.tipo},
        metadata = metadata || ${JSON.stringify({
          tipo_corregido: { por: sesion.nombre, en: new Date().toISOString() },
        })}::jsonb
      where id = ${datos.demandaId}
      returning id
    `)) as unknown as Array<{ id: number }>;
    if (!r[0]) throw new Error("El reclamo no existe");
  });
  revalidatePath("/calidad");
  revalidatePath("/demandas");
  return { ok: true };
}

// ── La nota a la SAT: generar y registrar el expediente ──────────────────────

/**
 * Genera la NOTA administrativa a la SAT: numera el expediente, CONGELA el
 * detalle de cada reclamo incluido (la nota histórica no cambia aunque la
 * demanda cambie) y saca esos reclamos de la cola de bacheo con la referencia
 * al expediente. Todo o nada: si algo falla, no queda ni la nota ni la
 * derivación a medias.
 */
export async function generarNotaSat(entrada: { observaciones?: string }) {
  const sesion = await requerirRol("planificacion", "atencion_ciudadana");
  const datos = z.object({ observaciones: z.string().max(2000).optional() }).parse(entrada);

  const { renglonesParaNotaSatEnTx, DESTINATARIO_SAT } = await import("./expedientes");

  const resultado = await conRls(claims(sesion), async (tx) => {
    // Serializa generaciones concurrentes (dos pestañas con la preview
    // abierta): la segunda espera a que la primera commitee y entonces lee
    // los reclamos que QUEDAN — sin esto salían dos notas numeradas con los
    // mismos casos congelados. El snapshot se toma DENTRO de esta tx.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('cimba-generar-nota-sat'))`);

    const renglones = await renglonesParaNotaSatEnTx(tx);
    if (renglones.length === 0) {
      throw new Error("No hay reclamos de la SAT abiertos para incluir en la nota");
    }

    // Numeración administrativa ANUAL en hora de Tucumán (la global seguía
    // contando entre años y el 31/12 a la noche cambiaba de año en UTC).
    // El advisory lock de arriba hace seguro el count+1.
    const creado = (await tx.execute(sql`
      with anio as (select to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY') as a)
      insert into expedientes (numero, tipo, destinatario, observaciones, cantidad, generado_por)
      select 'NOTA-SAT-' || anio.a || '-' ||
             lpad((coalesce((select count(*) from expedientes e
                             where e.tipo = 'sat' and e.numero like 'NOTA-SAT-' || anio.a || '-%'), 0) + 1)::text, 4, '0'),
             'sat', ${DESTINATARIO_SAT}, ${datos.observaciones ?? null}, ${renglones.length}, ${sesion.sub}::uuid
      from anio
      returning id, numero
    `)) as unknown as Array<{ id: number; numero: string }>;
    const exp = creado[0];
    if (!exp) throw new Error("No se pudo registrar el expediente");

    // El detalle congelado, por lotes para no hacer un viaje por renglón.
    const LOTE = 100;
    for (let i = 0; i < renglones.length; i += LOTE) {
      const trozo = renglones.slice(i, i + LOTE);
      const valores = sql.join(
        trozo.map((r) => sql`(${exp.id}, ${r.demandaId}, ${JSON.stringify(r)}::jsonb)`),
        sql`, `,
      );
      await tx.execute(sql`
        insert into expediente_demandas (expediente_id, demanda_id, detalle) values ${valores}
      `);
    }

    // Derivación: salen de la cola de bacheo, con la traza del expediente.
    // Si derivó menos de lo congelado (alguien tocó un reclamo en el medio),
    // se aborta TODO: la nota jamás puede decir una cosa y la base otra.
    const derivadas = (await tx.execute(sql`
      update demandas set
        estado = 'fuera_de_alcance',
        metadata = metadata || ${JSON.stringify({
          derivada: { a: "sat", por: sesion.nombre, en: new Date().toISOString() },
        })}::jsonb || jsonb_build_object('expediente', (select numero from expedientes where id = ${exp.id}))
      where id in (select demanda_id from expediente_demandas where expediente_id = ${exp.id})
        and estado in ('recibida', 'en_validacion')
      returning id
    `)) as unknown as Array<{ id: number }>;
    if (derivadas.length !== renglones.length) {
      throw new Error(
        `Un reclamo cambió de estado mientras se registraba la nota (${derivadas.length} de ${renglones.length}): no se registró nada — refrescá la previsualización y volvé a intentar`,
      );
    }

    return { id: Number(exp.id), numero: exp.numero };
  });

  revalidatePath("/expedientes");
  revalidatePath("/demandas");
  revalidatePath("/calidad");
  revalidatePath("/brecha");
  return { ok: true, ...resultado };
}

/**
 * Confirmar la señal "no es bache": el reclamo cae en ripio/cordón cuneta,
 * ahí no se bachea — se pasa la máquina. Sale de la cola de bacheo derivado
 * a Ingeniería, con la traza de quién lo confirmó. Uno a uno: la señal la
 * calcula el sistema, la decisión la firma una persona.
 */
export async function derivarAIngenieria(entrada: { demandaId: number }) {
  const sesion = await requerirRol("planificacion", "atencion_ciudadana");
  const { demandaId } = z.object({ demandaId: z.number().int().positive() }).parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    const r = (await tx.execute(sql`
      update demandas set
        estado = 'fuera_de_alcance',
        metadata = metadata || ${JSON.stringify({
          derivada: { a: "ingenieria", por: sesion.nombre, en: new Date().toISOString() },
        })}::jsonb
      where id = ${demandaId} and estado in ('recibida', 'en_validacion')
      returning id
    `)) as unknown as Array<{ id: number }>;
    if (!r[0]) throw new Error("El reclamo no está abierto");
  });
  revalidatePath("/calidad");
  revalidatePath("/demandas");
  return { ok: true };
}

/**
 * Confirmar la señal "ya resuelta": hay una reparación posterior al pedido a
 * metros del punto. El reclamo se VINCULA a ese incidente (no se descarta:
 * el vecino queda respondible con la obra que lo atendió) y sale de la cola.
 */
export async function marcarYaResuelta(entrada: { demandaId: number; incidenteId: number }) {
  const sesion = await requerirRol("planificacion", "atencion_ciudadana");
  const datos = z
    .object({ demandaId: z.number().int().positive(), incidenteId: z.number().int().positive() })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    const inc = (await tx.execute(sql`
      select id from incidentes where id = ${datos.incidenteId} and estado in ('reparado', 'verificado')
    `)) as unknown as Array<{ id: number }>;
    if (!inc[0]) throw new Error("El incidente de referencia no figura como reparado");

    await tx.execute(sql`
      insert into demanda_incidente (demanda_id, incidente_id, vinculado_por, automatico)
      values (${datos.demandaId}, ${datos.incidenteId}, ${sesion.sub}, false)
      on conflict do nothing
    `);
    const r = (await tx.execute(sql`
      update demandas set
        estado = 'vinculada',
        metadata = metadata || ${JSON.stringify({
          ya_resuelta: { incidente: datos.incidenteId, por: sesion.nombre, en: new Date().toISOString() },
        })}::jsonb
      where id = ${datos.demandaId} and estado in ('recibida', 'en_validacion')
      returning id
    `)) as unknown as Array<{ id: number }>;
    if (!r[0]) throw new Error("El reclamo no está abierto");
  });
  revalidatePath("/calidad");
  revalidatePath("/demandas");
  revalidatePath("/brecha");
  return { ok: true };
}
