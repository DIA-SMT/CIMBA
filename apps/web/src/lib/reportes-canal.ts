import { conRls, sql } from "@cimba/db";
import type { FuenteDemanda } from "@cimba/domain";
import type { Sesion } from "./auth";

/**
 * EL REPORTE DE VUELTA AL QUE PIDIÓ.
 *
 * "Reporte para DIE para poder presentarle un reporte a Colmenares. Lo mismo
 * para el Concejo Deliberante y para Atención Ciudadana. Para entregarle a la
 * Doctora reportes individuales" — Dirección de Bacheo, 12/09.
 *
 * Ojo con la diferencia respecto de la nota a la SAT, que se parece y no es lo
 * mismo. La nota a la SAT es una DERIVACIÓN: le mandamos trabajo a otro
 * organismo y los reclamos salen de nuestra cola. Esto es una RENDICIÓN: el
 * Concejo pidió 757 cosas y hay que poder contestarle qué pasó con cada una.
 * Por eso este reporte no cambia el estado de ninguna demanda — solo mira.
 *
 * Y mira sin maquillar: los pedidos sin atender salen contados igual que los
 * reparados. Un reporte que solo muestre lo hecho no es un reporte, es un
 * folleto, y el que lo recibe tiene la lista original para comparar.
 */

const claims = (s: Sesion) => ({
  sub: s.sub,
  rol_cimba: s.rol_cimba,
  id_persona: s.id_persona,
  id_empresa: s.id_empresa,
});

/** En qué terminó cada pedido, en el idioma del que lo hizo y no en el nuestro. */
export type EstadoRendicion = "reparado" | "en_curso" | "derivado" | "sin_atender" | "descartado";

export const ETIQUETA_RENDICION: Record<EstadoRendicion, string> = {
  reparado: "Reparado",
  en_curso: "En curso",
  derivado: "Derivado a otro organismo",
  sin_atender: "Sin atender todavía",
  descartado: "Descartado",
};

export interface RenglonReporte {
  demandaId: number;
  fechaPedido: string | null;
  /** Los del consolidado HCD/DIE entraron sin fecha: se dice, no se inventa. */
  sinFecha: boolean;
  direccion: string | null;
  barrio: string | null;
  tipo: string | null;
  solicitante: string | null;
  estado: EstadoRendicion;
  /** Cuándo se reparó, si se reparó. */
  reparadoEn: string | null;
  /** m² de la reparación, para las que tienen medida. */
  superficieM2: number | null;
}

export interface ReporteCanal {
  fuente: FuenteDemanda;
  total: number;
  porEstado: Record<EstadoRendicion, number>;
  /** m² ejecutados sobre los pedidos de este canal. */
  m2: number;
  /** Cuántos entraron sin fecha de origen: condiciona lo que se puede afirmar. */
  sinFecha: number;
  renglones: RenglonReporte[];
}

export async function reporteDeCanal(
  sesion: Sesion,
  fuente: FuenteDemanda,
  limite = 2000,
): Promise<ReporteCanal> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select d.id,
             case when d.metadata->>'sin_fecha' = 'true' then null
                  else to_char(d.creado_en, 'DD/MM/YYYY') end as fecha_pedido,
             (d.metadata->>'sin_fecha' = 'true') as sin_fecha,
             coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
             b.nombre as barrio,
             d.tipo::text as tipo,
             d.solicitante,
             d.estado::text as estado_demanda,
             /* El estado del INCIDENTE es lo que de verdad contesta "¿lo
                arreglaron?": una demanda 'vinculada' puede estar reparada o
                esperando hace un año, y son respuestas muy distintas. */
             (select i.estado::text from demanda_incidente di
                join incidentes i on i.id = di.incidente_id
                where di.demanda_id = d.id
                order by i.cerrado_en desc nulls last limit 1) as estado_incidente,
             (select to_char(i.cerrado_en, 'DD/MM/YYYY') from demanda_incidente di
                join incidentes i on i.id = di.incidente_id
                where di.demanda_id = d.id and i.cerrado_en is not null
                order by i.cerrado_en desc limit 1) as reparado_en,
             (select round(sum(iv.superficie_m2)::numeric, 2) from demanda_incidente di
                join intervenciones iv on iv.incidente_id = di.incidente_id
                where di.demanda_id = d.id and iv.estado = 'finalizada') as superficie
      from demandas d
      left join barrios b on b.id = d.barrio_id
      where d.fuente = ${fuente}
      order by d.creado_en desc
      limit ${limite}
    `)) as unknown as Array<Record<string, unknown>>;

    const renglones: RenglonReporte[] = filas.map((f) => {
      const estadoDemanda = String(f.estado_demanda);
      const estadoIncidente = (f.estado_incidente as string) ?? null;
      /**
       * Cómo se traduce cada situación a la respuesta que espera quien pidió.
       * El orden importa: 'descartada' y 'fuera_de_alcance' mandan sobre el
       * incidente, porque son decisiones nuestras sobre el pedido en sí.
       */
      const estado: EstadoRendicion =
        estadoDemanda === "descartada"
          ? "descartado"
          : estadoDemanda === "fuera_de_alcance"
            ? "derivado"
            : estadoIncidente === "reparado" || estadoIncidente === "verificado"
              ? "reparado"
              : estadoIncidente === "programado" || estadoIncidente === "en_ejecucion"
                ? "en_curso"
                : "sin_atender";
      return {
        demandaId: Number(f.id),
        fechaPedido: (f.fecha_pedido as string) ?? null,
        sinFecha: Boolean(f.sin_fecha),
        direccion: (f.direccion as string) ?? null,
        barrio: (f.barrio as string) ?? null,
        tipo: (f.tipo as string) ?? null,
        solicitante: (f.solicitante as string) ?? null,
        estado,
        reparadoEn: (f.reparado_en as string) ?? null,
        superficieM2: f.superficie != null ? Number(f.superficie) : null,
      };
    });

    const porEstado: Record<EstadoRendicion, number> = {
      reparado: 0,
      en_curso: 0,
      derivado: 0,
      sin_atender: 0,
      descartado: 0,
    };
    let m2 = 0;
    let sinFecha = 0;
    for (const r of renglones) {
      porEstado[r.estado] += 1;
      if (r.estado === "reparado" && r.superficieM2) m2 += r.superficieM2;
      if (r.sinFecha) sinFecha += 1;
    }

    return {
      fuente,
      total: renglones.length,
      porEstado,
      m2: Math.round(m2),
      sinFecha,
      renglones,
    };
  });
}
