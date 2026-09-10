/**
 * Construye la tabla de CORREDORES, que es la unidad de análisis del IPI.
 *
 *   node scripts/cargar-corredores.mjs
 *
 * El IPI no puntúa cuadras sueltas: puntúa ejes completos y los ordena dentro
 * de cada sector operativo. Por eso cada tramo de la jerarquía vial se recorta
 * contra los 11 sectores y se agrupa por (nombre × sector): una avenida que
 * cruza tres sectores entra tres veces, una por sector, que es exactamente
 * como está armado el plan ("Av. América e/ Fco. de Aguirre y España").
 *
 * Acá se calculan las variables ESTRUCTURALES, que no cambian mes a mes
 * (interconexión de barrios, accesibilidad, transporte público). La variable
 * "Estado" se recalcula aparte con la densidad de baches — es la que el Plan
 * de Acción de la DOV pide alimentar con datos reales de operación, y vive en
 * apps/web/src/lib/ipi.ts para poder recalcularse cuando se quiera.
 *
 * Idempotente: vacía y reconstruye la tabla entera dentro de una transacción,
 * conservando las correcciones a mano (factibilidad, compromisos, exclusiones).
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const raiz = path.join(import.meta.dirname, "..");
for (const l of fs.readFileSync(path.join(raiz, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, onnotice: () => {} });

const leer = (nombre) =>
  JSON.parse(fs.readFileSync(path.join(raiz, "apps", "web", "public", "data", nombre), "utf8")).features;

const jerarquia = leer("jerarquia-vial.json");
const colectivos = leer("recorridos-colectivos.json");

await sql.begin(async (tx) => {
  // Las correcciones humanas sobreviven a la reconstrucción: quien planifica
  // marcó una interferencia o un compromiso y eso no lo pisa un script.
  const manuales = await tx`
    select nombre, nivel, coalesce(sector_id, 0) as sector_id, v_factibilidad, compromiso, excluido, motivo_exclusion, metadata
    from corredores
    where metadata->>'ajustado_a_mano' is not null
  `;

  await tx.unsafe(`
    create temp table tmp_jerarquia (nombre text, jerarquia text, geom geometry(MultiLineString, 4326)) on commit drop;
    create temp table tmp_colectivos (geom geometry(LineString, 4326)) on commit drop;
  `);

  const lotes = async (items, tabla, fila) => {
    const LOTE = 300;
    for (let i = 0; i < items.length; i += LOTE) {
      const valores = items.slice(i, i + LOTE).map(fila).join(",\n");
      await tx.unsafe(`insert into ${tabla} values ${valores}`);
    }
  };
  const g = (f) => JSON.stringify(f.geometry).replace(/'/g, "''");
  const t = (v) => (v == null ? "null" : `'${String(v).replace(/'/g, "''")}'`);

  await lotes(jerarquia, "tmp_jerarquia", (f) =>
    `(${t(f.properties.nombre)}, ${t(f.properties.jerarquia)}, st_multi(st_setsrid(st_geomfromgeojson('${g(f)}'), 4326)))`);
  await lotes(colectivos, "tmp_colectivos", (f) =>
    `(st_setsrid(st_geomfromgeojson('${g(f)}'), 4326))`);

  await tx.unsafe("delete from corredores");

  /**
   * st_collectionextract(..., 2) es imprescindible: la intersección de una
   * línea con un polígono devuelve puntos donde apenas la roza, y una
   * GeometryCollection no entra en una columna MultiLineString.
   */
  await tx.unsafe(`
    insert into corredores (
      nombre, sector_id, nivel, longitud_m, geom,
      barrios_conectados, tiene_transporte,
      v_interconexion, v_accesibilidad, v_transporte, v_equipamientos
    )
    with recorte as (
      select j.nombre,
             case j.jerarquia when 'primaria' then 1 else 2 end as nivel,
             s.id as sector_id,
             s.geom as sector_geom,
             st_collectionextract(st_intersection(j.geom, s.geom), 2) as geom
      from tmp_jerarquia j
      join sectores_licitacion s on s.tipo = 'hormigon' and st_intersects(j.geom, s.geom)
    ),
    agrupado as (
      select nombre, nivel, sector_id,
             min(sector_geom::text) as sector_txt,
             st_multi(st_union(geom)) as geom
      from recorte
      where geom is not null and not st_isempty(geom)
      group by 1, 2, 3
    ),
    medido as (
      select a.*,
             st_length(a.geom::geography) as largo,
             (select count(distinct b.id) from barrios b where st_intersects(b.geom, a.geom)) as barrios,
             exists (
               select 1 from tmp_colectivos c
               where st_dwithin(c.geom::geography, a.geom::geography, 25)
             ) as transporte,
             -- Accesibilidad: un corredor que toca el borde del sector es una
             -- entrada al sector. Si lo toca en dos lugares distintos, lo
             -- atraviesa entero (la "continuidad total del eje" del manual).
             st_numgeometries(
               coalesce(
                 st_collectionextract(
                   st_intersection(a.geom, st_boundary(a.sector_txt::geometry)), 1
                 ),
                 'MULTIPOINT EMPTY'::geometry
               )
             ) as toques_borde
      from agrupado a
      -- Un "corredor" de 40 m es un resto de recorte, no un eje: no entra.
      where st_length(a.geom::geography) >= 80
    )
    select
      nombre, sector_id, nivel, round(largo::numeric, 1), geom,
      barrios, transporte,
      -- Interconexión de barrios: 1→20, 2→60, 3 o más→100; +10 si el eje
      -- atraviesa el sector completo, con tope 100.
      least(100, (case when barrios >= 3 then 100 when barrios = 2 then 60 else 20 end)
                 + (case when toques_borde >= 2 then 10 else 0 end)),
      -- Accesibilidad del sector: acceso principal 100, secundario 60, no
      -- cumple rol de acceso 20. Se deriva de la jerarquía y de si toca el
      -- borde: es una aproximación explícita, corregible a mano.
      case when toques_borde = 0 then 20 when nivel = 1 then 100 else 60 end,
      case when transporte then 100 else 0 end,
      -- Equipamientos urbanos (buffer 150 m): NO hay capa de equipamientos
      -- todavía. Queda null a propósito — vale más un hueco declarado que un
      -- cero que se lee como "acá no hay ni una escuela".
      null
    from medido
  `);

  for (const m of manuales) {
    await tx`
      update corredores set
        v_factibilidad = ${m.v_factibilidad},
        compromiso = ${m.compromiso},
        excluido = ${m.excluido},
        motivo_exclusion = ${m.motivo_exclusion},
        metadata = ${m.metadata}
      where nombre = ${m.nombre} and nivel = ${m.nivel} and coalesce(sector_id, 0) = ${m.sector_id}
    `;
  }
  if (manuales.length > 0) console.log(`se conservaron ${manuales.length} ajustes manuales`);
});

const resumen = await sql`
  select nivel, count(*)::int n, round(avg(barrios_conectados), 1) barrios_prom,
         count(*) filter (where tiene_transporte)::int con_tp
  from corredores group by 1 order by 1
`;
console.log("corredores por nivel:", JSON.stringify(resumen));
const total = await sql`select count(*)::int n, round(sum(longitud_m) / 1000, 1) km from corredores`;
console.log(`total: ${total[0].n} corredores · ${total[0].km} km`);

await sql.end();
