-- ═══════════════════════════════════════════════════════════════════════════
-- LAS ESQUINAS, QUE SON UNA DE CADA CINCO DIRECCIONES
--
-- 720 de los 3.281 pedidos con dirección no dicen una altura sino un cruce:
-- "Matheu y Buenos Aires", "9 de Julio y Lavaissé", "Lavaissé y Pje. Santos
-- Dumont". Para el callejero municipal eran invisibles —no tienen altura que
-- interpolar— y quedaban a merced de lo que dijera OSM, que con dos nombres
-- de calle sueltos se equivoca seguido.
--
-- Pero el municipio ya sabe dónde pasa cada una de las dos calles: tiene
-- puntos con altura sobre las dos. El cruce es, con muy buena aproximación, el
-- lugar donde esos dos conjuntos de puntos se tocan. Se busca el par más
-- cercano —uno de cada calle— y se devuelve el punto medio.
--
-- El guardarraíl es la distancia de ese par: si los puntos conocidos más
-- próximos de las dos calles están a 400 metros, esas calles no se cruzan ahí
-- (o no se cruzan) y la función se calla. Dar un punto en el medio de la nada
-- sería peor que no contestar.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function ubicar_esquina(p_a text, p_b text)
returns table (lon double precision, lat double precision, nivel text, separacion integer)
as $fn$
declare
  v_a text := calle_norm(p_a);
  v_b text := calle_norm(p_b);
begin
  if v_a is null or v_b is null or v_a = v_b then return; end if;

  return query
  with a as (
    select c.geom, c.peso from callejero_municipal c where c.calle = v_a
  ),
  b as (
    select c.geom, c.peso from callejero_municipal c where c.calle = v_b
  ),
  /**
   * Acá SÍ entran todos los puntos, también los geocodificados desde archivo,
   * al revés que en la interpolación por altura.
   *
   * Es deliberado y se midió: quedándose solo con la mejor evidencia, los
   * puntos conocidos de Corrientes y de Muñecas más próximos entre sí quedaban
   * a 316 metros y la esquina no se encontraba; con todos, a 80 — que es la
   * esquina. La diferencia es de cobertura geográfica, no de calidad: un punto
   * de archivo se equivoca por cien metros, no por tres kilómetros, y para
   * decir DÓNDE SE CRUZAN dos calles eso alcanza. Lo que protege de un
   * disparate es la distancia del par, que se verifica abajo.
   */
  par as (
    select x.geom as ga, y.geom as gb,
           st_distance(x.geom::geography, y.geom::geography) as d
      from a x cross join b y
     order by x.geom <-> y.geom
     limit 1
  )
  select st_x(st_centroid(st_makeline(p.ga, p.gb))),
         st_y(st_centroid(st_makeline(p.ga, p.gb))),
         /* Con los dos puntos conocidos a menos de 150 m, el medio cae en la
            esquina o a media cuadra: alcanza para mandar una cuadrilla. Hasta
            300 m ubica la zona. Más lejos, esas dos calles no se cruzan ahí
            —o no se cruzan— y la función se calla: un punto en el medio de la
            nada es peor que no contestar. */
         case when p.d <= 150 then 'exacta' else 'calle' end,
         round(p.d)::int
    from par p
   where p.d <= 300;
end;
$fn$ language plpgsql stable;

comment on function ubicar_esquina is
  'Ubica un cruce de calles con los puntos que el municipio ya conoce de cada una. Una de cada cinco direcciones del sistema es una esquina.';
