-- ── El sistema avisa cuando hay reclamos listos para cerrar ─────────────────
-- "Quiero que solucionemos poder cerrar los tickets que se abren desde acá.
--  Que haya proactividad del sistema al respecto" (el Director, 5/9).
-- El cierre interno ya existe (/cierres cierra cualquier reclamo con el
-- incidente reparado, venga de donde venga); lo que faltaba era que el sistema
-- EMPUJE: un aviso diario con cuántos reclamos quedaron listos para responder.

alter table avisos_destinatarios drop constraint if exists avisos_destinatarios_evento_check;
alter table avisos_destinatarios add constraint avisos_destinatarios_evento_check
  check (evento in ('orden_emitida', 'orden_vencida', 'item_propuesto', 'aviso_general', 'cierres_pendientes'));

-- Por defecto le llega a Atención Ciudadana (los que responden al vecino);
-- el Director lo redirige desde /ordenes/avisos como cualquier otro evento.
insert into avisos_destinatarios (evento, canal, destino, etiqueta)
values ('cierres_pendientes', 'push', 'atencion_ciudadana', 'Atención Ciudadana')
on conflict (evento, canal, destino) do nothing;
