import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { cache } from "react";
import { z } from "zod";
import { rolUsuarioSchema, type RolUsuario } from "@cimba/domain";

const COOKIE_SESION = "cimba_sesion";
const DURACION_HORAS = 12;

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
    .setExpirationTime(`${DURACION_HORAS}h`)
    .sign(secreto());
}

export async function escribirCookieSesion(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE_SESION, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DURACION_HORAS * 3600,
    path: "/",
  });
}

export async function borrarCookieSesion(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_SESION);
}

/** Lee y verifica la sesión desde la cookie. Cacheada por request. */
export const leerSesion = cache(async (): Promise<Sesion | null> => {
  const jar = await cookies();
  const token = jar.get(COOKIE_SESION)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secreto(), { issuer: "cimba" });
    return sesionSchema.parse(payload);
  } catch {
    return null;
  }
});

export async function requerirSesion(): Promise<Sesion> {
  const sesion = await leerSesion();
  if (!sesion) throw new Error("No autenticado");
  return sesion;
}

export async function requerirRol(...roles: RolUsuario[]): Promise<Sesion> {
  const sesion = await requerirSesion();
  if (sesion.rol_cimba !== "admin" && !roles.includes(sesion.rol_cimba)) {
    throw new Error(`Rol ${sesion.rol_cimba} sin permiso para esta acción`);
  }
  return sesion;
}

/** Roles que pueden ver datos de contacto del vecino. */
export function puedeVerContacto(rol: RolUsuario): boolean {
  return rol === "admin" || rol === "atencion_ciudadana";
}
