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
 * corredor" por una MEDICIÓN — lo que sigue roto por kilómetro, según la
 * operación diaria.
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
 * Cortes de la variable "Estado", en cosas rotas por km (ver recalcularIpi).
 *
 * Son cortes ABSOLUTOS, a propósito: bueno es menos de una cada 333 m, malo
 * una por cuadra, crítico una cada 55 m. Un corte relativo a la mediana de la
 * ciudad escondería la mejora — si se bachea toda la ciudad, la mitad de los
 * corredores seguiría saliendo "mala" contra la otra mitad.
 */
export const CORTES_ESTADO = { bueno: 3, regular: 8, malo: 18 } as const;

/** Los tipos de problema que son calzada: los mismos que cuenta Avance. */
const TIPOS_CALZADA = sql.raw(
  `('bache', 'pavimento_deteriorado', 'hundimiento', 'fisura', 'bocacalle_rota', 'cuneta_rota', 'cuadra_completa')`,
);

/**
 * El Estado mide lo que SIGUE ROTO en el corredor, no lo que se trabajó en él.
 *
 * Antes se contaba "lo reparado en 24 meses + lo pendiente", y eso hacía que
 * bachear un corredor nunca lo mejorara: cada pedido reparado salía de
 * pendiente y entraba a reparado, y con el recuento previo (se reparan
 * también los sin ticket) la cuenta subía. Mate de Luna, con 47 baches
 * reparados en 90 días, figuraba "crítico". Ahora cuentan tres cosas:
 *
 *   - problemas de calzada abiertos (uno por bache, no uno por vecino que
 *     reclamó: la unidad de registro es el bache, no el ticket);
 *   - pedidos de bacheo sin atender: los mismos que la Brecha marca en rojo
 *     (sin arreglo posterior ni problema abierto a 40 m). Un pedido vinculado
 *     a un problema ya reparado no cuenta: antes contaba dos veces;
 *   - reaperturas: un bacheo que cae a menos de 10 m de otro anterior en los
 *     últimos 12 meses — el parche que no aguantó, mismo criterio que
 *     /ordenes/escalamiento. El desgaste de fondo del corredor se sigue
 *     viendo ahí (más del 30% de la cuadra bacheada → Tipo C / A).
 *
 * Un bache reparado que aguanta deja de contar. Y una obra (paño, carpeta o
 * más de 50 m²) borra lo que había antes a menos de 40 m: el pavimento es
 * nuevo. Lo reparado en 24 meses se guarda aparte, para mostrar el trabajo
 * hecho en el corredor sin que pese en contra.
 */
