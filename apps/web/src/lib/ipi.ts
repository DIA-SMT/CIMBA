import { conRls, sql } from "@cimba/db";
import type { Sesion } from "./auth";

/**
 * ÍNDICE DE PRIORIDAD DE INTERVENCIÓN (IPI)
 *
 * La metodología oficial del municipio ("Plan de priorización de corredores
 * viales", Subsecretaría de Gestión Estratégica y Documentación). CIMBA no
 * inventa acá: reproduce la fórmula aprobada para que el ranking que sale del
 * sistema sea el mismo con el que se arma el Plan de Obras.
 *
 *   IPI = Σ (variable normalizada 0-100 × peso según nivel jerárquico)
 *
 * Lo que CIMBA aporta es lo que la metodología pide expresamente en su
 * apartado 1.11: reemplazar la apreciación cualitativa del "Estado del
 * corredor" por una MEDICIÓN — la densidad de patologías por kilómetro que
 * sale de la operación diaria.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

/** Pesos oficiales por nivel jerárquico (manual metodológico, Etapa 2 · Paso 3). */
export const PESOS_IPI = {
  1: { interconexion: 0.35, accesibilidad: 0.25, estado: 0.2, transporte: 0.1, equipamientos: 0.05, factibilidad: 0.05 },
  2: { interconexion: 0.3, estado: 0.25, equipamientos: 0.15, transporte: 0.1, accesibilidad: 0.1, factibilidad: 0.1 },
  3: { estado: 0.4, factibilidad: 0.2, equipamientos: 0.15, transporte: 0.1, interconexion: 0.1, accesibilidad: 0.05 },
} as const;

export const NIVEL_IPI = {
  1: "Interconexión urbana",
  2: "Estructurante interno",
  3: "Calle barrial",
} as const;

/**
 * Cortes de la variable "Estado", en patologías por km acumuladas en 24 meses.
 *
 * Calibrados contra la distribución real de la ciudad (mediana ≈ 8/km) para
 * que los cuatro grados oficiales queden poblados y no todo caiga en uno.
 * Son el primer calibrado: se revisan con la DOV cuando haya un año completo
 * de operación cargada.
 */
export const CORTES_ESTADO = { bueno: 3, regular: 8, malo: 18 } as const;

/**
 * Se cuentan las patologías REPARADAS y las PENDIENTES juntas, no solo las
 * reparadas. La metodología habla de "densidad de baches reparados", pero su
 * propio objetivo 1 es registrar la patología "tanto previo a la intervención
 * como en su estado final reparado" — y contar solo lo reparado premia al
 * corredor que nadie atendió nunca: cero reparaciones se leería "bueno"
 * justo donde la calle está deshecha y abandonada.
 */
