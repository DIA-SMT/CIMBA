-- ═══════════════════════════════════════════════════════════════════════════
-- EL CALLEJERO QUE EL MUNICIPIO YA TIENE
--
-- OpenStreetMap no tiene la altura de la mayoría de las calles de San Miguel
-- de Tucumán. Cuando no la tiene, Nominatim no dice "no sé": devuelve los
-- TRAMOS de la calle, y el sistema se quedaba con uno. Así "Colombia 4500" y
-- "Colombia 4576" —media cuadra en la realidad— terminaron a 3,2 km.
--
-- Pero el municipio SÍ sabe dónde está Colombia al 4500: tiene 2.732 puntos
-- con calle y altura, y más de mil son coordenadas tomadas con el teléfono
-- parado arriba del bache por la cuadrilla que lo tapó. Medido sobre esos
-- datos, la relación altura → distancia es notablemente estable:
--
--     Δaltura   1–50  →  38 m       Δaltura  ~500  →   725 m
--     Δaltura  ~100   → 139 m       Δaltura ~1000  → 1.479 m
--
-- Es decir ~1,45 m por unidad de altura, lineal. Con un punto conocido a menos
-- de 50 de altura el error mediano es de 38 metros: media cuadra, precisión
-- suficiente para mandar una cuadrilla. Este callejero interpola sobre esos
-- puntos y se consulta ANTES que OSM.
--
-- Y crece solo: cada pin corregido a mano y cada bache cargado con GPS entran
-- automáticamente, porque la vista lee las tablas vivas.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * El nombre de calle, normalizado para poder compararlo.
 *
 * Sin tildes ni mayúsculas ni puntuación, con las abreviaturas expandidas
 * ("AV. SIRIA" y "AVENIDA SIRIA" son la misma calle) y sin la altura final.
 * No es immutable porque unaccent() no lo es; alcanza con stable.
 */
create or replace function calle_norm(p text) returns text as $fn$
  with limpio as (
    /* public.unaccent y no unaccent a secas: cuando PostgreSQL inlinea esta
       función dentro de una vista materializada, vuelve a resolver los nombres
       en un contexto sin search_path y falla con "function unaccent(text) does
       not exist" — un error que no aparece en ninguna consulta normal. */
    select upper(public.unaccent(coalesce(p, ''))) as t
  ),
  sin_altura as (
    /* La altura del final, con o sin "N°"/"Nro", y los rangos "1000 AL 1900".
       Los espacios alrededor del AL son OBLIGATORIOS: con `\s*` de por medio,
       la "A" final de COLOMBIA se comía junto con la altura y la calle quedaba
       registrada como "COLOMBI" — dos calles distintas para el mismo lugar. */
    select regexp_replace(
             regexp_replace(t, '\s+(AL|A)\s+\d{1,5}\s*$', ''),
             '\s*(N\s*°|NRO\.?|N°|Nº)?\s*\d{1,5}\s*$', ''
           ) as t
    from limpio
  ),
  sin_puntuacion as (
    select regexp_replace(t, '[^A-Z0-9Ñ ]', ' ', 'g') as t from sin_altura
  ),
  abreviaturas as (
    select regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(
                     regexp_replace(t, '(^| )(AVDA|AVD|AV)( |$)', '\1AVENIDA\3', 'g'),
                     '(^| )(PJE|PSJE|PSJ)( |$)', '\1PASAJE\3', 'g'),
                   '(^| )(GRAL)( |$)', '\1GENERAL\3', 'g'),
                 '(^| )(DR|DRA)( |$)', '\1DOCTOR\3', 'g'),
               '(^| )(STA)( |$)', '\1SANTA\3', 'g'),
             '(^| )(STO)( |$)', '\1SANTO\3', 'g') as t
    from sin_puntuacion
  )
  /* "CALLE SARMIENTO" y "SARMIENTO" son la misma calle; y las palabras que
     quedan colgando después de sacar el rango —"Avda. Siria del 1000 al 1900"
     deja "AVENIDA SIRIA DEL"— se van también. */
  select nullif(
           trim(regexp_replace(
             regexp_replace(
               regexp_replace(t, '^\s*CALLE\s+', ''),
               '\s+(DEL|DE|ENTRE|ESQ|ESQUINA|Y|N)\s*$', ''),
             '\s+', ' ', 'g')),
           '')
    from abreviaturas;
$fn$ language sql stable;

/** La altura del final de una dirección, si la tiene. */
create or replace function altura_de(p text) returns integer as $fn$
  select nullif((regexp_match(coalesce(p, ''), '(\d{1,5})\s*$'))[1], '')::int;
$fn$ language sql immutable;

/**
 * Todo lo que el municipio sabe sobre dónde cae cada altura de cada calle.
 *
 * El `peso` dice de dónde salió el punto, y no es un detalle: interpolar entre
 * un punto bueno y uno del geocodificador viejo da un punto malo. Cuando una
 * calle tiene datos de campo, los del archivo no se miran.
 *   3 · coordenada tomada en la calle con el teléfono, o pin corregido a mano
 *   2 · sistemas municipales con coordenada propia (SIGOV, caché exacto)
 *   1 · geocodificado desde un archivo
 */
