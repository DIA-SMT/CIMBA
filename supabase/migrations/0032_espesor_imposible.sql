-- ═══════════════════════════════════════════════════════════════════════════
-- EL ESPESOR DE MEDIO MILÍMETRO
--
-- Entre los 90 trabajos que Calleri cargó por la carga libre hay 18 con un
-- espesor imposible: 13 con 0,5 cm y 5 con 0,1 cm. Una carpeta de asfalto de
-- medio centímetro no existe — el protocolo de la DOV trabaja entre 4 y 6 cm,
-- y el resto de esas mismas cargas lo confirma (45 en 5 cm, 23 en 4).
--
-- Es un error de tipeo con consecuencia directa: el espesor multiplica a la
-- superficie para dar el volumen, y el volumen por 2,4 da las TONELADAS con
-- las que se certifica el pago. Con 0,5 en vez de 5, esos 18 trabajos
-- certificaban la décima parte de lo que se colocó.
--
-- Se corrigen SOLO los imposibles (menos de 1 cm) y se llevan a 5, que es el
-- espesor estándar y el que tiene el grueso de esa misma tanda. Los de 3,5,
-- 4 y 6 cm no se tocan: son valores reales y no es tarea de una migración
-- decidir que alguien se equivocó cuando el número es plausible.
--
-- Ninguno está en un acta firmada, así que no hay nada certificado que
-- contradecir.
-- ═══════════════════════════════════════════════════════════════════════════

/* El item de la orden. volumen_m3 es columna generada: se recalcula solo. */
update orden_items oi set
  espesor_cm = 5,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'espesor_corregido', jsonb_build_object(
      'de', oi.espesor_cm,
      'a', 5,
      'motivo', 'espesor imposible cargado por la empresa (menos de 1 cm)',
      'migracion', '0032_espesor_imposible'
    )
  )
where oi.metadata ? 'migrado_de_carga_libre'
  and oi.espesor_cm is not null
  and oi.espesor_cm < 1
  and oi.acta_id is null;

/* Y la intervención detrás, que es de donde salen las toneladas del acta.
   Acá volumen_m3 NO es generada: hay que recalcularla. */
update intervenciones iv set
  volumen_m3 = round((iv.superficie_m2 * 0.05)::numeric, 2),
  materiales = coalesce(materiales, '{}'::jsonb) || jsonb_build_object('espesor_cm', 5),
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'espesor_corregido', jsonb_build_object(
      'de', iv.materiales->>'espesor_cm',
      'a', 5,
      'migracion', '0032_espesor_imposible'
    )
  )
where exists (
  select 1 from orden_items oi
  where oi.intervencion_id = iv.id
    and oi.metadata->'espesor_corregido'->>'migracion' = '0032_espesor_imposible'
);
