-- ═══════════════════════════════════════════════════════════════════════════
-- EL CALLEJERO, MATERIALIZADO
--
-- Como vista común, `callejero_municipal` volvía a normalizar con expresiones
-- regulares las ~4.000 direcciones de cuatro tablas en CADA consulta. Para una
-- búsqueda suelta se aguantaba; para geocodificar una tanda —o para medir la
-- cobertura sobre 1.300 direcciones— se iba al timeout.
--
-- Materializada con índice por (calle, altura), la misma pregunta se contesta
-- en microsegundos. El precio es que hay que refrescarla: lo hace el cron
-- diario y cada importación, y `concurrently` la deja consultable mientras
-- tanto (por eso la clave única sintética: sin un índice único, PostgreSQL no
-- acepta el refresco concurrente).
--
-- Un pin corregido hace cinco minutos puede no estar todavía. Es aceptable: lo
-- que el callejero contesta es dónde cae una altura, y eso no cambia porque
-- alguien mueva un punto — cambia cuánto mejor lo sabemos.
-- ═══════════════════════════════════════════════════════════════════════════

drop view if exists callejero_municipal;

create materialized view callejero_municipal as
  select row_number() over () as id, * from (
    select calle_norm(i.direccion) as calle, altura_de(i.direccion) as altura, i.geom,
           case
             when coalesce(i.metadata->>'origen', '') in ('bacheo_empresas', 'empresa_libre', 'orden_trabajo')
               then 3
             when coalesce(i.metadata->>'origen', '') = 'sigov' then 2
             else 1
           end as peso
      from incidentes i
     where i.geom is not null and altura_de(i.direccion) is not null
       and calle_norm(i.direccion) is not null
    union all
    select calle_norm(coalesce(d.direccion_normalizada, d.direccion_texto)),
           altura_de(coalesce(d.direccion_normalizada, d.direccion_texto)), d.geom,
           case when d.metadata->>'ubicacion_corregida' = 'true'
                  or d.metadata ? 'pin_corregido' then 3 else 2 end
      from demandas d
     where d.geom is not null
       and (d.metadata->>'ubicacion_corregida' = 'true'
            or d.metadata ? 'pin_corregido'
            or coalesce(d.geocod_confianza, 0) >= 0.8)
       and altura_de(coalesce(d.direccion_normalizada, d.direccion_texto)) is not null
       and calle_norm(coalesce(d.direccion_normalizada, d.direccion_texto)) is not null
    union all
    select calle_norm(oi.direccion), altura_de(oi.direccion), st_centroid(oi.geom), 3
      from orden_items oi
     where oi.geom is not null and altura_de(oi.direccion) is not null
       and calle_norm(oi.direccion) is not null
    union all
    select calle_norm(gc.direccion_norm), altura_de(gc.direccion_norm), gc.geom, 2
      from geocode_cache gc
     where gc.precision = 'exacta' and altura_de(gc.direccion_norm) is not null
       and calle_norm(gc.direccion_norm) is not null
  ) q;

-- La clave única que exige `refresh ... concurrently`.
create unique index callejero_municipal_id_idx on callejero_municipal (id);
-- La consulta real: por calle, y dentro de la calle por altura.
create index callejero_municipal_calle_idx on callejero_municipal (calle, altura);

comment on materialized view callejero_municipal is
  'Puntos conocidos (calle, altura) del municipio. Alimenta ubicar_altura(). La refresca el cron diario y cada importación.';

/**
 * Refrescar el callejero. Concurrently para no bloquear las consultas; si
 * falla porque nunca se pobló (una base recién creada), cae al refresco común.
 */
create or replace function refrescar_callejero() returns void as $fn$
begin
  refresh materialized view concurrently callejero_municipal;
exception when others then
  refresh materialized view callejero_municipal;
end;
$fn$ language plpgsql;
