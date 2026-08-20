-- ═══════════════════════════════════════════════════════════════════════════
-- CIMBA — Migración inicial
-- Modelo: DEMANDA (lo que piden) → INCIDENTE (el problema físico) →
--         INTERVENCIÓN (el trabajo ejecutado).
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists postgis;
create extension if not exists pg_trgm;

-- ── Enums ────────────────────────────────────────────────────────────────────
-- Nota: 'sat' (intimaciones a la Sociedad Aguas del Tucumán), 'tapa_registro'
-- y 'perdida_agua' se agregaron al relevar los datos reales de la Dirección de
-- Bacheo (ver docs/decisiones.md).

create type fuente_demanda as enum (
  'atencion_ciudadana', 'hcd', 'redes_sociales', 'secretaria',
  'bachia', 'cuadrilla', 'carga_manual', 'sat'
);

create type tipo_problema as enum (
  'bache', 'pavimento_deteriorado', 'hundimiento', 'fisura',
  'sumidero', 'tapa_registro', 'perdida_agua', 'otro'
);

create type estado_demanda as enum (
  'recibida', 'en_validacion', 'vinculada', 'descartada', 'fuera_de_alcance'
);

create type estado_incidente as enum (
  'detectado', 'priorizado', 'programado', 'en_ejecucion',
  'reparado', 'verificado', 'desestimado'
);

create type estado_intervencion as enum (
  'asignada', 'en_curso', 'finalizada', 'anulada'
);

create type rol_usuario as enum (
  'admin', 'atencion_ciudadana', 'hcd', 'informacion_estrategica',
  'planificacion', 'supervision', 'cuadrilla', 'lectura'
);

create type momento_foto as enum ('antes', 'durante', 'despues');

-- ── Territorio ───────────────────────────────────────────────────────────────
-- Cargar desde distritosNuevo.json (20 features, propiedades ID y NOMBRE).
-- Ojo: la numeración tiene huecos (no existe el 15) — no asumir 1..20 continuo.
create table distritos (
  id            integer primary key,          -- mismo ID que usa Atención Ciudadana
  nombre        text not null,
  geom          geometry(MultiPolygon, 4326) not null,
  -- true mientras la geometría sea un hull aproximado y no el límite oficial
  aproximado    boolean not null default false
);
create index distritos_geom_idx on distritos using gist (geom);

-- Cuadrantes de pavimento (GeoPackage de SIGOV, se cargan después)
create table cuadrantes (
  id            bigserial primary key,
  codigo        text unique not null,
  nombre        text,
  material      text,
  geom          geometry(MultiPolygon, 4326) not null,
  metadata      jsonb not null default '{}'::jsonb
);
create index cuadrantes_geom_idx on cuadrantes using gist (geom);

-- ── Identidad (espejo del SSO municipal, NO Supabase Auth) ───────────────────
create table perfiles (
  id                uuid primary key default gen_random_uuid(),
  id_persona        bigint unique not null,     -- identidad municipal
  id_tusuario       integer,                    -- tipo de usuario del portal
  nombre            text not null,
  documento         text,
  email             text,
  rol               rol_usuario not null default 'lectura',
  area              text,
  activo            boolean not null default true,
  ultimo_ingreso    timestamptz,
  creado_en         timestamptz not null default now()
);

-- ── Trazabilidad de sistemas externos ────────────────────────────────────────
create table external_ref (
  id              bigserial primary key,
  sistema         text not null,      -- 'atencion_ciudadana' | 'sigov' | 'bachia' | 'sat' | ...
  entidad_local   text not null,      -- 'demanda' | 'incidente' | 'intervencion'
  id_local        bigint not null,
  id_remoto       text not null,
  payload_hash    text not null,
  sincronizado_en timestamptz not null default now(),
  unique (sistema, entidad_local, id_remoto)
);
create index external_ref_local_idx on external_ref (entidad_local, id_local);

create table sync_runs (
  id            bigserial primary key,
  sistema       text not null,
  desde         timestamptz,
  hasta         timestamptz,
  leidos        integer not null default 0,
  insertados    integer not null default 0,
  actualizados  integer not null default 0,
  errores       integer not null default 0,
  detalle       jsonb not null default '{}'::jsonb,
  iniciado_en   timestamptz not null default now(),
  finalizado_en timestamptz
);

