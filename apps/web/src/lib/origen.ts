import type { NextRequest } from "next/server";

/**
 * EL ORIGEN PÚBLICO DE LA REQUEST, ANDE DONDE ANDE CIMBA.
 *
 * `req.nextUrl.origin` funciona en Vercel —su runtime inyecta el host público—
 * pero self-hosteado detrás de nginx devuelve el host INTERNO (localhost:3300),
 * y los redirects del SSO terminaban mandando al navegador a un puerto que no
 * existe para él. Acá se prefiere `x-forwarded-host`, que nginx setea con el
 * dominio real; Vercel también lo manda, así que no cambia nada allá.
 */
export function origenPublico(req: NextRequest): string {
  const host = req.headers.get("x-forwarded-host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  return req.nextUrl.origin;
}
