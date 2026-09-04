import { conRls, sql } from "@cimba/db";
import type { TipoProblema } from "@cimba/domain";
import type { Sesion } from "./auth";

/**
 * El centro de tratamiento de la demanda: el sistema cruza cada reclamo
 * abierto contra TODO lo que sabe (la red vial real, las reparaciones hechas,
 * los otros reclamos, el destino) y hace saltar el diagnóstico solo — nada de
 * información estática. "Si el reclamo es donde no hay pavimento, no puede
 * ser bache: es un pozo, enripiado" (el Director, 3/9).
 *
 * Señales:
 *  - no_es_bache:  tipificado bache/pavimento pero cae en calle de ripio o
 *                  cordón cuneta → es pasado de máquina (Ingeniería).
 *  - duplicada:    otro reclamo abierto del mismo tipo a <15 m, anterior.
 *  - ya_resuelta:  hay una reparación POSTERIOR al pedido a <25 m.
 *  - derivar_sat:  pérdidas de agua, tapas y sumideros → expediente a la SAT.
 */

export type SenalTratamiento = "no_es_bache" | "duplicada" | "ya_resuelta" | "derivar_sat";

export interface DiagnosticoResumen {
  abiertas: number;
  noEsBache: number;
  duplicadas: number;
  yaResueltas: number;
  derivarSat: number;
  satConFoto: number;
  /** Las que no saltó ninguna señal: la cola limpia de bacheo. */
  limpias: number;
}

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

/** Condiciones de cada señal, compartidas por el resumen y los listados. */
const COND: Record<SenalTratamiento, ReturnType<typeof sql>> = {
  no_es_bache: sql`a.destino = 'ingenieria' and a.tipo in ('bache', 'pavimento_deteriorado')`,
  duplicada: sql`exists (
    select 1 from demandas b
    where (b.creado_en, b.id) < (a.creado_en, a.id) and b.tipo = a.tipo and b.geom is not null
      and b.estado in ('recibida', 'en_validacion')
      and st_dwithin(b.geom::geography, a.geom::geography, 15)
  )`,
  ya_resuelta: sql`exists (
    select 1 from incidentes i
    where i.estado in ('reparado', 'verificado')
      and (a.metadata->>'sin_fecha' = 'true' or i.cerrado_en >= a.creado_en)
      and st_dwithin(i.geom::geography, a.geom::geography, 25)
      and (a.tipo is null or i.tipo = a.tipo
           or (a.tipo in ('bache','pavimento_deteriorado','hundimiento','fisura')
               and i.tipo in ('bache','pavimento_deteriorado','hundimiento','fisura')))
  )`,
  derivar_sat: sql`a.destino = 'sat'`,
};

