-- ═══════════════════════════════════════════════════════════════════════════
-- LA ORDEN DIBUJADA A MANO SOBRE EL MAPA
--
-- Los ámbitos que había —distrito, circuito, corredor, barrio, zona— son
-- recortes fijos del territorio, y sirven cuando el trabajo coincide con uno.
-- Muy seguido no coincide: "estas ocho manzanas", "de acá hasta el canal",
-- "todo lo que quedó adentro del operativo del sábado". Para eso el mapa ya
-- dejaba dibujar un recorrido, pero era una LÍNEA: servía para describir un
-- tramo de avenida, no para encerrar un pedazo de ciudad.
--
-- Cerrando ese mismo dibujo en un polígono, la orden pasa a tener una
-- superficie propia: los pedidos que caen adentro entran a la orden, y la
-- empresa recibe el área dibujada en su mapa en vez de una lista de
-- direcciones sueltas.
--
-- El polígono se guarda EN la orden y no en una tabla de zonas: no es un
-- recorte reutilizable del territorio, es el alcance de esta orden y de
-- ninguna otra.
-- ═══════════════════════════════════════════════════════════════════════════

alter type ambito_orden add value if not exists 'poligono';

alter table ordenes_trabajo
  add column if not exists poligono geometry(Polygon, 4326);

comment on column ordenes_trabajo.poligono is
  'El área dibujada a mano cuando el ámbito es "poligono". Define qué entra en la orden y qué ve la empresa en su mapa.';

-- Para "¿esta orden cubre este punto?" y para dibujar el área en el mapa.
create index if not exists ordenes_trabajo_poligono_idx
  on ordenes_trabajo using gist (poligono);