export async function recalcularIpi(sesion: Sesion): Promise<{ corredores: number }> {
  return conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      with patologias as (
        select c.id,
          /**
           * Solo el BACHEO cuenta como patología. Una repavimentación de 800
           * m² no es evidencia de deterioro actual: es la obra que ya se hizo
           * — y si contara, el corredor recién arreglado saldría "crítico".
           * Mismo criterio que /ordenes/escalamiento, a propósito: dos
           * pantallas que miden la misma calle tienen que medirla igual.
           */
          (select count(*) from intervenciones i
            where i.geom_ejecucion is not null
              and coalesce(i.tipo_intervencion::text, 'bacheo') = 'bacheo'
              and coalesce(i.superficie_m2, 0) < 50
              and i.finalizada_en > now() - interval '24 months'
              and st_dwithin(i.geom_ejecucion::geography, c.geom::geography, 25)) as reparadas,
          (select count(*) from demandas d
            where d.geom is not null
              and d.estado in ('recibida', 'en_validacion', 'vinculada')
              and st_dwithin(d.geom::geography, c.geom::geography, 25)) as pendientes
        from corredores c
      ),
      medido as (
        select c.id, c.nivel, c.longitud_m,
               (p.reparadas + p.pendientes) as total,
               (p.reparadas + p.pendientes) / greatest(c.longitud_m / 1000.0, 0.05) as densidad
        from corredores c join patologias p on p.id = c.id
      ),
      calificado as (
        select id, nivel, total, round(densidad::numeric, 2) as densidad,
               case
                 when densidad < ${CORTES_ESTADO.bueno} then 0
                 when densidad < ${CORTES_ESTADO.regular} then 25
                 when densidad < ${CORTES_ESTADO.malo} then 75
                 else 100
               end as v_estado
        from medido
      )
      update corredores c set
        baches_24m = k.total,
        densidad_km = k.densidad,
        v_estado = k.v_estado,
        calculado_en = now(),
        /**
         * Los pesos se RENORMALIZAN sobre las variables que existen. Hoy falta
         * la capa de equipamientos urbanos: si su peso se contara como cero,
         * todos los corredores perderían el mismo 5-15% y el índice dejaría de
         * ser comparable con el que calcula la Subsecretaría a mano. Dividir
         * por la suma de los pesos disponibles mantiene la escala 0-100.
         */
        ipi = round((
          (case when k.v_estado is null then 0 else k.v_estado * (case k.nivel when 1 then 0.20 when 2 then 0.25 else 0.40 end) end)
          + (case when c.v_interconexion is null then 0 else c.v_interconexion * (case k.nivel when 1 then 0.35 when 2 then 0.30 else 0.10 end) end)
          + (case when c.v_accesibilidad is null then 0 else c.v_accesibilidad * (case k.nivel when 1 then 0.25 when 2 then 0.10 else 0.05 end) end)
          + (case when c.v_transporte is null then 0 else c.v_transporte * (case k.nivel when 1 then 0.10 when 2 then 0.10 else 0.10 end) end)
          + (case when c.v_equipamientos is null then 0 else c.v_equipamientos * (case k.nivel when 1 then 0.05 when 2 then 0.15 else 0.15 end) end)
          + (case when c.v_factibilidad is null then 0 else c.v_factibilidad * (case k.nivel when 1 then 0.05 when 2 then 0.10 else 0.20 end) end)
        ) / nullif(
          (case when k.v_estado is null then 0 else (case k.nivel when 1 then 0.20 when 2 then 0.25 else 0.40 end) end)
          + (case when c.v_interconexion is null then 0 else (case k.nivel when 1 then 0.35 when 2 then 0.30 else 0.10 end) end)
          + (case when c.v_accesibilidad is null then 0 else (case k.nivel when 1 then 0.25 when 2 then 0.10 else 0.05 end) end)
          + (case when c.v_transporte is null then 0 else (case k.nivel when 1 then 0.10 when 2 then 0.10 else 0.10 end) end)
          + (case when c.v_equipamientos is null then 0 else (case k.nivel when 1 then 0.05 when 2 then 0.15 else 0.15 end) end)
          + (case when c.v_factibilidad is null then 0 else (case k.nivel when 1 then 0.05 when 2 then 0.10 else 0.20 end) end)
        , 0)::numeric, 2)
      from calificado k
      where k.id = c.id
    `);
    const filas = (await tx.execute(sql`select count(*)::int as n from corredores where ipi is not null`)) as unknown as Array<{ n: number }>;
    return { corredores: Number(filas[0]?.n ?? 0) };
  });
}

export interface CorredorIpi {
  id: number;
  nombre: string;
  sector: string | null;
  nivel: 1 | 2 | 3;
  longitudM: number;
  ipi: number | null;
  vEstado: number | null;
  vInterconexion: number | null;
  vAccesibilidad: number | null;
  vTransporte: number | null;
  vEquipamientos: number | null;
  vFactibilidad: number | null;
  barriosConectados: number | null;
  baches24m: number | null;
  densidadKm: number | null;
  tieneTransporte: boolean | null;
  compromiso: boolean;
  excluido: boolean;
  calculadoEn: string | null;
}

/** El ranking, ordenado como manda la metodología: por sector, y dentro de
 *  cada sector por nivel jerárquico y después por IPI. */
export async function rankingIpi(sesion: Sesion, sectorId?: number): Promise<CorredorIpi[]> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select c.id, c.nombre, s.sector, c.nivel, c.longitud_m, c.ipi,
             c.v_estado, c.v_interconexion, c.v_accesibilidad, c.v_transporte,
             c.v_equipamientos, c.v_factibilidad, c.barrios_conectados,
             c.baches_24m, c.densidad_km, c.tiene_transporte, c.compromiso,
             c.excluido, c.calculado_en
      from corredores c
      left join sectores_licitacion s on s.id = c.sector_id
      ${sectorId ? sql`where c.sector_id = ${sectorId}` : sql``}
      order by s.sector nulls last, c.nivel, c.ipi desc nulls last
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => ({
      id: Number(f.id),
      nombre: String(f.nombre),
      sector: (f.sector as string) ?? null,
      nivel: Number(f.nivel) as 1 | 2 | 3,
      longitudM: Number(f.longitud_m ?? 0),
      ipi: f.ipi != null ? Number(f.ipi) : null,
      vEstado: f.v_estado != null ? Number(f.v_estado) : null,
      vInterconexion: f.v_interconexion != null ? Number(f.v_interconexion) : null,
      vAccesibilidad: f.v_accesibilidad != null ? Number(f.v_accesibilidad) : null,
      vTransporte: f.v_transporte != null ? Number(f.v_transporte) : null,
      vEquipamientos: f.v_equipamientos != null ? Number(f.v_equipamientos) : null,
      vFactibilidad: f.v_factibilidad != null ? Number(f.v_factibilidad) : null,
      barriosConectados: f.barrios_conectados != null ? Number(f.barrios_conectados) : null,
      baches24m: f.baches_24m != null ? Number(f.baches_24m) : null,
      densidadKm: f.densidad_km != null ? Number(f.densidad_km) : null,
      tieneTransporte: f.tiene_transporte as boolean | null,
      compromiso: Boolean(f.compromiso),
      excluido: Boolean(f.excluido),
      calculadoEn: f.calculado_en != null ? String(f.calculado_en) : null,
    }));
  });
}

/** El nombre del GIS viene "APELLIDO; NOMBRE": se lee al derecho. */
export function nombreCorredor(nombre: string): string {
  const partes = nombre.split(";").map((p) => p.trim()).filter(Boolean);
  return partes.length === 2 ? `${partes[1]} ${partes[0]}` : nombre;
}

/** La palabra del grado, para no mostrar solo el número. */
export function gradoEstado(v: number | null): string {
  if (v == null) return "sin calcular";
  if (v >= 100) return "crítico";
  if (v >= 75) return "malo";
  if (v >= 25) return "regular";
  return "bueno";
}
