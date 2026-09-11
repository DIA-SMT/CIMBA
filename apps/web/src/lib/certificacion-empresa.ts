import "server-only";
import { conRls, sql } from "@cimba/db";
import type { Sesion } from "./auth";
import { REGIMEN } from "./certificacion";

/**
 * LO MISMO QUE VE SUPERVISIÓN, PERO DEL LADO DE LA EMPRESA.
 *
 * "¿Esto se puede cobrar?" es la pregunta que de verdad le importa a una
 * contratista, y hasta ahora la respuesta vivía solo en el tablero del
 * municipio: la empresa cargaba a ciegas y se enteraba del faltante recién
 * cuando le rebotaban la certificación. Mostrarle el estado de su propia
 * medición es, además del acto de transparencia obvio, el mejor incentivo
 * que hay para que cargue completo y a tiempo — lo que no está cargado no
 * entra en el acta, y ahora se ve.
 *
 * Es SOLO LECTURA y siempre acotado a la empresa de la sesión: el cálculo del
 * régimen es el mismo de regimenPorEmpresa (certificacion.ts) y las reglas
 * salen del protocolo de la DOV, no de acá.
 */

const claims = (s: Sesion) => ({
  sub: s.sub,
  rol_cimba: s.rol_cimba,
  id_persona: s.id_persona,
  id_empresa: s.id_empresa,
});

export interface CertificacionEmpresa {
  empresa: string;
  modalidad: "total" | "muestreo";
  motivo: string;
  /** Trabajo cargado que todavía no entró en ningún acta firmada. */
  sinCertificar: { items: number; m2: number };
  /** Lo que ya pasó por acta: es lo único que se certifica a los fines del pago. */
  certificado: { items: number; m2: number };
  /** Cargado en los últimos 30 días, para tener una referencia de ritmo. */
  ultimos30: { items: number; m2: number };
  /** Trabajo cargado sin orden previa: entra igual, pero se mira aparte. */
  sinOrden: { items: number; m2: number };
  ultimaActa: string | null;
  ultimaDesviacion: number | null;
  actas: Array<{
    numero: string;
    fecha: string;
    estado: string;
    modalidad: string;
    puntosInformados: number;
    puntosMedidos: number;
    m2Informados: number;
    m2Medidos: number;
    desviacionPct: number | null;
  }>;
}

