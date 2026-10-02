-- 0022: Toneladas de asfalto, y el bache que no se puede ejecutar.
--
-- Dos cosas de la revisión del 12/09 con la Dirección de Bacheo:
--
--  1. LA UNIDAD CON LA QUE SE CERTIFICA ES LA TONELADA. La obra se paga por
--     tonelada de asfalto, no por m². Los m² se siguen mostrando porque son lo
--     tangible —el capataz ve el pozo, no ve la tonelada— pero el número que
--     va al acta tiene que estar a la vista de los dos lados. No hace falta
--     columna nueva: tonelada = volumen_m3 × 2,4, y `volumen_m3` ya es una
--     columna generada. Se deja anotada la densidad acá para que el día que
--     cambie el pliego se busque en un solo lugar.
--
--  2. "NO ES BACHE / NO SE PUEDE EJECUTAR". Hasta hoy la cuadrilla que llegaba
--     a un punto y encontraba una pérdida de agua tenía dos salidas y las dos
--     mentían: "no lo encontré" (falso, lo encontró) o reportarlo hecho
--     (peor: inventa m² y cierra un reclamo que sigue abierto en la calle).
--     Ahora el item puede terminar en 'no_ejecutable' con el motivo real.

-- ── El item que no se puede ejecutar ─────────────────────────────────────────
alter type estado_item_orden add value if not exists 'no_ejecutable';

-- ── Pérdida de líquidos cloacales ────────────────────────────────────────────
-- El vocabulario ya tenía 'perdida_agua' (agua potable) y 'tapa_registro'
-- (la tapa rota). Faltaba la tercera que pidió Bacheo y que la app de la
-- Dirección no distinguía: la cloaca que desborda. Va a la SAT igual que las
-- otras dos, pero es otro reclamo y otra cuadrilla.
alter type tipo_problema add value if not exists 'perdida_cloacal';

-- ── La densidad, en un solo lugar ────────────────────────────────────────────
-- 2,4 t/m³ es el dato que dio la Dirección de Bacheo para la mezcla asfáltica
-- en caliente que se usa en el municipio. La app la lee de lib/medicion.ts;
-- esto es su contraparte para las consultas SQL y los informes.
create table if not exists parametros_certificacion (
  clave       text primary key,
  valor       numeric not null,
  unidad      text not null,
  descripcion text not null,
  vigente_desde date not null default current_date
);

insert into parametros_certificacion (clave, valor, unidad, descripcion)
values (
  'densidad_asfalto',
  2.4,
  't/m³',
  'Densidad de la mezcla asfáltica en caliente. Toneladas = volumen_m3 × este valor. Dato de la Dirección de Bacheo (12/09/2026).'
)
on conflict (clave) do nothing;

comment on table parametros_certificacion is
  'Constantes con las que se certifica la obra. Viven en la base y no en el código porque las fija el pliego, no el programa.';
