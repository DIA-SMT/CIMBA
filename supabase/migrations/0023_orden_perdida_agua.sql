-- 0023: La orden de pérdida de agua.
--
-- La pérdida de agua es de la SAT. Pero el municipio la ejecuta cuando no
-- puede esperar —y solo con UOCRA e INGECO, que son las únicas habilitadas
-- por contrato— o la releva con foto para la nota que se le manda a la SAT.
--
-- Hasta ahora no había forma de emitir esa orden: los tipos disponibles eran
-- bacheo, paño, carpeta, cordón cuneta, imbornales, tapas y ripio. Así que las
-- 59 pérdidas de agua abiertas aparecían mezcladas entre los baches de
-- cualquier orden, listas para mandárselas a una contratista que no puede
-- resolverlas — y desde ahí solo se podía cerrar en falso o dejarlas colgadas.
--
-- Qué tipo de problema entra en cada tipo de orden vive en el dominio
-- (packages/domain/src/alcance.ts), no acá: es una regla de negocio que
-- cambia con los contratos, no una restricción de integridad.

alter type tipo_orden add value if not exists 'perdida_agua';

comment on type tipo_orden is
  'Qué trabajo manda a hacer la orden. De esto depende qué incidentes se ofrecen al armarla y a qué empresas se puede asignar (ver packages/domain/src/alcance.ts).';
