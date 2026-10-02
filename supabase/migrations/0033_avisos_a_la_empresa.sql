-- ═══════════════════════════════════════════════════════════════════════════
-- LOS AVISOS QUE LE LLEGAN A LA EMPRESA
--
-- En toda la base había CERO suscripciones push de empresas, y no por falta
-- de teléfonos: ningún evento las tenía como destino. Los avisos se mandaban
-- por rol, y el rol "empresa" son trece contratistas — avisarle "te emitieron
-- la OT-0026" al rol entero era avisarle a doce de una orden ajena.
--
-- El destino `empresa` es distinto: no es un rol, es "la contratista dueña de
-- la orden que dispara el evento", y se resuelve en el momento con el
-- empresa_id (ver lib/notificar.ts). Acá se prenden los seis avisos que una
-- empresa necesita para trabajar sin tener que entrar a mirar: que le
-- emitieron una orden, que se le vence, que le validaron o rechazaron un
-- bache propuesto, que le pasaron una orden, que se le cerró una.
-- ═══════════════════════════════════════════════════════════════════════════

/* La lista de eventos vivía en un CHECK: cuatro eventos nuevos, cuatro valores
   nuevos. Se rehace entera para que quede a la vista cuáles existen. */
alter table avisos_destinatarios drop constraint if exists avisos_destinatarios_evento_check;
alter table avisos_destinatarios add constraint avisos_destinatarios_evento_check
  check (evento = any (array[
    'orden_emitida', 'orden_vencida', 'item_propuesto', 'aviso_general',
    'cierres_pendientes', 'pulso_diario',
    -- los que le hablan a la empresa de la orden
    'item_validado', 'item_rechazado', 'orden_reasignada', 'orden_cerrada'
  ]));

insert into avisos_destinatarios (evento, canal, destino, etiqueta, activo)
select v.evento, 'push', 'empresa', 'La empresa de la orden', true
from (values
  ('orden_emitida'),
  ('orden_vencida'),
  ('item_validado'),
  ('item_rechazado'),
  ('orden_reasignada'),
  ('orden_cerrada')
) as v(evento)
where not exists (
  select 1 from avisos_destinatarios a
  where a.evento = v.evento and a.canal = 'push' and a.destino = 'empresa'
);
