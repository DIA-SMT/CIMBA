-- 0009: Expedientes — el registro de las notas administrativas que salen de CIMBA.
--
-- La derivación a la SAT no es un archivo suelto: es una NOTA formal al
-- Director de la SAT (Dr. Marcelo Caponio) con los reclamos de agua
-- registrados en los sistemas operativos, su georreferencia y sus fotos.
-- Generarla es un acto administrativo: queda numerada, registrada, con el
-- detalle CONGELADO al momento de la firma (la nota histórica no cambia
-- aunque la demanda cambie), y las demandas incluidas salen de la cola de
-- bacheo con la referencia al expediente.

create sequence if not exists expedientes_numero_seq;

create table expedientes (
  id            bigint generated always as identity primary key,
  numero        text unique not null,                 -- NOTA-SAT-2026-0001
  tipo          text not null check (tipo in ('sat')), -- extensible (ingeniería, etc.)
  destinatario  text not null,
  observaciones text,
  cantidad      int not null,
  generado_por  uuid references perfiles(id),
  generado_en   timestamptz not null default now(),
  metadata      jsonb not null default '{}'
);

-- El detalle congelado: qué decía cada reclamo cuando se firmó la nota.
create table expediente_demandas (
  expediente_id bigint not null references expedientes(id) on delete cascade,
  demanda_id    bigint not null references demandas(id),
  detalle       jsonb not null,
  primary key (expediente_id, demanda_id)
);

alter table expedientes enable row level security;
alter table expediente_demandas enable row level security;
create policy expedientes_select on expedientes for select using (
  cimba_rol() <> '' and cimba_rol() <> 'empresa'
);
create policy expedientes_write on expedientes for all using (
  cimba_rol() in ('admin', 'planificacion', 'atencion_ciudadana')
);
create policy expediente_demandas_select on expediente_demandas for select using (
  cimba_rol() <> '' and cimba_rol() <> 'empresa'
);
create policy expediente_demandas_write on expediente_demandas for all using (
  cimba_rol() in ('admin', 'planificacion', 'atencion_ciudadana')
);
