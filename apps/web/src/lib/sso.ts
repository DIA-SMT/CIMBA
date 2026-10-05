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

/**
 * Los nombres de campo son los de la tabla `persona` de CIDITUC: vienen con el
 * sufijo _persona. La primera versión de este archivo esperaba `nombre`,
 * `apellido`, `documento` y `email` a secas, así que el esquema parseaba
 * igual —son todos nullish— y el perfil quedaba creado como "Persona 47936",
 * sin documento y sin mail. Se dejan los nombres cortos como alternativa por
 * si otro endpoint municipal los devuelve así.
 */
const usuarioMunicipalSchema = z.object({
  id_persona: z.number(),
  id_tusuario: z.number().nullish(),
  nombre_persona: z.string().nullish(),
  apellido_persona: z.string().nullish(),
  documento_persona: z.union([z.string(), z.number()]).nullish(),
  email_persona: z.string().nullish(),
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
  /**
   * El usuario viene en la RAÍZ del cuerpo, no adentro de un `data`. Acá
   * estaba el bug que hacía que un token perfectamente válido terminara en
   * "token_invalido": el esquema nunca recibía nada que parsear y
   * validarTokenMunicipal devolvía null.
   *
   * Se contempla igual la variante anidada —hay endpoints municipales que sí
   * envuelven en `data`— y la grafía sin eñe, que es la clase de detalle que
   * cambia sin aviso. El derivador lee `data.usuarioSinContraseña` sobre la
   * respuesta de axios, o sea la raíz del JSON: esa es la forma buena.
   */
  const cuerpo = (await res.json()) as Record<string, unknown> & {
    data?: Record<string, unknown>;
  };
  const crudo =
    cuerpo["usuarioSinContraseña"] ??
    cuerpo.usuarioSinContrasena ??
    cuerpo.data?.["usuarioSinContraseña"] ??
    cuerpo.data?.usuarioSinContrasena;
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
  const apellido = u.apellido_persona ?? u.apellido;
  const nombre = u.nombre_persona ?? u.nombre;
  return (
    u.apellido_nombre ??
    ([apellido, nombre].filter(Boolean).join(", ") || `Persona ${u.id_persona}`)
  );
}

/** Documento y mail, con los dos juegos de nombres posibles. */
export function documentoDe(u: UsuarioMunicipal): string | null {
  const d = u.documento_persona ?? u.documento;
  return d != null && String(d).trim() !== "" ? String(d) : null;
}

export function emailDe(u: UsuarioMunicipal): string | null {
  const e = u.email_persona ?? u.email;
  return e != null && e.trim() !== "" ? e.trim() : null;
}
