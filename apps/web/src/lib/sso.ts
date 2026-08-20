import { z } from "zod";
import type { RolUsuario } from "@cimba/domain";

/**
 * SSO institucional Ciudad Digital.
 *
 * Flujo (idéntico a UrbanIA/ELCOP):
 *  1. El portal abre https://<cimba>/?auth=<token municipal>
 *  2. /api/auth/callback valida el token contra GET /usuarios/authStatus
 *     (server-side; header Authorization CRUDO, sin prefijo "Bearer")
 *  3. upsert de perfil, JWT propio en cookie httpOnly, redirect sin token.
 *
 * El JWT_SECRET_KEY municipal NUNCA se configura acá: la validez del token la
 * afirma el backend municipal, no una verificación local de firma.
 */

const usuarioMunicipalSchema = z.object({
  id_persona: z.number(),
  id_tusuario: z.number().nullish(),
  nombre: z.string().nullish(),
  apellido: z.string().nullish(),
  apellido_nombre: z.string().nullish(),
  documento: z.union([z.string(), z.number()]).nullish(),
  email: z.string().nullish(),
});
export type UsuarioMunicipal = z.infer<typeof usuarioMunicipalSchema>;

// Cache en memoria del resultado de authStatus (TTL corto) para no golpear
// el backend municipal en cada request.
const cacheAuth = new Map<string, { usuario: UsuarioMunicipal; expira: number }>();
const TTL_MS = 5 * 60_000;

export async function validarTokenMunicipal(token: string): Promise<UsuarioMunicipal | null> {
  const cacheado = cacheAuth.get(token);
  if (cacheado && cacheado.expira > Date.now()) return cacheado.usuario;

  const base = process.env.CIMBA_API_CIUDAD_DIGITAL;
  if (!base) throw new Error("CIMBA_API_CIUDAD_DIGITAL no configurada");

  const res = await fetch(new URL("/usuarios/authStatus", base), {
    headers: { Authorization: token }, // crudo, sin "Bearer"
    cache: "no-store",
  });
  if (!res.ok) return null;
  const cuerpo = (await res.json()) as { data?: { usuarioSinContraseña?: unknown; usuarioSinContrasena?: unknown } };
  const crudo = cuerpo.data?.["usuarioSinContraseña"] ?? cuerpo.data?.usuarioSinContrasena;
  const parseado = usuarioMunicipalSchema.safeParse(crudo);
  if (!parseado.success) return null;

  cacheAuth.set(token, { usuario: parseado.data, expira: Date.now() + TTL_MS });
  return parseado.data;
}

/**
 * Rol CIMBA derivado del permiso institucional + mapeo propio.
 * `id_tusuario == 1` es admin general del portal → bootstrap de admin CIMBA.
 * El resto arranca en lectura y un admin lo eleva desde la tabla perfiles.
 */
export function derivarRolInicial(usuario: UsuarioMunicipal): RolUsuario {
  if (usuario.id_tusuario === 1) return "admin";
  return "lectura";
}

export function nombreCompleto(u: UsuarioMunicipal): string {
  return (
    u.apellido_nombre ??
    [u.apellido, u.nombre].filter(Boolean).join(", ") ??
    `Persona ${u.id_persona}`
  );
}
