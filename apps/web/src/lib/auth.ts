import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import { getDb, sql } from "@cimba/db";
import { rolUsuarioSchema, type RolUsuario } from "@cimba/domain";
import { COOKIE_SESION, DURACION_SESION_S } from "./sesion-duracion";

const sesionSchema = z.object({
  sub: z.string().uuid(), // perfiles.id
  rol_cimba: rolUsuarioSchema,
  // postgres.js devuelve bigint como string: coercionar siempre
  id_persona: z.coerce.number(),
  nombre: z.string(),
  /** Solo cuando rol_cimba = 'empresa': a qué contratista pertenece. */
  id_empresa: z.coerce.number().optional(),
  /** Clave temporal pendiente de cambio: el middleware lo encierra en /clave. */
  ct: z.boolean().optional(),
});
export type Sesion = z.infer<typeof sesionSchema>;

function secreto(): Uint8Array {
  const s = process.env.CIMBA_JWT_SECRET;
  if (!s || s.length < 32) throw new Error("CIMBA_JWT_SECRET debe tener al menos 32 caracteres");
  return new TextEncoder().encode(s);
}

export async function firmarSesion(sesion: Sesion): Promise<string> {
  return new SignJWT(sesion)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("cimba")
    .setExpirationTime(`${DURACION_SESION_S}s`)
    .sign(secreto());
}

export async function escribirCookieSesion(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_SESION, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DURACION_SESION_S,
    path: "/",
  });
}

export async function borrarCookieSesion(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_SESION);
}

/** Verifica un token suelto. Devuelve null si no es válido, nunca lanza. */
export async function leerSesionDeToken(token: string): Promise<Sesion | null> {
  try {
    const { payload } = await jwtVerify(token, secreto(), { issuer: "cimba" });
    const sesion = sesionSchema.parse(payload);
    return (await perfilSigueActivo(sesion.sub)) ? sesion : null;
  } catch {
    return null;
  }
}

/** Lee y verifica la sesión desde la cookie. Cacheada por request. */
export const leerSesion = cache(async (): Promise<Sesion | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESION)?.value;
  if (!token) return null;
  return leerSesionDeToken(token);
});

/**
 * La contracara de la sesión que se renueva sola (ver sesion-duracion.ts): un
 * token puede vivir días, así que cada lectura confirma que el perfil existe y
 * sigue activo. Suspender a alguien en Configuración lo saca en el próximo
 * clic. Una consulta por clave primaria, una vez por pedido (leerSesion está
 * cacheada por request).
 *
 * Si la base no contesta, se deja pasar: un corte de red de la base no puede
 * echar a toda la Dirección. La acción que siga va a fallar igual por la base,
 * con su propio mensaje.
 */
async function perfilSigueActivo(id: string): Promise<boolean> {
  try {
    const filas = (await getDb().execute(sql`
      select activo from perfiles where id = ${id}::uuid
    `)) as unknown as Array<{ activo: boolean }>;
    return filas[0]?.activo === true;
  } catch {
    return true;
  }
}

export async function requerirSesion(): Promise<Sesion> {
  const sesion = await leerSesion();
  if (!sesion) throw new Error("No autenticado");
  return sesion;
}

/**
 * El chequeo de rol, sobre una sesión que ya se tiene en la mano.
 *
 * Existe aparte de requerirRol porque el bot de Telegram no trae cookie: su
 * sesión se arma en el servidor a partir del chat que escribió, y sin esto no
 * habría forma de aplicarle el mismo control que a una pantalla. La condición
 * es la misma, bypass de admin incluido: si alguna vez divergen, el bot y la
 * web dejan de coincidir en quién puede qué, que es la peor falla posible acá.
 */
export function exigirRol(sesion: Sesion, ...roles: RolUsuario[]): Sesion {
  if (sesion.rol_cimba !== "admin" && !roles.includes(sesion.rol_cimba)) {
    throw new Error(`Rol ${sesion.rol_cimba} sin permiso para esta acción`);
  }
  return sesion;
}

export async function requerirRol(...roles: RolUsuario[]): Promise<Sesion> {
  return exigirRol(await requerirSesion(), ...roles);
}

/** Roles que pueden ver datos de contacto del vecino. */
export function puedeVerContacto(rol: RolUsuario): boolean {
  return rol === "admin" || rol === "atencion_ciudadana";
}
