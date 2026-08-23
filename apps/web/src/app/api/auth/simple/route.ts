import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { escribirCookieSesion, firmarSesion } from "@/lib/auth";
import { upsertPerfil } from "@/lib/perfiles";

/**
 * Acceso simple temporal (un solo usuario admin por credenciales de entorno)
 * mientras no está conectado el SSO de Ciudad Digital. id_persona fijo y
 * alejado del rango real para no chocar con ninguna identidad municipal.
 */
const ID_PERSONA_ADMIN = 900001;

const cuerpoSchema = z.object({ usuario: z.string().min(1), clave: z.string().min(1) });

export async function POST(req: NextRequest) {
  const usuario = process.env.ADMIN_USUARIO;
  const clave = process.env.ADMIN_PASSWORD;
  if (!usuario || !clave) {
    return NextResponse.json({ error: "El acceso todavía no está configurado" }, { status: 501 });
  }

  const cuerpo = cuerpoSchema.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success || cuerpo.data.usuario !== usuario || cuerpo.data.clave !== clave) {
    return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 });
  }

  const perfil = await upsertPerfil({
    idPersona: ID_PERSONA_ADMIN,
    idTusuario: 1,
    nombre: "Dirección IA",
    documento: null,
    email: null,
    rolInicial: "admin",
  });

  const jwt = await firmarSesion({
    sub: perfil.id,
    rol_cimba: "admin",
    id_persona: perfil.id_persona,
    nombre: perfil.nombre,
  });
  await escribirCookieSesion(jwt);
  return NextResponse.json({ ok: true });
}
