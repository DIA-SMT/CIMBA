import { conRls, sql } from "@cimba/db";
import type { Sesion } from "./auth";

/**
 * Actividad y trazabilidad de uso — "fundamental poder trazar cualquier
 * anomalía o mal uso, y hacer seguimiento de quién la usa y quién no".
 *
 * La fuente es la tabla `auditoria`, que los triggers de la base llenan solos
 * en cada alta/cambio/baja de demandas, incidentes, intervenciones, órdenes,
 * items, expedientes y avisos, con el ACTOR de la transacción — más los
 * ingresos, que la ruta de login registra como evento propio. Acá no se
 * escribe nada: solo se lee y se traduce a lenguaje de personas.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

export interface UsoPorPersona {
  id: string;
  nombre: string;
  rol: string;
  usuario: string | null;
  activo: boolean;
  ultimoIngreso: string | null;
  ingresos30: number;
  acciones30: number;
  ultimaAccion: string | null;
}

export async function usoPorPersona(sesion: Sesion): Promise<UsoPorPersona[]> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select p.id, p.nombre, p.rol::text as rol, p.usuario, p.activo, p.ultimo_ingreso,
             (select count(*) from auditoria a
                where a.actor = p.id and a.entidad = 'sesion'
                  and a.ocurrido_en > now() - interval '30 days')::int as ingresos30,
             (select count(*) from auditoria a
                where a.actor = p.id and a.entidad <> 'sesion'
                  and a.ocurrido_en > now() - interval '30 days')::int as acciones30,
             (select max(a.ocurrido_en) from auditoria a where a.actor = p.id) as ultima_accion
      from perfiles p
      order by ultima_accion desc nulls last, p.nombre
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => ({
      id: String(f.id),
      nombre: String(f.nombre),
      rol: String(f.rol),
      usuario: (f.usuario as string) ?? null,
      activo: Boolean(f.activo),
      ultimoIngreso: f.ultimo_ingreso != null ? String(f.ultimo_ingreso) : null,
      ingresos30: Number(f.ingresos30 ?? 0),
      acciones30: Number(f.acciones30 ?? 0),
      ultimaAccion: f.ultima_accion != null ? String(f.ultima_accion) : null,
    }));
  });
}

export interface EventoActividad {
  id: number;
  en: string;
  actorId: string | null;
  actor: string;
  rol: string | null;
  entidad: string;
  entidadId: number;
  accion: string;
  /** Fragmentos ya destilados del diff para armar la frase legible. */
  estadoAntes: string | null;
  estadoDespues: string | null;
  numero: string | null;
  m2: number | null;
  via: string | null;
  marca: string | null;
}

/**
 * El feed: los últimos movimientos, con SOLO los fragmentos útiles del diff
 * (el diff completo trae la fila entera, geometría incluida — leerlo entero
 * para 120 eventos sería carísimo y no aporta nada a la lectura humana).
 */
export async function feedActividad(
  sesion: Sesion,
  filtros: { actor?: string; incluirSistema?: boolean; limite?: number } = {},
): Promise<EventoActividad[]> {
  const limite = Math.min(300, Math.max(20, filtros.limite ?? 120));
  // uuid o nada: el filtro viene de un <select> con ids reales, pero la URL
  // la escribe cualquiera.
  const actor = filtros.actor && /^[0-9a-f-]{36}$/.test(filtros.actor) ? filtros.actor : null;

  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select a.id, a.ocurrido_en, a.entidad, a.entidad_id, a.accion, a.actor,
             p.nombre as actor_nombre, p.rol::text as actor_rol,
             a.diff->'antes'->>'estado' as estado_antes,
             coalesce(a.diff->'despues'->>'estado',
                      case when a.accion = 'insert' then a.diff->>'estado' end) as estado_despues,
             coalesce(a.diff->>'numero', a.diff->'despues'->>'numero') as numero,
             (case when a.entidad = 'intervenciones'
                   then coalesce(a.diff->>'superficie_m2', a.diff->'despues'->>'superficie_m2') end)::numeric as m2,
             a.diff->>'via' as via,
             -- La marca de gestión más significativa del cambio, si la hay:
             -- con eso "update demandas" se vuelve "cerró / derivó / descartó".
             case
               when a.entidad = 'demandas' and (a.diff->'despues'->'metadata' ? 'cierre')
                    and not coalesce(a.diff->'antes'->'metadata' ? 'cierre', false) then 'cierre'
               when a.entidad = 'demandas' and (a.diff->'despues'->'metadata' ? 'derivada')
                    and not coalesce(a.diff->'antes'->'metadata' ? 'derivada', false) then 'derivada'
               when a.entidad = 'demandas' and (a.diff->'despues'->'metadata' ? 'duplicada_de')
                    and not coalesce(a.diff->'antes'->'metadata' ? 'duplicada_de', false) then 'duplicada'
               when a.entidad = 'demandas' and (a.diff->'despues'->'metadata' ? 'tipo_corregido')
                    and not coalesce(a.diff->'antes'->'metadata' ? 'tipo_corregido', false) then 'tipo_corregido'
             end as marca
      from auditoria a
      left join perfiles p on p.id = a.actor
      where true
        ${actor ? sql`and a.actor = ${actor}::uuid` : sql``}
        ${filtros.incluirSistema ? sql`` : sql`and a.actor is not null`}
      order by a.ocurrido_en desc
      limit ${limite}
    `)) as unknown as Array<Record<string, unknown>>;

    return filas.map((f) => ({
      id: Number(f.id),
      en: String(f.ocurrido_en),
      actorId: f.actor != null ? String(f.actor) : null,
      actor: (f.actor_nombre as string) ?? "Sistema (sincronización)",
      rol: (f.actor_rol as string) ?? null,
      entidad: String(f.entidad),
      entidadId: Number(f.entidad_id),
      accion: String(f.accion),
      estadoAntes: (f.estado_antes as string) ?? null,
      estadoDespues: (f.estado_despues as string) ?? null,
      numero: (f.numero as string) ?? null,
      m2: f.m2 != null ? Number(f.m2) : null,
      via: (f.via as string) ?? null,
      marca: (f.marca as string) ?? null,
    }));
  });
}
