"use server";

import { conRls, sql } from "@cimba/db";
import { requerirSesion } from "./auth";

export interface FotoObra {
  id: number;
  momento: "antes" | "durante" | "despues";
  storagePath: string | null;
  urlExterna: string | null;
  tomadaEn: string | null;
  lat: number | null;
  lon: number | null;
}

/**
 * Fotos de obra de un incidente (las suben las cuadrillas desde /campo).
 * Se piden bajo demanda al seleccionar un punto: meterlas en el GeoJSON del
 * mapa significaría arrastrar las fotos de 1.800 incidentes en cada carga.
 */
export async function fotosDeIncidente(incidenteId: number): Promise<FotoObra[]> {
  const sesion = await requerirSesion();
  if (!Number.isInteger(incidenteId)) return [];
  return conRls(
    { sub: sesion.sub, rol_cimba: sesion.rol_cimba, id_persona: sesion.id_persona, id_empresa: sesion.id_empresa },
    async (tx) => {
      const filas = (await tx.execute(sql`
        select f.id, f.momento, f.storage_path, f.url_externa, f.tomada_en,
               st_y(f.geom) as lat, st_x(f.geom) as lon
        from fotografias f
        join intervenciones iv on iv.id = f.intervencion_id
        where iv.incidente_id = ${incidenteId}
        order by case f.momento when 'antes' then 0 when 'durante' then 1 else 2 end,
                 f.tomada_en nulls last
        limit 24
      `)) as unknown as Array<Record<string, unknown>>;
      return filas.map((f) => ({
        id: Number(f.id),
        momento: String(f.momento) as FotoObra["momento"],
        storagePath: f.storage_path != null ? String(f.storage_path) : null,
        urlExterna: f.url_externa != null ? String(f.url_externa) : null,
        tomadaEn: f.tomada_en != null ? String(f.tomada_en) : null,
        lat: f.lat != null ? Number(f.lat) : null,
        lon: f.lon != null ? Number(f.lon) : null,
      }));
    },
  );
}
