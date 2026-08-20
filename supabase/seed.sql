-- Seed de desarrollo: perfiles por rol, cuadrillas y bucket de fotografías.
-- Los DATOS REALES no se cargan por seed: se importan con
--   pnpm ingest:archivos -- "<carpeta Datos Bacheo>"
-- que es idempotente y registra cada corrida en sync_runs.

insert into perfiles (id_persona, id_tusuario, nombre, rol) values
  (90000, 1,  'Dev admin',                    'admin'),
  (90001, 99, 'Dev atención ciudadana',       'atencion_ciudadana'),
  (90002, 99, 'Dev hcd',                      'hcd'),
  (90003, 99, 'Dev información estratégica',  'informacion_estrategica'),
  (90004, 99, 'Dev planificación',            'planificacion'),
  (90005, 99, 'Dev supervisión',              'supervision'),
  (90006, 99, 'Dev cuadrilla',                'cuadrilla'),
  (90007, 99, 'Dev lectura',                  'lectura')
on conflict (id_persona) do nothing;

-- Idempotente sin unique en nombre: insert condicional
insert into cuadrillas (nombre, responsable)
select v.nombre, v.responsable
from (values
  ('Cuadrilla Norte',  (select id from perfiles where id_persona = 90006)),
  ('Cuadrilla Sur',    (select id from perfiles where id_persona = 90006)),
  ('Cuadrilla Este',   null::uuid),
  ('Cuadrilla Oeste',  null::uuid),
  ('Bacheo nocturno',  null::uuid)
) as v(nombre, responsable)
where not exists (select 1 from cuadrillas c where c.nombre = v.nombre);

-- El bucket de Storage "fotografias" se crea por Storage API en scripts/db.mjs
-- (el rol postgres no puede insertar en storage.buckets en Supabase Cloud).
