-- ═══════════════════════════════════════════════════════════════════════════
-- LOS 90 BACHES DE CALLERI, DENTRO DE SU ORDEN
--
-- Entre el 15 y el 18 de septiembre, Calleri cargó 90 trabajos por la carga
-- libre del portal —"punto suelto", sin orden— cuando en realidad los estaba
-- ejecutando por la OT-2026-0006, que tenía abierta y en ejecución. La carga
-- libre existe justamente para el bache que aparece fuera de la lista, así que
-- el sistema los aceptó sin chistar: creó el incidente y la intervención de
-- cada uno, y quedaron bien en el mapa y en la brecha.
--
-- Lo que NO quedó bien es la orden. Como ninguno es item de la OT-2026-0006,
-- el avance de esa orden dice 16 de 22 cuando en la calle se taparon 106
-- baches, y el acta de medición que se firma sobre la orden deja afuera 90
-- trabajos con sus metros y sus toneladas.
--
-- Esta migración los mete en su orden SIN TOCAR NADA DE LO YA CARGADO: no
-- crea incidentes ni intervenciones ni fotos, solo la fila de orden_items que
-- faltaba, apuntando a la intervención que ya existe. Las medidas se copian
-- tal cual se cargaron — varias tienen el espesor en 0,5 cm, que es un error
-- de carga de la empresa, y se corrige desde la orden con el botón de
-- corregir medidas: no es tarea de una migración adivinar qué quisieron poner.
--
-- Es idempotente por construcción: el `not exists` sobre orden_items impide
-- que un segundo pase duplique nada.
-- ═══════════════════════════════════════════════════════════════════════════

insert into orden_items (
  orden_id, incidente_id, intervencion_id, direccion, geom, tipo_trabajo, estado,
  ancho_m, largo_m, espesor_cm, superficie_m2, tipo_obra,
  reportado_en, reportado_por, observaciones, metadata
)
select
  ot.id,
  i.id,
  iv.id,
  i.direccion,
  i.geom,
  -- Mismo criterio que crearOrden: el pavimento deteriorado es carpeta.
  case when i.tipo = 'pavimento_deteriorado' then 'carpeta' else 'bache' end,
  'hecho',
  (iv.materiales->>'ancho_m')::numeric,
  (iv.materiales->>'largo_m')::numeric,
  (iv.materiales->>'espesor_cm')::numeric,
  iv.superficie_m2,
  iv.tipo_obra,
  -- La fecha real del trabajo, no la de esta migración.
  iv.finalizada_en,
  iv.ejecutada_por,
  iv.observaciones,
  jsonb_build_object(
    'medicion', coalesce(iv.materiales->>'medicion', 'lados'),
    'capataz', iv.metadata->>'capataz',
    -- De dónde viene esta fila, para que dentro de un año se entienda por qué
    -- un item de la orden no tiene el recorrido normal de propuesto/validado.
    'migrado_de_carga_libre', jsonb_build_object(
      'migracion', '0029_calleri_a_su_orden',
      'intervencion', iv.id,
      'incidente', i.id
    )
  )
from incidentes i
join intervenciones iv on iv.incidente_id = i.id
join ordenes_trabajo ot on ot.numero = 'OT-2026-0006'
where i.metadata->>'origen' = 'empresa_libre'
  and i.metadata->>'empresa' = 'CALLERI E HIJOS S.A.'
  -- Solo lo ejecutado mientras esa orden estaba viva.
  and iv.estado = 'finalizada'
  -- EL FRENO A LA DUPLICACIÓN: si el trabajo ya está en alguna orden, no entra.
  and not exists (
    select 1 from orden_items oi where oi.incidente_id = i.id
  );

/*
 * La marca en los incidentes: dejan de ser "sin orden". Sin esto, la próxima
 * vez que alguien mire de dónde salieron va a leer `sin_orden: true` sobre un
 * bache que está en la OT-2026-0006, y no hay forma de saber cuál de las dos
 * cosas es cierta.
 */
update incidentes i set
  metadata = metadata - 'sin_orden' || jsonb_build_object(
    'orden', 'OT-2026-0006',
    'migrado_a_orden', jsonb_build_object('migracion', '0029_calleri_a_su_orden', 'en', now()::text)
  )
where i.metadata->>'origen' = 'empresa_libre'
  and i.metadata->>'empresa' = 'CALLERI E HIJOS S.A.'
  and exists (
    select 1 from orden_items oi
    join ordenes_trabajo ot on ot.id = oi.orden_id
    where oi.incidente_id = i.id and ot.numero = 'OT-2026-0006'
      and oi.metadata ? 'migrado_de_carga_libre'
  );

/*
 * Y en las intervenciones, para que la certificación las impute a la orden:
 * `orden` es la clave que leen las métricas por orden y el acta.
 */
update intervenciones iv set
  metadata = metadata - 'sin_orden' || jsonb_build_object('orden', 'OT-2026-0006')
where exists (
  select 1 from orden_items oi
  join ordenes_trabajo ot on ot.id = oi.orden_id
  where oi.intervencion_id = iv.id and ot.numero = 'OT-2026-0006'
    and oi.metadata ? 'migrado_de_carga_libre'
);
