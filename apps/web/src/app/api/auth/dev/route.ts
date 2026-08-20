import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { rolUsuarioSchema } from "@cimba/domain";
import { escribirCookieSesion, firmarSesion } from "@/lib/auth";
import { upsertPerfil } from "@/lib/perfiles";

/**
 * SOLO DESARROLLO (DEV_FAKE_SSO=1): impersona un rol sin backend municipal.
 * En producción este endpoint responde 404.
 */
export async function POST(req: NextRequest) {
  if (process.env.DEV_FAKE_SSO !== "1") {
    return NextResponse.json({ error: "no disponible" }, { status: 404 });
  }
  const cuerpo = z.object({ rol: rolUsuarioSchema }).safeParse(await req.json());
  if (!cuerpo.success) return NextResponse.json({ error: "rol inválido" }, { status: 400 });

  const rol = cuerpo.data.rol;
  // id_persona ficticio estable por rol (90000 + índice)
  const idPersona = 90000 + rolUsuarioSchema.options.indexOf(rol);

  const perfil = await upsertPerfil({
    idPersona,
    idTusuario: rol === "admin" ? 1 : 99,
    nombre: `Dev ${rol.replaceAll("_", " ")}`,
    documento: null,
    email: null,
    rolInicial: rol,
  });

  // En dev el rol pedido manda (el upsert conserva roles previos)
  const { getDb, sql } = await import("@cimba/db");
  await getDb().execute(sql`update perfiles set rol = ${rol} where id = ${perfil.id}`);

  const jwt = await firmarSesion({
    sub: perfil.id,
    rol_cimba: rol,
    id_persona: perfil.id_persona,
    nombre: perfil.nombre,
  });
  await escribirCookieSesion(jwt);
  return NextResponse.json({ ok: true });
}
