-- 0013: La red hidráulica como objeto de gestión, no como capa decorativa.
--
-- El paquete de la DOV (10/9/2026) trae dos insumos que faltaban: el
-- relevamiento consolidado de imbornales (1.343 bocas de tormenta con estado
-- leve→colapsado) y los puntos críticos de anegamiento. Entran con la MISMA
-- lógica que el bache: unidad georreferenciada, estado en escala de semáforo,
-- y trazabilidad de quién la atiende — para poder controlar el mantenimiento
-- pluvial igual que se controla el bacheo.
--
-- Además corrigen una clasificación que hoy está mal: el clasificador manda
-- TODAS las tapas y sumideros a la SAT, pero la boca de tormenta es obra civil
-- municipal (Dpto. Obras de Ingeniería de la DOV), no de la SAT. Con los
-- imbornales georreferenciados se puede distinguir por cercanía.

-- ── Imbornales (bocas de tormenta) ──────────────────────────────────────────
-- La escala del relevamiento es la misma gradación del semáforo: leve →
-- moderado → grave → colapsado. Se guarda también el texto original porque
-- trae grados intermedios ("LEVE - MODERADO") que se normalizaron al peor.
create type estado_imbornal as enum ('leve', 'moderado', 'grave', 'colapsado');

create table imbornales (
  id            bigint generated always as identity primary key,
  ident         text,                       -- código del relevamiento (F54, I212…)
  clase         text,                       -- IMB. EXISTENTE / NUEVO / FOSA CON REJA
  tipo          text,                       -- CORDON / FOSA CON REJAS / LOSA CANAL
  estado        estado_imbornal,
  estado_texto  text,
  direccion     text,
  barrio        text,
  colector      text,                       -- a qué colector descarga
  cuenca        text,
  depresion     boolean,
  tapas         integer,
  observaciones text,
  distrito_id   integer references distritos(id),
  circuito_id   integer references circuitos(id),
  -- Última limpieza o reparación registrada: es lo que convierte al imbornal
  -- en algo controlable y no en una foto de 2025.
  atendido_en   timestamptz,
  atendido_por  uuid references perfiles(id),
  metadata      jsonb not null default '{}',
  geom          geometry(Point, 4326) not null,
  creado_en     timestamptz not null default now()
);
create index imbornales_geom_idx on imbornales using gist (geom);
create index imbornales_geog_idx on imbornales using gist ((geom::geography));
create index imbornales_estado_idx on imbornales (estado);
create index imbornales_distrito_idx on imbornales (distrito_id);
-- El ident se repite entre tandas del relevamiento: la unicidad es por punto.
create unique index imbornales_ident_geom_idx on imbornales (ident, st_astext(geom));

-- ── Zonas inundables (puntos críticos de anegamiento) ───────────────────────
-- Pocos puntos pero de mucho peso: son la evidencia para la regla de
-- escalamiento "anegamiento recurrente → cordón cuneta o estudio hidráulico
-- previo", y el primer insumo de la variable hídrica que la DOV quiere sumar
-- al IPI (índice de sumergencia = tirante × velocidad).
create table zonas_inundables (
  id            bigint generated always as identity primary key,
  direccion     text,
  observaciones text,
  tirante_m     numeric(4, 2),              -- extraído del relato del vecino
  distrito_id   integer references distritos(id),
  metadata      jsonb not null default '{}',
  geom          geometry(Point, 4326) not null,
  creado_en     timestamptz not null default now()
);
create index zonas_inundables_geom_idx on zonas_inundables using gist (geom);
create index zonas_inundables_geog_idx on zonas_inundables using gist ((geom::geography));

-- ── Corrección del clasificador: la boca de tormenta NO es de la SAT ────────
/**
 * Reemplaza a la versión de 0006. Cambia una sola regla, pero de fondo:
 *
 *  - `sumidero` (boca de tormenta / imbornal) → INGENIERÍA. Es obra civil
 *    municipal del Dpto. Obras de Ingeniería, no de la SAT. El parte diario
 *    de ese departamento (limpieza de cámaras, rejas y tapas) es justamente
 *    este trabajo.
 *  - `tapa_registro` se desambigua por cercanía: si hay un imbornal relevado
 *    a menos de 15 m, es tapa PLUVIAL → ingeniería; si no, se asume cloacal
 *    → SAT, que es el criterio conservador (la SAT devuelve lo que no es suyo,
 *    pero un pozo cloacal abierto tratado como municipal no se deriva nunca).
 *  - `perdida_agua` sigue siendo SAT sin discusión.
 */
create or replace function clasificar_destino_demanda(
  p_tipo tipo_problema, p_descripcion text, p_geom geometry
) returns destino_resolucion as $$
begin
  if p_tipo = 'perdida_agua' then
    return 'sat';
  end if;

  if p_tipo = 'sumidero' then
    return 'ingenieria';
  end if;

  if p_tipo = 'tapa_registro' then
    if p_descripcion ~* '(pluvial|tormenta|imbornal|sumidero|desag[üu]e|rejilla|reja)' then
      return 'ingenieria';
    end if;
    if p_descripcion ~* '(cloaca|cloacal|l[ií]quido|efluente|pozo negro)' then
      return 'sat';
    end if;
    if p_geom is not null
       and to_regclass('imbornales') is not null
       and exists (
         select 1 from imbornales i
         where st_dwithin(i.geom::geography, p_geom::geography, 15)
       )
    then
      return 'ingenieria';
    end if;
    return 'sat';
  end if;

  if p_descripcion ~* '(pasad[oa] de m[aá]quina|enripiad|perfilad[oa]|niveladora|calle de tierra)' then
    return 'ingenieria';
  end if;

  if p_geom is not null
     and to_regclass('red_vial') is not null
     and exists (
       select 1 from red_vial rv
       where rv.capa in ('ripio', 'cordon_cuneta')
         and st_dwithin(rv.geom::geography, p_geom::geography, 20)
     )
     and not exists (
       select 1 from red_vial rv
       where rv.capa = 'pavimento'
         and st_dwithin(rv.geom::geography, p_geom::geography, 12)
     )
  then
    return 'ingenieria';
  end if;

  return 'bacheo';
end $$ language plpgsql stable;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table imbornales enable row level security;
alter table zonas_inundables enable row level security;
create policy imbornales_select on imbornales for select using (cimba_rol() <> '');
create policy zonas_inundables_select on zonas_inundables for select using (cimba_rol() <> '');
