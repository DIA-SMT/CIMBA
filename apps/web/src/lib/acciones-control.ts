"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { requerirRol, type Sesion } from "./auth";
import { ErrorVisible } from "./errores";

/**
 * Las dos decisiones del inspector sobre lo que cargó una empresa: darlo por
 * bueno, o darlo de baja. Corregir la medida ya existía (corregirMedidasItem)
 * y se usa tal cual.
 *
 * Quién puede: el cuerpo de inspectores (supervisión) y planificación — el
 * mismo grupo que ve Certificación. Nunca la empresa: es el control sobre ella.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

const revalidar = (ordenId?: number) => {
  revalidatePath("/ordenes/control");
  revalidatePath("/ordenes/certificacion");
  revalidatePath("/ordenes");
  if (ordenId) revalidatePath(`/ordenes/${ordenId}`);
};

/** "Está bien": la carga se miró y las medidas y las fotos cierran. Se puede quitar. */
export async function marcarCargaControlada(entrada: { itemId: number; controlada: boolean }) {
  const sesion = await requerirRol("planificacion", "supervision");
  const datos = z.object({ itemId: z.number().int().positive(), controlada: z.boolean() }).parse(entrada);

  const ordenId = await conRls(claims(sesion), async (tx) => {
    const r = (await tx.execute(sql`
      update orden_items set metadata =
        case when ${datos.controlada}::boolean
          then coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
                 'control', jsonb_build_object('por', ${sesion.nombre}::text, 'en', now()::text))
          else coalesce(metadata, '{}'::jsonb) - 'control'
        end
      where id = ${datos.itemId} and estado = 'hecho' and acta_id is null
      returning orden_id
    `)) as unknown as Array<{ orden_id: number }>;
    if (!r[0]) throw new ErrorVisible("Esa carga ya no está para controlar: se certificó o se dio de baja");
    return Number(r[0].orden_id);
  });
  revalidar(ordenId);
  return { ok: true };
}

/**
 * DAR DE BAJA UNA CARGA. Nunca se borra nada: la intervención queda anulada
 * con sus fotos, y la baja queda escrita en el item con quién, cuándo, por qué
 * y lo que decía antes. En los dos casos el punto deja de certificarse.
 *
 * Qué pasa con el bache depende del motivo (Dirección de Bacheo, 12/10):
 *
 * - DUPLICADO: el bache SÍ está arreglado, por la otra carga. Solo se anula la
 *   copia. Si la copia tenía su propio problema, ese problema se desestima como
 *   duplicado del original y los pedidos de vecinos que tenía se suman al
 *   original — así, cuando se les responda, se les responde con el arreglo que
 *   existe.
 *
 * - MAL CARGADO: el bache NO se puede dar por arreglado con esa carga. Vuelve
 *   a pendiente en la orden, para que la empresa lo cargue bien; si la orden ya
 *   está cerrada, vuelve a la cola de la ciudad para entrar en otra.
 *
 * Lo que ya está en un acta de medición firmada no se toca: está certificado.
 */
