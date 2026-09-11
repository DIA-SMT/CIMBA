import "server-only";
import { conRls, sql } from "@cimba/db";
import type { Sesion } from "./auth";

/**
 * TODO LO QUE LA EMPRESA CARGÓ, EN UNA PLANILLA.
 *
 * La contratista carga bache por bache desde el teléfono y hasta acá no tenía
 * forma de llevarse lo suyo: para armar el remito, cruzar contra su propia
 * planilla o discutir una certificación, dependía de que el municipio se lo
 * exportara. Es SU trabajo y su evidencia; que pueda bajarlo es lo mínimo.
 *
 * Junta las dos formas en que una empresa carga, que hasta ahora vivían en
 * tablas distintas: los items de una orden y la carga libre (sin orden). La
 * columna "Orden" es la que las distingue de un vistazo.
 */

const claims = (s: Sesion) => ({
  sub: s.sub,
  rol_cimba: s.rol_cimba,
  id_persona: s.id_persona,
  id_empresa: s.id_empresa,
});

export interface TrabajoExportable {
  fecha: string | null;
  orden: string | null;
  direccion: string | null;
  estado: string;
  tipoIntervencion: string | null;
  tipoObra: string | null;
  anchoM: number | null;
  largoM: number | null;
  espesorCm: number | null;
  superficieM2: number | null;
  volumenM3: number | null;
  capataz: string | null;
  ticket147: string | null;
  observaciones: string | null;
  lat: number | null;
  lon: number | null;
  certificado: boolean;
  fotoAntes: string | null;
  fotoDespues: string | null;
}

export async function trabajosDeEmpresa(
  sesion: Sesion,
  empresaId: number,
  filtros: { ordenId?: number } = {},
): Promise<TrabajoExportable[]> {
  const ordenId = filtros.ordenId ?? null;
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      /* Lo cargado CONTRA UNA ORDEN. Solo los items que la empresa tocó:
         pendiente todavía no es trabajo y no tiene nada que exportar. */
      select oi.reportado_en as fecha,
             ot.numero as orden,
             oi.direccion,
             oi.estado::text as estado,
             iv.tipo_intervencion::text as tipo_intervencion,
             oi.tipo_obra::text as tipo_obra,
             oi.ancho_m, oi.largo_m, oi.espesor_cm, oi.superficie_m2, oi.volumen_m3,
             oi.metadata->>'capataz' as capataz,
             oi.metadata->>'ticket_147' as ticket_147,
             oi.observaciones,
             st_y(oi.geom) as lat, st_x(oi.geom) as lon,
             (oi.acta_id is not null) as certificado,
             (select f.url_externa from fotografias f
                where f.intervencion_id = oi.intervencion_id and f.momento = 'antes'
                order by f.id limit 1) as foto_antes,
             (select f.url_externa from fotografias f
                where f.intervencion_id = oi.intervencion_id and f.momento = 'despues'
                order by f.id limit 1) as foto_despues
      from orden_items oi
      join ordenes_trabajo ot on ot.id = oi.orden_id
      left join intervenciones iv on iv.id = oi.intervencion_id
      where ot.empresa_id = ${empresaId}
        and oi.estado in ('hecho', 'no_encontrado', 'ya_resuelto')
        and (${ordenId}::bigint is null or ot.id = ${ordenId})

      union all

      /* La carga LIBRE, sin orden. Se identifica por el nombre del contratista
         en metadata, que es la misma clave con la que entran las cargas del
         Apps Script y las de SIGOV. Cuando se filtra por una orden puntual,
         esta mitad no corresponde. */
      select iv.finalizada_en as fecha,
             null as orden,
             i.direccion,
             'hecho' as estado,
             iv.tipo_intervencion::text,
             iv.tipo_obra::text,
             (iv.materiales->>'ancho_m')::numeric,
             (iv.materiales->>'largo_m')::numeric,
             (iv.materiales->>'espesor_cm')::numeric,
             iv.superficie_m2, iv.volumen_m3,
             iv.metadata->>'capataz',
             iv.metadata->>'ticket_147',
             iv.observaciones,
             st_y(i.geom), st_x(i.geom),
             false,
             (select f.url_externa from fotografias f
                where f.intervencion_id = iv.id and f.momento = 'antes' order by f.id limit 1),
             (select f.url_externa from fotografias f
                where f.intervencion_id = iv.id and f.momento = 'despues' order by f.id limit 1)
      from intervenciones iv
      join incidentes i on i.id = iv.incidente_id
      join empresas e on e.id = ${empresaId}
      where ${ordenId}::bigint is null
        and iv.estado = 'finalizada'
        and iv.metadata->>'sin_orden' = 'true'
        and iv.metadata->>'contratista' = e.nombre

      order by fecha desc nulls last
    `)) as unknown as Array<Record<string, unknown>>;

    const num = (v: unknown) => (v != null ? Number(v) : null);
    return filas.map((f) => ({
      fecha: f.fecha != null ? String(f.fecha) : null,
      orden: (f.orden as string) ?? null,
      direccion: (f.direccion as string) ?? null,
      estado: String(f.estado),
      tipoIntervencion: (f.tipo_intervencion as string) ?? null,
      tipoObra: (f.tipo_obra as string) ?? null,
      anchoM: num(f.ancho_m),
      largoM: num(f.largo_m),
      espesorCm: num(f.espesor_cm),
      superficieM2: num(f.superficie_m2),
      volumenM3: num(f.volumen_m3),
      capataz: (f.capataz as string) ?? null,
      ticket147: (f.ticket_147 as string) ?? null,
      observaciones: (f.observaciones as string) ?? null,
      lat: num(f.lat),
      lon: num(f.lon),
      certificado: Boolean(f.certificado),
      fotoAntes: (f.foto_antes as string) ?? null,
      fotoDespues: (f.foto_despues as string) ?? null,
    }));
  });
}
