import { conRls, sql } from "@cimba/db";
import type { Sesion } from "./auth";

/**
 * CUADRAS QUE YA NO SE BACHEAN
 *
 * Los criterios de escalamiento del Plan de Acción y Control de Bacheo de la
 * DOV, aplicados sobre la operación real. Son el puente entre el trabajo
 * diario y el Programa Operativo Anual: dicen qué cuadra dejó de ser un
 * problema de mantenimiento y pasó a ser una obra.
 *
 *   hasta 3 baches por cuadra, sin reincidencia      → bacheo común
 *   >30% de la cuadra bacheada en 24 meses           → Obra Tipo C
 *   o 2+ reaperturas en 12 meses                     → Obra Tipo C
 *   3 cuadras contiguas con Tipo C                   → Obra Tipo A + ranking IPI
 *   anegamiento recurrente                           → cordón cuneta o estudio hidráulico
 *   filtración de agua o cloacal                     → provisorio + derivación a SAT
 *
 * El criterio que falta es "piel de cocodrilo en más del 20% del tramo":
 * exige clasificar la patología de cada foto, que todavía no se hace.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

/** Mismo radio que el mapa del riesgo: si dos pantallas miden la misma cuadra
 *  tienen que medirla igual, o el operador ve dos números y no cree ninguno. */
const RADIO_M = 30;
/**
 * Solo cuenta el BACHEO. Un paño de hormigón o una carpeta de 800 m² no son
 * parches acumulados: son la obra que este tablero recomienda. Contarlos daba
 * "100% de la cuadra bacheada" justo en la cuadra recién repavimentada, que
 * es exactamente lo contrario de lo que hay que mostrar.
 */
const ES_BACHEO = (a: string) =>
  sql.raw(`coalesce(${a}.tipo_intervencion::text, 'bacheo') = 'bacheo' and coalesce(${a}.superficie_m2, 0) < 50`);
/** Ancho de calzada supuesto para estimar la superficie de la cuadra. La red
 *  vial es una línea sin ancho; 7 m es la calzada urbana de dos manos típica
 *  de SMT. Es un supuesto declarado, no una medición. */
const ANCHO_CALZADA_M = 7;
/** Umbrales oficiales del Plan de Acción. */
export const UMBRALES = { porcentajeCuadra: 30, reaperturas: 2, cuadrasContiguas: 3 } as const;

export type MotivoEscalamiento =
  | "superficie"
  | "reaperturas"
  | "contiguidad"
  | "anegamiento"
  | "filtracion";

export interface CuadraEscalable {
  id: number;
  direccion: string | null;
  barrio: string | null;
  largoM: number;
  reparaciones: number;
  m2Reparados: number;
  porcentajeCuadra: number;
  reaperturas: number;
  anegamiento: boolean;
  filtracion: boolean;
  /** 'C' obra de paños/cordón cuneta · 'A' repavimentación · 'hidraulica' estudio previo */
  escala: "A" | "C" | "hidraulica";
  motivos: MotivoEscalamiento[];
  lat: number;
  lon: number;
}

let cache: { datos: CuadraEscalable[]; en: number } | null = null;
const TTL_MS = 6 * 60 * 60 * 1000;

/**
 * El cálculo cruza ~8 mil cuadras pavimentadas contra intervenciones, demandas
 * y zonas inundables: tarda unos segundos y se cachea 6 h, igual que el mapa
 * del riesgo. Una cuadra no cambia de categoría en una tarde.
 */
