import { NextResponse, type NextRequest } from "next/server";
import { conRls, sql } from "@cimba/db";
import { leerSesion } from "@/lib/auth";

export const maxDuration = 60;

/**
 * DÓNDE SE ESTÁ TRABAJANDO. El mapa de las órdenes del último mes, cada una
 * con el color de su empresa.
 *
 * Leo, 10/9: "en la función órdenes también poder ver un mapa de las órdenes
 * que vas dando, del último mes, zonificado por empresa — para no superponer".
 * El problema real que lo motiva: dos inspectores generaron la misma obra en
 * la misma bocacalle porque nadie veía lo que ya estaba mandado.
 */
export async function GET(req: NextRequest) {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  // Es el tablero de asignación de trabajo de toda la ciudad: no es algo que
  // una contratista deba poder enumerar.
  if (!["admin", "planificacion", "supervision"].includes(sesion.rol_cimba)) {
    return NextResponse.json({ error: "sin permiso" }, { status: 403 });
  }

  /**
   * El piso era 7 días, así que "hoy" era imposible de pedir: el parámetro se
   * subía solo a una semana sin decirlo. La Dirección de Bacheo pidió el
   * recorte de HOY y el de ESTA SEMANA (16/09) — que es la pregunta de la
   * mañana: qué se mandó a hacer y dónde, para no pisarse entre inspectores.
   */
  const dias = Math.min(180, Math.max(1, Number(req.nextUrl.searchParams.get("dias") ?? 30)));

  /**
   * "Hoy" es desde la medianoche de Tucumán, no "las últimas 24 horas": a las
   * 9 de la mañana, un día corrido se lleva puesta media tarde de ayer y el
   * botón estaría mintiendo. Los demás recortes sí son ventanas corridas, que
   * es lo que se espera de "últimos 30 días".
   */
  const desde =
    dias === 1
      ? sql`date_trunc('day', now() at time zone 'America/Argentina/Tucuman')
            at time zone 'America/Argentina/Tucuman'`
      : sql`now() - (${dias} || ' days')::interval`;

  const filas = await conRls(
    { sub: sesion.sub, rol_cimba: sesion.rol_cimba, id_persona: sesion.id_persona, id_empresa: sesion.id_empresa },
    async (tx) =>
      (await tx.execute(sql`
        select oi.id, ot.numero, ot.tipo::text as tipo_orden, ot.estado::text as estado_orden,
               oi.estado::text as estado_item, oi.direccion, e.nombre as empresa,
               coalesce(ot.emitida_en, ot.creado_en) as fecha,
               'orden' as fuente,
               st_asgeojson(oi.geom)::json as geometry
        from orden_items oi
        join ordenes_trabajo ot on ot.id = oi.orden_id
        join empresas e on e.id = ot.empresa_id
        where oi.geom is not null
          and ot.estado in ('emitida', 'en_ejecucion', 'completada')
          and coalesce(ot.emitida_en, ot.creado_en) >= ${desde}

        union all

        /**
         * LO QUE SE TRABAJA SIN PASAR POR UNA ORDEN DE CIMBA.
         *
         * La mitad larga del bacheo de la ciudad entra por archivo o por la
         * sincronización con la app de las empresas: la planilla mensual, el
         * SIGOV, la carga libre del portal. Ese trabajo existe, ocupa la misma
         * cuadra y lo hace la misma contratista, pero el mapa no lo dibujaba —
         * así que "dónde se está trabajando hoy" mostraba solo el pedazo que
         * se había mandado por orden, y el inspector que miraba para no
         * superponerse veía media ciudad vacía que en realidad no lo estaba.
         *
         * La fecha acá es la del TRABAJO (finalizada_en), no la de ninguna
         * emisión: es lo único que tienen, y es lo que se está preguntando.
         */
        select iv.id, null as numero, 'bacheo' as tipo_orden, 'externa' as estado_orden,
               'hecho' as estado_item, i.direccion,
               coalesce(iv.metadata->>'contratista', iv.metadata->>'empresa', 'Sin empresa') as empresa,
               coalesce(iv.finalizada_en, iv.iniciada_en) as fecha,
               'archivo' as fuente,
               st_asgeojson(st_centroid(iv.geom_ejecucion))::json as geometry
        from intervenciones iv
        join incidentes i on i.id = iv.incidente_id
        where iv.geom_ejecucion is not null
          and iv.estado = 'finalizada'
          and coalesce(iv.finalizada_en, iv.iniciada_en) >= ${desde}
          -- Lo que YA está como item de una orden no se dibuja dos veces.
          and not exists (
            select 1 from orden_items oi2 where oi2.intervencion_id = iv.id
          )

        order by fecha desc
        limit 4000
      `)) as unknown as Array<Record<string, unknown>>,
  );

  return NextResponse.json({
    type: "FeatureCollection",
    features: filas.map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        id: Number(f.id),
        numero: f.numero != null ? String(f.numero) : null,
        /* De dónde salió: una orden de CIMBA o una carga externa (planilla,
           SIGOV, la app de la empresa). El mapa los dibuja distinto — lo que
           se mandó por orden tiene borde, lo externo no— porque no es lo
           mismo "esto está encargado" que "esto lo hicieron y lo informaron". */
        fuente: String(f.fuente),
        empresa: String(f.empresa),
        tipoOrden: String(f.tipo_orden),
        estadoOrden: String(f.estado_orden),
        estadoItem: String(f.estado_item),
        direccion: (f.direccion as string) ?? null,
        fecha: String(f.fecha),
      },
    })),
  });
}
