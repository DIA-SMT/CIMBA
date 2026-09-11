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
