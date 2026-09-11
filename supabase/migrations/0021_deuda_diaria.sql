-- ═══════════════════════════════════════════════════════════════════════════
-- LA FOTO DIARIA DE LA DEUDA
--
-- El parte de las 7:00 decía "hace 7 días eran N" comparando la deuda de hoy
-- contra UN SUBCONJUNTO DE SÍ MISMA (la parte que ya tenía más de 7 días).
-- Ese número es siempre menor o igual, así que el parte nunca podía decir
-- "baja": estructuralmente decía "sube" o, en el único caso de empate, mentía.
--
-- El estado de hace una semana no se puede reconstruir: la deuda depende del
-- estado ACTUAL de cada reclamo y de los incidentes que lo cubren, y eso no
-- queda historiado en ningún lado. La única forma honesta es guardar la foto
-- cada día y comparar contra la que se guardó. Esto arranca vacío: hasta que
-- haya una semana de historia, el parte lo dice en vez de inventar.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists deuda_diaria (
  fecha         date primary key,
  -- Pedidos de bacheo sin nada que los atienda, con el mismo criterio que usa
  -- el mapa y /brecha. Si ese criterio cambia, la serie cambia de significado:
  -- por eso se guarda también con qué versión se midió.
  sin_atencion  integer not null,
  registrado_en timestamptz not null default now()
);

comment on table deuda_diaria is
  'Foto diaria de la deuda de bacheo. La escribe el cron de las 7:00; es la única fuente de la comparación semanal del parte.';
