-- ── Trazabilidad de uso: quién hace qué, quién entra y quién no ──────────────
-- "Fundamental poder trazar cualquier anomalía o mal uso. También hacer
--  seguimiento de quién la usa y quién no" (el Director, 6/9).
-- La tabla auditoria y su trigger existen desde 0000 y ya graban demandas,
-- incidentes e intervenciones con el actor de cada transacción. Acá se
-- completa la cobertura con las tablas de gestión y se indexa para leerla
-- como feed (hasta ahora nadie la consultaba por fecha ni por actor).

drop trigger if exists trg_auditar_ordenes on ordenes_trabajo;
create trigger trg_auditar_ordenes
  after insert or update or delete on ordenes_trabajo
  for each row execute function auditar();
drop trigger if exists trg_auditar_orden_items on orden_items;
create trigger trg_auditar_orden_items
  after insert or update or delete on orden_items
  for each row execute function auditar();
drop trigger if exists trg_auditar_expedientes on expedientes;
create trigger trg_auditar_expedientes
  after insert or update or delete on expedientes
  for each row execute function auditar();
drop trigger if exists trg_auditar_avisos on avisos_destinatarios;
create trigger trg_auditar_avisos
  after insert or update or delete on avisos_destinatarios
  for each row execute function auditar();

-- Los INGRESOS como evento de primera clase (el login no toca ninguna tabla
-- auditada: perfiles.ultimo_ingreso solo guarda el último). entidad_id lleva
-- id_persona porque la columna es bigint y perfiles.id es uuid.
-- Los inserta la ruta de login; acá solo queda documentada la convención:
--   entidad = 'sesion', accion = 'ingreso', actor = perfil, diff = {rol, via}

create index if not exists auditoria_ocurrido_idx on auditoria (ocurrido_en desc);
create index if not exists auditoria_actor_idx on auditoria (actor, ocurrido_en desc);

-- RLS (escrita aunque hoy no se aplique, como el resto): la actividad la leen
-- solo admin y planificación; escribir puede cualquiera (lo hacen los triggers
-- en nombre de la operación que sea).
alter table auditoria enable row level security;
-- La política de 0000 dejaba leer solo a admin: se amplía a planificación
-- (el Director de Bacheo tiene que poder ver la actividad).
drop policy if exists auditoria_select on auditoria;
create policy auditoria_select on auditoria for select
  using (cimba_rol() in ('admin', 'planificacion'));
drop policy if exists auditoria_insert on auditoria;
create policy auditoria_insert on auditoria for insert with check (true);
