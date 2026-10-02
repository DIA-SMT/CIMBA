/**
 * CORREGIR LOS PINES QUE NO ESTÁN DONDE DICE SU DIRECCIÓN.
 *
 *   node scripts/corregir-pines-por-direccion.mjs            → solo mira y lista
 *   node scripts/corregir-pines-por-direccion.mjs --aplicar   → corrige
 *   node scripts/corregir-pines-por-direccion.mjs --aplicar --metros 500
 *
 * Es la versión en lote del botón "Mover el pin" de
 * /calidad/tratamiento/punto_dudoso: cruza la dirección escrita de cada
 * reclamo contra el callejero municipal (migraciones 0025-0028) y, cuando el
 * punto guardado quedó a más de N metros de donde el callejero dice que está
 * esa dirección, lo mueve.
 *
 * POR QUÉ SE PUEDE CONFIAR EN LA SUGERENCIA. Medido escondiendo cada uno de
 * los 936 puntos tomados con GPS en la calle: el error mediano del callejero
 * es de 10 metros, y de 9 cuando la altura está encerrada entre dos conocidas.
 * Sobre los reclamos sanos, la distancia entre la dirección y el pin es de 18
 * metros de mediana. Cuando se va a cientos de metros, el que está mal es el
 * pin.
 *
 * LO QUE NO TOCA, y es lo importante:
 *   · Un pin que ya corrigió una persona (`ubicacion_corregida`). Una decisión
 *     humana le gana a cualquier cálculo, siempre.
 *   · Un reclamo cerrado, descartado o derivado: su historia ya está escrita.
 *   · Una sugerencia que caiga fuera de la ciudad. No debería pasar —el
 *     callejero se arma con puntos de adentro— pero un punto fuera del ejido
 *     es peor que un punto mal puesto adentro.
 *
 * Deja en metadata de qué distancia se movió, con qué apoyo y cuándo, así
 * cualquiera de estas correcciones se puede revisar o deshacer a mano.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import postgres from "postgres";

const RAIZ = path.join(import.meta.dirname, "..");
const envPath = path.join(RAIZ, ".env");
if (fs.existsSync(envPath)) {
  for (const linea of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Falta DATABASE_URL");
  process.exit(1);
}

const args = process.argv.slice(2);
const aplicar = args.includes("--aplicar");
const metros = args.includes("--metros") ? Number(args[args.indexOf("--metros") + 1]) : 300;
if (!Number.isFinite(metros) || metros < 100) {
  console.error("--metros tiene que ser un número de al menos 100");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

/** El punto sugerido, en metros, para una lista de filas ya resuelta. */
const fmt = (n) => Number(n).toLocaleString("es-AR", { maximumFractionDigits: 0 });

