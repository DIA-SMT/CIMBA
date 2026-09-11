-- UN USUARIO POR EMPRESA, CON CLAVE PROPIA Y CAMBIO OBLIGATORIO.
--
-- Hasta ahora la contratista entraba con el SLUG de la empresa y una clave
-- guardada en `empresas.clave_hash`: una sola credencial compartida por todos
-- los capataces, sin forma de exigir el cambio de la clave inicial y sin
-- rastro de quién cargó qué (`orden_items.reportado_por` decía "INGECO S.A.").
--
-- Los usuarios del personal (Silvana, Alejandro, Leo) SÍ tienen todo eso: viven
-- en `perfiles` con usuario, clave propia y `clave_temporal`, y el middleware
-- los encierra en /clave hasta que la cambian. Esta columna hace que las
-- empresas usen exactamente ese mismo mecanismo en vez de uno paralelo: un
-- perfil con rol 'empresa' apuntando a su empresa.
--
-- El camino viejo (slug + empresas.clave_hash) se deja andando: las claves ya
-- repartidas siguen funcionando y nadie se queda afuera el día del cambio.

alter table perfiles add column if not exists empresa_id bigint references empresas (id);

create index if not exists perfiles_empresa_idx on perfiles (empresa_id) where empresa_id is not null;

comment on column perfiles.empresa_id is
  'Para los perfiles con rol empresa: a qué contratista pertenece. Viaja en el JWT como id_empresa y es lo que acota todo lo que ve y toca en /empresa.';
