-- 0017: un item de orden puede ser un TRAMO, no solo un punto.
--
-- Leo, 10/9: "si podemos poner Corrientes del 400 al 1000… aparecerá como una
-- línea, o sea, intervalos". Y el caso real que contó: una cuadrilla que el
-- sábado trabaja "la Independencia en el tramo desde Avellaneda hasta Canal
-- Sur". Eso no es un punto: es un segmento de calle.
--
-- También lo necesita el recorrido dibujado a mano sobre el mapa (la procesión
-- y la maratón que contó): la orden sale de una línea trazada, no de pines.

-- La columna deja de exigir Point y acepta cualquier geometría 2D: los items
-- de bache siguen siendo puntos y los tramos pasan a ser líneas. El índice
-- GiST sirve para las dos por igual.
alter table orden_items
  alter column geom type geometry(Geometry, 4326)
  using geom::geometry(Geometry, 4326);

comment on column orden_items.geom is
  'Punto para un bache; LineString para un tramo por intervalo de altura o un recorrido dibujado.';

-- Altura desde/hasta cuando el tramo se definió por numeración ("del 400 al
-- 1000"): se guardan para poder reimprimir la orden con las mismas palabras
-- con las que se dictó.
alter table orden_items add column if not exists altura_desde integer;
alter table orden_items add column if not exists altura_hasta integer;