-- ── DEMANDA ──────────────────────────────────────────────────────────────────
create table demandas (
  id                    bigserial primary key,
  fuente                fuente_demanda not null,
  estado                estado_demanda not null default 'recibida',
  tipo                  tipo_problema,
  descripcion           text,

  direccion_texto       text,
  direccion_normalizada text,
  geocod_confianza      numeric(4,3),
  geom                  geometry(Point, 4326),
  distrito_id           integer references distritos(id),

  contacto              jsonb not null default '{}'::jsonb,  -- datos personales: acceso restringido
  solicitante           text,          -- concejal, área, cuenta de red
  prioridad_informada   smallint,
  menciones             integer,
  url_origen            text,

  creado_por            uuid references perfiles(id),
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),
  metadata              jsonb not null default '{}'::jsonb
);
create index demandas_geom_idx on demandas using gist (geom);
create index demandas_fuente_estado_idx on demandas (fuente, estado);
create index demandas_distrito_idx on demandas (distrito_id);
create index demandas_dir_trgm_idx on demandas using gin (direccion_normalizada gin_trgm_ops);

-- ── INCIDENTE ────────────────────────────────────────────────────────────────
create table incidentes (
  id                bigserial primary key,
  tipo              tipo_problema not null,
  estado            estado_incidente not null default 'detectado',
  geom              geometry(Point, 4326) not null,
  direccion         text,
  distrito_id       integer references distritos(id),
  cuadrante_id      bigint references cuadrantes(id),

  prioridad         smallint,
  score_prioridad   numeric(6,2),
  superficie_m2     numeric(8,2),
  observaciones     text,

  detectado_en      timestamptz not null default now(),
  cerrado_en        timestamptz,
  creado_por        uuid references perfiles(id),
  metadata          jsonb not null default '{}'::jsonb
);
create index incidentes_geom_idx on incidentes using gist (geom);
create index incidentes_estado_prioridad_idx on incidentes (estado, prioridad);
create index incidentes_distrito_idx on incidentes (distrito_id);

create table demanda_incidente (
  demanda_id    bigint not null references demandas(id) on delete cascade,
  incidente_id  bigint not null references incidentes(id) on delete cascade,
  vinculado_por uuid references perfiles(id),
  vinculado_en  timestamptz not null default now(),
  automatico    boolean not null default false,
  confianza     numeric(4,3),
  primary key (demanda_id, incidente_id)
);
create index demanda_incidente_incidente_idx on demanda_incidente (incidente_id);

-- ── INTERVENCIÓN ─────────────────────────────────────────────────────────────
create table cuadrillas (
  id            bigserial primary key,
  nombre        text not null,
  responsable   uuid references perfiles(id),
  activa        boolean not null default true
);

create table intervenciones (
  id                bigserial primary key,
  incidente_id      bigint not null references incidentes(id),
  cuadrilla_id      bigint references cuadrillas(id),
  estado            estado_intervencion not null default 'asignada',

  geom_ejecucion    geometry(Point, 4326),
  iniciada_en       timestamptz,
  finalizada_en     timestamptz,
  superficie_m2     numeric(8,2),
  materiales        jsonb not null default '{}'::jsonb,
  observaciones     text,

  ejecutada_por     uuid references perfiles(id),
  creado_en         timestamptz not null default now(),
  metadata          jsonb not null default '{}'::jsonb
);
create index intervenciones_incidente_idx on intervenciones (incidente_id, estado);
create index intervenciones_geom_idx on intervenciones using gist (geom_ejecucion);

create table fotografias (
  id                bigserial primary key,
  intervencion_id   bigint references intervenciones(id) on delete cascade,
  demanda_id        bigint references demandas(id) on delete cascade,
  momento           momento_foto not null,
  storage_path      text,             -- bucket de Supabase Storage
  url_externa       text,             -- si la foto vive en el server municipal
  geom              geometry(Point, 4326),
  tomada_en         timestamptz,
  subida_en         timestamptz not null default now(),
  check (intervencion_id is not null or demanda_id is not null),
  check (storage_path is not null or url_externa is not null)
);

-- ── Soporte ──────────────────────────────────────────────────────────────────
create table geocode_cache (
  direccion_norm  text primary key,
  geom            geometry(Point, 4326) not null,
  confianza       numeric(4,3),
  proveedor       text not null,
  creado_en       timestamptz not null default now()
);

create table auditoria (
  id            bigserial primary key,
  entidad       text not null,
  entidad_id    bigint not null,
  accion        text not null,
  actor         uuid references perfiles(id),
  diff          jsonb,
  ocurrido_en   timestamptz not null default now()
);
create index auditoria_entidad_idx on auditoria (entidad, entidad_id);

-- ── Staging: lo que escribe la ingesta antes de promover ─────────────────────
create schema if not exists staging;

