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
const ID_PERSONA_BACHEO = 900002;
const BASE_ID_PERSONA_EMPRESA = 910000;

const cuerpoSchema = z.object({ usuario: z.string().min(1), clave: z.string().min(1) });

/**
 * La clave de entorno correcta no alcanza: el perfil tiene que estar activo.
 * Es el mismo criterio que ya aplica el callback del SSO, y es la única
 * manera de suspender un acceso sin tocar variables de entorno.
 */
function perfilSuspendido(perfil: { activo: boolean }): NextResponse | null {
  if (perfil.activo) return null;
  return NextResponse.json({ error: "Acceso suspendido: hablá con la Dirección de IA" }, { status: 403 });
}

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
    const rechazo = perfilSuspendido(perfil);
    if (rechazo) return rechazo;
    const jwt = await firmarSesion({
      sub: perfil.id,
      // El rol sale del PERFIL, no de un hardcode: así un admin puede degradar
      // (o suspender) este acceso desde la base sin rotar la clave de entorno.
      rol_cimba: perfil.rol,
      id_persona: perfil.id_persona,
      nombre: perfil.nombre,
    });
    await escribirCookieSesion(jwt);
    return NextResponse.json({ ok: true, destino: "/mapa" });
  }

  // 2) Director de Bacheo: rol planificación — es el que emite las órdenes de
  //    trabajo, asigna circuitos y genera las claves de las empresas.
  const bacheoUsuario = process.env.BACHEO_USUARIO;
  const bacheoClave = process.env.BACHEO_PASSWORD;
  if (bacheoUsuario && bacheoClave && usuario === bacheoUsuario && clave === bacheoClave) {
    const perfil = await upsertPerfil({
      idPersona: ID_PERSONA_BACHEO,
      idTusuario: 1,
      nombre: "Dirección de Bacheo",
      documento: null,
      email: null,
      rolInicial: "planificacion",
    });
    const rechazo = perfilSuspendido(perfil);
    if (rechazo) return rechazo;
    const jwt = await firmarSesion({
      sub: perfil.id,
      rol_cimba: perfil.rol,
      id_persona: perfil.id_persona,
      nombre: perfil.nombre,
    });
    await escribirCookieSesion(jwt);
    return NextResponse.json({ ok: true, destino: perfil.rol === "planificacion" ? "/ordenes" : "/mapa" });
  }

  // 3) Usuario local del personal (Silvana, Alejandro, …): usuario y clave
  //    propios en perfiles, con clave temporal que se pide cambiar al entrar.
  const locales = (await getDb().execute(sql`
    select id, id_persona, nombre, rol, activo, clave_hash, clave_temporal
    from perfiles
    where usuario = ${usuario.toLowerCase()} and clave_hash is not null
  `)) as unknown as Array<{
    id: string; id_persona: number; nombre: string; rol: string;
    activo: boolean; clave_hash: string; clave_temporal: boolean;
  }>;
  const local = locales[0];
  if (local && local.clave_hash === sha256(clave)) {
    const rechazo = perfilSuspendido(local);
    if (rechazo) return rechazo;
    // La cuadrilla propia ejecuta como la empresa "Administración": su
    // empresa viaja en el JWT para que el portal y las acciones de items
    // no tengan que resolverla en cada pedido.
    let idEmpresaCuadrilla: number | undefined;
    if (local.rol === "cuadrilla") {
      const adm = (await getDb().execute(sql`
        select id from empresas where slug = 'administracion' and activa
      `)) as unknown as Array<{ id: number }>;
      if (adm[0]) idEmpresaCuadrilla = Number(adm[0].id);
    }
    const jwt = await firmarSesion({
      sub: local.id,
      rol_cimba: local.rol as never,
      id_persona: Number(local.id_persona),
      nombre: local.nombre,
      ...(idEmpresaCuadrilla ? { id_empresa: idEmpresaCuadrilla } : {}),
      // Con clave temporal, el middleware no lo deja salir de /clave: el
      // "destino" de abajo era solo una sugerencia que se podía ignorar.
      ...(local.clave_temporal ? { ct: true } : {}),
    });
    await escribirCookieSesion(jwt);
    await getDb().execute(sql`update perfiles set ultimo_ingreso = now() where id = ${local.id}::uuid`);
    // Clave temporal: se lo lleva derecho a cambiarla antes que a trabajar.
    const destino = local.clave_temporal
      ? "/clave"
      : local.rol === "atencion_ciudadana"
        ? "/cierres"
        : local.rol === "planificacion"
          ? "/ordenes"
          : local.rol === "cuadrilla"
            ? "/empresa"
            : "/mapa";
    return NextResponse.json({ ok: true, destino });
  }

  // 4) Empresa contratista por slug + clave (hash en la base, nunca en claro).
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
    const rechazo = perfilSuspendido(perfil);
    if (rechazo) return rechazo;
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
