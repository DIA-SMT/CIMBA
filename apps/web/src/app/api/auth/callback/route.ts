import { NextResponse, type NextRequest } from "next/server";
import { escribirCookieSesion, firmarSesion } from "@/lib/auth";
import { upsertPerfil } from "@/lib/perfiles";
import { derivarRolInicial, nombreCompleto, validarTokenMunicipal } from "@/lib/sso";

/**
 * Recibe ?auth=<token municipal>, lo valida server-side contra
 * /usuarios/authStatus y emite la cookie de sesión propia.
 * El token municipal jamás llega al bundle del cliente ni queda en la URL:
 * este handler redirige a "/" limpio.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("auth");
  const destino = new URL("/", req.nextUrl.origin);

  if (!token) return NextResponse.redirect(new URL("/acceso", req.nextUrl.origin));

  const usuario = await validarTokenMunicipal(token);
  if (!usuario) {
    const acceso = new URL("/acceso", req.nextUrl.origin);
    acceso.searchParams.set("error", "token_invalido");
    return NextResponse.redirect(acceso);
  }

  const perfil = await upsertPerfil({
    idPersona: usuario.id_persona,
    idTusuario: usuario.id_tusuario ?? null,
    nombre: nombreCompleto(usuario),
    documento: usuario.documento != null ? String(usuario.documento) : null,
    email: usuario.email ?? null,
    rolInicial: derivarRolInicial(usuario),
  });

  if (!perfil.activo) {
    const acceso = new URL("/acceso", req.nextUrl.origin);
    acceso.searchParams.set("error", "perfil_inactivo");
    return NextResponse.redirect(acceso);
  }

  const jwt = await firmarSesion({
    sub: perfil.id,
    rol_cimba: perfil.rol,
    id_persona: perfil.id_persona,
    nombre: perfil.nombre,
  });
  await escribirCookieSesion(jwt);
  return NextResponse.redirect(destino);
}
