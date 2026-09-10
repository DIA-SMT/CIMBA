-- 0015: Certificación de obra — actas de medición conjunta y control de
-- calidad por muestreo.
--
-- Es la pieza que hoy le falta al sistema para servir de verdad: sin acta de
-- medición conjunta firmada, lo que informa la contratista NO se certifica a
-- los fines del pago, y las actas son lo que protege a la administración
-- frente al Tribunal de Cuentas. El protocolo también fija un régimen de
-- inspección post-ejecución (24 h, 30 días, 90 días y 6 meses por muestreo)
-- que hoy no existe en ningún lado.

-- ── Inspecciones de calidad ─────────────────────────────────────────────────
create type momento_inspeccion as enum ('24h', '30d', '90d', '6m');
create type resultado_inspeccion as enum ('conforme', 'observado');

/**
 * Se registra SOLO lo que se inspeccionó. La cola de lo que toca inspeccionar
 * hoy se deriva por regla (lib/certificacion.ts) en vez de materializarse:
 * una tabla de tareas programadas envejece mal —hay que borrarla cuando el
 * item se anula, rehacerla cuando cambia la fecha— y acá la regla es fija.
 */
create table inspecciones_calidad (
  id              bigint generated always as identity primary key,
  intervencion_id bigint not null references intervenciones(id) on delete cascade,
  orden_item_id   bigint references orden_items(id) on delete set null,
  momento         momento_inspeccion not null,
  resultado       resultado_inspeccion not null,
  observaciones   text,
  -- Nivel respecto del pavimento, bordes, sellado, fisuración: lo que mira
  -- el inspector según el momento. Texto libre estructurado en metadata.
  metadata        jsonb not null default '{}',
  inspector       uuid references perfiles(id),
  realizada_en    timestamptz not null default now(),
  geom            geometry(Point, 4326),
  unique (intervencion_id, momento)
);
create index inspecciones_intervencion_idx on inspecciones_calidad (intervencion_id);
create index inspecciones_momento_idx on inspecciones_calidad (momento, realizada_en desc);

-- ── Actas de medición conjunta ──────────────────────────────────────────────
create type estado_acta as enum ('borrador', 'firmada', 'anulada');

/**
 * El acta congela lo medido en campo contra lo informado por la contratista.
 * La desviación es el número que gobierna el régimen: por encima del 5% se
 * vuelve a medir el 100% de los puntos del día.
 */
create table actas_medicion (
  id                bigint generated always as identity primary key,
  numero            text unique not null,
  empresa_id        bigint not null references empresas(id),
  fecha             date not null default current_date,
  estado            estado_acta not null default 'borrador',
  -- 'total' (100% de los puntos) o 'muestreo' (≥20% aleatorio)
  modalidad         text not null check (modalidad in ('total', 'muestreo')),
  puntos_informados integer not null default 0,
  puntos_medidos    integer not null default 0,
  m2_informados     numeric(10, 2) not null default 0,
  m2_medidos        numeric(10, 2) not null default 0,
  desviacion_pct    numeric(6, 2),
  observaciones     text,
  -- Las dos firmas que exige el protocolo. Se guardan como nombre y fecha:
  -- el acta se imprime y se firma en papel, esto es su registro.
  firma_inspector   text,
  firma_contratista text,
  firmada_en        timestamptz,
  creada_por        uuid references perfiles(id),
  creada_en         timestamptz not null default now(),
  metadata          jsonb not null default '{}'
);
create index actas_empresa_idx on actas_medicion (empresa_id, fecha desc);

/**
 * El detalle congelado, igual que expediente_demandas: lo medido queda
 * inmutable aunque después alguien corrija el item. Un acta que cambia sola
 * no sirve de respaldo ante una auditoría.
 */
create table acta_items (
  id             bigint generated always as identity primary key,
  acta_id        bigint not null references actas_medicion(id) on delete cascade,
  orden_item_id  bigint references orden_items(id) on delete set null,
  direccion      text,
  m2_informado   numeric(8, 2),
  m2_medido      numeric(8, 2),
  observaciones  text,
  geom           geometry(Point, 4326),
  unique (acta_id, orden_item_id)
);
create index acta_items_acta_idx on acta_items (acta_id);

-- Marca en el item de qué acta salió certificado: sin esto no se sabe qué
-- está pago y qué no.
alter table orden_items add column if not exists acta_id bigint references actas_medicion(id);
create index if not exists orden_items_acta_idx on orden_items (acta_id);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table inspecciones_calidad enable row level security;
alter table actas_medicion enable row level security;
alter table acta_items enable row level security;
-- La empresa ve sus propias actas (es parte firmante); las inspecciones de
-- calidad son del municipio.
create policy inspecciones_select on inspecciones_calidad for select
  using (cimba_rol() <> '' and cimba_rol() <> 'empresa');
create policy actas_select on actas_medicion for select
  using (cimba_rol() <> '' and (cimba_rol() <> 'empresa' or empresa_id = cimba_empresa()));
create policy acta_items_select on acta_items for select
  using (cimba_rol() <> '' and (cimba_rol() <> 'empresa' or exists (
    select 1 from actas_medicion a where a.id = acta_id and a.empresa_id = cimba_empresa()
  )));
