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
 * Las claves de `demandas.metadata` que escribe una PERSONA desde la app, no
 * el archivo de origen. Sobreviven a cualquier re-importación.
 *
 * Es una lista cerrada y no un "todo lo que no venga en el payload" porque el
 * archivo sí tiene que poder refrescar sus propios campos (estado_ac, asunto,
 * categoría…). Cada vez que una acción nueva deje una marca en metadata hay
 * que sumarla acá, o la próxima ingesta se la lleva puesta.
 */
const MARCAS_HUMANAS = [
  "ubicacion_corregida", // corrección del pin en el mapa (acciones.ts)
  "ubicacion_corregida_en",
  "pin_corregido", // pin aceptado en la corrección por lote (acciones-pines.ts)
  "pin_omitido",
  "pin_geocoder_fallo", // para no reintentar el geocoder en cada tanda
  "destino_corregido", // bacheo ↔ pluvial corregido a mano
  "tipo_corregido", // tipo corregido en Tratamiento
  "cotejo_retroactivo", // vinculación masiva contra lo ya reparado
  "duplicada_de", // descarte por duplicado, con su traza
  "descartada_por",
  "descartada_en",
  "motivo_descarte",
  "derivada", // derivación a SAT / Ingeniería
  "expediente", // número de expediente de esa derivación
  "ya_resuelta", // el vecino pidió algo que ya estaba hecho
  "cierre", // la respuesta que Atención Ciudadana le dio al vecino
  "ia", // análisis del clasificador, con su modelo y su fecha
] as const;

const marcasHumanas = sql`array[${sql.join(
  MARCAS_HUMANAS.map((k) => sql`${k}`),
  sql`, `,
)}]::text[]`;

/**
 * Una ubicación puesta por una persona —a mano en el mapa, o aceptando la
 * propuesta del geocoder en la corrección por lote— nunca se pisa con la del
 * archivo. Las dos son decisiones humanas; la del lote también pasa por una
 * pantalla donde alguien acepta una por una.
 */