export async function darDeBajaCarga(entrada: {
  itemId: number;
  motivo: "duplicado" | "mal_cargado";
  /** Duplicado: la carga que queda como la buena. */
  originalItemId?: number;
  detalle?: string;
}) {
  const sesion = await requerirRol("planificacion", "supervision");
  const datos = z
    .object({
      itemId: z.number().int().positive(),
      motivo: z.enum(["duplicado", "mal_cargado"]),
      originalItemId: z.number().int().positive().optional(),
      detalle: z.string().max(1000).optional(),
    })
    .parse(entrada);
  if (datos.motivo === "duplicado" && !datos.originalItemId) {
    throw new ErrorVisible("Elegí cuál es la carga original: la que queda como buena");
  }
  if (datos.originalItemId === datos.itemId) {
    throw new ErrorVisible("Una carga no puede ser duplicado de sí misma");
  }

  const resultado = await conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select oi.id, oi.orden_id, oi.estado::text as estado, oi.acta_id, oi.intervencion_id, oi.incidente_id,
             oi.superficie_m2, oi.ancho_m, oi.largo_m, oi.espesor_cm, oi.tipo_obra::text as tipo_obra,
             oi.reportado_en, ot.estado::text as orden_estado, ot.numero
      from orden_items oi
      join ordenes_trabajo ot on ot.id = oi.orden_id
      where oi.id = ${datos.itemId}
      for update of oi
    `)) as unknown as Array<Record<string, unknown>>;
    const item = filas[0];
    if (!item) throw new ErrorVisible("La carga no existe");
    if (item.acta_id != null) {
      throw new ErrorVisible("Esa carga ya está en un acta de medición firmada: está certificada y no se da de baja");
    }
    if (item.estado !== "hecho" || item.intervencion_id == null) {
      throw new ErrorVisible("Esa carga ya no está como hecha: puede que ya se haya dado de baja");
    }
    const intervencionId = Number(item.intervencion_id);
    const incidenteId = item.incidente_id != null ? Number(item.incidente_id) : null;

    let original: { item: number; orden: string; incidente: number | null } | null = null;
    if (datos.motivo === "duplicado") {
      const o = ((await tx.execute(sql`
        select oi.id, oi.estado::text as estado, oi.incidente_id, ot.numero
        from orden_items oi join ordenes_trabajo ot on ot.id = oi.orden_id
        where oi.id = ${datos.originalItemId!}
      `)) as unknown as Array<Record<string, unknown>>)[0];
      if (!o) throw new ErrorVisible("La carga original no existe");
      if (o.estado !== "hecho") {
        throw new ErrorVisible("La carga que elegiste como original no está hecha: no puede ser la buena");
      }
      original = {
        item: Number(o.id),
        orden: String(o.numero),
        incidente: o.incidente_id != null ? Number(o.incidente_id) : null,
      };
    }

    const registro = JSON.stringify({
      motivo: datos.motivo,
      detalle: datos.detalle?.trim() || null,
      por: sesion.nombre,
      en: new Date().toISOString(),
      intervencion: intervencionId,
      original: original ? { item: original.item, orden: original.orden } : null,
      // Lo que decía la carga, para que la baja se pueda leer después.
      antes: {
        superficie_m2: item.superficie_m2,
        ancho_m: item.ancho_m,
        largo_m: item.largo_m,
        espesor_cm: item.espesor_cm,
        tipo_obra: item.tipo_obra,
        reportado_en: item.reportado_en != null ? new Date(String(item.reportado_en)).toISOString() : null,
      },
    });

    // La intervención queda, anulada: deja de contar en todo lo que cuenta
    // trabajo hecho, y sus fotos siguen ahí para quien quiera ver por qué.
    await tx.execute(sql`
      update intervenciones set estado = 'anulada',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('baja', ${registro}::jsonb)
      where id = ${intervencionId}
    `);

    // ¿El problema tiene OTRO trabajo que lo sostenga como arreglado?
    const otros = incidenteId
      ? Number(
          ((await tx.execute(sql`
            select count(*)::int as n from intervenciones
            where incidente_id = ${incidenteId} and estado = 'finalizada' and id <> ${intervencionId}
          `)) as unknown as Array<{ n: number }>)[0]?.n ?? 0,
        )
      : 0;

    const ordenActiva = item.orden_estado === "emitida" || item.orden_estado === "en_ejecucion";

    if (datos.motivo === "duplicado") {
      if (incidenteId && original?.incidente && original.incidente !== incidenteId && otros === 0) {
        // Los vecinos de la copia pasan al original: su bache es ese.
        await tx.execute(sql`
          insert into demanda_incidente (demanda_id, incidente_id, vinculado_por, automatico)
          select di.demanda_id, ${original.incidente}, ${sesion.sub}::uuid, false
          from demanda_incidente di where di.incidente_id = ${incidenteId}
          on conflict do nothing
        `);
        await tx.execute(sql`
          update incidentes set estado = 'desestimado',
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
              'duplicado_de', ${original.incidente}::bigint, 'baja', ${registro}::jsonb)
          where id = ${incidenteId}
        `);
      }
      await tx.execute(sql`
        update orden_items set estado = 'rechazado',
          metadata = (coalesce(metadata, '{}'::jsonb) - 'control') || jsonb_build_object(
            'bajas', coalesce(metadata->'bajas', '[]'::jsonb) || jsonb_build_array(${registro}::jsonb))
        where id = ${datos.itemId}
      `);
    } else {
      if (incidenteId && otros === 0) {
        await tx.execute(sql`
          update incidentes set
            estado = ${ordenActiva ? "programado" : "priorizado"}::estado_incidente,
            cerrado_en = null
          where id = ${incidenteId} and estado in ('reparado', 'verificado')
        `);
      }
      // Vuelve a pendiente limpio, como si no se hubiera cargado: la próxima
      // carga lo llena de nuevo. Lo que decía queda en la baja.
      await tx.execute(sql`
        update orden_items set estado = 'pendiente',
          intervencion_id = null, superficie_m2 = null, ancho_m = null, largo_m = null,
          espesor_cm = null, tipo_obra = null, reportado_en = null, reportado_por = null,
          metadata = (coalesce(metadata, '{}'::jsonb) - 'control') || jsonb_build_object(
            'bajas', coalesce(metadata->'bajas', '[]'::jsonb) || jsonb_build_array(${registro}::jsonb))
        where id = ${datos.itemId}
      `);
    }
    return { ordenId: Number(item.orden_id), ordenActiva };
  });

  revalidar(resultado.ordenId);
  revalidatePath("/empresa");
  revalidatePath("/incidentes");
  revalidatePath("/brecha");
  revalidatePath("/cierres");
  return { ok: true, ordenActiva: resultado.ordenActiva };
}
