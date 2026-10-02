import { getDb, sql } from "@cimba/db";
import type { RolUsuario } from "@cimba/domain";

export interface PerfilRow {
  id: string;
  id_persona: number;
  nombre: string;
  rol: RolUsuario;
  activo: boolean;
}

/**
 * Quién es el que escribe por Telegram. Traduce un chat a la persona del
 * padrón, que es lo que le permite al bot actuar con sus permisos.
 *
 * Dos cosas que no son opcionales, y por eso van en la consulta y no en el
 * llamador:
 *
 *  - `revocado_en is null`: un vínculo dado de baja no autoriza nada.
 *  - `p.activo`: dar de baja a alguien en CIMBA es `activo = false`, no un
 *    delete, así que el `on delete cascade` del vínculo no se dispara nunca.
 *    Sin este chequeo, suspender a una persona le cerraría la web y le dejaría
 *    el bot funcionando. Se evalúa en CADA pedido, no al vincular: la sesión no
 *    lleva el campo `activo`, así que es el único momento en que se puede ver.
 */
export async function perfilPorChatTelegram(chatId: string): Promise<PerfilRow | null> {
  const filas = (await getDb().execute(sql`
    select p.id, p.id_persona, p.nombre, p.rol, p.activo
    from telegram_vinculos v
    join perfiles p on p.id = v.perfil_id
    where v.chat_id = ${chatId} and v.revocado_en is null and p.activo
    limit 1
  `)) as unknown as PerfilRow[];
  const perfil = filas[0];
  if (!perfil) return null;
  // postgres.js devuelve bigint como string
  return { ...perfil, id_persona: Number(perfil.id_persona) };
}

/** Marca que el vínculo se usó. Best-effort: si falla, la consulta sigue. */
export async function marcarUsoTelegram(chatId: string): Promise<void> {
  await getDb()
    .execute(sql`
      update telegram_vinculos set ultimo_uso = now()
      where chat_id = ${chatId} and revocado_en is null
    `)
    .catch(() => undefined);
}

/** Upsert del espejo local de la identidad municipal. Conserva el rol ya asignado. */
export async function upsertPerfil(datos: {
  idPersona: number;
  idTusuario: number | null;
  nombre: string;
  documento: string | null;
  email: string | null;
  rolInicial: RolUsuario;
}): Promise<PerfilRow> {
  const db = getDb();
  const filas = (await db.execute(sql`
    insert into perfiles (id_persona, id_tusuario, nombre, documento, email, rol, ultimo_ingreso)
    values (${datos.idPersona}, ${datos.idTusuario}, ${datos.nombre}, ${datos.documento},
            ${datos.email}, ${datos.rolInicial}, now())
    on conflict (id_persona) do update set
      id_tusuario = excluded.id_tusuario,
      nombre = excluded.nombre,
      documento = coalesce(excluded.documento, perfiles.documento),
      email = coalesce(excluded.email, perfiles.email),
      ultimo_ingreso = now()
    returning id, id_persona, nombre, rol, activo
  `)) as unknown as PerfilRow[];
  const perfil = filas[0];
  if (!perfil) throw new Error("No se pudo crear el perfil");
  // postgres.js devuelve bigint como string
  return { ...perfil, id_persona: Number(perfil.id_persona) };
}
