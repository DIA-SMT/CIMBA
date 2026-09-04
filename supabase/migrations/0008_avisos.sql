-- 0008: Avisos gestionables por la Dirección de Bacheo.
--
-- El Director decide QUÉ evento le avisa a QUIÉN y POR DÓNDE: push (VAPID, ya
-- existente) o email (Resend). Los eventos automáticos son la emisión de una
-- orden, su vencimiento y los baches propuestos por las cuadrillas; el aviso
-- general es un mensaje que el Director redacta y manda cuando quiere.

create table avisos_destinatarios (
  id        bigint generated always as identity primary key,
  evento    text not null check (evento in ('orden_emitida', 'orden_vencida', 'item_propuesto', 'aviso_general')),
  canal     text not null check (canal in ('push', 'email')),
  -- push: un rol (le llega a todo perfil de ese rol con push suscripto);
  -- email: una dirección.
  destino   text not null,
  etiqueta  text,          -- nombre amigable: "Leo — Director", "Mesa SAT"
  activo    boolean not null default true,
  creado_en timestamptz not null default now(),
  unique (evento, canal, destino)
);

-- Lo que el cron de vencimientos hacía por hardcode pasa a ser configuración.
insert into avisos_destinatarios (evento, canal, destino, etiqueta) values
  ('orden_vencida', 'push', 'planificacion', 'Planificación (Bacheo)'),
  ('orden_vencida', 'push', 'supervision', 'Supervisión'),
  ('item_propuesto', 'push', 'planificacion', 'Planificación (Bacheo)'),
  ('orden_emitida', 'push', 'planificacion', 'Planificación (Bacheo)');

alter table avisos_destinatarios enable row level security;
create policy avisos_select on avisos_destinatarios for select using (
  cimba_rol() <> '' and cimba_rol() <> 'empresa'
);
create policy avisos_write on avisos_destinatarios for all using (
  cimba_rol() in ('admin', 'planificacion')
);
