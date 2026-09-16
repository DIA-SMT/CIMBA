-- ─────────────────────────────────────────────────────────────────────────────
-- LA PRECISIÓN DEL GEOCODIFICADOR, GUARDADA Y NO ADIVINADA
--
-- geocode_cache guardaba un punto y una confianza, y nada que dijera si ese
-- punto era la PUERTA o simplemente algún tramo de la calle. Nominatim, cuando
-- OSM no tiene la altura, devuelve los tramos de la calle y el código se
-- quedaba con el primero: "Colombia 4500" y "Colombia 4576" —media cuadra en
-- la realidad— terminaron a 3,2 km, y el caché las dejó congeladas así.
--
-- Con la columna, el sistema puede leer del caché solo lo que es exacto y
-- volver a preguntar por el resto, además de poder decirle a quien carga que
-- ese punto hay que corregirlo a mano.
-- ─────────────────────────────────────────────────────────────────────────────

alter table geocode_cache
  add column if not exists precision text
    check (precision in ('exacta', 'calle', 'aproximada'));

/*
 * Backfill desde la confianza vieja, que es el único dato que hay: 0,85 era
 * "type = house | intersection" (la puerta) y 0,55 todo lo demás. No es
 * perfecto —la heurística vieja marcaba 0,55 a direcciones exactas cuyo tipo
 * OSM era otro, como una escuela con altura— pero se equivoca hacia el lado
 * seguro: esas se vuelven a preguntar y se corrigen solas al primer uso.
 */
update geocode_cache
   set precision = case when confianza >= 0.8 then 'exacta' else 'calle' end
 where precision is null;

-- Para la consulta del caché, que filtra por precisión.
create index if not exists geocode_cache_precision_idx on geocode_cache (precision);
