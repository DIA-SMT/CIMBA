-- ═══════════════════════════════════════════════════════════════════════════
-- LOS UMBRALES DEL CALLEJERO, MEDIDOS Y NO ADIVINADOS
--
-- La primera versión decidía "exacta" con una regla inventada (hueco ≤ 120).
-- Se midió de verdad: se escondió cada uno de los 936 puntos tomados con GPS
-- en la calle y se le pidió al callejero que lo adivinara con los otros. El
-- error es la distancia real entre lo que dijo y dónde estaba el bache.
--
--   ENCERRADA (hay un punto conocido antes y otro después — se interpola)
--     hueco ≤ 40    n=338   mediana   3 m   p90    38 m
--     hueco 41-120  n=167   mediana   9 m   p90    34 m
--     hueco 121-300 n=149   mediana   9 m   p90    39 m
--     hueco 301-800 n= 75   mediana   9 m   p90   105 m
--     hueco > 800   n= 20   mediana  29 m   p90   219 m
--
--   NO ENCERRADA (solo hay puntos de un lado — se devuelve el más cercano)
--     Δ ≤ 40        n= 66   mediana  24 m   p90    66 m
--     Δ 41-120      n= 43   mediana 114 m   p90   186 m
--     Δ 121-300     n= 30   mediana 285 m   p90   439 m
--     Δ 301-800     n= 20   mediana 631 m   p90 1.188 m
--
-- La lectura es clara y no era obvia: lo que importa NO es que el punto de
-- apoyo esté cerca, sino que la altura esté ENCERRADA entre dos conocidas.
-- Interpolando, hasta con 800 de hueco el error mediano es de 9 metros —
-- dentro del bache. Sin encerrar, a partir de 40 de diferencia ya se va de
-- cuadra, y a partir de 300 no sirve para nada.
--
-- De ahí los umbrales de abajo. Y de ahí también que, sin encerrar y lejos, la
-- función prefiera no contestar: que siga OSM es mejor que dar un punto a 600
-- metros con cara de dato.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function ubicar_altura(p_calle text, p_altura integer)
returns table (lon double precision, lat double precision, nivel text, delta integer, apoyo integer)
as $fn$
declare
  v_calle text := calle_norm(p_calle);
  v_peso  integer;
begin
  if v_calle is null or p_altura is null then return; end if;

  -- El mejor grado de evidencia que tiene ESTA calle: si hay puntos tomados en
  -- el terreno, los geocodificados desde un archivo no participan. Interpolar
  -- entre un punto bueno y uno malo da un punto malo.
  select max(c.peso) into v_peso from callejero_municipal c where c.calle = v_calle;
  if v_peso is null then return; end if;

  return query
  with datos as (
    select c.altura, c.geom from callejero_municipal c
     where c.calle = v_calle and c.peso = v_peso
  ),
  -- Varios puntos en la misma altura se promedian: son el mismo lugar cargado
  -- por distintas cuadrillas.
  agrupado as (
    select d.altura, st_centroid(st_collect(d.geom)) as geom from datos d group by d.altura
  ),
  abajo as (
    select a.altura, a.geom from agrupado a where a.altura <= p_altura order by a.altura desc limit 1
  ),
  arriba as (
    select a.altura, a.geom from agrupado a where a.altura >= p_altura order by a.altura asc limit 1
  ),
  bordes as (
    select (select ab.altura from abajo ab) as h_ab, (select ab.geom from abajo ab) as g_ab,
           (select ar.altura from arriba ar) as h_ar, (select ar.geom from arriba ar) as g_ar
  ),
  elegido as (
    select
      case
        when b.h_ab = p_altura then b.g_ab
        when b.h_ar = p_altura then b.g_ar
        when b.h_ab is not null and b.h_ar is not null
          then st_lineinterpolatepoint(st_makeline(b.g_ab, b.g_ar),
                 (p_altura - b.h_ab)::float / nullif(b.h_ar - b.h_ab, 0))
        else coalesce(b.g_ab, b.g_ar)
      end as geom,
      case
        when b.h_ab = p_altura or b.h_ar = p_altura then 0
        when b.h_ab is not null and b.h_ar is not null then b.h_ar - b.h_ab
        else coalesce(abs(p_altura - b.h_ab), abs(b.h_ar - p_altura))
      end as delta,
      (b.h_ab is not null and b.h_ar is not null) as encerrada
    from bordes b
  )
  select st_x(e.geom), st_y(e.geom),
         case
           -- Encerrada: interpolar es confiable hasta huecos grandes.
           when e.encerrada and e.delta <= 800 then 'exacta'
           -- Sin encerrar, solo el vecino inmediato sirve como dirección.
           when not e.encerrada and e.delta <= 40 then 'exacta'
           when e.encerrada then 'calle'
           when e.delta <= 150 then 'calle'
           else null
         end,
         e.delta,
         v_peso
    from elegido e
   /* Sin encerrar y a más de 150 de la altura conocida, el callejero se calla:
      que conteste OSM. Un punto a 600 metros con cara de dato es peor que no
      tener dato. */
   where e.geom is not null
     and (e.encerrada or e.delta <= 150);
end;
$fn$ language plpgsql stable;
