"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { ROLES_USUARIO } from "@cimba/domain";
import { requerirSesion, type Sesion } from "./auth";
import { ErrorVisible } from "./errores";

/**
 * Alta y recuperación de acceso para el personal interno: usuario y clave
 * propios en perfiles, el mismo mecanismo que ya usan Silvana y Alejandro.
 * Las empresas contratistas tienen su propia alta (slug + clave, en
 * /ordenes/empresas) y admin/bacheo entran por credenciales de entorno:
 * ninguno de los dos pasa por acá, así que "empresa" no se ofrece como rol.
 *
 * Solo el superadmin (rol admin) da de alta o resetea — es el único punto
 * capaz de otorgar cualquier rol, así que restringe exactamente igual que
 * la RLS lo haría si corriera (no corre: ver rls-no-aplicada en memoria).
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Legible por teléfono: sin caracteres ambiguos (0/O, 1/l/I) — mismo criterio
// que generarClaveEmpresa en acciones-ordenes.ts.
const ALFABETO_CLAVE = "abcdefghjkmnpqrstuvwxyz23456789";
function claveAleatoria(): string {
  return Array.from(randomBytes(10), (b) => ALFABETO_CLAVE[b % ALFABETO_CLAVE.length]).join("");
}

async function exigirSuperadmin(): Promise<Sesion> {
  const sesion = await requerirSesion();
  if (sesion.rol_cimba !== "admin") throw new ErrorVisible("Dar de alta o resetear usuarios es tarea del superadmin");
  return sesion;
}

const ROLES_ASIGNABLES = ROLES_USUARIO.filter((r) => r !== "empresa") as [string, ...string[]];

const crearSchema = z.object({
  usuario: z.string().trim().min(3, "Al menos 3 caracteres").max(80),
  nombre: z.string().trim().min(2, "Falta el nombre").max(120),
  email: z.string().trim().max(160).optional(),
  rol: z.enum(ROLES_ASIGNABLES),
});

/**
 * Crea el acceso y devuelve la clave temporal EN CLARO, una sola vez — la
 * pantalla la muestra y no vuelve a poder recuperarla (en la base solo queda
 * el hash). Al primer ingreso, clave_temporal manda a /clave antes que a
 * cualquier otra pantalla.
 */
export async function crearUsuarioLocal(entrada: z.infer<typeof crearSchema>) {
  const sesion = await exigirSuperadmin();
  const datos = crearSchema.parse(entrada);
  const usuario = datos.usuario.toLowerCase();
  const email = datos.email && datos.email.length > 0 ? datos.email : null;
  const clave = claveAleatoria();

  const fila = await conRls(claims(sesion), async (tx) => {
    const existe = (await tx.execute(sql`select 1 from perfiles where usuario = ${usuario}`)) as unknown as unknown[];
    if (existe.length > 0) throw new ErrorVisible(`Ya existe un usuario "${usuario}"`);

    // Rango reservado para altas locales (920000+): no choca con los
    // id_persona fijos de admin/bacheo/empresas (900000s / 910000s).
    const siguiente = (await tx.execute(sql`
      select coalesce(max(id_persona), 919999) + 1 as n from perfiles
      where id_persona >= 920000 and id_persona < 930000
    `)) as unknown as Array<{ n: number | string }>;
    const idPersona = Number(siguiente[0]?.n ?? 920000);

    return (
      (await tx.execute(sql`
        insert into perfiles (id_persona, nombre, email, rol, usuario, clave_hash, clave_temporal, activo)
        values (${idPersona}, ${datos.nombre}, ${email}, ${datos.rol}, ${usuario}, ${sha256(clave)}, true, true)
        returning id, usuario
      `)) as unknown as Array<{ id: string; usuario: string }>
    )[0];
  });
  if (!fila) throw new ErrorVisible("No se pudo crear el usuario");

  revalidatePath("/actividad");
  return { usuario: fila.usuario, clave };
}

const resetSchema = z.object({ perfilId: z.string().uuid() });

/**
 * Resetea la clave de un acceso local ya existente (usuario la perdió, se
 * fue de la organización y vuelve otro con el mismo puesto, sospecha de mal
 * uso, etc.). La anterior deja de servir en el acto.
 */
export async function regenerarClaveUsuario(entrada: z.infer<typeof resetSchema>) {
  const sesion = await exigirSuperadmin();
  const { perfilId } = resetSchema.parse(entrada);
  const clave = claveAleatoria();

  const fila = await conRls(claims(sesion), async (tx) => {
    return (
      (await tx.execute(sql`
        update perfiles set clave_hash = ${sha256(clave)}, clave_temporal = true
        where id = ${perfilId}::uuid and usuario is not null
        returning usuario
      `)) as unknown as Array<{ usuario: string }>
    )[0];
  });
  if (!fila) throw new ErrorVisible("Ese acceso no usa usuario y clave propios: no hay nada para resetear");

  revalidatePath("/actividad");
  return { usuario: fila.usuario, clave };
}

// ── Configuración: ver y modificar el padrón ────────────────────────────────

export interface UsuarioAdmin {
  id: string;
  idPersona: number;
  nombre: string;
  usuario: string | null;
  email: string | null;
  rol: string;
  area: string | null;
  activo: boolean;
  claveTemporal: boolean;
  /** Entra con usuario y clave propios. Los del SSO municipal no. */
  tieneClave: boolean;
  empresaNombre: string | null;
  ultimoIngreso: string | null;
}

