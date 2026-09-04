import { conRls, sql } from "@cimba/db";
import type { Sesion } from "./auth";
import { urlFoto } from "./fotos";

/**
 * Expedientes: las notas administrativas que salen de CIMBA. Hoy, la nota a
 * la SAT; el modelo queda listo para otras derivaciones (Ingeniería, etc.).
 *
 * El detalle de cada reclamo se CONGELA en expediente_demandas al generar:
 * la nota registrada es un documento histórico, no una vista viva.
 */

export const DESTINATARIO_SAT = "Dr. Marcelo Caponio — Director de la S.A.T.";

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

export interface RenglonNota {
  demandaId: number;
  ticket: string | null;
  tipo: string | null;
  direccion: string | null;
  barrio: string | null;
  fechaPedido: string | null;
  lat: number | null;
  lon: number | null;
  fotoUrl: string | null;
}

/**
 * Los reclamos de agua abiertos, con todo lo que la nota necesita mostrar.
 * OJO: sin la descripción libre del vecino — ahí suelen escribir su nombre y
 * teléfono, y esta nota viaja a un organismo externo y queda congelada.
 *
 * La variante `enTx` corre dentro de una transacción existente: la usa
 * generarNotaSat para que el snapshot y la derivación sean UNA operación.
 */
export async function renglonesParaNotaSatEnTx(
  tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> },
): Promise<RenglonNota[]> {
  const filas = (await tx.execute(sql`
    select d.id,
           (select er.id_remoto from external_ref er
              where er.sistema = 'atencion_ciudadana' and er.entidad_local = 'demanda' and er.id_local = d.id
              order by er.sincronizado_en desc limit 1) as ticket,
           d.tipo::text as tipo,
           coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
           b.nombre as barrio,
           case when d.metadata->>'sin_fecha' = 'true' then null
                else to_char(d.creado_en, 'DD/MM/YYYY') end as fecha_pedido,
           st_y(d.geom) as lat, st_x(d.geom) as lon,
           (select f.url_externa from fotografias f where f.demanda_id = d.id
              order by f.tomada_en desc nulls last limit 1) as foto_externa,
           (select f.storage_path from fotografias f where f.demanda_id = d.id
              order by f.tomada_en desc nulls last limit 1) as foto_storage
    from demandas d
    left join barrios b on b.id = d.barrio_id
    where d.destino = 'sat' and d.estado in ('recibida', 'en_validacion')
    order by d.barrio_id nulls last, d.creado_en desc
  `)) as Array<Record<string, unknown>>;

  return filas.map((f) => ({
    demandaId: Number(f.id),
    ticket: (f.ticket as string) ?? null,
    tipo: (f.tipo as string) ?? null,
    direccion: (f.direccion as string) ?? null,
    barrio: (f.barrio as string) ?? null,
    fechaPedido: (f.fecha_pedido as string) ?? null,
    lat: f.lat != null ? Number(f.lat) : null,
    lon: f.lon != null ? Number(f.lon) : null,
    fotoUrl: urlFoto({
      urlExterna: (f.foto_externa as string) ?? null,
      storagePath: (f.foto_storage as string) ?? null,
    }),
  }));
}

export async function renglonesParaNotaSat(sesion: Sesion): Promise<RenglonNota[]> {
  return conRls(claims(sesion), (tx) => renglonesParaNotaSatEnTx(tx));
}

export interface ExpedienteResumen {
  id: number;
  numero: string;
  tipo: string;
  destinatario: string;
  cantidad: number;
  generadoEn: string;
  generadoPor: string | null;
}

export async function listarExpedientes(sesion: Sesion): Promise<ExpedienteResumen[]> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select e.id, e.numero, e.tipo, e.destinatario, e.cantidad, e.generado_en, p.nombre as generado_por
      from expedientes e
      left join perfiles p on p.id = e.generado_por
      order by e.id desc
      limit 200
    `)) as unknown as Array<Record<string, unknown>>;
    return filas.map((f) => ({
      id: Number(f.id),
      numero: String(f.numero),
      tipo: String(f.tipo),
      destinatario: String(f.destinatario),
      cantidad: Number(f.cantidad ?? 0),
      generadoEn: String(f.generado_en),
      generadoPor: (f.generado_por as string) ?? null,
    }));
  });
}

export interface ExpedienteCompleto extends ExpedienteResumen {
  observaciones: string | null;
  renglones: RenglonNota[];
}

export async function obtenerExpediente(sesion: Sesion, id: number): Promise<ExpedienteCompleto | null> {
  return conRls(claims(sesion), async (tx) => {
    const cab = (await tx.execute(sql`
      select e.*, p.nombre as generado_por_nombre
      from expedientes e
      left join perfiles p on p.id = e.generado_por
      where e.id = ${id}
    `)) as unknown as Array<Record<string, unknown>>;
    const e = cab[0];
    if (!e) return null;

    const detalle = (await tx.execute(sql`
      select demanda_id, detalle from expediente_demandas
      where expediente_id = ${id}
      order by demanda_id
    `)) as unknown as Array<{ demanda_id: number; detalle: RenglonNota }>;

    return {
      id: Number(e.id),
      numero: String(e.numero),
      tipo: String(e.tipo),
      destinatario: String(e.destinatario),
      observaciones: (e.observaciones as string) ?? null,
      cantidad: Number(e.cantidad ?? 0),
      generadoEn: String(e.generado_en),
      generadoPor: (e.generado_por_nombre as string) ?? null,
      renglones: detalle.map((d) => ({ ...d.detalle, demandaId: Number(d.demanda_id) })),
    };
  });
}
