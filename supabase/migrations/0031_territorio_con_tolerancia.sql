-- ═══════════════════════════════════════════════════════════════════════════
-- EL BACHE QUE CAE JUSTO SOBRE EL BORDE
--
-- 39 pedidos y 37 incidentes tienen coordenada pero no tienen distrito. No
-- están en otra ciudad: 8 y 18 de ellos, respectivamente, caen a MENOS DE UN
-- METRO del límite — sobre la línea, o unos centímetros afuera. Es el bache de
-- la avenida que separa dos distritos, o el redondeo del polígono contra el
-- redondeo del punto.
--
-- `st_contains` los rechaza (un punto exactamente sobre el borde no está
-- "contenido"), así que quedaban sin distrito: invisibles para el filtro por
-- distrito, para la deuda por territorio y para el parte por zona. Un bache en
-- el medio de la ciudad que no existía para ninguna cuenta territorial.
--
--   a menos de   1 m del límite:  8 pedidos · 18 incidentes
--   a menos de  50 m:            21 pedidos · 23 incidentes
--   a más de   300 m:            11 pedidos · 12 incidentes  ← ésos SÍ están
--                                                              afuera y así se
--                                                              quedan
--
-- La tolerancia de 50 metros es media cuadra: alcanza para el borde y para
-- cualquier error de redondeo, y no alcanza para meter en la ciudad algo que
-- está en Yerba Buena. Lo que queda afuera de eso sigue sin distrito, que es
-- la respuesta correcta.
-- ═══════════════════════════════════════════════════════════════════════════

/**
 * A qué distrito pertenece un punto. Primero por contención pura; si el punto
 * cae sobre el límite o a centímetros de él, el distrito más cercano dentro de
 * la tolerancia. Null si está realmente afuera.
 */
create or replace function distrito_de(p geometry, tolerancia_m double precision default 50)
returns integer as $fn$
  select d.id from distritos d
   where st_dwithin(d.geom::geography, p::geography, tolerancia_m)
   order by st_distance(d.geom::geography, p::geography), d.id
   limit 1;
$fn$ language sql stable;

create or replace function circuito_de(p geometry, tolerancia_m double precision default 50)
returns integer as $fn$
  select c.id from circuitos c
   where st_dwithin(c.geom::geography, p::geography, tolerancia_m)
   order by st_distance(c.geom::geography, p::geography), c.id
   limit 1;
$fn$ language sql stable;

create or replace function barrio_de(p geometry, tolerancia_m double precision default 50)
returns integer as $fn$
  select b.id from barrios b
   where st_dwithin(b.geom::geography, p::geography, tolerancia_m)
   order by st_distance(b.geom::geography, p::geography), b.id
   limit 1;
$fn$ language sql stable;

create or replace function cuadrante_de(p geometry, tolerancia_m double precision default 50)
returns bigint as $fn$
  select c.id from cuadrantes c
   where st_dwithin(c.geom::geography, p::geography, tolerancia_m)
   order by st_distance(c.geom::geography, p::geography), c.id
   limit 1;
$fn$ language sql stable;

comment on function distrito_de is
  'El distrito de un punto, tolerando el borde. st_contains rechaza los puntos que caen sobre el límite y los dejaba sin territorio.';

/**
 * Los triggers pasan a usar las funciones. Siguen completando SOLO lo que está
 * en NULL: mover un punto y recalcular sus pertenencias es responsabilidad de
 * quien lo mueve (corregirUbicacionDemanda, corregirUbicacionItem y la
 * corrección por lote ya lo hacen), porque un trigger que pisa siempre le
 * ganaría a una corrección hecha a mano.
 */
create or replace function autocompletar_territorio() returns trigger as $fn$
begin
  if new.geom is not null then
    if new.distrito_id is null then
      new.distrito_id := distrito_de(new.geom);
    end if;
    if to_regclass('cuadrantes') is not null and new.cuadrante_id is null then
      new.cuadrante_id := cuadrante_de(new.geom);
    end if;
  end if;
  return new;
end $fn$ language plpgsql;

create or replace function autocompletar_territorio_demanda() returns trigger as $fn$
begin
  if new.geom is not null and new.distrito_id is null then
    new.distrito_id := distrito_de(new.geom);
  end if;
  return new;
end $fn$ language plpgsql;

-- ── El arrastre de lo que quedó sin territorio ─────────────────────────────

update demandas d set distrito_id = distrito_de(d.geom)
 where d.geom is not null and d.distrito_id is null and distrito_de(d.geom) is not null;

update demandas d set circuito_id = circuito_de(d.geom)
 where d.geom is not null and d.circuito_id is null and circuito_de(d.geom) is not null;

update demandas d set barrio_id = barrio_de(d.geom)
 where d.geom is not null and d.barrio_id is null and barrio_de(d.geom) is not null;

update incidentes i set distrito_id = distrito_de(i.geom)
 where i.geom is not null and i.distrito_id is null and distrito_de(i.geom) is not null;

update incidentes i set circuito_id = circuito_de(i.geom)
 where i.geom is not null and i.circuito_id is null and circuito_de(i.geom) is not null;

update incidentes i set barrio_id = barrio_de(i.geom)
 where i.geom is not null and i.barrio_id is null and barrio_de(i.geom) is not null;