/**
 * El padrón completo, para la pantalla de Configuración. Incluye a los
 * perfiles sin clave propia (los que entran por el SSO municipal) porque
 * también hay que poder cambiarles el rol o darlos de baja.
 */
export async function listarUsuarios(): Promise<UsuarioAdmin[]> {
  const sesion = await exigirSuperadmin();
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select p.id, p.id_persona, p.nombre, p.usuario, p.email, p.rol::text as rol, p.area,
             p.activo, p.clave_temporal, (p.clave_hash is not null) as tiene_clave,
             e.nombre as empresa_nombre, p.ultimo_ingreso
      from perfiles p
      left join empresas e on e.id = p.empresa_id
      order by p.activo desc, p.rol, p.nombre
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => ({
      id: String(f.id),
      idPersona: Number(f.id_persona),
      nombre: String(f.nombre),
      usuario: (f.usuario as string) ?? null,
      email: (f.email as string) ?? null,
      rol: String(f.rol),
      area: (f.area as string) ?? null,
      activo: Boolean(f.activo),
      claveTemporal: Boolean(f.clave_temporal),
      tieneClave: Boolean(f.tiene_clave),
      empresaNombre: (f.empresa_nombre as string) ?? null,
      ultimoIngreso: f.ultimo_ingreso != null ? String(f.ultimo_ingreso) : null,
    }));
  });
}

const modificarSchema = z.object({
  perfilId: z.string().uuid(),
  nombre: z.string().trim().min(2).max(120).optional(),
  rol: z.enum(ROLES_ASIGNABLES).optional(),
  area: z.string().trim().max(120).nullable().optional(),
  activo: z.boolean().optional(),
});

/**
 * Cambiar nombre, rol, área o si el acceso sigue vivo.
 *
 * Dos frenos, y los dos por la misma razón práctica: si el último admin se
 * saca el rol o se desactiva, nadie puede volver a crear usuarios y la única
 * salida es entrar a la base a mano. Uno protege contra hacérselo a uno mismo
 * (el caso frecuente: "me equivoqué de fila") y el otro contra dejar el
 * sistema sin ningún administrador activo.
 */
export async function modificarUsuario(entrada: z.infer<typeof modificarSchema>) {
  const sesion = await exigirSuperadmin();
  const datos = modificarSchema.parse(entrada);
  const pierdeElMando = datos.activo === false || (datos.rol != null && datos.rol !== "admin");

  if (datos.perfilId === sesion.sub && pierdeElMando) {
    throw new ErrorVisible("No podés quitarte a vos mismo el acceso de administrador");
  }

  await conRls(claims(sesion), async (tx) => {
    if (pierdeElMando) {
      const actual = (await tx.execute(sql`
        select rol::text as rol, activo from perfiles where id = ${datos.perfilId}::uuid
      `)) as unknown as Array<{ rol: string; activo: boolean }>;
      if (!actual[0]) throw new ErrorVisible("El usuario no existe");
      if (actual[0].rol === "admin" && actual[0].activo) {
        const otros = (await tx.execute(sql`
          select count(*)::int as n from perfiles
          where rol = 'admin' and activo and id <> ${datos.perfilId}::uuid
        `)) as unknown as Array<{ n: number }>;
        if (Number(otros[0]?.n ?? 0) === 0) {
          throw new ErrorVisible(
            "Es el último administrador activo: nombrá a otro antes de sacarle el rol",
          );
        }
      }
    }
    const r = (await tx.execute(sql`
      update perfiles set
        nombre = coalesce(${datos.nombre ?? null}, nombre),
        rol = coalesce(${datos.rol ?? null}::rol_usuario, rol),
        area = case when ${datos.area !== undefined} then ${datos.area ?? null} else area end,
        activo = coalesce(${datos.activo ?? null}, activo)
      where id = ${datos.perfilId}::uuid
      returning id
    `)) as unknown as Array<{ id: string }>;
    if (!r[0]) throw new ErrorVisible("El usuario no existe");
  });

  revalidatePath("/configuracion");
  revalidatePath("/actividad");
  return { ok: true };
}

// ── Configuración: qué avisos manda el sistema ──────────────────────────────

export interface AvisoConfig {
  id: number;
  evento: string;
  canal: string;
  destino: string;
  etiqueta: string | null;
  activo: boolean;
}

export async function listarAvisosConfig(): Promise<AvisoConfig[]> {
  const sesion = await exigirSuperadmin();
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select id, evento, canal, destino, etiqueta, activo
      from avisos_destinatarios order by evento, canal, destino
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => ({
      id: Number(f.id),
      evento: String(f.evento),
      canal: String(f.canal),
      destino: String(f.destino),
      etiqueta: (f.etiqueta as string) ?? null,
      activo: Boolean(f.activo),
    }));
  });
}

/**
 * Prender o apagar un aviso puntual. No se borra la fila: apagar tiene que ser
 * reversible con un clic, y quien apagó "orden vencida a Supervisión" el mes
 * pasado tiene derecho a encontrarlo ahí para volver a prenderlo.
 */
export async function cambiarAvisoConfig(entrada: { id: number; activo: boolean }) {
  const sesion = await exigirSuperadmin();
  const datos = z.object({ id: z.number().int().positive(), activo: z.boolean() }).parse(entrada);
  await conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      update avisos_destinatarios set activo = ${datos.activo} where id = ${datos.id}
    `);
  });
  revalidatePath("/configuracion");
  revalidatePath("/ordenes/avisos");
  return { ok: true };
}