export async function diagnosticoDemandas(sesion: Sesion): Promise<DiagnosticoResumen> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      with a as (
        select * from demandas
        where estado in ('recibida', 'en_validacion') and geom is not null
      )
      select
        (select count(*) from a)::int as abiertas,
        (select count(*) from a where ${COND.no_es_bache})::int as no_es_bache,
        (select count(*) from a where ${COND.duplicada})::int as duplicadas,
        (select count(*) from a where ${COND.ya_resuelta})::int as ya_resueltas,
        (select count(*) from a where ${COND.derivar_sat})::int as derivar_sat,
        (select count(distinct a.id) from a join fotografias f on f.demanda_id = a.id
           where ${COND.derivar_sat})::int as sat_con_foto,
        (select count(*) from a where (${COND.no_es_bache}) is not true and (${COND.duplicada}) is not true
           and (${COND.ya_resuelta}) is not true and (${COND.derivar_sat}) is not true)::int as limpias
    `)) as unknown as Array<Record<string, unknown>>;
    const f = filas[0] ?? {};
    return {
      abiertas: Number(f.abiertas ?? 0),
      noEsBache: Number(f.no_es_bache ?? 0),
      duplicadas: Number(f.duplicadas ?? 0),
      yaResueltas: Number(f.ya_resueltas ?? 0),
      derivarSat: Number(f.derivar_sat ?? 0),
      satConFoto: Number(f.sat_con_foto ?? 0),
      limpias: Number(f.limpias ?? 0),
    };
  });
}

export interface DemandaDiagnosticada {
  id: number;
  fuente: string;
  tipo: TipoProblema | null;
  direccion: string | null;
  barrio: string | null;
  creadoEn: string;
  lat: number | null;
  lon: number | null;
  tieneFoto: boolean;
  /** Detalle específico de la señal: contra qué chocó y a cuántos metros. */
  detalle: string | null;
  /** Para duplicada: el reclamo original; para ya_resuelta: el incidente. */
  referenciaId: number | null;
}

export async function demandasPorSenal(
  sesion: Sesion,
  senal: SenalTratamiento,
  limite = 300,
): Promise<DemandaDiagnosticada[]> {
  const detalle: Record<SenalTratamiento, ReturnType<typeof sql>> = {
    no_es_bache: sql`
      (select 'Cae en calle de ' || (case rv.capa when 'cordon_cuneta' then 'cordón cuneta' else rv.capa end)
              || coalesce(' (' || rv.direccion || ')', '')
       from red_vial rv where rv.capa in ('ripio', 'cordon_cuneta')
         and st_dwithin(rv.geom::geography, a.geom::geography, 20)
       order by rv.geom <-> a.geom limit 1) as detalle,
      null::bigint as referencia_id`,
    duplicada: sql`
      (select 'A ' || round(st_distance(b.geom::geography, a.geom::geography)) || ' m del reclamo #' || b.id
              || ' (' || to_char(b.creado_en, 'DD/MM/YY') || ')'
       from demandas b where (b.creado_en, b.id) < (a.creado_en, a.id) and b.tipo = a.tipo and b.geom is not null
         and b.estado in ('recibida', 'en_validacion')
         and st_dwithin(b.geom::geography, a.geom::geography, 15)
       order by b.creado_en, b.id limit 1) as detalle,
      (select b.id from demandas b where (b.creado_en, b.id) < (a.creado_en, a.id) and b.tipo = a.tipo and b.geom is not null
         and b.estado in ('recibida', 'en_validacion')
         and st_dwithin(b.geom::geography, a.geom::geography, 15)
       order by b.creado_en, b.id limit 1) as referencia_id`,
    ya_resuelta: sql`
      (select 'Reparado a ' || round(st_distance(i.geom::geography, a.geom::geography)) || ' m el ' ||
              to_char(i.cerrado_en, 'DD/MM/YY') || ' (incidente #' || i.id || ')'
       from incidentes i where i.estado in ('reparado', 'verificado')
         and (a.metadata->>'sin_fecha' = 'true' or i.cerrado_en >= a.creado_en)
         and st_dwithin(i.geom::geography, a.geom::geography, 25)
         and (a.tipo is null or i.tipo = a.tipo
              or (a.tipo in ('bache','pavimento_deteriorado','hundimiento','fisura')
                  and i.tipo in ('bache','pavimento_deteriorado','hundimiento','fisura')))
       order by i.cerrado_en desc limit 1) as detalle,
      (select i.id from incidentes i where i.estado in ('reparado', 'verificado')
         and (a.metadata->>'sin_fecha' = 'true' or i.cerrado_en >= a.creado_en)
         and st_dwithin(i.geom::geography, a.geom::geography, 25)
         and (a.tipo is null or i.tipo = a.tipo
              or (a.tipo in ('bache','pavimento_deteriorado','hundimiento','fisura')
                  and i.tipo in ('bache','pavimento_deteriorado','hundimiento','fisura')))
       order by i.cerrado_en desc limit 1) as referencia_id`,
    derivar_sat: sql`
      (select 'Ticket AC ' || er.id_remoto from external_ref er
       where er.sistema = 'atencion_ciudadana' and er.entidad_local = 'demanda' and er.id_local = a.id
       order by er.sincronizado_en desc limit 1) as detalle,
      null::bigint as referencia_id`,
  };

  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select a.id, a.fuente, a.tipo,
             coalesce(a.direccion_normalizada, a.direccion_texto) as direccion,
             b.nombre as barrio, a.creado_en,
             st_y(a.geom) as lat, st_x(a.geom) as lon,
             exists (select 1 from fotografias f where f.demanda_id = a.id) as tiene_foto,
             ${detalle[senal]}
      from demandas a
      left join barrios b on b.id = a.barrio_id
      where a.estado in ('recibida', 'en_validacion') and a.geom is not null
        and ${COND[senal]}
      order by a.creado_en desc
      limit ${limite}
    `)) as unknown as Array<Record<string, unknown>>;

    return filas.map((f) => ({
      id: Number(f.id),
      fuente: String(f.fuente),
      tipo: (f.tipo as TipoProblema) ?? null,
      direccion: (f.direccion as string) ?? null,
      barrio: (f.barrio as string) ?? null,
      creadoEn: String(f.creado_en),
      lat: f.lat != null ? Number(f.lat) : null,
      lon: f.lon != null ? Number(f.lon) : null,
      tieneFoto: Boolean(f.tiene_foto),
      detalle: (f.detalle as string) ?? null,
      referenciaId: f.referencia_id != null ? Number(f.referencia_id) : null,
    }));
  });
}
