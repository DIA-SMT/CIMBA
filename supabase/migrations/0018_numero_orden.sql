-- EL NÚMERO DE ORDEN NO PUEDE CHOCAR.
--
-- Bug real, visto dos veces en los logs de producción (22/8 y 7/9):
--
--   duplicate key value violates unique constraint "ordenes_trabajo_numero_key"
--   Key (numero)=(OT-2026-0001) already exists.
--
-- El número se armaba con `nextval('ordenes_numero_seq')`, una secuencia que no
-- tiene ninguna relación con las filas: basta que la base se reconstruya, que
-- se restaure un backup, o que alguien inserte una orden con número explícito,
-- para que la secuencia quede atrás y TODA creación de orden falle con un 23505
-- crudo en la cara del Director — perdiendo la orden entera con sus items,
-- después de haberlos elegido uno por uno.
--
-- La función de acá abajo deriva el número de los DATOS y no de un contador
-- paralelo, así que no puede desfasarse. El advisory lock serializa a los
-- creadores concurrentes (planificación son tres personas: el costo es nulo) y
-- se libera solo al terminar la transacción.
--
-- Se numera por AÑO: OT-2026-0001 arranca de nuevo en enero, que es lo que ya
-- hacía el formato viejo con to_char(now(), 'YYYY').

create or replace function siguiente_numero_orden() returns text
language plpgsql
as $$
declare
  anio text := to_char(now() at time zone 'America/Argentina/Tucuman', 'YYYY');
  siguiente int;
begin
  -- Un solo creador a la vez calcula el número. 4200 es una constante
  -- arbitraria que identifica a este lock dentro de la base.
  perform pg_advisory_xact_lock(4200);
  select coalesce(max(substring(numero from '\d{4}$')::int), 0) + 1
    into siguiente
    from ordenes_trabajo
   where numero like 'OT-' || anio || '-%';
  return 'OT-' || anio || '-' || lpad(siguiente::text, 4, '0');
end;
$$;

-- La secuencia vieja queda, por si alguna orden histórica se quiere rastrear,
-- pero se la pone al día para que nadie se confunda leyéndola.
select setval(
  'ordenes_numero_seq',
  greatest(
    1,
    coalesce((select max(substring(numero from '\d{4}$')::int) from ordenes_trabajo), 1)
  ),
  true
);
