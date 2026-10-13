-- ═══════════════════════════════════════════════════════════════════════════
-- EL AVISO DE PEDIDO CARGADO
--
-- "Estaría bueno que por Telegram salte una alerta cuando alguien cargue un
-- punto" (Dirección de Bacheo, 13/10/2026). Es un evento más del tablero de
-- avisos (/ordenes/avisos): se dispara cuando alguien registra un pedido en
-- la pantalla Ciudadano.
--
-- Igual que 0033 y 0034: el CHECK se rehace entero para que la lista de
-- eventos quede a la vista en un solo lugar, y acá NO se agrega ningún
-- destinatario. Quién recibe el aviso lo carga una persona en el tablero.
--
-- No cambia ni mueve ninguna fila. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

alter table avisos_destinatarios drop constraint if exists avisos_destinatarios_evento_check;
alter table avisos_destinatarios add constraint avisos_destinatarios_evento_check
  check (evento = any (array[
    'orden_emitida',
    'orden_vencida',
    'item_propuesto',
    'aviso_general',
    'cierres_pendientes',
    'pulso_diario',
    'item_validado',
    'item_rechazado',
    'orden_reasignada',
    'orden_cerrada',
    'pedido_cargado'
  ]));