export async function cuadrasEscalables(sesion: Sesion, forzar = false): Promise<CuadraEscalable[]> {
  if (!forzar && cache && Date.now() - cache.en < TTL_MS) return cache.datos;

  const datos = await conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      with cuadras as (
        select rv.id, rv.direccion, rv.barrio, rv.geom,
               st_length(rv.geom::geography) as largo
        from red_vial rv
        where rv.capa = 'pavimento' and st_length(rv.geom::geography) >= 20
      ),
      medido as (
        select c.*,
          (select count(*) from intervenciones i
            where i.estado = 'finalizada' and i.geom_ejecucion is not null
              and ${ES_BACHEO("i")}
              and i.finalizada_en > now() - interval '24 months'
              and st_dwithin(i.geom_ejecucion::geography, c.geom::geography, ${RADIO_M}))::int as reparaciones,
          coalesce((select sum(i.superficie_m2) from intervenciones i
            where i.estado = 'finalizada' and i.geom_ejecucion is not null
              and ${ES_BACHEO("i")}
              and i.finalizada_en > now() - interval '24 months'
              and st_dwithin(i.geom_ejecucion::geography, c.geom::geography, ${RADIO_M})), 0) as m2,
          /**
           * Reapertura = reparación que cae a menos de 10 m de otra anterior
           * sobre la misma cuadra, dentro de los últimos 12 meses. Es el
           * "se reabre o falla" del régimen de garantía: el parche volvió.
           */
          (select count(*) from intervenciones i
            where i.estado = 'finalizada' and i.geom_ejecucion is not null
              and ${ES_BACHEO("i")}
              and i.finalizada_en > now() - interval '12 months'
              and st_dwithin(i.geom_ejecucion::geography, c.geom::geography, ${RADIO_M})
              and exists (
                select 1 from intervenciones prev
                where prev.estado = 'finalizada' and prev.geom_ejecucion is not null
                  and ${ES_BACHEO("prev")}
                  and prev.id <> i.id and prev.finalizada_en < i.finalizada_en
                  and st_dwithin(prev.geom_ejecucion::geography, i.geom_ejecucion::geography, 10)
              ))::int as reaperturas,
          exists (select 1 from zonas_inundables z
                   where st_dwithin(z.geom::geography, c.geom::geography, 40)) as anegamiento,
          exists (select 1 from demandas d
                   where d.tipo = 'perdida_agua' and d.estado in ('recibida','en_validacion','vinculada')
                     and d.geom is not null
                     and st_dwithin(d.geom::geography, c.geom::geography, ${RADIO_M})) as filtracion
        from cuadras c
      ),
      evaluado as (
        select m.*,
          -- Superficie de calzada estimada: largo × ancho supuesto.
          least(100, round((m.m2 / greatest(m.largo * ${ANCHO_CALZADA_M}, 1) * 100)::numeric, 1)) as pct
        from medido m
        where m.reparaciones > 0 or m.anegamiento or m.filtracion
      ),
      candidatas as (
        select *,
          (pct > ${UMBRALES.porcentajeCuadra} or reaperturas >= ${UMBRALES.reaperturas}) as tipo_c
        from evaluado
      ),
      -- Tipo A: tres cuadras Tipo C encadenadas. DBSCAN a 5 m agrupa las que
      -- se tocan punta con punta; con minpoints 3 solo sobreviven las cadenas.
      agrupado as (
        select id,
               st_clusterdbscan(geom, eps := 0.00005, minpoints := ${UMBRALES.cuadrasContiguas})
                 over () as grupo
        from candidatas where tipo_c
      )
      /**
       * La red vial no trae dirección (3 de 7.988 la tienen): la cuadra se
       * nombra con la dirección del pedido más cercano, que es como la
       * llaman las personas que trabajan ahí. "Cuadra #34676" no le sirve
       * a nadie para salir a mirarla.
       */
      select c.id,
             coalesce(c.direccion, cerca.direccion) as direccion,
             coalesce(c.barrio, b.nombre) as barrio,
             round(c.largo::numeric, 0) as largo,
             c.reparaciones, round(c.m2::numeric, 1) as m2, c.pct, c.reaperturas,
             c.anegamiento, c.filtracion, c.tipo_c,
             (a.grupo is not null) as contigua,
             st_y(st_lineinterpolatepoint(st_linemerge(c.geom), 0.5)) as lat,
             st_x(st_lineinterpolatepoint(st_linemerge(c.geom), 0.5)) as lon
      from candidatas c
      left join agrupado a on a.id = c.id
      left join lateral (
        select d.direccion_texto as direccion
        from demandas d
        where d.geom is not null and d.direccion_texto is not null
          and st_dwithin(d.geom::geography, c.geom::geography, ${RADIO_M})
        order by d.geom <-> st_centroid(c.geom)
        limit 1
      ) cerca on true
      left join lateral (
        select bb.nombre from barrios bb
        where st_intersects(bb.geom, c.geom) limit 1
      ) b on true
      where c.tipo_c or c.anegamiento
      order by (a.grupo is not null) desc, c.reaperturas desc, c.pct desc
      limit 400
    `)) as unknown as Array<Record<string, unknown>>;

    return filas.map((f) => {
      const motivos: MotivoEscalamiento[] = [];
      const pct = Number(f.pct ?? 0);
      const reaperturas = Number(f.reaperturas ?? 0);
      if (pct > UMBRALES.porcentajeCuadra) motivos.push("superficie");
      if (reaperturas >= UMBRALES.reaperturas) motivos.push("reaperturas");
      if (f.contigua) motivos.push("contiguidad");
      if (f.anegamiento) motivos.push("anegamiento");
      if (f.filtracion) motivos.push("filtracion");
      /**
       * El anegamiento manda sobre el resto: la norma es explícita en que ahí
       * va estudio hidráulico ANTES que intervención vial — repavimentar una
       * cuadra que se inunda es tirar la plata dos veces.
       */
      const escala = f.anegamiento ? "hidraulica" : f.contigua ? "A" : "C";
      return {
        id: Number(f.id),
        direccion: (f.direccion as string) ?? null,
        barrio: (f.barrio as string) ?? null,
        largoM: Number(f.largo ?? 0),
        reparaciones: Number(f.reparaciones ?? 0),
        m2Reparados: Number(f.m2 ?? 0),
        porcentajeCuadra: pct,
        reaperturas,
        anegamiento: Boolean(f.anegamiento),
        filtracion: Boolean(f.filtracion),
        escala: escala as "A" | "C" | "hidraulica",
        motivos,
        lat: Number(f.lat ?? 0),
        lon: Number(f.lon ?? 0),
      };
    });
  });

  cache = { datos, en: Date.now() };
  return datos;
}

export const ETIQUETA_MOTIVO: Record<MotivoEscalamiento, string> = {
  superficie: `más del ${UMBRALES.porcentajeCuadra}% de la cuadra bacheada en 24 meses`,
  reaperturas: `${UMBRALES.reaperturas} o más reaperturas en 12 meses`,
  contiguidad: `${UMBRALES.cuadrasContiguas} cuadras seguidas en la misma situación`,
  anegamiento: "punto de anegamiento sobre la cuadra",
  filtracion: "pérdida de agua sin resolver",
};

export const ETIQUETA_ESCALA = {
  C: { titulo: "Obra Tipo C", detalle: "paños de hormigón o cordón cuneta, por contratación directa" },
  A: { titulo: "Obra Tipo A", detalle: "repavimentación por licitación — entra al ranking IPI del sector" },
  hidraulica: { titulo: "Estudio hidráulico", detalle: "el agua es la causa: cordón cuneta o estudio antes de tocar la calzada" },
} as const;
