import { conRls, sql } from "@cimba/db";
import type { Sesion } from "./auth";

/**
 * EL CONTROL DE LO CARGADO.
 *
 * "Para realizar el control de los inspectores de las dimensiones y las
 * fotos, así como también eliminar un punto, por potenciales duplicados o
 * cargado erróneo" (Dirección de Bacheo, 12/10).
 *
 * Hasta acá, lo que cargaba una empresa por el portal entraba firme: se veía
 * orden por orden, se podía corregir la medida, pero no había una cola de
 * "lo que todavía nadie miró" ni forma de sacar un punto ya reportado. Esta
 * consulta arma esa cola: cada bache cargado y todavía sin certificar, con sus
 * fotos, sus medidas y lo que hace sospechar de él.
 *
 * Lo que ya entró en un acta de medición firmada no aparece: está certificado
 * y no se toca.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

/** Cuántas cargas por página: con dos fotos cada una, más no se mira bien. */
export const CARGAS_POR_PAGINA = 30;

export type VistaControl = "sin_revisar" | "revisados" | "bajas" | "todos";

/** A cuántos metros otra carga de la misma empresa se ofrece como "el original". */
export const METROS_CANDIDATO_DUPLICADO = 30;
/** Y a cuántos ya salta la alarma de "hay otra carga acá mismo". */
const METROS_ALARMA_CERCA = 10;

export interface BajaCarga {
  motivo: "duplicado" | "mal_cargado";
  detalle: string | null;
  por: string;
  en: string;
  /** Duplicado: de cuál. */
  original?: { item: number; orden: string | null } | null;
}

export interface CargaControl {
  itemId: number;
  ordenId: number;
  ordenNumero: string;
  ordenEstado: string;
  empresa: string;
  direccion: string | null;
  estado: string;
  lat: number | null;
  lon: number | null;
  reportadoEn: string | null;
  capataz: string | null;
  anchoM: number | null;
  largoM: number | null;
  espesorCm: number | null;
  superficieM2: number | null;
  volumenM3: number | null;
  tipoObra: string | null;
  /** Cómo se midió en la calle: lados, superficie o volumen de mezcla. */
  medicion: string | null;
  fotos: Array<{ momento: string; storagePath: string | null; urlExterna: string | null }>;
  /** Quién la dio por buena, si alguien la miró. */
  controlado: { por: string; en: string } | null;
  /** La última baja, si la tuvo (aunque después se haya vuelto a cargar). */
  baja: BajaCarga | null;
  /** Lo que hace sospechar de la carga, en palabras. */
  alarmas: string[];
  /** Otras cargas de la misma empresa cerca: los candidatos a "original". */
  cercanas: Array<{
    itemId: number;
    orden: string;
    direccion: string | null;
    reportadoEn: string | null;
    metros: number;
    foto: string | null;
  }>;
}

export interface ResultadoControl {
  cargas: CargaControl[];
  total: number;
  /** Cuántas hay en cada vista, para los botones de arriba. */
  conteo: Record<VistaControl, number>;
}

/**
 * La condición de cada vista. "Sin revisar" es lo hecho y sin marca de
 * control; "dados de baja" son los que hoy no cuentan por una baja (los que
 * se volvieron a cargar ya están de nuevo en "sin revisar").
 */
function filtroVista(vista: VistaControl) {
  const hecho = sql`(oi.estado = 'hecho' and oi.acta_id is null)`;
  const deBaja = sql`(oi.estado in ('rechazado', 'pendiente') and jsonb_array_length(coalesce(oi.metadata->'bajas', '[]'::jsonb)) > 0)`;
  if (vista === "sin_revisar") return sql`${hecho} and not (oi.metadata ? 'control')`;
  if (vista === "revisados") return sql`${hecho} and oi.metadata ? 'control'`;
  if (vista === "bajas") return deBaja;
  return sql`(${hecho} or ${deBaja})`;
}

