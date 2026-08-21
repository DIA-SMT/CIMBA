"use server";

import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { requerirSesion, type Sesion } from "./auth";
import { notificarPerfil } from "./push";

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona });

const suscripcionSchema = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(5) }),
});

export async function suscribirPush(entrada: unknown, userAgent?: string) {
  const sesion = await requerirSesion();
  const sub = suscripcionSchema.parse(entrada);
  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      insert into push_suscripciones (perfil_id, endpoint, claves, user_agent)
      values (${sesion.sub}, ${sub.endpoint}, ${JSON.stringify(sub.keys)}::jsonb, ${userAgent ?? null})
      on conflict (endpoint) do update set claves = excluded.claves, perfil_id = excluded.perfil_id
    `);
  });
  return { ok: true };
}

export async function desuscribirPush(entrada: { endpoint: string }) {
  const sesion = await requerirSesion();
  const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(entrada);
  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`delete from push_suscripciones where endpoint = ${endpoint}`);
  });
  return { ok: true };
}

/** Notificación de prueba a las suscripciones del propio usuario. */
export async function probarPush() {
  const sesion = await requerirSesion();
  const r = await notificarPerfil(sesion.sub, {
    titulo: "CIMBA · prueba",
    cuerpo: `¡Funciona, ${sesion.nombre}! Así vas a enterarte de las novedades de bacheo.`,
    url: "/mapa",
    tag: "prueba",
  });
  return { ok: true, enviadas: r.enviadas };
}