const ubicacionHumana = sql`(
  metadata->>'ubicacion_corregida' = 'true'
  or metadata -> 'pin_corregido' is not null
)`;

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
        /**
         * LO QUE DECIDIÓ UNA PERSONA GANA SOBRE EL ARCHIVO.
         *
         * El payload refresca los datos de origen, pero cada re-importación
         * pasa por acá y hasta ahora se llevaba puesto casi todo el trabajo
         * humano: el tipo corregido a mano en Tratamiento volvía al del
         * archivo, el pin aceptado en la corrección por lote volvía al punto
         * malo, y el metadata entero —quién descartó un duplicado, quién
         * derivó a SAT y con qué expediente, la respuesta al vecino, el
         * cotejo retroactivo— se pisaba. Nadie se enteraba: el reclamo
         * simplemente volvía atrás.
         */
        await db.execute(sql`
          update demandas set
            -- Un tipo corregido a mano no se revierte; y un archivo que viene
            -- sin tipo no borra el que ya está (la clasificación por IA lo
            -- escribe justamente cuando el origen no lo trae).
            tipo = case
              when metadata -> 'tipo_corregido' is not null then tipo
              else coalesce(${d.tipo}::tipo_problema, tipo) end,
            descripcion = ${d.descripcion},
            direccion_texto = ${d.direccionTexto},
            direccion_normalizada = case
              when ${ubicacionHumana} then direccion_normalizada
              else ${d.direccionNormalizada} end,
            geocod_confianza = case
              when ${ubicacionHumana} then geocod_confianza
              else ${d.geocodConfianza} end,
            geom = case
              when ${ubicacionHumana} then geom
              else ${geomSql(d.punto)} end,
            solicitante = ${d.solicitante},
            prioridad_informada = ${d.prioridadInformada},
            menciones = ${d.menciones},
            url_origen = ${d.urlOrigen},
            contacto = ${JSON.stringify(d.contacto)}::jsonb,
            -- Las marcas humanas del metadata viejo se copian ENCIMA del
            -- payload. La lista es explícita a propósito: un "sacale al
            -- payload lo que ya estaba" genérico se llevaría puesto justo lo
            -- que el archivo sí tiene que refrescar. El coalesce cubre el
            -- caso normal —ninguna marca presente—, donde un jsonb_object_agg
            -- vacío devuelve NULL y borraría la columna entera.
            metadata = ${JSON.stringify(d.metadata)}::jsonb || (
              select coalesce(jsonb_object_agg(k, demandas.metadata -> k), '{}'::jsonb)
              from unnest(${marcasHumanas}) as k
              where demandas.metadata -> k is not null
            )
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
 * En qué estado deja al incidente cada estado de su intervención. Una obra
 * anulada tiene que salir del pendiente: si queda como programada, el sistema
 * promete un arreglo que ya nadie va a hacer.
 */
function incidenteSegun(estado: IntervencionNormalizada["estado"]): string {
  switch (estado) {
    case "finalizada":
      return "reparado";
    case "en_curso":
      return "en_ejecucion";
    case "anulada":
      return "desestimado";
    default:
      return "programado";
  }
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
        const punto = sql`st_setsrid(st_makepoint(${iv.punto.lon}, ${iv.punto.lat}), 4326)`;
        await db.execute(sql`
          update intervenciones set
            estado = ${iv.estado},
            -- La obra se puede replantear unos metros: el punto de ejecución
            -- se refresca igual que las fechas. Antes se escribía una única
            -- vez, al insertar.
            geom_ejecucion = ${punto},
            iniciada_en = ${fechaParam(iv.iniciadaEn)}::timestamptz,
            finalizada_en = ${fechaParam(iv.finalizadaEn)}::timestamptz,
            superficie_m2 = ${iv.superficieM2},
            materiales = ${JSON.stringify(iv.materiales)}::jsonb,
            observaciones = ${iv.observaciones},
            -- El tipo de intervención corregido a mano deja esta marca; sin
            -- preservarla, la próxima sincronización borra la traza de quién
            -- lo corrigió y cuándo.
            metadata = ${JSON.stringify(iv.metadata)}::jsonb ||
              case when metadata -> 'tipo_corregido' is not null
                   then jsonb_build_object('tipo_corregido', metadata -> 'tipo_corregido')
                   else '{}'::jsonb end
          where id = ${existente[0].id_local}
        `);
        /**
         * El incidente tiene que seguir a su intervención. Sin esto una obra
         * que pasa de programada a terminada actualiza la intervención pero
         * deja el incidente en el estado viejo, y el mapa y las métricas por
         * distrito la siguen contando como pendiente. No se notaba mientras las
         * fuentes se importaban una sola vez desde un archivo; con
         * sincronización continua es el caso normal, no el raro.
         */
        await db.execute(sql`
          update incidentes set
            /* Una verificación en campo la hace el municipio, no la planilla:
               de 'verificado' no se baja, y su fecha de cierre no se toca. */
            estado = case
              when estado = 'verificado' then estado
              else ${incidenteSegun(iv.estado)}::estado_incidente end,
            superficie_m2 = coalesce(${iv.superficieM2}, superficie_m2),
            /* La geometría y la dirección se escribían UNA sola vez, al
               insertar. Si la empresa corregía la coordenada o la dirección en
               su planilla —el caso más común de corrección que hacen—, CIMBA
               se quedaba con el punto malo para siempre y el bache seguía
               dibujado en la cuadra equivocada. */
            geom = ${punto},
            direccion = coalesce(${iv.direccionTexto}, direccion),
            /* El trigger de territorio solo completa lo que está en NULL, así
               que al mover el punto hay que recalcular a mano: si no, el
               incidente se muda de lugar pero sigue sumando en el distrito y
               el cuadrante viejos. */
            distrito_id = (select d.id from distritos d
              where st_contains(d.geom, ${punto}) limit 1),
            cuadrante_id = (select c.id from cuadrantes c
              where st_contains(c.geom, ${punto}) limit 1),
            cerrado_en = case
              when estado = 'verificado' then cerrado_en
              else ${fechaParam(iv.estado === "finalizada" ? iv.finalizadaEn : null)}::timestamptz end
          where id = (
            select id_local from external_ref
            where sistema = ${sistema} and entidad_local = 'incidente' and id_remoto = ${iv.idRemoto}
          )
        `);
        await db.execute(sql`
          update external_ref set payload_hash = ${hash}, sincronizado_en = now()
          where sistema = ${sistema} and entidad_local = 'intervencion' and id_remoto = ${iv.idRemoto}
        `);
        r.actualizados++;
      } else {
        const estadoIncidente = incidenteSegun(iv.estado);
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

export async function registrarSyncRun(
  r: ResultadoIngesta,
  desde: Date | null,
  /** Datos propios de la fuente (p. ej. hasta qué id llegó el barrido). */
  extra: Record<string, unknown> = {},
): Promise<void> {
  const db = getDb();
  await db.execute(sql`
    insert into sync_runs (sistema, desde, hasta, leidos, insertados, actualizados, errores, detalle, finalizado_en)
    values (
      ${r.sistema}, ${fechaParam(desde)}::timestamptz, now(), ${r.leidos}, ${r.insertados}, ${r.actualizados},
      ${r.errores.length},
      ${JSON.stringify({ sinCambios: r.sinCambios, errores: r.errores.slice(0, 50), ...extra })}::jsonb,
      now()
    )
  `);
}

/**
 * Cursor del barrido de Atención Ciudadana: el mayor id_reclamo ya importado.
 * Sale de external_ref, que el pipeline llena por cada demanda promovida, así
 * que no hay estado extra que mantener sincronizado.
 *
 * Las demandas que entraron por archivo también dejaron su id_reclamo acá, así
 * que el barrido arranca donde terminó el export del Director (113362) en vez
 * de repetir histórico. `respaldo` solo se usa si external_ref está vacío.
 */
export async function cursorAtencionCiudadana(respaldo: number): Promise<number> {
  const filas = (await getDb().execute(sql`
    select
      (select max(case when id_remoto ~ '^[0-9]+$' then id_remoto::bigint end)
         from external_ref
        where sistema = 'atencion_ciudadana' and entidad_local = 'demanda') as importado,
      (select max(case when detalle->>'hastaId' ~ '^[0-9]+$'
                       then (detalle->>'hastaId')::bigint end)
         from sync_runs
        where sistema = 'atencion_ciudadana') as barrido
  `)) as unknown as Array<{ importado: string | number | null; barrido: string | number | null }>;
  const f = filas[0];
  // El máximo de los dos: un tramo entero puede no tener ni un reclamo de
  // pavimento, y mirando solo lo importado el cursor se quedaría clavado ahí,
  // repitiendo esos mismos ids en cada corrida del cron.
  return Math.max(
    f?.importado != null ? Number(f.importado) : respaldo,
    f?.barrido != null ? Number(f.barrido) : respaldo,
  );
}

/**
 * Fotos que viven en un sistema externo: Google Drive (app de las empresas) o
 * el backend de SIGOV. No se descargan: se referencia la URL, que es pública.
 * Bajar miles de fotos para volver a subirlas a Storage costaría varios GB sin
 * ganar nada mientras las apps de origen sigan siendo las de carga.
 *
 * Idempotente por url_externa: re-sincronizar no duplica. La tabla no tiene
 * índice único sobre eso, así que se comprueba antes de insertar en vez de
 * apoyarse en un ON CONFLICT que no existe.
 *
 * Va por lotes a propósito. La versión fila por fila hacía tres viajes a la
 * base por foto, y con las 2.567 de SIGOV eso son casi 7.700 consultas
 * seguidas: el pooler de Supabase corta la conexión a mitad de camino
 * (ECONNRESET) y se pierde la corrida entera. Así son dos consultas de lectura
 * y un insert cada 200 fotos.
 */
export async function guardarFotosExternas(
  sistema: string,
  fotos: Array<{
    idRemotoIntervencion: string;
    momento: "antes" | "durante" | "despues";
    urlExterna: string;
    lat: number | null;
    lon: number | null;
    tomadaEn: Date | null;
  }>,
): Promise<{ insertadas: number; yaEstaban: number; sinIntervencion: number }> {
  const r = { insertadas: 0, yaEstaban: 0, sinIntervencion: 0 };
  if (fotos.length === 0) return r;
  const db = getDb();

  /**
   * La misma fila de origen pudo entrar como intervención (hubo obra) o como
   * demanda (fue una detección). La tabla admite las dos: colgar la foto de la
   * demanda es lo que evita perder la evidencia de las pérdidas de agua y las
   * tapas rotas, que es justamente donde la foto más prueba. Si existen las
   * dos, gana la intervención.
   */
  const refs = (await db.execute(sql`
    select id_remoto, entidad_local, id_local from external_ref
    where sistema = ${sistema} and entidad_local in ('intervencion', 'demanda')
  `)) as unknown as Array<{ id_remoto: string; entidad_local: string; id_local: number }>;

  const destinos = new Map<string, { esIv: boolean; id: number }>();
  for (const ref of refs) {
    const esIv = ref.entidad_local === "intervencion";
    const previo = destinos.get(ref.id_remoto);
    if (!previo || (esIv && !previo.esIv)) {
      destinos.set(ref.id_remoto, { esIv, id: Number(ref.id_local) });
    }
  }

  const guardadas = (await db.execute(sql`
    select url_externa from fotografias where url_externa is not null
  `)) as unknown as Array<{ url_externa: string }>;
  const conocidas = new Set(guardadas.map((f) => f.url_externa));

  const pendientes: Array<{ f: (typeof fotos)[number]; d: { esIv: boolean; id: number } }> = [];
  for (const f of fotos) {
    const d = destinos.get(f.idRemotoIntervencion);
    if (!d) {
      r.sinIntervencion++;
      continue;
    }
    // El add corta también los repetidos dentro del propio lote, que antes
    // se filtraban solos porque cada insert se comprobaba contra la base.
    if (conocidas.has(f.urlExterna)) {
      r.yaEstaban++;
      continue;
    }
    conocidas.add(f.urlExterna);
    pendientes.push({ f, d });
  }

  const TAM_LOTE = 200;
  for (let i = 0; i < pendientes.length; i += TAM_LOTE) {
    const trozo = pendientes.slice(i, i + TAM_LOTE);
    const filas = trozo.map(
      ({ f, d }) => sql`(
        ${d.esIv ? d.id : null}, ${d.esIv ? null : d.id},
        ${f.momento}, ${f.urlExterna},
        ${
          f.lat != null && f.lon != null
            ? sql`st_setsrid(st_makepoint(${f.lon}, ${f.lat}), 4326)`
            : sql`null`
        },
        ${fechaParam(f.tomadaEn)}::timestamptz
      )`,
    );
    await db.execute(sql`
      insert into fotografias (intervencion_id, demanda_id, momento, url_externa, geom, tomada_en)
      values ${sql.join(filas, sql`, `)}
    `);
    r.insertadas += trozo.length;
  }
  return r;
}

/**
 * Descarta de un lote lo que ya está guardado sin cambios, comparando el hash
 * del payload contra external_ref en UNA sola consulta.
 *
 * Sin esto, una sincronización periódica de la planilla de empresas hace 1.038
 * viajes a la base solo para descubrir que no cambió nada: ~8 minutos por
 * corrida. Filtrando antes, una corrida sin novedades no escribe ni consulta
 * fila por fila, y el intervalo de 15 minutos deja de ser apretado.
 *
 * El hash tiene que calcularse igual que en la ingesta o todo parecería nuevo.
 */
export async function filtrarNovedades<T extends { idRemoto: string }>(
  sistema: string,
  entidad: "demanda" | "intervencion",
  items: T[],
): Promise<{ novedades: T[]; sinCambios: number }> {
  if (items.length === 0) return { novedades: [], sinCambios: 0 };
  const filas = (await getDb().execute(sql`
    select id_remoto, payload_hash from external_ref
    where sistema = ${sistema} and entidad_local = ${entidad}
  `)) as unknown as Array<{ id_remoto: string; payload_hash: string | null }>;

  const conocidos = new Map(filas.map((f) => [f.id_remoto, f.payload_hash]));
  const novedades = items.filter((i) => conocidos.get(i.idRemoto) !== hashPayload(i));
  return { novedades, sinCambios: items.length - novedades.length };
}

/**
 * Igual que arriba pero para las fotos externas, que no pasan por external_ref:
 * se comparan por URL, que es única por archivo de Drive.
 */
export async function filtrarFotosNuevas<T extends { urlExterna: string }>(
  fotos: T[],
): Promise<{ nuevas: T[]; yaEstaban: number }> {
  if (fotos.length === 0) return { nuevas: [], yaEstaban: 0 };
  const filas = (await getDb().execute(sql`
    select url_externa from fotografias where url_externa is not null
  `)) as unknown as Array<{ url_externa: string }>;
  const conocidas = new Set(filas.map((f) => f.url_externa));
  const nuevas = fotos.filter((f) => !conocidas.has(f.urlExterna));
  return { nuevas, yaEstaban: fotos.length - nuevas.length };
}
