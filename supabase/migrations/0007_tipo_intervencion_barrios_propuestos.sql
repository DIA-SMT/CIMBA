-- 0007: Tipo de intervención, barrios en la base y items propuestos por empresas.
--
-- Tres construcciones de la hoja de ruta de la reunión con Bacheo (2/9):
--  1. TIPO DE INTERVENCIÓN como dato de primera clase: "¿cómo se finalizó?
--     ¿por bacheo o por cambio de paño?" — la pregunta que más repitió el
--     Director. Cada intervención lo declara; la empresa lo elige al reportar
--     y Bacheo lo puede corregir.
--  2. BARRIOS de verdad: los 327 polígonos pasan del JSON a la base, cada
--     demanda/incidente sabe su barrio, y Migue puede responder "¿qué hicimos
--     en Villa Alem?".
--  3. La EMPRESA PROPONE, BACHEO VALIDA: la cuadrilla encuentra baches que no
--     estaban en la orden (o el bache ya estaba resuelto al llegar) — entran
--     como items propuestos que un inspector valida antes de que cuenten.

-- ── Tipo de intervención ─────────────────────────────────────────────────────
-- Los cuatro modos reales de resolver del municipio, en palabras del Director:
-- bacheo / cambio de paño de hormigón / carpeta (repavimentación) / enripiado
-- (pasado de máquina).
create type tipo_intervencion as enum ('bacheo', 'pano_hormigon', 'carpeta', 'enripiado');

alter table intervenciones add column if not exists tipo_intervencion tipo_intervencion;
create index if not exists intervenciones_tipo_idx on intervenciones (tipo_intervencion);

-- Backfill con lo que cada fuente ya sabe de sí misma:
--  · SIGOV trae el tipo de obra en materiales;
--  · lo que vino de órdenes de trabajo, por el tipo del item;
--  · el resto del bacheo histórico (empresas/planillas), bacheo puro.
update intervenciones set tipo_intervencion = case
  when materiales->>'tipo_obra' ~* 'hormig' then 'pano_hormigon'::tipo_intervencion
  when materiales->>'tipo_obra' ~* 'asf[aá]lt|carpeta|repaviment' then 'carpeta'::tipo_intervencion
  when metadata->>'origen' = 'orden_trabajo' and metadata->>'escala' = 'obra' then 'carpeta'::tipo_intervencion
  else 'bacheo'::tipo_intervencion
end
where tipo_intervencion is null;

-- Nº de contrato o decreto de la orden (lo pidió el Director junto al tipo).
alter table ordenes_trabajo add column if not exists contrato_decreto text;

-- ── Barrios ──────────────────────────────────────────────────────────────────
create table barrios (
  -- PK propia: el id del shapefile municipal viene VACÍO en 121 de los 327
  -- barrios y hasta repetido — se guarda aparte, solo informativo.
  id       bigint generated always as identity primary key,
  id_shape bigint,
  nombre   text not null,
  geom     geometry(MultiPolygon, 4326) not null
);
create index barrios_geom_idx on barrios using gist (geom);
-- La carga de los 327 polígonos la hace scripts/cargar-territorio.mjs.

alter table demandas   add column if not exists barrio_id bigint references barrios(id);
alter table incidentes add column if not exists barrio_id bigint references barrios(id);
create index if not exists demandas_barrio_idx on demandas (barrio_id);
create index if not exists incidentes_barrio_idx on incidentes (barrio_id);

-- Los triggers de territorio completan también el barrio.
create or replace function autocompletar_territorio() returns trigger as $$
begin
  if new.geom is not null then
    if new.distrito_id is null then
      select d.id into new.distrito_id from distritos d where st_contains(d.geom, new.geom) limit 1;
    end if;
    if to_regclass('cuadrantes') is not null and new.cuadrante_id is null then
      select c.id into new.cuadrante_id from cuadrantes c where st_contains(c.geom, new.geom) limit 1;
    end if;
    if to_regclass('circuitos') is not null and new.circuito_id is null then
      select c.id into new.circuito_id from circuitos c where st_contains(c.geom, new.geom) limit 1;
    end if;
    if to_regclass('barrios') is not null and new.barrio_id is null then
      select b.id into new.barrio_id from barrios b where st_contains(b.geom, new.geom) limit 1;
    end if;
  end if;
  return new;
end $$ language plpgsql;

create or replace function autocompletar_territorio_demanda() returns trigger as $$
begin
  if new.geom is not null then
    if new.distrito_id is null then
      select d.id into new.distrito_id from distritos d where st_contains(d.geom, new.geom) limit 1;
    end if;
    if to_regclass('circuitos') is not null and new.circuito_id is null then
      select c.id into new.circuito_id from circuitos c where st_contains(c.geom, new.geom) limit 1;
    end if;
    if to_regclass('barrios') is not null and new.barrio_id is null then
      select b.id into new.barrio_id from barrios b where st_contains(b.geom, new.geom) limit 1;
    end if;
  end if;
  return new;
end $$ language plpgsql;

-- ── Items propuestos por la empresa ──────────────────────────────────────────
-- Valores nuevos del enum: NO se usan en esta migración (restricción de ADD
-- VALUE dentro de la transacción); se usan en runtime.
--  · propuesto:   lo encontró la cuadrilla, espera validación de Bacheo.
--  · rechazado:   Bacheo lo descartó (queda la traza).
--  · ya_resuelto: llegaron y el bache ya estaba hecho — foto del después y
--                 vínculo con lo abierto cerca; no suma m² de la empresa.
alter type estado_item_orden add value if not exists 'propuesto';
alter type estado_item_orden add value if not exists 'rechazado';
alter type estado_item_orden add value if not exists 'ya_resuelto';
