import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getDb, sql } from "@cimba/db";
import { escribirCookieSesion, firmarSesion } from "@/lib/auth";
import { upsertPerfil } from "@/lib/perfiles";

/**
 * Acceso simple temporal mientras no está conectado el SSO de Ciudad Digital.
 * Dos tipos de usuario entran por acá:
 *  - el admin, por credenciales de entorno;
 *  - las empresas contratistas, por slug + clave que les genera el Director
 *    desde /ordenes/empresas (solo se guarda el hash).
 * id_persona fijo y alejado del rango real para no chocar con ninguna
 * identidad municipal: 900001 el admin, 910000+id las empresas.
 */
const ID_PERSONA_ADMIN = 900001;
const BASE_ID_PERSONA_EMPRESA = 910000;

const cuerpoSchema = z.object({ usuario: z.string().min(1), clave: z.string().min(1) });

// Un route.ts solo puede exportar métodos HTTP: el helper queda local
// (la contraparte que GENERA claves vive en lib/acciones-ordenes.ts).
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function POST(req: NextRequest) {
  const cuerpo = cuerpoSchema.safeParse(await req.json().catch(() => null));
  if (!cuerpo.success) {
    return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 });
  }
  const { usuario, clave } = cuerpo.data;

  // 1) Admin por variables de entorno
  const adminUsuario = process.env.ADMIN_USUARIO;
  const adminClave = process.env.ADMIN_PASSWORD;
  if (adminUsuario && adminClave && usuario === adminUsuario && clave === adminClave) {
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
    return NextResponse.json({ ok: true, destino: "/mapa" });
  }

  // 2) Empresa contratista por slug + clave (hash en la base, nunca en claro).
  //    Sin RLS acá: todavía no hay sesión. La consulta es puntual por slug.
  const empresas = (await getDb().execute(sql`
    select id, nombre, slug, clave_hash from empresas
    where slug = ${usuario.toLowerCase()} and activa
  `)) as unknown as Array<{ id: number; nombre: string; slug: string; clave_hash: string | null }>;
  const empresa = empresas[0];

  if (empresa?.clave_hash && empresa.clave_hash === sha256(clave)) {
    const perfil = await upsertPerfil({
      idPersona: BASE_ID_PERSONA_EMPRESA + Number(empresa.id),
      idTusuario: null,
      nombre: empresa.nombre,
      documento: null,
      email: null,
      rolInicial: "empresa",
    });
    const jwt = await firmarSesion({
      sub: perfil.id,
      rol_cimba: "empresa",
      id_persona: perfil.id_persona,
      nombre: empresa.nombre,
      id_empresa: Number(empresa.id),
    });
    await escribirCookieSesion(jwt);
    return NextResponse.json({ ok: true, destino: "/empresa" });
  }

  if (!adminUsuario || !adminClave) {
    return NextResponse.json({ error: "El acceso todavía no está configurado" }, { status: 501 });
  }
  return NextResponse.json({ error: "Usuario o contraseña incorrectos" }, { status: 401 });
}
