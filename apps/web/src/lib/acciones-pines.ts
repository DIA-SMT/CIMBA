"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { conRls, sql } from "@cimba/db";
import { dentroDeSMT } from "@cimba/domain";
import { crearGeocoderNominatim } from "@cimba/integrations";
import { requerirRol, type Sesion } from "./auth";

/**
 * CORRECCIÓN DE PINES EN LOTE — el multiplicador del paso 2 de la línea de
 * montaje: ~1.400 pedidos tienen la ubicación dudosa (<75%) y por eso el
 * sistema, a propósito, no los trabaja solo. Acá la IA geocodifica una tanda
 * y PROPONE; una persona revisa la lista y confirma — el mismo contrato que
 * el tratamiento y la nota SAT: el sistema propone, alguien firma.
 *
 * Solo se proponen resultados con confianza ≥ 0.75 (altura o esquina exacta):
 * un pin que sigue siendo dudoso no desbloquea nada. Lo que el geocoder no
 * clava queda MARCADO (pin_geocoder_fallo) para no reintentarlo en cada tanda
 * — esos van a mano, arrastrando el pin en la ficha.
 */

const claims = (s: Sesion) => ({ sub: s.sub, rol_cimba: s.rol_cimba, id_persona: s.id_persona, id_empresa: s.id_empresa });

export interface PropuestaPin {
  demandaId: number;
  direccionOriginal: string;
  direccionResuelta: string;
  lat: number;
  lon: number;
  confianza: number;
  confianzaAnterior: number | null;
  /** Cuántos metros se movería el pin (null si no tenía). */
  distanciaM: number | null;
}

const TANDA = 20;

