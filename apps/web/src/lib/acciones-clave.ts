"use server";

import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb, sql } from "@cimba/db";
import { escribirCookieSesion, firmarSesion, requerirSesion } from "./auth";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * Cambio de la propia clave, para los usuarios locales (los que tienen usuario
 * y clave en perfiles: Silvana, Alejandro…). Los de entorno (admin, bacheo) y
 * las empresas no pasan por acá: sus claves se cambian por otro canal.
 *
 * Corre sin RLS: es una operación sobre EL PROPIO perfil (sesion.sub) y la
 * clave actual se verifica primero — no hay forma de tocar la de otro.
 */
export async function cambiarMiClave(entrada: { actual: string; nueva: string }) {
  const sesion = await requerirSesion();
  const datos = z
    .object({
      actual: z.string().min(1),
      nueva: z.string().min(8, "La clave nueva necesita al menos 8 caracteres").max(100),
    })
    .refine((v) => v.nueva !== v.actual, {
      message: "La clave nueva tiene que ser distinta de la actual",
    })
    .parse(entrada);

  const filas = (await getDb().execute(sql`
    select clave_hash from perfiles where id = ${sesion.sub}::uuid and usuario is not null and activo
  `)) as unknown as Array<{ clave_hash: string | null }>;
  const perfil = filas[0];
  if (!perfil?.clave_hash) {
    throw new Error("Tu acceso no usa clave propia (entrás por credenciales del sistema): no hay nada que cambiar acá");
  }
  if (perfil.clave_hash !== sha256(datos.actual)) {
    throw new Error("La clave actual no coincide");
  }

  await getDb().execute(sql`
    update perfiles set clave_hash = ${sha256(datos.nueva)}, clave_temporal = false
    where id = ${sesion.sub}::uuid
  `);

  // La cookie vieja lleva el flag ct=true y el middleware lo encierra en
  // /clave hasta que expire: se re-emite la sesión SIN el flag ya mismo.
  if (sesion.ct) {
    const { ct: _ct, ...sinFlag } = sesion;
    await escribirCookieSesion(await firmarSesion(sinFlag));
  }
  return { ok: true };
}
