import { NextResponse, type NextRequest } from "next/server";
import { escribirCookieSesion, firmarSesion } from "@/lib/auth";
import { upsertPerfil } from "@/lib/perfiles";
import {
  derivarRolInicial,
  documentoDe,
  emailDe,
  nombreCompleto,
  validarTokenMunicipal,
} from "@/lib/sso";

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

  /**
   * Si el SSO no está configurado, esto tiene que terminar en la pantalla de
   * acceso, no en un 500.
   *
   * CIMBA entra por su propia puerta —usuario y clave— y el SSO es un camino
   * adicional. Pero el middleware manda al callback cualquier URL que traiga
   * ?auth=, así que sin CIMBA_API_CIUDAD_DIGITAL cargada
   * validarTokenMunicipal tira, y alguien que llegue con un token viejo o un
   * link guardado se come una pantalla de error del framework en vez del
   * formulario de siempre. Se distingue del token inválido para no mandar a
   * nadie a buscar un problema donde no está.
   */
  let usuario: Awaited<ReturnType<typeof validarTokenMunicipal>> = null;
  let sinConfigurar = false;
  try {
    usuario = await validarTokenMunicipal(token);
  } catch {
    sinConfigurar = true;
  }
  if (!usuario) {
    const acceso = new URL("/acceso", req.nextUrl.origin);
    acceso.searchParams.set("error", sinConfigurar ? "sso_no_configurado" : "token_invalido");
    return NextResponse.redirect(acceso);
  }

  const perfil = await upsertPerfil({
    idPersona: usuario.id_persona,
    idTusuario: usuario.id_tusuario ?? null,
    nombre: nombreCompleto(usuario),
    documento: documentoDe(usuario),
    email: emailDe(usuario),
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
