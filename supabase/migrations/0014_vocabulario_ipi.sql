-- 0014: El vocabulario oficial de la DOV y el Índice de Prioridad de
-- Intervención (IPI) como objeto de la base.
--
-- Hasta acá CIMBA priorizaba con un score propio 0-100. El municipio tiene su
-- propia metodología aprobada —el IPI, del "Plan de priorización de corredores
-- viales"— y el Plan de Acción de la DOV pide EXPRESAMENTE que el sistema
-- alimente su variable "Estado" con densidad de baches por corredor, en vez de
-- la apreciación cualitativa del relevamiento. Eso es lo que hace esta
-- migración: que CIMBA hable el idioma con el que se decide el Plan de Obras.

-- ── 1. Tipos de falla que faltaban ──────────────────────────────────────────
-- Del protocolo de empresas: bache · bocacalle rota · cuneta rota · cuadra
-- completa a realizar · pérdida de agua · cámara o tapa de cloaca rota ·
-- imbornales trancados. Los tres primeros faltaban; "imbornales trancados" ya
-- está cubierto por `sumidero`, que es el mismo objeto.
alter type tipo_problema add value if not exists 'bocacalle_rota';
alter type tipo_problema add value if not exists 'cuneta_rota';
alter type tipo_problema add value if not exists 'cuadra_completa';

-- ── 2. Tipo de obra ─────────────────────────────────────────────────────────
-- Es lo que se certifica, y solo aplica a intervención vial directa (bache,
-- bocacalle y cuneta). El resto se registra como relevamiento y se deriva.
create type tipo_obra_bacheo as enum (
  'provisorio',    -- urgencia o paliativo: después hay que volver
  'planificado',   -- reparación normal, la mayoría
  'extendido',     -- supera los 4 m²: otra escala de trabajo
  'sobre_adoquin'  -- calzada de adoquín
);

alter table intervenciones add column if not exists tipo_obra tipo_obra_bacheo;
alter table intervenciones add column if not exists volumen_m3 numeric(8, 2);
alter table orden_items add column if not exists tipo_obra tipo_obra_bacheo;

-- El volumen sale solo cuando se cargó el espesor: es dato de certificación,
-- no hay que pedirlo dos veces.
alter table orden_items add column if not exists volumen_m3 numeric(8, 2)
  generated always as (
    case when superficie_m2 is not null and espesor_cm is not null
      then round((superficie_m2 * espesor_cm / 100.0)::numeric, 2) end
  ) stored;

comment on column intervenciones.tipo_obra is
  'Modalidad de bacheo del protocolo DOV. Distinto de tipo_intervencion, que dice QUÉ se hizo (bacheo/paño/carpeta/enripiado).';

-- ── 3. Corredores viales: la unidad de análisis del IPI ─────────────────────
/**
 * El IPI no puntúa cuadras sueltas: puntúa CORREDORES (ejes completos que
 * conectan barrios y concentran movilidad), y los ordena dentro de cada sector
 * operativo y dentro de cada nivel jerárquico. La jerarquía no da puntaje:
 * define el orden de entrada al análisis.
 *
 * Las siete variables se guardan normalizadas 0-100 tal como manda el manual
 * metodológico, y por separado los insumos crudos con los que se calcularon
 * (barrios que cruza, baches de los últimos 24 meses, densidad por km): sin
 * eso el índice es una caja negra y nadie lo puede discutir en una reunión.
 */
create table corredores (
  id                bigint generated always as identity primary key,
  nombre            text not null,
  sector_id         bigint references sectores_licitacion(id),
  -- 1 interconexión urbana · 2 estructurante interno · 3 calle barrial
  nivel             smallint not null check (nivel between 1 and 3),
  longitud_m        numeric(10, 1),

  -- Variables normalizadas 0-100 (manual metodológico, Etapa 2 · Paso 2)
  v_estado          smallint,
  v_interconexion   smallint,
  v_accesibilidad   smallint,
  v_transporte      smallint,
  v_equipamientos   smallint,
  v_factibilidad    smallint not null default 100,
  -- "Compromisos asumidos" se pondera FUERA del cálculo: es una variable
  -- definitoria de acción, no un sumando.
  compromiso        boolean not null default false,
  -- Factibilidad "no factible" es EXCLUYENTE: el corredor sale del ranking.
  excluido          boolean not null default false,
  motivo_exclusion  text,

  -- Insumos crudos, para poder explicar cada puntaje
  barrios_conectados smallint,
  baches_24m         integer,
  densidad_km        numeric(6, 2),
  tiene_transporte   boolean,

  ipi               numeric(5, 2),
  calculado_en      timestamptz,
  -- Correcciones a mano de quien planifica (factibilidad, compromisos): se
  -- respetan en el recálculo, igual que metadata.destino_corregido en demandas.
  metadata          jsonb not null default '{}',
  geom              geometry(MultiLineString, 4326) not null,
  creado_en         timestamptz not null default now()
);
create index corredores_geom_idx on corredores using gist (geom);
create index corredores_geog_idx on corredores using gist ((geom::geography));
create index corredores_sector_idx on corredores (sector_id, nivel, ipi desc);
create unique index corredores_nombre_sector_idx on corredores (nombre, coalesce(sector_id, 0), nivel);

alter table corredores enable row level security;
create policy corredores_select on corredores for select using (cimba_rol() <> '');
