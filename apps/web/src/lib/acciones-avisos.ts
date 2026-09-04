"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { requerirRol, requerirSesion, type Sesion } from "./auth";
import { ROLES_PUSH } from "@/app/(app)/ordenes/avisos/constantes";
import { notificarEvento, type EventoAviso } from "./notificar";

/**
 * Gestión de avisos: el Director decide qué evento avisa a quién y por dónde.
 * Todo gateado a planificación/admin — es SU tablero de comunicaciones.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

const eventoSchema = z.enum(["orden_emitida", "orden_vencida", "item_propuesto", "aviso_general"]);

export async function agregarDestinatario(entrada: {
  evento: string;
  canal: "push" | "email";
  destino: string;
  etiqueta?: string;
}) {
  const sesion = await requerirRol("planificacion");
  const datos = z
    .object({
      evento: eventoSchema,
      canal: z.enum(["push", "email"]),
      destino: z.string().min(2).max(200),
      etiqueta: z.string().max(100).optional(),
    })
    .superRefine((v, ctx) => {
      // Contra ROLES_PUSH (solo roles internos): 'empresa' es externo y los
      // avisos de la Dirección jamás pueden llegarle por acá.
      if (v.canal === "push" && !(ROLES_PUSH as readonly string[]).includes(v.destino)) {
        ctx.addIssue({ code: "custom", message: "Para push, el destino tiene que ser un rol interno del sistema" });
      }
      if (v.canal === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.destino)) {
        ctx.addIssue({ code: "custom", message: "Ese email no parece válido" });
      }
    })
    .parse(entrada);

  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      insert into avisos_destinatarios (evento, canal, destino, etiqueta)
      values (${datos.evento}, ${datos.canal}, ${datos.destino.toLowerCase()}, ${datos.etiqueta ?? null})
      on conflict (evento, canal, destino) do update set activo = true, etiqueta = coalesce(excluded.etiqueta, avisos_destinatarios.etiqueta)
    `);
  });
  revalidatePath("/ordenes/avisos");
  return { ok: true };
}

export async function alternarDestinatario(entrada: { id: number; activo: boolean }) {
  const sesion = await requerirRol("planificacion");
  const datos = z.object({ id: z.number().int().positive(), activo: z.boolean() }).parse(entrada);
  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`update avisos_destinatarios set activo = ${datos.activo} where id = ${datos.id}`);
  });
  revalidatePath("/ordenes/avisos");
  return { ok: true };
}

export async function quitarDestinatario(entrada: { id: number }) {
  const sesion = await requerirRol("planificacion");
  const { id } = z.object({ id: z.number().int().positive() }).parse(entrada);
  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`delete from avisos_destinatarios where id = ${id}`);
  });
  revalidatePath("/ordenes/avisos");
  return { ok: true };
}

/**
 * El aviso general: el Director redacta y manda YA, a los destinatarios del
 * evento 'aviso_general'. Devuelve el resumen real (cuántos push, cuántos
 * emails, qué se salteó) para que la página lo muestre sin mentir.
 */
export async function enviarAvisoGeneral(entrada: { asunto: string; mensaje: string }) {
  await requerirRol("planificacion");
  const datos = z
    .object({ asunto: z.string().min(3).max(150), mensaje: z.string().min(3).max(3000) })
    .parse(entrada);

  const r = await notificarEvento("aviso_general", {
    titulo: datos.asunto,
    cuerpo: datos.mensaje.slice(0, 160),
    cuerpoEmail: datos.mensaje,
    url: "/mapa",
  });
  return { ok: true, ...r };
}

/**
 * Listado para la página de gestión. En un módulo "use server" TODO export es
 * un endpoint invocable: la sesión se deriva ACÁ adentro (jamás por
 * parámetro, sería forjable) y el rol externo queda afuera.
 */
export async function listarDestinatarios() {
  const sesion = await requerirSesion();
  if (sesion.rol_cimba === "empresa") throw new Error("Sin permiso");
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select id, evento, canal, destino, etiqueta, activo
      from avisos_destinatarios
      order by evento, canal, destino
    `)) as unknown as Array<{
      id: number; evento: EventoAviso; canal: "push" | "email";
      destino: string; etiqueta: string | null; activo: boolean;
    }>;
    return filas.map((f) => ({ ...f, id: Number(f.id) }));
  });
}
