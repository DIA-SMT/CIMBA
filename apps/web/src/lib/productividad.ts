import { conRls, sql } from "@cimba/db";
import type { Sesion } from "./auth";

/**
 * Productividad del bacheo: cuántos baches se hacen por día y por mes, por
 * ejecutor, y cómo rinde eso contra la capacidad teórica del Director
 * (10 baches por turno, 2 turnos). Todo sale de las intervenciones
 * FINALIZADAS — trabajo con foto y medidas, no promesas.
 *
 * El ejecutor se resuelve con la MISMA regla que /intervenciones y Migue:
 * cuadrilla propia por su nombre, contratista por metadata, "SIGOV" para la
 * obra contratada histórica — así este informe nunca contradice a las fichas.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

const EJECUTOR = sql`coalesce(c.nombre, iv.metadata->>'contratista', 'Sin asignar')`;

export interface FilaMesEjecutor {
  mes: string; // "2026-09"
  ejecutor: string;
  baches: number;
  m2: number;
  m3: number;
}

export interface FilaDia {
  dia: string; // "2026-09-06"
  baches: number;
  m2: number;
}

export interface Productividad {
  porMes: FilaMesEjecutor[];
  porDia: FilaDia[];
  /** Totales de los últimos 30 días, por ejecutor. */
  ultimos30: Array<{ ejecutor: string; baches: number; m2: number; m3: number; diasActivos: number }>;
}

export async function productividad(sesion: Sesion): Promise<Productividad> {
  return conRls(claims(sesion), async (tx) => {
    // El m³ se reconstruye de las medidas reales cuando están (superficie ×
    // espesor); las intervenciones históricas sin espesor no inventan volumen.
    const porMes = (await tx.execute(sql`
      select to_char(iv.finalizada_en, 'YYYY-MM') as mes,
             ${EJECUTOR} as ejecutor,
             count(*)::int as baches,
             round(coalesce(sum(iv.superficie_m2), 0))::int as m2,
             round(coalesce(sum(iv.superficie_m2 * nullif(iv.materiales->>'espesor_cm', '')::numeric / 100), 0)::numeric, 1) as m3
      from intervenciones iv
      left join cuadrillas c on c.id = iv.cuadrilla_id
      where iv.estado = 'finalizada' and iv.finalizada_en is not null
        and iv.finalizada_en >= date_trunc('month', now()) - interval '5 months'
      group by 1, 2
      order by 1 desc, 3 desc
    `)) as unknown as Array<Record<string, unknown>>;

    const porDia = (await tx.execute(sql`
      select to_char(iv.finalizada_en, 'YYYY-MM-DD') as dia,
             count(*)::int as baches,
             round(coalesce(sum(iv.superficie_m2), 0))::int as m2
      from intervenciones iv
      where iv.estado = 'finalizada' and iv.finalizada_en is not null
        and iv.finalizada_en >= now() - interval '30 days'
      group by 1
      order by 1
    `)) as unknown as Array<Record<string, unknown>>;

    const ultimos30 = (await tx.execute(sql`
      select ${EJECUTOR} as ejecutor,
             count(*)::int as baches,
             round(coalesce(sum(iv.superficie_m2), 0))::int as m2,
             round(coalesce(sum(iv.superficie_m2 * nullif(iv.materiales->>'espesor_cm', '')::numeric / 100), 0)::numeric, 1) as m3,
             count(distinct iv.finalizada_en::date)::int as dias_activos
      from intervenciones iv
      left join cuadrillas c on c.id = iv.cuadrilla_id
      where iv.estado = 'finalizada' and iv.finalizada_en is not null
        and iv.finalizada_en >= now() - interval '30 days'
      group by 1
      order by 2 desc
    `)) as unknown as Array<Record<string, unknown>>;

    return {
      porMes: porMes.map((f) => ({
        mes: String(f.mes),
        ejecutor: String(f.ejecutor),
        baches: Number(f.baches ?? 0),
        m2: Number(f.m2 ?? 0),
        m3: Number(f.m3 ?? 0),
      })),
      porDia: porDia.map((f) => ({
        dia: String(f.dia),
        baches: Number(f.baches ?? 0),
        m2: Number(f.m2 ?? 0),
      })),
      ultimos30: ultimos30.map((f) => ({
        ejecutor: String(f.ejecutor),
        baches: Number(f.baches ?? 0),
        m2: Number(f.m2 ?? 0),
        m3: Number(f.m3 ?? 0),
        diasActivos: Number(f.dias_activos ?? 0),
      })),
    };
  });
}
