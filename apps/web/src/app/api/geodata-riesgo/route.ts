import { NextResponse } from "next/server";
import { getDb, sql } from "@cimba/db";
import { leerSesion } from "@/lib/auth";

export const maxDuration = 60;

/**
 * EL MAPA DEL RIESGO: qué cuadras van a romperse ANTES de que lluevan los
 * reclamos — de apagar incendios a adelantarse. Puntaje 0–100 por tramo
 * PAVIMENTADO de la red vial, EXPLICABLE factor por factor (nada de caja
 * negra: cada peso se puede defender en una reunión):
 *
 *   40 · REINCIDENCIA: pedidos abiertos POSTERIORES a la última reparación
 *        del tramo — ahí ya se arregló y volvió a romperse: falla estructural.
 *   25 · PRESIÓN ABIERTA: pedidos de bacheo abiertos sobre el tramo.
 *   20 · ANTIGÜEDAD: cuánto hace que el pedido más viejo espera (satura a 1 año).
 *   15 · HISTORIAL: cuántas veces ya se intervino el tramo — pavimento fatigado.
 *
 * Solo se devuelven los tramos con puntaje ≥ 25: el mapa del riesgo es una
 * lista corta de cuadras para mirar, no otra alfombra de datos.
 *
 * El cálculo cruza ~10 mil tramos contra demandas/incidentes/intervenciones
 * (todo con índices GiST) y tarda unos segundos: se cachea en memoria 6 horas
 * — el riesgo estructural no cambia minuto a minuto.
 */

const RADIO_M = 30;
let cache: { datos: unknown; en: number } | null = null;
const TTL_MS = 6 * 60 * 60 * 1000;

export async function GET() {
  const sesion = await leerSesion();
  if (!sesion) return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  if (sesion.rol_cimba === "empresa") return NextResponse.json({ error: "sin permiso" }, { status: 403 });

  if (cache && Date.now() - cache.en < TTL_MS) {
    return NextResponse.json(cache.datos, { headers: { "cache-control": "private, max-age=3600" } });
  }

  const filas = (await getDb().execute(sql`
    with tramos as (
      select rv.id, rv.geom, rv.direccion
      from red_vial rv
      where rv.capa = 'pavimento'
    ),
    factores as (
      select t.id, t.direccion, t.geom,
        -- pedidos de bacheo abiertos sobre el tramo
        (select count(*) from demandas d
          where d.estado in ('recibida','en_validacion') and d.geom is not null
            and coalesce(d.destino::text, 'bacheo') = 'bacheo'
            and st_dwithin(d.geom::geography, t.geom::geography, ${RADIO_M}))::int as abiertos,
        -- el más viejo de esos pedidos, en días (0 si no hay o sin fecha confiable)
        coalesce((select max(extract(day from now() - d.creado_en))::int from demandas d
          where d.estado in ('recibida','en_validacion') and d.geom is not null
            and coalesce(d.destino::text, 'bacheo') = 'bacheo'
            and d.metadata->>'sin_fecha' is null
            and st_dwithin(d.geom::geography, t.geom::geography, ${RADIO_M})), 0) as antiguedad_dias,
        -- cuántas veces ya se intervino este tramo (historial de fatiga)
        (select count(*) from intervenciones iv
          where iv.estado = 'finalizada' and iv.geom_ejecucion is not null
            and st_dwithin(iv.geom_ejecucion::geography, t.geom::geography, ${RADIO_M}))::int as reparaciones,
        -- la última reparación sobre el tramo
        (select max(iv.finalizada_en) from intervenciones iv
          where iv.estado = 'finalizada' and iv.geom_ejecucion is not null
            and st_dwithin(iv.geom_ejecucion::geography, t.geom::geography, ${RADIO_M})) as ultima_reparacion
      from tramos t
    ),
    con_reincidencia as (
      select f.*,
        case when f.ultima_reparacion is null then 0 else
          (select count(*) from demandas d
            where d.estado in ('recibida','en_validacion') and d.geom is not null
              and coalesce(d.destino::text, 'bacheo') = 'bacheo'
              and d.creado_en > f.ultima_reparacion
              and st_dwithin(d.geom::geography, f.geom::geography, ${RADIO_M}))::int
        end as reincidentes
      from factores f
      where f.abiertos > 0 or f.reparaciones > 1
    ),
    puntuado as (
      select id, direccion, geom, abiertos, antiguedad_dias, reparaciones, reincidentes,
        round(
          40 * least(1.0, reincidentes / 3.0) +
          25 * least(1.0, abiertos / 5.0) +
          20 * least(1.0, antiguedad_dias / 365.0) +
          15 * least(1.0, reparaciones / 6.0)
        )::int as score
      from con_reincidencia
    )
    select id, direccion, abiertos, antiguedad_dias, reparaciones, reincidentes, score,
           st_asgeojson(st_simplify(geom, 0.00004))::json as geometry
    from puntuado
    where score >= 25
    order by score desc
    limit 800
  `)) as unknown as Array<Record<string, unknown>>;

  const datos = {
    type: "FeatureCollection",
    generado_en: new Date().toISOString(),
    features: filas.map((f) => ({
      type: "Feature",
      geometry: f.geometry,
      properties: {
        id: Number(f.id),
        direccion: (f.direccion as string) ?? null,
        score: Number(f.score),
        reincidentes: Number(f.reincidentes ?? 0),
        abiertos: Number(f.abiertos ?? 0),
        antiguedad_dias: Number(f.antiguedad_dias ?? 0),
        reparaciones: Number(f.reparaciones ?? 0),
      },
    })),
  };

  cache = { datos, en: Date.now() };
  return NextResponse.json(datos, { headers: { "cache-control": "private, max-age=3600" } });
}
