import { getDb, sql } from "@cimba/db";
import type { BarrioProps, CapasAvance, CuadraProps } from "./avance-tipos";

/**
 * LAS CAPAS DE ALCANCE de Avance: barrios, cuadras arregladas y a qué cuadra
 * y barrio pertenece cada trabajo. Ver el tipo `CapasAvance`.
 *
 * Cada trabajo va a la cuadra MÁS CERCANA a menos de ~25 m (el 93% de los
 * trabajos cae ahí; el resto queda como punto, sin inventarle calle). Una
 * cuadra de hasta 250 m se pinta entera; en las más largas se pinta solo el
 * tramo de 75 m alrededor de cada trabajo, porque un bache en la avenida no
 * arregla la avenida.
 *
 * No cambia con la ventana ni con el recorte, y lo nuevo entra despacio: se
 * guarda diez minutos en memoria (la promesa, para que diez pantallas
 * abriendo a la vez compartan una sola consulta). Un trabajo cargado en ese
 * rato aparece igual como punto; su calle se pinta en la próxima vuelta.
 */

type Fila = Record<string, unknown>;

/** 250 m: una cuadra común; más que eso es una avenida o un tramo largo. */
const CUADRA_LARGA_M = 250;
const CACHE_MS = 10 * 60_000;
let cache: { en: number; promesa: Promise<CapasAvance> } | null = null;

export function capasAvance(): Promise<CapasAvance> {
  const ahora = Date.now();
  if (cache && ahora - cache.en < CACHE_MS) return cache.promesa;
  const promesa = consultar().catch((e: unknown) => {
    cache = null;
    throw e;
  });
  cache = { en: ahora, promesa };
  return promesa;
}

async function consultar(): Promise<CapasAvance> {
  /* Todo en una transacción y en orden: una conexión, sin competir con la
     transacción de la otra mitad de Avance por el pool. */
  return getDb().transaction(async (db) => {
    const asignacion = (await db.execute(sql`
      select iv.id, c.id as cuadra, c.largo, ba.id as barrio
      from intervenciones iv
      left join lateral (
        select r.id, st_length(r.geom::geography) as largo
        from red_vial r
        where st_dwithin(r.geom, iv.geom_ejecucion, 0.00025)
        order by r.geom <-> iv.geom_ejecucion
        limit 1
      ) c on true
      left join lateral (
        select b.id from barrios b where st_intersects(b.geom, iv.geom_ejecucion) limit 1
      ) ba on true
      where iv.estado = 'finalizada' and iv.geom_ejecucion is not null
    `)) as unknown as Fila[];

    const enteras = new Set<number>();
    const tramos: number[] = [];
    const trabajos: CapasAvance["trabajos"] = asignacion.map((f) => {
      const id = Number(f.id);
      const cuadra = f.cuadra == null ? null : Number(f.cuadra);
      const barrio = f.barrio == null ? null : Number(f.barrio);
      if (cuadra == null) return [id, null, null, barrio];
      if (Number(f.largo) <= CUADRA_LARGA_M) {
        enteras.add(cuadra);
        return [id, `c${cuadra}`, cuadra, barrio];
      }
      tramos.push(id);
      return [id, `l${id}`, cuadra, barrio];
    });

    const filasEnteras =
      enteras.size > 0
        ? ((await db.execute(sql`
            select r.id, r.direccion, st_asgeojson(st_simplify(r.geom, 0.00002), 5)::json as g
            from red_vial r
            where r.id in (${sql.join([...enteras].map((id) => sql`${id}`), sql`, `)})
          `)) as unknown as Fila[])
        : [];

    /* El tramo alrededor del trabajo, sobre SU cuadra (la misma elegida arriba). */
    const filasTramos =
      tramos.length > 0
        ? ((await db.execute(sql`
            select iv.id, c.id as cuadra, c.direccion,
                   st_asgeojson(st_simplify(st_intersection(c.geom, st_buffer(iv.geom_ejecucion::geography, 75)::geometry), 0.00002), 5)::json as g
            from intervenciones iv
            join lateral (
              select r.id, r.direccion, r.geom from red_vial r
              where st_dwithin(r.geom, iv.geom_ejecucion, 0.00025)
              order by r.geom <-> iv.geom_ejecucion
              limit 1
            ) c on true
            where iv.id in (${sql.join(tramos.map((id) => sql`${id}`), sql`, `)})
          `)) as unknown as Fila[])
        : [];

    const barrios = (await db.execute(sql`
      select b.id, b.nombre,
             (select d.id from distritos d where st_intersects(d.geom, st_pointonsurface(b.geom)) limit 1) as distrito,
             st_asgeojson(st_simplifypreservetopology(b.geom, 0.0001), 5)::json as g
      from barrios b
    `)) as unknown as Fila[];

    const esLinea = (g: unknown): g is CapasAvance["cuadras"]["features"][number]["geometry"] =>
      g != null && typeof g === "object" && ["LineString", "MultiLineString"].includes(String((g as { type?: unknown }).type));
    const esArea = (g: unknown): g is CapasAvance["barrios"]["features"][number]["geometry"] =>
      g != null && typeof g === "object" && ["Polygon", "MultiPolygon"].includes(String((g as { type?: unknown }).type));
    const limpio = (s: unknown) => (s == null ? null : String(s).replace(/\s+/g, " ").trim() || null);

    const cuadras: CapasAvance["cuadras"]["features"] = [];
    for (const f of filasEnteras) {
      if (!esLinea(f.g)) continue;
      cuadras.push({
        type: "Feature",
        geometry: f.g,
        properties: { clave: `c${Number(f.id)}`, cuadra: Number(f.id), direccion: limpio(f.direccion) } satisfies CuadraProps,
      });
    }
    const tramosDibujados = new Set<string>();
    for (const f of filasTramos) {
      if (!esLinea(f.g)) continue;
      const clave = `l${Number(f.id)}`;
      tramosDibujados.add(clave);
      cuadras.push({
        type: "Feature",
        geometry: f.g,
        properties: { clave, cuadra: Number(f.cuadra), direccion: limpio(f.direccion) } satisfies CuadraProps,
      });
    }
    /* Un tramo que no se pudo recortar (geometría vacía) no se pinta: el
       trabajo queda como punto, sin clave de cuadra. */
    for (const t of trabajos) {
      if (t[1]?.startsWith("l") && !tramosDibujados.has(t[1])) {
        t[1] = null;
      }
    }

    return {
      barrios: {
        type: "FeatureCollection",
        features: barrios
          .filter((f) => esArea(f.g))
          .map((f) => ({
            type: "Feature" as const,
            geometry: f.g as CapasAvance["barrios"]["features"][number]["geometry"],
            properties: {
              id: Number(f.id),
              nombre: limpio(f.nombre) ?? `Barrio ${String(f.id)}`,
              distrito: f.distrito == null ? null : Number(f.distrito),
            } satisfies BarrioProps,
          })),
      },
      cuadras: { type: "FeatureCollection", features: cuadras },
      trabajos,
    };
  });
}