export async function certificacionDeEmpresa(
  sesion: Sesion,
  empresaId: number,
): Promise<CertificacionEmpresa | null> {
  return conRls(claims(sesion), async (tx) => {
    const cab = (await tx.execute(sql`
      select e.nombre,
        (select count(*) from orden_items oi
          join ordenes_trabajo ot on ot.id = oi.orden_id
          where ot.empresa_id = e.id and oi.estado = 'hecho' and oi.acta_id is null)::int as sin_items,
        coalesce((select sum(oi.superficie_m2) from orden_items oi
          join ordenes_trabajo ot on ot.id = oi.orden_id
          where ot.empresa_id = e.id and oi.estado = 'hecho' and oi.acta_id is null), 0) as sin_m2,
        (select count(*) from orden_items oi
          join ordenes_trabajo ot on ot.id = oi.orden_id
          where ot.empresa_id = e.id and oi.estado = 'hecho' and oi.acta_id is not null)::int as cert_items,
        coalesce((select sum(oi.superficie_m2) from orden_items oi
          join ordenes_trabajo ot on ot.id = oi.orden_id
          where ot.empresa_id = e.id and oi.estado = 'hecho' and oi.acta_id is not null), 0) as cert_m2,
        (select count(*) from orden_items oi
          join ordenes_trabajo ot on ot.id = oi.orden_id
          where ot.empresa_id = e.id and oi.estado = 'hecho'
            and oi.reportado_en >= now() - interval '30 days')::int as m30_items,
        coalesce((select sum(oi.superficie_m2) from orden_items oi
          join ordenes_trabajo ot on ot.id = oi.orden_id
          where ot.empresa_id = e.id and oi.estado = 'hecho'
            and oi.reportado_en >= now() - interval '30 days'), 0) as m30_m2,
        /* La carga libre no cuelga de ninguna orden: se cuenta por el nombre
           de la empresa en metadata, que es la misma clave con la que entran
           las cargas del Apps Script y las de SIGOV. */
        (select count(*) from intervenciones v
          where v.estado = 'finalizada' and v.metadata->>'sin_orden' = 'true'
            and v.metadata->>'contratista' = e.nombre)::int as libre_items,
        coalesce((select sum(v.superficie_m2) from intervenciones v
          where v.estado = 'finalizada' and v.metadata->>'sin_orden' = 'true'
            and v.metadata->>'contratista' = e.nombre), 0) as libre_m2,
        (select max(a.fecha) from actas_medicion a
          where a.empresa_id = e.id and a.estado = 'firmada') as ultima_acta,
        (select min(a.fecha) from actas_medicion a
          where a.empresa_id = e.id and a.estado = 'firmada') as primera_acta,
        (select a.desviacion_pct from actas_medicion a
          where a.empresa_id = e.id and a.estado = 'firmada'
          order by a.fecha desc limit 1) as ultima_desviacion
      from empresas e
      where e.id = ${empresaId}
    `)) as unknown as Array<Record<string, unknown>>;
    const f = cab[0];
    if (!f) return null;

    const actas = (await tx.execute(sql`
      select a.numero, a.fecha, a.estado::text, a.modalidad,
             a.puntos_informados, a.puntos_medidos, a.m2_informados, a.m2_medidos, a.desviacion_pct
      from actas_medicion a
      where a.empresa_id = ${empresaId}
      order by a.fecha desc, a.id desc
      limit 12
    `)) as unknown as Array<Record<string, unknown>>;

    // Mismo cálculo que regimenPorEmpresa: si cambia allá, cambia acá, o la
    // empresa lee una regla distinta de la que le aplica supervisión.
    const primera = f.primera_acta ? new Date(String(f.primera_acta)) : null;
    const desviacion = f.ultima_desviacion != null ? Number(f.ultima_desviacion) : null;
    const semanas = primera ? (Date.now() - primera.getTime()) / (7 * 24 * 3600 * 1000) : 0;
    let modalidad: "total" | "muestreo" = "total";
    let motivo: string;
    if (!primera) {
      motivo = `Todavía no hay actas firmadas: se mide el 100% de los puntos las primeras ${REGIMEN.semanasMedicionTotal} semanas.`;
    } else if (desviacion != null && desviacion > REGIMEN.desviacionQueObligaTotal) {
      motivo = `La última acta dio ${desviacion.toFixed(1)}% de desviación entre lo informado y lo medido (más de ${REGIMEN.desviacionQueObligaTotal}%): vuelve a medición total.`;
    } else if (semanas < REGIMEN.semanasMedicionTotal) {
      motivo = `Arrancaron hace ${Math.floor(semanas)} semanas: medición total hasta la cuarta.`;
    } else {
      modalidad = "muestreo";
      motivo = `Régimen normal: se mide una muestra de al menos el ${REGIMEN.muestreoMinimoPct}% de los puntos.`;
    }

    return {
      empresa: String(f.nombre),
      modalidad,
      motivo,
      sinCertificar: { items: Number(f.sin_items ?? 0), m2: Number(f.sin_m2 ?? 0) },
      certificado: { items: Number(f.cert_items ?? 0), m2: Number(f.cert_m2 ?? 0) },
      ultimos30: { items: Number(f.m30_items ?? 0), m2: Number(f.m30_m2 ?? 0) },
      sinOrden: { items: Number(f.libre_items ?? 0), m2: Number(f.libre_m2 ?? 0) },
      ultimaActa: f.ultima_acta != null ? String(f.ultima_acta) : null,
      ultimaDesviacion: desviacion,
      actas: actas.map((a) => ({
        numero: String(a.numero),
        fecha: String(a.fecha),
        estado: String(a.estado),
        modalidad: String(a.modalidad),
        puntosInformados: Number(a.puntos_informados ?? 0),
        puntosMedidos: Number(a.puntos_medidos ?? 0),
        m2Informados: Number(a.m2_informados ?? 0),
        m2Medidos: Number(a.m2_medidos ?? 0),
        desviacionPct: a.desviacion_pct != null ? Number(a.desviacion_pct) : null,
      })),
    };
  });
}