export async function cargasParaControlar(
  sesion: Sesion,
  opciones: { vista: VistaControl; empresaId?: number | null; ordenId?: number | null; pagina?: number },
): Promise<ResultadoControl> {
  const empresaId = opciones.empresaId ?? null;
  const ordenId = opciones.ordenId ?? null;
  const pagina = Math.max(1, opciones.pagina ?? 1);
  const alcance = sql`
    (${empresaId}::bigint is null or ot.empresa_id = ${empresaId})
    and (${ordenId}::bigint is null or ot.id = ${ordenId})
  `;

  return conRls(claims(sesion), async (tx) => {
    const conteos = (await tx.execute(sql`
      select
        count(*) filter (where ${filtroVista("sin_revisar")})::int as sin_revisar,
        count(*) filter (where ${filtroVista("revisados")})::int as revisados,
        count(*) filter (where ${filtroVista("bajas")})::int as bajas,
        count(*) filter (where ${filtroVista("todos")})::int as todos
      from orden_items oi
      join ordenes_trabajo ot on ot.id = oi.orden_id
      where ${alcance}
    `)) as unknown as Array<Record<VistaControl, number>>;
    const conteo: Record<VistaControl, number> = {
      sin_revisar: Number(conteos[0]?.sin_revisar ?? 0),
      revisados: Number(conteos[0]?.revisados ?? 0),
      bajas: Number(conteos[0]?.bajas ?? 0),
      todos: Number(conteos[0]?.todos ?? 0),
    };

    const filas = (await tx.execute(sql`
      select oi.id, oi.orden_id, ot.numero, ot.estado::text as orden_estado, e.nombre as empresa,
             oi.direccion, oi.estado::text as estado,
             st_y(st_centroid(oi.geom)) as lat, st_x(st_centroid(oi.geom)) as lon,
             oi.reportado_en, oi.ancho_m, oi.largo_m, oi.espesor_cm, oi.superficie_m2, oi.volumen_m3,
             oi.tipo_obra::text as tipo_obra, oi.metadata,
             /* Las fotos de la carga. Si se dio de baja por mal cargada, el
                item ya no apunta a esa intervención: la baja guarda cuál era. */
             coalesce((
               select json_agg(json_build_object(
                        'momento', f.momento, 'storagePath', f.storage_path, 'urlExterna', f.url_externa)
                      order by f.momento)
               from fotografias f
               where f.intervencion_id = coalesce(
                 oi.intervencion_id,
                 (oi.metadata->'bajas'->-1->>'intervencion')::bigint)
             ), '[]'::json) as fotos,
             /* Otras cargas de la MISMA empresa a menos de 30 m: es donde se
                esconde el duplicado, y son las que se ofrecen como original. */
             coalesce((
               select json_agg(c order by c.metros)
               from (
                 select o2.id as "itemId", ot2.numero as orden, o2.direccion,
                        o2.reportado_en as "reportadoEn",
                        round(st_distance(o2.geom::geography, oi.geom::geography))::int as metros,
                        (select f.storage_path from fotografias f
                          where f.intervencion_id = o2.intervencion_id and f.momento = 'despues'
                          limit 1) as foto
                 from orden_items o2
                 join ordenes_trabajo ot2 on ot2.id = o2.orden_id
                 where o2.id <> oi.id and o2.estado = 'hecho'
                   and ot2.empresa_id = ot.empresa_id
                   and o2.geom is not null and oi.geom is not null
                   and st_dwithin(o2.geom::geography, oi.geom::geography, ${METROS_CANDIDATO_DUPLICADO})
                 order by metros
                 limit 5
               ) c
             ), '[]'::json) as cercanas
      from orden_items oi
      join ordenes_trabajo ot on ot.id = oi.orden_id
      join empresas e on e.id = ot.empresa_id
      where ${filtroVista(opciones.vista)} and ${alcance}
      order by oi.reportado_en desc nulls last, oi.id desc
      limit ${CARGAS_POR_PAGINA} offset ${(pagina - 1) * CARGAS_POR_PAGINA}
    `)) as unknown as Array<Record<string, unknown>>;

    const cargas = filas.map((f): CargaControl => {
      const m = (f.metadata as Record<string, unknown>) ?? {};
      const bajas = Array.isArray(m.bajas) ? (m.bajas as BajaCarga[]) : [];
      const fotos = (f.fotos as CargaControl["fotos"]) ?? [];
      const cercanas = (f.cercanas as CargaControl["cercanas"]) ?? [];
      const superficie = f.superficie_m2 != null ? Number(f.superficie_m2) : null;
      const medicion = typeof m.medicion === "string" ? m.medicion : null;

      /* Lo que hace sospechar, dicho en palabras y no como un número. */
      const alarmas: string[] = [];
      const cerca = cercanas.find((c) => c.metros <= METROS_ALARMA_CERCA);
      if (cerca) alarmas.push(`Hay otra carga a ${cerca.metros} m (${cerca.orden})`);
      if (!fotos.some((x) => x.momento === "antes")) alarmas.push("Sin foto del antes");
      if (superficie != null && superficie >= 50) alarmas.push("Más de 50 m²: ¿es un bache o una obra?");
      if (medicion === "volumen") alarmas.push("Superficie estimada desde el volumen de mezcla");

      return {
        itemId: Number(f.id),
        ordenId: Number(f.orden_id),
        ordenNumero: String(f.numero),
        ordenEstado: String(f.orden_estado),
        empresa: String(f.empresa),
        direccion: (f.direccion as string) ?? null,
        estado: String(f.estado),
        lat: f.lat != null ? Number(f.lat) : null,
        lon: f.lon != null ? Number(f.lon) : null,
        reportadoEn: f.reportado_en != null ? new Date(String(f.reportado_en)).toISOString() : null,
        capataz: typeof m.capataz === "string" ? m.capataz : null,
        anchoM: f.ancho_m != null ? Number(f.ancho_m) : null,
        largoM: f.largo_m != null ? Number(f.largo_m) : null,
        espesorCm: f.espesor_cm != null ? Number(f.espesor_cm) : null,
        superficieM2: superficie,
        volumenM3: f.volumen_m3 != null ? Number(f.volumen_m3) : null,
        tipoObra: (f.tipo_obra as string) ?? null,
        medicion,
        fotos,
        controlado:
          m.control && typeof m.control === "object"
            ? (m.control as { por: string; en: string })
            : null,
        baja: bajas.length > 0 ? bajas[bajas.length - 1]! : null,
        alarmas,
        cercanas,
      };
    });

    return { cargas, total: conteo[opciones.vista], conteo };
  });
}

/** Las empresas que tienen algo para controlar, para el filtro de arriba. */
export async function empresasConCargas(sesion: Sesion): Promise<Array<{ id: number; nombre: string; n: number }>> {
  return conRls(claims(sesion), async (tx) => {
    const filas = (await tx.execute(sql`
      select e.id, e.nombre, count(*)::int as n
      from orden_items oi
      join ordenes_trabajo ot on ot.id = oi.orden_id
      join empresas e on e.id = ot.empresa_id
      where oi.estado = 'hecho' and oi.acta_id is null
      group by e.id, e.nombre
      order by n desc
    `)) as unknown as Array<{ id: number; nombre: string; n: number }>;
    return filas.map((f) => ({ id: Number(f.id), nombre: String(f.nombre), n: Number(f.n) }));
  });
}
