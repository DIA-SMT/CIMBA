import { NextResponse } from "next/server";
import { getDb, sql } from "@cimba/db";
import { leerSesion } from "@/lib/auth";
import { feedActividad } from "@/lib/actividad";
import { urlFoto } from "@/lib/fotos";

export const maxDuration = 60;

/**
 * Los datos vivos de la pantalla de comando (/tv): cuatro cifras grandes,
 * los últimos movimientos y las últimas fotos de trabajo. La pantalla los
 * pide cada minuto — todo agregado, nada personal.
 */
export async function GET() {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (sesion.rol_cimba === "empresa") return NextResponse.json({ error: "sin permiso" }, { status: 403 });

  const db = getDb();
  const TZ = "America/Argentina/Buenos_Aires";

  const cifras = (await db.execute(sql`
    select
      (select count(*) from demandas d
        where d.estado in ('recibida','en_validacion') and d.geom is not null
          and coalesce(d.destino::text, 'bacheo') = 'bacheo'
          and not exists (select 1 from incidentes i
            where st_dwithin(i.geom::geography, d.geom::geography, 40)
              and (i.estado in ('detectado','priorizado','programado','en_ejecucion')
                   or (i.estado in ('reparado','verificado')
                       and (d.metadata->>'sin_fecha' = 'true' or i.cerrado_en >= d.creado_en)))))::int as sin_atencion,
      (select count(*) from incidentes where estado = 'en_ejecucion')::int as en_obra,
      (select count(*) from intervenciones iv
        where iv.estado = 'finalizada'
          and (iv.finalizada_en at time zone ${TZ})::date = ((now() at time zone ${TZ})::date - 1))::int as reparados_ayer,
      (select round(coalesce(sum(iv.superficie_m2), 0))::int from intervenciones iv
        where iv.estado = 'finalizada' and iv.finalizada_en >= now() - interval '30 days') as m2_mes
  `)) as unknown as Array<Record<string, unknown>>;
  const c = cifras[0] ?? {};

  // El feed lo leen admin/planificación (misma regla que /actividad); para
  // otros roles la pantalla muestra el resto sin el feed.
  const feed = ["admin", "planificacion"].includes(sesion.rol_cimba)
    ? (await feedActividad(sesion, { limite: 20 })).slice(0, 8)
    : [];

  const fotos = (await db.execute(sql`
    select fo.url_externa, fo.storage_path, fo.momento,
           coalesce(i.direccion, '') as direccion, fo.tomada_en
    from fotografias fo
    left join intervenciones iv on iv.id = fo.intervencion_id
    left join incidentes i on i.id = iv.incidente_id
    where fo.intervencion_id is not null and fo.momento = 'despues'
    order by fo.tomada_en desc nulls last
    limit 3
  `)) as unknown as Array<Record<string, unknown>>;

  return NextResponse.json({
    cifras: {
      sinAtencion: Number(c.sin_atencion ?? 0),
      enObra: Number(c.en_obra ?? 0),
      reparadosAyer: Number(c.reparados_ayer ?? 0),
      m2Mes: Number(c.m2_mes ?? 0),
    },
    feed: feed.map((e) => ({ en: e.en, actor: e.actor, entidad: e.entidad, entidadId: e.entidadId, accion: e.accion, estadoDespues: e.estadoDespues, numero: e.numero, marca: e.marca, m2: e.m2 })),
    fotos: fotos
      .map((f) => ({
        url: urlFoto({ urlExterna: (f.url_externa as string) ?? null, storagePath: (f.storage_path as string) ?? null }),
        direccion: (f.direccion as string) || null,
      }))
      .filter((f): f is { url: string; direccion: string | null } => f.url != null),
  });
}