try {
  // ── Los reclamos ──────────────────────────────────────────────────────────
  const demandas = await sql`
    select a.id,
           coalesce(a.direccion_normalizada, a.direccion_texto) as dir,
           st_y(a.geom) as lat_vieja, st_x(a.geom) as lon_vieja,
           u.lat as lat_nueva, u.lon as lon_nueva,
           round(st_distance(a.geom::geography,
                             st_setsrid(st_makepoint(u.lon, u.lat), 4326)::geography)) as m,
           u.delta, u.apoyo
      from demandas a,
           lateral ubicar_altura(coalesce(a.direccion_normalizada, a.direccion_texto),
                                 altura_de(coalesce(a.direccion_normalizada, a.direccion_texto))) u
     where a.estado in ('recibida', 'en_validacion')
       and a.geom is not null
       and u.nivel = 'exacta'
       and st_distance(a.geom::geography,
                       st_setsrid(st_makepoint(u.lon, u.lat), 4326)::geography) > ${metros}
       -- Lo que corrigió una persona no se toca.
       and coalesce(a.metadata->>'ubicacion_corregida', '') <> 'true'
       and not (a.metadata ? 'pin_corregido')
       -- Y la sugerencia tiene que caer adentro de la ciudad.
       and distrito_de(st_setsrid(st_makepoint(u.lon, u.lat), 4326)) is not null
     order by m desc
  `;

  console.log(`\n${demandas.length} reclamo(s) con el pin a más de ${metros} m de su dirección:\n`);
  for (const d of demandas) {
    const apoyo = d.apoyo === 3 ? "GPS de campo" : d.apoyo === 2 ? "sistema municipal" : "archivo";
    console.log(
      `  #${String(d.id).padStart(5)}  ${fmt(d.m).padStart(6)} m  ` +
        `(hueco ${String(d.delta).padStart(4)}, apoyo ${apoyo})  ${d.dir}`,
    );
  }

  // ── El mismo cruce sobre los incidentes abiertos ──────────────────────────
  const incidentes = await sql`
    select i.id, i.direccion as dir,
           u.lat as lat_nueva, u.lon as lon_nueva,
           round(st_distance(i.geom::geography,
                             st_setsrid(st_makepoint(u.lon, u.lat), 4326)::geography)) as m,
           u.delta, u.apoyo
      from incidentes i,
           lateral ubicar_altura(i.direccion, altura_de(i.direccion)) u
     where i.geom is not null
       and i.estado in ('detectado', 'priorizado', 'programado', 'en_ejecucion')
       and u.nivel = 'exacta'
       and st_distance(i.geom::geography,
                       st_setsrid(st_makepoint(u.lon, u.lat), 4326)::geography) > ${metros}
       and coalesce(i.metadata->>'ubicacion_corregida', '') <> 'true'
       and distrito_de(st_setsrid(st_makepoint(u.lon, u.lat), 4326)) is not null
       /* Un incidente que YA está en una orden no se mueve por su cuenta: la
          cuadrilla puede tener el papel impreso con la otra dirección. Esos se
          corrigen desde la orden, que además mueve el item. */
       and not exists (
         select 1 from orden_items oi
         join ordenes_trabajo ot on ot.id = oi.orden_id
         where oi.incidente_id = i.id and ot.estado in ('emitida', 'en_ejecucion')
       )
     order by m desc
  `;
  console.log(`\n${incidentes.length} incidente(s) abierto(s) en la misma situación:\n`);
  for (const i of incidentes) {
    console.log(`  #${String(i.id).padStart(5)}  ${fmt(i.m).padStart(6)} m  ${i.dir}`);
  }

  if (!aplicar) {
    console.log("\n(solo mirando — agregá --aplicar para corregirlos)\n");
  } else {
    const ahora = new Date().toISOString();
    for (const d of demandas) {
      await sql`
        update demandas set
          geom = st_setsrid(st_makepoint(${d.lon_nueva}, ${d.lat_nueva}), 4326),
          /* 0,85 y no 1,0: el punto lo puso el callejero, no una persona
             parada en la vereda. Queda por encima del umbral de revisión
             manual (0,75) porque el error medido es de 9 metros, pero decir
             1,0 sería decir que alguien lo confirmó. */
          geocod_confianza = 0.85,
          distrito_id = distrito_de(st_setsrid(st_makepoint(${d.lon_nueva}, ${d.lat_nueva}), 4326)),
          circuito_id = circuito_de(st_setsrid(st_makepoint(${d.lon_nueva}, ${d.lat_nueva}), 4326)),
          barrio_id  = barrio_de(st_setsrid(st_makepoint(${d.lon_nueva}, ${d.lat_nueva}), 4326)),
          /* ubicacion_corregida frena a la re-importación: sin esto, la
             próxima sincronización devuelve el pin a los 9 km de donde estaba. */
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'ubicacion_corregida', true,
            'ubicacion_corregida_en', ${ahora}::text,
            'ubicacion_corregida_por', 'callejero municipal (lote)'::text,
            /* Los ::numeric son obligatorios: adentro de jsonb_build_object un
               parámetro suelto no tiene de dónde inferir su tipo y Postgres
               responde "could not determine data type of parameter". */
            'ubicacion_corregida_detalle', jsonb_build_object(
              'movido_m', ${Number(d.m)}::numeric,
              'hueco_altura', ${Number(d.delta)}::int,
              'apoyo', ${Number(d.apoyo)}::int,
              'desde', jsonb_build_array(${Number(d.lon_vieja)}::numeric, ${Number(d.lat_vieja)}::numeric)
            )
          )
        where id = ${d.id}
      `;
    }
    for (const i of incidentes) {
      await sql`
        update incidentes set
          geom = st_setsrid(st_makepoint(${i.lon_nueva}, ${i.lat_nueva}), 4326),
          distrito_id = distrito_de(st_setsrid(st_makepoint(${i.lon_nueva}, ${i.lat_nueva}), 4326)),
          cuadrante_id = cuadrante_de(st_setsrid(st_makepoint(${i.lon_nueva}, ${i.lat_nueva}), 4326)),
          circuito_id = circuito_de(st_setsrid(st_makepoint(${i.lon_nueva}, ${i.lat_nueva}), 4326)),
          barrio_id  = barrio_de(st_setsrid(st_makepoint(${i.lon_nueva}, ${i.lat_nueva}), 4326)),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'ubicacion_corregida', true,
            'ubicacion_corregida_en', ${ahora}::text,
            'ubicacion_corregida_por', 'callejero municipal (lote)'::text
          )
        where id = ${i.id}
      `;
    }
    console.log(
      `\n✔ ${demandas.length} reclamo(s) y ${incidentes.length} incidente(s) movidos a su dirección.\n`,
    );
    // El callejero incorpora los puntos nuevos para la próxima consulta.
    await sql`select refrescar_callejero()`;
  }
} finally {
  await sql.end();
}