create or replace view callejero_municipal as
  select calle_norm(i.direccion) as calle, altura_de(i.direccion) as altura, i.geom,
         case
           when coalesce(i.metadata->>'origen', '') in ('bacheo_empresas', 'empresa_libre', 'orden_trabajo')
             then 3
           when coalesce(i.metadata->>'origen', '') = 'sigov' then 2
           else 1
         end as peso
    from incidentes i
   where i.geom is not null and altura_de(i.direccion) is not null
     and calle_norm(i.direccion) is not null
  union all
  -- Los pedidos: solo los que una persona ubicó a mano o que el origen trajo
  -- con coordenada confiable. El resto son justamente los mal ubicados.
  select calle_norm(coalesce(d.direccion_normalizada, d.direccion_texto)),
         altura_de(coalesce(d.direccion_normalizada, d.direccion_texto)), d.geom,
         case when d.metadata->>'ubicacion_corregida' = 'true'
                or d.metadata ? 'pin_corregido' then 3 else 2 end
    from demandas d
   where d.geom is not null
     and (d.metadata->>'ubicacion_corregida' = 'true'
          or d.metadata ? 'pin_corregido'
          or coalesce(d.geocod_confianza, 0) >= 0.8)
     and altura_de(coalesce(d.direccion_normalizada, d.direccion_texto)) is not null
     and calle_norm(coalesce(d.direccion_normalizada, d.direccion_texto)) is not null
  union all
  -- Los items de orden: dirección dictada por la Dirección y punto afinado a
  -- mano en el mini-mapa antes de emitir.
  select calle_norm(oi.direccion), altura_de(oi.direccion), st_centroid(oi.geom), 3
    from orden_items oi
   where oi.geom is not null and altura_de(oi.direccion) is not null
     and calle_norm(oi.direccion) is not null
  union all
  select calle_norm(gc.direccion_norm), altura_de(gc.direccion_norm), gc.geom, 2
    from geocode_cache gc
   where gc.precision = 'exacta' and altura_de(gc.direccion_norm) is not null
     and calle_norm(gc.direccion_norm) is not null;

comment on view callejero_municipal is
  'Puntos conocidos (calle, altura) del municipio. Alimenta ubicar_altura(); crece solo con cada carga de campo y cada pin corregido.';

/**
 * DÓNDE CAE UNA ALTURA DE UNA CALLE, según lo que el municipio ya sabe.
 *
 * Devuelve el punto y con qué apoyo se armó:
 *   'exacta' · hay un punto conocido en esa misma altura, o se interpoló entre
 *              dos que la encierran y están cerca.
 *   'calle'  · se interpoló entre dos lejanos, o se devolvió el conocido más
 *              próximo. El punto está sobre esa calle y en la zona correcta,
 *              pero hay que mirarlo antes de mandar a alguien.
 * Sin datos suficientes devuelve cero filas y quien llama sigue con OSM.
 */
create or replace function ubicar_altura(p_calle text, p_altura integer)
-- `precision` sola es palabra reservada de SQL: la columna se llama `nivel`.
returns table (lon double precision, lat double precision, nivel text, delta integer, apoyo integer)
as $fn$
declare
  v_calle text := calle_norm(p_calle);
  v_peso  integer;
begin
  if v_calle is null or p_altura is null then return; end if;

  -- El mejor grado de evidencia que tiene ESTA calle: si hay puntos de campo,
  -- los del archivo no participan.
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
    select d.altura, st_centroid(st_collect(d.geom)) as geom
      from datos d group by d.altura
  ),
  abajo as (
    select a.altura, a.geom from agrupado a where a.altura <= p_altura order by a.altura desc limit 1
  ),
  arriba as (
    select a.altura, a.geom from agrupado a where a.altura >= p_altura order by a.altura asc limit 1
  ),
  elegido as (
    select
      case
        -- Altura exacta conocida.
        when (select ab.altura from abajo ab) = p_altura then (select ab.geom from abajo ab)
        -- Encerrada entre dos: se interpola proporcionalmente.
        when (select ab.altura from abajo ab) is not null
         and (select ar.altura from arriba ar) is not null
          then st_lineinterpolatepoint(
                 st_makeline((select ab.geom from abajo ab), (select ar.geom from arriba ar)),
                 (p_altura - (select ab.altura from abajo ab))::float
                   / nullif((select ar.altura from arriba ar) - (select ab.altura from abajo ab), 0))
        -- Solo de un lado: el conocido más cercano, sin inventar dirección.
        else coalesce((select ab.geom from abajo ab), (select ar.geom from arriba ar))
      end as geom,
      case
        when (select ab.altura from abajo ab) = p_altura then 0
        when (select ab.altura from abajo ab) is not null
         and (select ar.altura from arriba ar) is not null
          then (select ar.altura from arriba ar) - (select ab.altura from abajo ab)
        else coalesce(
               abs(p_altura - (select ab.altura from abajo ab)),
               abs((select ar.altura from arriba ar) - p_altura))
      end as delta,
      ((select ab.altura from abajo ab) is not null
        and (select ar.altura from arriba ar) is not null) as encerrada
  )
  select st_x(e.geom), st_y(e.geom),
         /* 120 de altura son unos 175 metros: dentro de eso el punto
            interpolado cae en la cuadra correcta y se puede mandar una
            cuadrilla. Más lejos, sirve para ubicar la zona y nada más. */
         case when e.delta <= 120 and (e.encerrada or e.delta = 0) then 'exacta' else 'calle' end,
         e.delta,
         v_peso
    from elegido e
   where e.geom is not null;
end;
$fn$ language plpgsql stable;

comment on function ubicar_altura is
  'Interpola la posición de una altura sobre el callejero municipal. Se consulta ANTES que OSM: sabe de las calles que OSM no tiene numeradas.';