export async function proponerCorreccionPines(): Promise<{
  propuestas: PropuestaPin[];
  sinResultado: number;
  quedan: number;
}> {
  const sesion = await requerirRol("planificacion", "atencion_ciudadana");

  const candidatas = await conRls(claims(sesion), async (tx) => {
    return (await tx.execute(sql`
      select d.id,
             coalesce(d.direccion_normalizada, d.direccion_texto) as direccion,
             d.geocod_confianza,
             st_y(d.geom) as lat, st_x(d.geom) as lon,
             (select count(*) from demandas x
                where x.estado in ('recibida','en_validacion')
                  and coalesce(x.direccion_normalizada, x.direccion_texto) is not null
                  and (x.geom is null or coalesce(x.geocod_confianza, 0) < 0.75)
                  and x.metadata->>'pin_geocoder_fallo' is null
                  and x.metadata->>'pin_omitido' is null)::int as total
      from demandas d
      where d.estado in ('recibida','en_validacion')
        and coalesce(d.direccion_normalizada, d.direccion_texto) is not null
        and (d.geom is null or coalesce(d.geocod_confianza, 0) < 0.75)
        and d.metadata->>'pin_geocoder_fallo' is null
        and d.metadata->>'pin_omitido' is null
      order by d.geocod_confianza asc nulls first, d.id
      limit ${TANDA}
    `)) as unknown as Array<Record<string, unknown>>;
  });

  const total = Number(candidatas[0]?.total ?? 0);
  const geocoder = crearGeocoderNominatim();
  const propuestas: PropuestaPin[] = [];
  const fallidas: number[] = [];

  for (const c of candidatas) {
    const direccion = String(c.direccion);
    const r = await geocoder.geocodificar(direccion).catch(() => null);
    if (!r || r.confianza < 0.75 || !dentroDeSMT(r.punto)) {
      fallidas.push(Number(c.id));
      continue;
    }
    let distanciaM: number | null = null;
    if (c.lat != null && c.lon != null) {
      const dLat = ((r.punto.lat - Number(c.lat)) * Math.PI) / 180;
      const dLon = ((r.punto.lon - Number(c.lon)) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((Number(c.lat) * Math.PI) / 180) * Math.cos((r.punto.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
      distanciaM = Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
    }
    propuestas.push({
      demandaId: Number(c.id),
      direccionOriginal: direccion,
      direccionResuelta: r.direccionResuelta ?? direccion,
      lat: r.punto.lat,
      lon: r.punto.lon,
      confianza: r.confianza,
      confianzaAnterior: c.geocod_confianza != null ? Number(c.geocod_confianza) : null,
      distanciaM,
    });
  }

  // Las que el geocoder no clavó se marcan para no reintentarlas cada tanda:
  // van a mano (el pin se arrastra en la ficha) y ahí se les borra la marca.
  if (fallidas.length > 0) {
    await conRls(claims(sesion), async (tx) => {
      await tx.execute(sql`
        update demandas set metadata = metadata ||
          ${JSON.stringify({ pin_geocoder_fallo: new Date().toISOString().slice(0, 10) })}::jsonb
        where id in (${sql.join(fallidas.map((x) => sql`${x}`), sql`, `)})
      `);
    });
  }

  return { propuestas, sinResultado: fallidas.length, quedan: Math.max(0, total - candidatas.length) };
}

export async function aplicarCorreccionPines(entrada: {
  aceptadas: Array<{ demandaId: number; lat: number; lon: number; confianza: number; direccion: string }>;
  omitidas: number[];
}) {
  const sesion = await requerirRol("planificacion", "atencion_ciudadana");
  const datos = z
    .object({
      aceptadas: z
        .array(
          z.object({
            demandaId: z.number().int().positive(),
            lat: z.number().min(-27.2).max(-26.5),
            lon: z.number().min(-65.6).max(-64.9),
            confianza: z.number().min(0.75).max(1),
            direccion: z.string().min(4).max(400),
          }),
        )
        .max(TANDA),
      omitidas: z.array(z.number().int().positive()).max(TANDA),
    })
    .parse(entrada);

  let aplicadas = 0;
  await conRls(claims(sesion), async (tx) => {
    for (const a of datos.aceptadas) {
      if (!dentroDeSMT({ lat: a.lat, lon: a.lon })) continue;
      // Solo si sigue abierta y sigue dudosa: si alguien la corrigió a mano en
      // el medio, esa corrección humana no se pisa.
      const r = (await tx.execute(sql`
        update demandas set
          geom = st_setsrid(st_makepoint(${a.lon}, ${a.lat}), 4326),
          geocod_confianza = ${a.confianza},
          direccion_normalizada = ${a.direccion},
          distrito_id = (select di.id from distritos di
            where st_contains(di.geom, st_setsrid(st_makepoint(${a.lon}, ${a.lat}), 4326)) limit 1),
          circuito_id = (select ci.id from circuitos ci
            where st_contains(ci.geom, st_setsrid(st_makepoint(${a.lon}, ${a.lat}), 4326)) limit 1),
          barrio_id = (select b.id from barrios b
            where st_contains(b.geom, st_setsrid(st_makepoint(${a.lon}, ${a.lat}), 4326)) limit 1),
          metadata = metadata || ${JSON.stringify({
            pin_corregido: { por: sesion.nombre, en: new Date().toISOString(), via: "lote_ia" },
          })}::jsonb
        where id = ${a.demandaId}
          and estado in ('recibida','en_validacion')
          and (geom is null or coalesce(geocod_confianza, 0) < 0.75)
        returning id
      `)) as unknown as Array<{ id: number }>;
      if (r[0]) aplicadas += 1;
    }

    if (datos.omitidas.length > 0) {
      await tx.execute(sql`
        update demandas set metadata = metadata ||
          ${JSON.stringify({ pin_omitido: { por: sesion.nombre, en: new Date().toISOString() } })}::jsonb
        where id in (${sql.join(datos.omitidas.map((x) => sql`${x}`), sql`, `)})
      `);
    }
  });

  revalidatePath("/calidad");
  revalidatePath("/demandas");
  revalidatePath("/brecha");
  return { ok: true, aplicadas, omitidas: datos.omitidas.length };
}
