-- 0006: Red vial, sectores de licitación, destino de resolución y usuarios locales.
--
-- Los insumos que pasó la Dirección de Bacheo (sep 2026) convierten dos
-- promesas en datos: la RED VIAL (10.392 cuadras con pavimento/ripio/cordón
-- cuneta) habilita la clasificación automática bacheo/SAT/ingeniería que
-- desinfla los "sin vincular", y los SECTORES DE LICITACIÓN son la zonificación
-- real de cada empresa (11 sectores de paños + 4 cuadrantes con doble
-- asignación hormigón/asfalto).
--
-- La carga de datos NO va acá (son ~10 mil geometrías): la hace
-- scripts/cargar-territorio.mjs leyendo apps/web/public/data/*.json, y el
-- backfill de destino corre ahí después de cargar la red.

-- ── Red vial: cada cuadra sabe de qué está hecha ─────────────────────────────
create table red_vial (
  id           bigint generated always as identity primary key,
  capa         text not null check (capa in ('pavimento', 'ripio', 'cordon_cuneta')),
  intervencion text,          -- REPAVIMENTACIÓN / PAVIMENTACIÓN / PERFILADO Y ENRIPIADO
  direccion    text,
  barrio       text,
  geom         geometry(MultiLineString, 4326) not null
);
create index red_vial_geom_idx on red_vial using gist (geom);
-- Las consultas de cercanía van en metros (geography): índice propio.
create index red_vial_geog_idx on red_vial using gist ((geom::geography));
create index red_vial_capa_idx on red_vial (capa);

-- ── Sectores de licitación: la zonificación real de las empresas ─────────────
create table sectores_licitacion (
  id                 bigint generated always as identity primary key,
  tipo               text not null check (tipo in ('hormigon', 'cuadrante')),
  sector             text not null,
  empresa_id         bigint references empresas(id),
  -- Los 4 cuadrantes grandes tienen DOS adjudicatarias: una para paños de
  -- hormigón y otra para asfalto. Los 11 sectores chicos, solo hormigón.
  empresa_asfalto_id bigint references empresas(id),
  licitacion         text,
  metadata           jsonb not null default '{}',
  geom               geometry(MultiPolygon, 4326) not null
);
create index sectores_licitacion_geom_idx on sectores_licitacion using gist (geom);

-- CONTRATUC aparece adjudicataria de asfalto en los cuadrantes y no estaba.
insert into empresas (nombre, slug, cuadrillas, metadata)
values ('CONTRATUC', 'contratuc', 1, '{}')
on conflict (slug) do nothing;

-- ── Destino de resolución: quién resuelve cada demanda ───────────────────────
-- Es LA clasificación que pidió el Director: "te queda bacheo por un lado,
-- ingeniería por otro" — y las pérdidas de agua/tapas/sumideros son de la SAT.
create type destino_resolucion as enum ('bacheo', 'sat', 'ingenieria');

alter table demandas add column if not exists destino destino_resolucion;
create index if not exists demandas_destino_idx on demandas (destino);

/**
 * Reglas, en orden:
 *  1. Pérdida de agua, tapa de registro o sumidero → SAT (se le arma expediente).
 *  2. El texto pide pasado de máquina / enripiado → ingeniería.
 *  3. El punto cae en una cuadra de ripio o cordón cuneta (a <20 m) y NO hay
 *     pavimento pegado (<12 m, para no robarse las esquinas) → ingeniería:
 *     en calle de tierra no hay bache que bachear, es pasado de máquina.
 *  4. Todo lo demás → bacheo.
 */
create or replace function clasificar_destino_demanda(
  p_tipo tipo_problema, p_descripcion text, p_geom geometry
) returns destino_resolucion as $$
begin
  if p_tipo in ('perdida_agua', 'tapa_registro', 'sumidero') then
    return 'sat';
  end if;
  if p_descripcion ~* '(pasad[oa] de m[aá]quina|enripiad|perfilad[oa]|niveladora|calle de tierra)' then
    return 'ingenieria';
  end if;
  if p_geom is not null
     and to_regclass('red_vial') is not null
     and exists (
       select 1 from red_vial rv
       where rv.capa in ('ripio', 'cordon_cuneta')
         and st_dwithin(rv.geom::geography, p_geom::geography, 20)
     )
     and not exists (
       select 1 from red_vial rv
       where rv.capa = 'pavimento'
         and st_dwithin(rv.geom::geography, p_geom::geography, 12)
     )
  then
    return 'ingenieria';
  end if;
  return 'bacheo';
end $$ language plpgsql stable;

create or replace function trg_clasificar_destino() returns trigger as $$
begin
  -- Solo si nadie lo fijó a mano: una corrección humana no se pisa.
  if new.destino is null or (tg_op = 'UPDATE' and (new.metadata->>'destino_corregido') is null) then
    new.destino := clasificar_destino_demanda(new.tipo, new.descripcion, new.geom);
  end if;
  return new;
end $$ language plpgsql;

create trigger trg_demandas_destino
  before insert or update of tipo, descripcion, geom on demandas
  for each row execute function trg_clasificar_destino();

-- ── Usuarios locales con clave propia ────────────────────────────────────────
-- Hasta ahora entraban solo admin/bacheo (por entorno) y las empresas (por
-- slug). Silvana, Alejandro y quien siga necesitan usuario y clave propios,
-- con clave temporal que el sistema pide cambiar al entrar.
alter table perfiles add column if not exists usuario text unique;
alter table perfiles add column if not exists clave_hash text;
alter table perfiles add column if not exists clave_temporal boolean not null default false;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table red_vial enable row level security;
alter table sectores_licitacion enable row level security;
create policy red_vial_select on red_vial for select using (cimba_rol() <> '');
create policy sectores_select on sectores_licitacion for select using (cimba_rol() <> '');
