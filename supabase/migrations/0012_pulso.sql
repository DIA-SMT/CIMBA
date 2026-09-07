-- ── El pulso de las 7:00 ─────────────────────────────────────────────────────
-- El parte diario que el sistema manda solo: qué entró ayer, qué se reparó,
-- dónde se concentró la deuda nueva, qué vence hoy y la anomalía del día.
-- Es un evento más del tablero de avisos: el Director decide quién lo recibe
-- y por qué canal, como todo lo demás.

alter table avisos_destinatarios drop constraint if exists avisos_destinatarios_evento_check;
alter table avisos_destinatarios add constraint avisos_destinatarios_evento_check
  check (evento in ('orden_emitida', 'orden_vencida', 'item_propuesto', 'aviso_general',
                    'cierres_pendientes', 'pulso_diario'));

insert into avisos_destinatarios (evento, canal, destino, etiqueta) values
  ('pulso_diario', 'push', 'planificacion', 'Planificación (el Director)'),
  ('pulso_diario', 'push', 'admin', 'Administración'),
  ('pulso_diario', 'email', 'planificacion', 'Planificación (el Director)')
on conflict (evento, canal, destino) do nothing;
