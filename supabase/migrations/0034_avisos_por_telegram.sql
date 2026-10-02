-- ═══════════════════════════════════════════════════════════════════════════
-- TELEGRAM: EL TERCER CANAL DE AVISOS
--
-- Los avisos salían por dos puertas, y las dos suponen a alguien sentado:
-- push exige tener el navegador suscripto y abierto en la máquina donde uno
-- se suscribió, y el email lo mira quien está frente a una pantalla. El
-- Director de Bacheo trabaja en la calle: el único aparato que mira en todo
-- el día es el teléfono, y ahí ya tiene Telegram.
--
-- Esto no agrega un sistema de avisos nuevo: agrega un valor más a `canal`.
-- El despachador (lib/notificar.ts) suma una rama al lado de push y email, y
-- el tablero de /ordenes/avisos sigue siendo el único lugar donde se decide
-- quién recibe qué. Por eso acá abajo NO se prende ningún aviso: la migración
-- habilita el canal y nada más. Los destinatarios los carga una persona.
--
-- En `destino` va el id del chat de Telegram: un número que Telegram le
-- asigna a cada conversación y que identifica a quién escribirle. No es un
-- secreto (sin el token del bot no sirve de nada), pero tampoco es público:
-- vale lo mismo que un número de teléfono interno.
-- ═══════════════════════════════════════════════════════════════════════════

/* Mismo criterio que 0033 con los eventos: el CHECK se rehace entero, en vez
   de parchearlo, para que los canales que existen queden a la vista en un
   solo lugar. Idempotente: el drop lleva `if exists`. */
alter table avisos_destinatarios drop constraint if exists avisos_destinatarios_canal_check;
alter table avisos_destinatarios add constraint avisos_destinatarios_canal_check
  check (canal = any (array['push', 'email', 'telegram']));

comment on column avisos_destinatarios.destino is
  'push: un rol, o "empresa" (la contratista dueña de la orden). '
  'email: una dirección. '
  'telegram: el id del chat, tal como lo reporta Telegram.';