create table staging.registros (
  id            bigserial primary key,
  sistema       text not null,
  entidad       text not null,        -- 'demanda' | 'intervencion'
  id_remoto     text not null,
  payload       jsonb not null,
  payload_hash  text not null,
  recibido_en   timestamptz not null default now(),
  promovido_en  timestamptz,
  error         text,
  unique (sistema, entidad, id_remoto, payload_hash)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- Triggers
-- ═══════════════════════════════════════════════════════════════════════════

-- actualizado_en genérico
create or replace function set_actualizado_en() returns trigger as $$
begin
  new.actualizado_en := now();
  return new;
end $$ language plpgsql;

create trigger trg_demandas_actualizado
  before update on demandas
  for each row execute function set_actualizado_en();

-- Autocompletar distrito y cuadrante por cruce espacial
create or replace function autocompletar_territorio() returns trigger as $$
begin
  if new.geom is not null then
    if new.distrito_id is null then
      select d.id into new.distrito_id
      from distritos d
      where st_contains(d.geom, new.geom)
      limit 1;
    end if;
    if to_regclass('cuadrantes') is not null and new.cuadrante_id is null then
      select c.id into new.cuadrante_id
      from cuadrantes c
      where st_contains(c.geom, new.geom)
      limit 1;
    end if;
  end if;
  return new;
end $$ language plpgsql;

create or replace function autocompletar_territorio_demanda() returns trigger as $$
begin
  if new.geom is not null and new.distrito_id is null then
    select d.id into new.distrito_id
    from distritos d
    where st_contains(d.geom, new.geom)
    limit 1;
  end if;
  return new;
end $$ language plpgsql;

create trigger trg_demandas_territorio
  before insert or update of geom on demandas
  for each row execute function autocompletar_territorio_demanda();

create trigger trg_incidentes_territorio
  before insert or update of geom on incidentes
  for each row execute function autocompletar_territorio();

-- Auditoría genérica
create or replace function auditar() returns trigger as $$
declare
  v_actor uuid;
begin
  begin
    v_actor := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub';
  exception when others then
    v_actor := null;
  end;
  if tg_op = 'INSERT' then
    insert into auditoria (entidad, entidad_id, accion, actor, diff)
    values (tg_table_name, new.id, 'insert', v_actor, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into auditoria (entidad, entidad_id, accion, actor, diff)
    values (tg_table_name, new.id, 'update', v_actor,
            jsonb_build_object('antes', to_jsonb(old), 'despues', to_jsonb(new)));
    return new;
  elsif tg_op = 'DELETE' then
    insert into auditoria (entidad, entidad_id, accion, actor, diff)
    values (tg_table_name, old.id, 'delete', v_actor, to_jsonb(old));
    return old;
  end if;
  return null;
end $$ language plpgsql;

create trigger trg_auditar_demandas
  after insert or update or delete on demandas
  for each row execute function auditar();
create trigger trg_auditar_incidentes
  after insert or update or delete on incidentes
  for each row execute function auditar();
create trigger trg_auditar_intervenciones
  after insert or update or delete on intervenciones
  for each row execute function auditar();

-- ═══════════════════════════════════════════════════════════════════════════
-- Deduplicación: candidatos de incidente para una demanda
-- ═══════════════════════════════════════════════════════════════════════════
-- La lógica autoritativa (con reglas de confianza y compatibilidad de tipos)
-- vive en packages/domain. Esta función devuelve el conjunto candidato con un
-- score aproximado para búsquedas masivas server-side.

create or replace function sugerir_incidente(
  p_geom geometry,
  p_tipo tipo_problema,
  p_fecha timestamptz default now(),
  p_radio_m numeric default 40,
  p_reincidencia_dias integer default 90
) returns table (
  incidente_id bigint,
  distancia_m numeric,
  mismo_tipo boolean,
  es_reincidencia boolean,
  score numeric
) as $$
  select
    i.id,
    round(st_distance(i.geom::geography, p_geom::geography)::numeric, 1) as distancia_m,
    (i.tipo = p_tipo) as mismo_tipo,
    (i.estado in ('reparado','verificado')
      and i.cerrado_en is not null
      and p_fecha - i.cerrado_en <= make_interval(days => p_reincidencia_dias)) as es_reincidencia,
    round((
      0.6 * exp(-st_distance(i.geom::geography, p_geom::geography) / (p_radio_m / 2.0))
      + 0.4 * case when i.tipo = p_tipo then 1.0 else 0.4 end
    )::numeric, 3) as score
  from incidentes i
  where st_dwithin(i.geom::geography, p_geom::geography, p_radio_m)
    and (
      i.estado in ('detectado','priorizado','programado','en_ejecucion')
      or (i.estado in ('reparado','verificado')
          and i.cerrado_en is not null
          and p_fecha - i.cerrado_en <= make_interval(days => p_reincidencia_dias))
    )
  order by score desc
$$ language sql stable;

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════════
-- El JWT propio de CIMBA lleva claims: sub (perfil.id), rol_cimba, id_persona.
-- Con Drizzle/postgres.js los claims se inyectan por transacción vía
-- set_config('request.jwt.claims', ...). Con supabase-js los pone PostgREST.

create or replace function cimba_rol() returns text as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'rol_cimba', '');
$$ language sql stable;

create or replace function cimba_perfil() returns uuid as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$ language sql stable;

alter table demandas enable row level security;
alter table incidentes enable row level security;
alter table intervenciones enable row level security;
alter table demanda_incidente enable row level security;
alter table fotografias enable row level security;
alter table perfiles enable row level security;
alter table cuadrillas enable row level security;
alter table distritos enable row level security;
alter table cuadrantes enable row level security;
alter table auditoria enable row level security;

-- Territorio y catálogos: visibles para todo usuario autenticado
create policy distritos_select on distritos for select using (cimba_rol() <> '');
create policy cuadrantes_select on cuadrantes for select using (cimba_rol() <> '');
create policy cuadrillas_select on cuadrillas for select using (cimba_rol() <> '');
create policy perfiles_select on perfiles for select using (cimba_rol() <> '');

-- DEMANDAS
create policy demandas_select on demandas for select using (
  cimba_rol() in ('admin','atencion_ciudadana','informacion_estrategica',
                  'planificacion','supervision','lectura')
  or (cimba_rol() = 'hcd' and creado_por = cimba_perfil())
);
create policy demandas_insert on demandas for insert with check (
  cimba_rol() in ('admin','atencion_ciudadana','hcd','informacion_estrategica')
);
create policy demandas_update on demandas for update using (
  cimba_rol() in ('admin','atencion_ciudadana')
);
create policy demandas_delete on demandas for delete using (cimba_rol() = 'admin');

-- INCIDENTES
create policy incidentes_select on incidentes for select using (
  cimba_rol() in ('admin','atencion_ciudadana','hcd','informacion_estrategica',
                  'planificacion','supervision','lectura')
  or (cimba_rol() = 'cuadrilla' and exists (
        select 1 from intervenciones iv
        join cuadrillas c on c.id = iv.cuadrilla_id
        where iv.incidente_id = incidentes.id and c.responsable = cimba_perfil()
      ))
);
create policy incidentes_insert on incidentes for insert with check (
  cimba_rol() in ('admin','atencion_ciudadana','planificacion')
);
create policy incidentes_update on incidentes for update using (
  cimba_rol() in ('admin','planificacion','supervision')
);
create policy incidentes_delete on incidentes for delete using (cimba_rol() = 'admin');

-- VINCULACIÓN demanda-incidente
create policy demanda_incidente_select on demanda_incidente for select using (cimba_rol() <> '');
create policy demanda_incidente_insert on demanda_incidente for insert with check (
  cimba_rol() in ('admin','atencion_ciudadana')
);
create policy demanda_incidente_delete on demanda_incidente for delete using (
  cimba_rol() in ('admin','atencion_ciudadana')
);

-- INTERVENCIONES
create policy intervenciones_select on intervenciones for select using (
  cimba_rol() in ('admin','atencion_ciudadana','informacion_estrategica',
                  'planificacion','supervision','lectura')
  or (cimba_rol() = 'cuadrilla' and exists (
        select 1 from cuadrillas c
        where c.id = intervenciones.cuadrilla_id and c.responsable = cimba_perfil()
      ))
);
create policy intervenciones_insert on intervenciones for insert with check (
  cimba_rol() in ('admin','planificacion')
);
create policy intervenciones_update on intervenciones for update using (
  cimba_rol() in ('admin','planificacion','supervision')
  or (cimba_rol() = 'cuadrilla' and exists (
        select 1 from cuadrillas c
        where c.id = intervenciones.cuadrilla_id and c.responsable = cimba_perfil()
      ))
);

-- FOTOGRAFÍAS
create policy fotografias_select on fotografias for select using (cimba_rol() <> '');
create policy fotografias_insert on fotografias for insert with check (
  cimba_rol() in ('admin','atencion_ciudadana','hcd','planificacion','cuadrilla')
);

-- AUDITORÍA: solo admin y supervisión
create policy auditoria_select on auditoria for select using (
  cimba_rol() in ('admin','supervision')
);

-- ── Vista sin datos personales ───────────────────────────────────────────────
-- RLS es por fila, no por columna: `contacto` (nombre, teléfono, email, CUIT
-- del vecino) solo debe verse por atencion_ciudadana y admin. La app consulta
-- SIEMPRE esta vista salvo para esos dos roles; nunca exponer contacto en el
-- mapa ni en exportaciones.
create view demandas_publicas with (security_invoker = true) as
  select id, fuente, estado, tipo, descripcion, direccion_texto,
         direccion_normalizada, geocod_confianza, geom, distrito_id,
         solicitante, prioridad_informada, menciones, url_origen,
         creado_por, creado_en, actualizado_en, metadata
  from demandas;
