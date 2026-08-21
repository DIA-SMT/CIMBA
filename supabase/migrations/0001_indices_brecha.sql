-- Índices geográficos funcionales: los cruces de brecha y deduplicación usan
-- st_dwithin(geom::geography, ...) en metros; sin estos índices el cast a
-- geography fuerza un recorrido secuencial (2.9k demandas × 1.8k incidentes).
create index if not exists incidentes_geog_idx on incidentes using gist ((geom::geography));
create index if not exists demandas_geog_idx on demandas using gist ((geom::geography));
create index if not exists intervenciones_geog_idx on intervenciones using gist ((geom_ejecucion::geography));
