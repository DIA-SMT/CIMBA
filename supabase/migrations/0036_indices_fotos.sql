-- ═══════════════════════════════════════════════════════════════════════════
-- LAS FOTOS, ENCONTRABLES
--
-- El mapa muestra la foto de cada punto al pasar el mouse: la del trabajo de
-- cada problema y la que mandó quien hizo cada pedido. Para eso busca en
-- `fotografias` por trabajo (intervencion_id) y por pedido (demanda_id)...
-- y ninguna de las dos columnas tenía índice. Con 6.700 puntos, cada apertura
-- del mapa recorría la tabla entera miles de veces: unos 5 de los 6 a 8
-- segundos que tardaba en aparecer el primer punto (medido el 23/9).
--
-- Solo agrega índices. No cambia ni mueve ninguna fila. Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════

create index if not exists fotografias_intervencion_idx
  on fotografias (intervencion_id)
  where intervencion_id is not null;

create index if not exists fotografias_demanda_idx
  on fotografias (demanda_id)
  where demanda_id is not null;
