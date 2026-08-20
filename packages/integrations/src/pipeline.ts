import { createHash } from "node:crypto";
import { getDb, sql } from "@cimba/db";
import type { DemandaNormalizada, IntervencionNormalizada } from "@cimba/domain";
import type { ResultadoIngesta } from "./tipos";

/**
 * Pipeline de ingesta: normalizado → staging → promoción.
 * Idempotente vía external_ref.payload_hash: re-importar el mismo archivo o
 * re-consultar la misma API no duplica ni pisa datos sin cambios.
 */

function hashPayload(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function geomSql(punto: { lat: number; lon: number } | null) {
  return punto
    ? sql`st_setsrid(st_makepoint(${punto.lon}, ${punto.lat}), 4326)`
    : sql`null`;
}

/**
 * postgres.js por la vía `unsafe()` (que usa drizzle en db.execute) no
 * serializa objetos Date: hay que pasar ISO strings (Postgres castea solo).
 */
function fechaParam(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function describirError(e: unknown): string {
  const partes: string[] = [];
  let actual: unknown = e;
  while (actual instanceof Error) {
    partes.push(actual.message.split("\n")[0] ?? actual.message);
    actual = actual.cause;
  }
  return partes.length > 0 ? partes[partes.length - 1]! : String(e);
}

export async function ingestarDemandas(
  sistema: string,
  demandas: DemandaNormalizada[],
): Promise<ResultadoIngesta> {
  const db = getDb();
  const r: ResultadoIngesta = {
    sistema,
    leidos: demandas.length,
    insertados: 0,
    actualizados: 0,
    sinCambios: 0,
    errores: [],
  };

  for (const d of demandas) {
    const hash = hashPayload(d);
    try {
      await db.execute(sql`
        insert into staging.registros (sistema, entidad, id_remoto, payload, payload_hash)
        values (${sistema}, 'demanda', ${d.idRemoto}, ${JSON.stringify(d)}::jsonb, ${hash})
        on conflict do nothing
      `);

      const existente = (await db.execute(sql`
        select id_local, payload_hash from external_ref
        where sistema = ${sistema} and entidad_local = 'demanda' and id_remoto = ${d.idRemoto}
      `)) as unknown as Array<{ id_local: number; payload_hash: string }>;

      if (existente.length > 0 && existente[0]) {
        if (existente[0].payload_hash === hash) {
          r.sinCambios++;
          continue;
        }
        await db.execute(sql`
          update demandas set
            tipo = ${d.tipo},
            descripcion = ${d.descripcion},
            direccion_texto = ${d.direccionTexto},
            direccion_normalizada = ${d.direccionNormalizada},
            geocod_confianza = ${d.geocodConfianza},
            geom = ${geomSql(d.punto)},
            solicitante = ${d.solicitante},
            prioridad_informada = ${d.prioridadInformada},
            menciones = ${d.menciones},
            url_origen = ${d.urlOrigen},
            contacto = ${JSON.stringify(d.contacto)}::jsonb,
            metadata = ${JSON.stringify(d.metadata)}::jsonb
          where id = ${existente[0].id_local}
        `);
        await db.execute(sql`
          update external_ref set payload_hash = ${hash}, sincronizado_en = now()
          where sistema = ${sistema} and entidad_local = 'demanda' and id_remoto = ${d.idRemoto}
        `);
        r.actualizados++;
      } else {
        const insertado = (await db.execute(sql`
          insert into demandas (
            fuente, estado, tipo, descripcion, direccion_texto, direccion_normalizada,
            geocod_confianza, geom, distrito_id, contacto, solicitante,
            prioridad_informada, menciones, url_origen, creado_en, metadata
          ) values (
            ${d.fuente}, 'recibida', ${d.tipo}, ${d.descripcion}, ${d.direccionTexto},
            ${d.direccionNormalizada}, ${d.geocodConfianza}, ${geomSql(d.punto)},
            ${d.distritoId}, ${JSON.stringify(d.contacto)}::jsonb, ${d.solicitante},
            ${d.prioridadInformada}, ${d.menciones}, ${d.urlOrigen},
            coalesce(${fechaParam(d.creadoEn)}::timestamptz, now()), ${JSON.stringify(d.metadata)}::jsonb
          ) returning id
        `)) as unknown as Array<{ id: number }>;
        const nuevo = insertado[0];
        if (!nuevo) throw new Error("insert de demanda no devolvió id");
        await db.execute(sql`
          insert into external_ref (sistema, entidad_local, id_local, id_remoto, payload_hash)
          values (${sistema}, 'demanda', ${nuevo.id}, ${d.idRemoto}, ${hash})
        `);
        r.insertados++;
      }
    } catch (e) {
      r.errores.push({ idRemoto: d.idRemoto, error: describirError(e) });
    }
  }
  return r;
}

/**
 * Las intervenciones históricas (planillas de bacheo, obras SIGOV) llegan sin
 * incidente: se les crea uno con el estado coherente (reparado si la
 * intervención terminó) para conservar el modelo demanda→incidente→intervención.
 */
export async function ingestarIntervenciones(
  sistema: string,
  intervenciones: IntervencionNormalizada[],
): Promise<ResultadoIngesta> {
  const db = getDb();
  const r: ResultadoIngesta = {
    sistema,
    leidos: intervenciones.length,
    insertados: 0,
    actualizados: 0,
    sinCambios: 0,
    errores: [],
  };

  for (const iv of intervenciones) {
    const hash = hashPayload(iv);
    try {
      if (!iv.punto) {
        r.errores.push({ idRemoto: iv.idRemoto, error: "sin coordenadas válidas" });
        continue;
      }
      await db.execute(sql`
        insert into staging.registros (sistema, entidad, id_remoto, payload, payload_hash)
        values (${sistema}, 'intervencion', ${iv.idRemoto}, ${JSON.stringify(iv)}::jsonb, ${hash})
        on conflict do nothing
      `);

      const existente = (await db.execute(sql`
        select id_local, payload_hash from external_ref
        where sistema = ${sistema} and entidad_local = 'intervencion' and id_remoto = ${iv.idRemoto}
      `)) as unknown as Array<{ id_local: number; payload_hash: string }>;

      if (existente.length > 0 && existente[0]) {
        if (existente[0].payload_hash === hash) {
          r.sinCambios++;
          continue;
        }
        await db.execute(sql`
          update intervenciones set
            estado = ${iv.estado},
            iniciada_en = ${fechaParam(iv.iniciadaEn)}::timestamptz,
            finalizada_en = ${fechaParam(iv.finalizadaEn)}::timestamptz,
            superficie_m2 = ${iv.superficieM2},
            materiales = ${JSON.stringify(iv.materiales)}::jsonb,
            observaciones = ${iv.observaciones},
            metadata = ${JSON.stringify(iv.metadata)}::jsonb
          where id = ${existente[0].id_local}
        `);
        await db.execute(sql`
          update external_ref set payload_hash = ${hash}, sincronizado_en = now()
          where sistema = ${sistema} and entidad_local = 'intervencion' and id_remoto = ${iv.idRemoto}
        `);
        r.actualizados++;
      } else {
        const estadoIncidente =
          iv.estado === "finalizada" ? "reparado" : iv.estado === "en_curso" ? "en_ejecucion" : "programado";
        const incidente = (await db.execute(sql`
          insert into incidentes (tipo, estado, geom, direccion, superficie_m2, detectado_en, cerrado_en, metadata)
          values (
            ${iv.tipo}, ${estadoIncidente},
            st_setsrid(st_makepoint(${iv.punto.lon}, ${iv.punto.lat}), 4326),
            ${iv.direccionTexto}, ${iv.superficieM2},
            coalesce(${fechaParam(iv.iniciadaEn)}::timestamptz, now()),
            ${fechaParam(iv.estado === "finalizada" ? iv.finalizadaEn : null)}::timestamptz,
            ${JSON.stringify({ origen: sistema, geocod_confianza: iv.geocodConfianza })}::jsonb
          ) returning id
        `)) as unknown as Array<{ id: number }>;
        const inc = incidente[0];
        if (!inc) throw new Error("insert de incidente no devolvió id");

        const intervencion = (await db.execute(sql`
          insert into intervenciones (
            incidente_id, estado, geom_ejecucion, iniciada_en, finalizada_en,
            superficie_m2, materiales, observaciones, metadata
          ) values (
            ${inc.id}, ${iv.estado},
            st_setsrid(st_makepoint(${iv.punto.lon}, ${iv.punto.lat}), 4326),
            ${fechaParam(iv.iniciadaEn)}::timestamptz, ${fechaParam(iv.finalizadaEn)}::timestamptz, ${iv.superficieM2},
            ${JSON.stringify(iv.materiales)}::jsonb, ${iv.observaciones},
            ${JSON.stringify(iv.metadata)}::jsonb
          ) returning id
        `)) as unknown as Array<{ id: number }>;
        const nuevaIv = intervencion[0];
        if (!nuevaIv) throw new Error("insert de intervención no devolvió id");

        await db.execute(sql`
          insert into external_ref (sistema, entidad_local, id_local, id_remoto, payload_hash) values
          (${sistema}, 'intervencion', ${nuevaIv.id}, ${iv.idRemoto}, ${hash}),
          (${sistema}, 'incidente', ${inc.id}, ${iv.idRemoto}, ${hash})
        `);
        r.insertados++;
      }
    } catch (e) {
      r.errores.push({ idRemoto: iv.idRemoto, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return r;
}

export async function registrarSyncRun(r: ResultadoIngesta, desde: Date | null): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    insert into sync_runs (sistema, desde, hasta, leidos, insertados, actualizados, errores, detalle, finalizado_en)
    values (
      ${r.sistema}, ${fechaParam(desde)}::timestamptz, now(), ${r.leidos}, ${r.insertados}, ${r.actualizados},
      ${r.errores.length}, ${JSON.stringify({ sinCambios: r.sinCambios, errores: r.errores.slice(0, 50) })}::jsonb,
      now()
    )
  `);
}
