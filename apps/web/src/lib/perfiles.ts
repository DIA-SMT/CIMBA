import { getDb, sql } from "@cimba/db";
import type { RolUsuario } from "@cimba/domain";

export interface PerfilRow {
  id: string;
  id_persona: number;
  nombre: string;
  rol: RolUsuario;
  activo: boolean;
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
  return perfil;
}
