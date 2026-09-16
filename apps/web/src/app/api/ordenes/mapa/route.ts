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

  const filas = await conRls(
    { sub: sesion.sub, rol_cimba: sesion.rol_cimba, id_persona: sesion.id_persona, id_empresa: sesion.id_empresa },
    async (tx) =>
      (await tx.execute(sql`
        select oi.id, ot.numero, ot.tipo::text as tipo_orden, ot.estado::text as estado_orden,
               oi.estado::text as estado_item, oi.direccion, e.nombre as empresa,
               coalesce(ot.emitida_en, ot.creado_en) as fecha,
               st_asgeojson(oi.geom)::json as geometry
        from orden_items oi
        join ordenes_trabajo ot on ot.id = oi.orden_id
        join empresas e on e.id = ot.empresa_id
        where oi.geom is not null
          and ot.estado in ('emitida', 'en_ejecucion', 'completada')
          and coalesce(ot.emitida_en, ot.creado_en) >= ${
            /**
             * "Hoy" es desde la medianoche de Tucumán, no "las últimas 24
             * horas": a las 9 de la mañana, un día corrido se lleva puesta
             * media tarde de ayer y el botón estaría mintiendo. Los demás
             * recortes sí son ventanas corridas, que es lo que se espera de
             * "últimos 30 días".
             */
            dias === 1
              ? sql`date_trunc('day', now() at time zone 'America/Argentina/Tucuman')
                    at time zone 'America/Argentina/Tucuman'`
              : sql`now() - (${dias} || ' days')::interval`
          }
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
        numero: String(f.numero),
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