export async function recalcularIpi(sesion: Sesion): Promise<{ corredores: number }> {
  return conRls(claims(sesion), async (tx) => {
    await tx.execute(sql`
      with obras as materialized (
        select i.geom_ejecucion as geom, i.finalizada_en from intervenciones i
        where i.estado = 'finalizada' and i.geom_ejecucion is not null and i.finalizada_en is not null
          and (coalesce(i.tipo_intervencion::text, 'bacheo') <> 'bacheo' or coalesce(i.superficie_m2, 0) >= 50)
      ),
      bacheos as materialized (
        select i.id, i.geom_ejecucion as geom, i.finalizada_en from intervenciones i
        where i.estado = 'finalizada' and i.geom_ejecucion is not null and i.finalizada_en is not null
          and coalesce(i.tipo_intervencion::text, 'bacheo') = 'bacheo' and coalesce(i.superficie_m2, 0) < 50
      ),
      abiertos as materialized (
        select i.geom, i.detectado_en from incidentes i
        where i.estado in ('detectado', 'priorizado', 'programado', 'en_ejecucion')
          and i.tipo::text in ${TIPOS_CALZADA}
      ),
      /**
       * Cada "&& st_expand(…, 0.0005)" es un recorte por recuadro (~50 m)
       * antes de medir en metros: deja usar el índice espacial y baja el
       * cálculo de ~30 s a ~6 s. La distancia que decide es la de st_dwithin.
       */
      rotos as materialized (
        select 'problema' as clase, a.geom from abiertos a
        where not exists (select 1 from obras o
                          where o.finalizada_en > a.detectado_en
                            and o.geom && st_expand(a.geom, 0.0005)
                            and st_dwithin(o.geom::geography, a.geom::geography, 40))
        union all
        select 'pedido', d.geom from demandas d
        where d.estado in ('recibida', 'en_validacion') and d.geom is not null
          and coalesce(d.destino::text, 'bacheo') = 'bacheo'
          and not exists (select 1 from incidentes i
                          where i.estado in ('reparado', 'verificado')
                            and i.geom && st_expand(d.geom, 0.0005)
                            and st_dwithin(i.geom::geography, d.geom::geography, 40)
                            and (d.metadata->>'sin_fecha' is not null or i.cerrado_en >= d.creado_en))
          and not exists (select 1 from abiertos a
                          where a.geom && st_expand(d.geom, 0.0005)
                            and st_dwithin(a.geom::geography, d.geom::geography, 40))
        union all
        select 'reapertura', b.geom from bacheos b
        where b.finalizada_en > now() - interval '12 months'
          and exists (select 1 from bacheos p
                      where p.id <> b.id and p.finalizada_en < b.finalizada_en
                        and p.geom && st_expand(b.geom, 0.0005)
                        and st_dwithin(p.geom::geography, b.geom::geography, 10))
          and not exists (select 1 from obras o
                          where o.finalizada_en > b.finalizada_en
                            and o.geom && st_expand(b.geom, 0.0005)
                            and st_dwithin(o.geom::geography, b.geom::geography, 40))
      ),
      por_corredor as (
        select c.id,
          count(r.clase) filter (where r.clase = 'problema')::int as problemas,
          count(r.clase) filter (where r.clase = 'pedido')::int as pedidos,
          count(r.clase) filter (where r.clase = 'reapertura')::int as reaperturas
        from corredores c
        left join rotos r on r.geom && st_expand(c.geom, 0.0005)
          and st_dwithin(r.geom::geography, c.geom::geography, 25)
        group by c.id
      ),
      arreglados as (
        select c.id, count(b.id)::int as arreglados
        from corredores c
        left join bacheos b on b.finalizada_en > now() - interval '24 months'
          and b.geom && st_expand(c.geom, 0.0005)
          and st_dwithin(b.geom::geography, c.geom::geography, 25)
        group by c.id
      ),
      medido as (
        select c.id, c.nivel, p.problemas, p.pedidos, p.reaperturas, a.arreglados,
               (p.problemas + p.pedidos + p.reaperturas) / greatest(c.longitud_m / 1000.0, 0.05) as densidad
        from corredores c
        join por_corredor p on p.id = c.id
        join arreglados a on a.id = c.id
      ),
      calificado as (
        select id, nivel, problemas, pedidos, reaperturas, arreglados,
               round(densidad::numeric, 2) as densidad,
               case
                 when densidad < ${CORTES_ESTADO.bueno} then 0
                 when densidad < ${CORTES_ESTADO.regular} then 25
                 when densidad < ${CORTES_ESTADO.malo} then 75
                 else 100
               end as v_estado
        from medido
      )
      update corredores c set
        baches_24m = k.arreglados,
        densidad_km = k.densidad,
        v_estado = k.v_estado,
        metadata = c.metadata || jsonb_build_object('estado', jsonb_build_object(
          'problemas', k.problemas, 'pedidos', k.pedidos, 'reaperturas', k.reaperturas)),
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
  /** Baches reparados en 24 meses: el trabajo hecho, que NO pesa en el Estado. */
  arreglados24m: number | null;
  /** Lo que sigue roto por km: es lo que decide el Estado. */
  densidadKm: number | null;
  /** De qué se compone lo roto. Null si el corredor se calculó con la regla anterior. */
  rotos: { problemas: number; pedidos: number; reaperturas: number } | null;
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
             c.baches_24m, c.densidad_km, c.metadata->'estado' as rotos, c.tiene_transporte,
             c.compromiso, c.excluido, c.calculado_en
      from corredores c
      left join sectores_licitacion s on s.id = c.sector_id
      ${sectorId ? sql`where c.sector_id = ${sectorId}` : sql``}
      order by s.sector nulls last, c.nivel, c.ipi desc nulls last
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => {
      const rotos = f.rotos as { problemas?: unknown; pedidos?: unknown; reaperturas?: unknown } | null;
      return {
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
        arreglados24m: f.baches_24m != null ? Number(f.baches_24m) : null,
        densidadKm: f.densidad_km != null ? Number(f.densidad_km) : null,
        rotos: rotos
          ? { problemas: Number(rotos.problemas ?? 0), pedidos: Number(rotos.pedidos ?? 0), reaperturas: Number(rotos.reaperturas ?? 0) }
          : null,
        tieneTransporte: f.tiene_transporte as boolean | null,
        compromiso: Boolean(f.compromiso),
        excluido: Boolean(f.excluido),
        calculadoEn: f.calculado_en != null ? String(f.calculado_en) : null,
      };
    });
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
