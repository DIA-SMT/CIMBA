-- Suscripciones a notificaciones push (Web Push / VAPID).
-- Una fila por navegador suscripto; el endpoint es único por suscripción.
create table push_suscripciones (
  id          bigserial primary key,
  perfil_id   uuid references perfiles(id) on delete cascade,
  endpoint    text unique not null,
  claves      jsonb not null,          -- { p256dh, auth }
  user_agent  text,
  creado_en   timestamptz not null default now()
);
create index push_susc_perfil_idx on push_suscripciones (perfil_id);

alter table push_suscripciones enable row level security;
create policy push_select on push_suscripciones for select using (cimba_rol() <> '');
create policy push_insert on push_suscripciones for insert with check (perfil_id = cimba_perfil());
create policy push_delete on push_suscripciones for delete using (
  perfil_id = cimba_perfil() or cimba_rol() = 'admin'
);
