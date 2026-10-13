-- ═══════════════════════════════════════════════════════════════════════════
-- LAS CALLES DE LA CIUDAD CON SU NOMBRE, PARA UBICAR LOS CRUCES
--
-- "Estoy teniendo problemas con las cargas de intersecciones: Piedras y San
-- Luis; Eudoro Aráoz y Chacabuco tampoco" (13/10/2026). El callejero municipal
-- estima un cruce con los puntos que conoce de cada calle, y para muchas
-- calles conoce pocos (San Luis 4, Chacabuco 7) o los tiene cargados con otro
-- nombre ("Piedras", "Las Piedras", "Combate de Las Piedras"). Nominatim, con
-- dos nombres de calle, devuelve un tramo cualquiera de una de las dos.
--
-- OpenStreetMap tiene el trazado de cada calle con su nombre. Con eso el cruce
-- es exacto: el punto donde las dos líneas se tocan. Se baja una vez (scripts/
-- cargar-calles-osm.mjs) y se consulta acá, sin depender de un servicio
-- externo en cada carga — el servidor público de OSM estaba caído justo
-- cuando se probó.
--
-- Tabla nueva; no toca ninguna otra. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists calles_osm (
  -- El id del tramo (way) en OpenStreetMap: recargar pisa, no duplica.
  id           bigint primary key,
  nombre       text not null,
  -- El nombre sin tildes, en minúscula y sin "avenida", "pasaje"…: contra
  -- esto se busca lo que escribe la gente.
  nombre_norm  text not null,
  tipo         text,
  geom         geometry(LineString, 4326) not null,
  cargado_en   timestamptz not null default now()
);

create index if not exists calles_osm_geom_idx on calles_osm using gist (geom);

comment on table calles_osm is
  'Calles con nombre de San Miguel de Tucumán según OpenStreetMap, para ubicar cruces ("Piedras y San Luis"). Se carga con scripts/cargar-calles-osm.mjs.';
