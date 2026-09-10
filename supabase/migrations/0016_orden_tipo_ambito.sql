-- 0016: La orden de trabajo deja de ser solo "un circuito de bacheo".
--
-- Leo, 10/9: "la orden de trabajo va a depender de… vamos a trabajar tal
-- distrito, tal circuito, tal corredor o bien tal barrio, son esas cuatro
-- alternativas". Y antes de eso hay que elegir QUÉ trabajo es: "en el nuevo
-- orden de trabajo tendría que aparecer un tipo de orden para ver si sale
-- para imbornales, tapa… todas las opciones que haya", porque de eso depende
-- a qué empresa le llega.
--
-- Para las órdenes de imbornales el ámbito no es una zona sino el COLECTOR:
-- "va a tener o colector tal, te va a aparecer colector".

-- ── Tipo de orden: QUÉ trabajo se manda a hacer ─────────────────────────────
create type tipo_orden as enum (
  'bacheo',          -- lo de todos los días
  'pano_hormigon',   -- cambio de paño (Obra Tipo C)
  'carpeta',         -- repavimentación (Obra Tipo A)
  'cordon_cuneta',
  'imbornales',      -- limpieza y reparación de bocas de tormenta
  'tapas',           -- tapas de cámara: reposición o reparación
  'ripio'            -- pasado de máquina / enripiado
);

-- ── Ámbito: POR DÓNDE se define el trabajo ──────────────────────────────────
create type ambito_orden as enum ('distrito', 'circuito', 'corredor', 'barrio', 'colector');

alter table ordenes_trabajo add column if not exists tipo tipo_orden not null default 'bacheo';
alter table ordenes_trabajo add column if not exists ambito ambito_orden not null default 'circuito';
-- Referencia del ámbito elegido. Se guardan las tres claves posibles en vez de
-- una polimórfica: son FK reales, con integridad y con índice.
alter table ordenes_trabajo add column if not exists distrito_id integer references distritos(id);
alter table ordenes_trabajo add column if not exists barrio_id bigint references barrios(id);
alter table ordenes_trabajo add column if not exists corredor_id bigint references corredores(id);
-- El colector es texto libre en el relevamiento de imbornales (no hay tabla
-- de colectores): se guarda el nombre tal cual viene de esa capa.
alter table ordenes_trabajo add column if not exists colector text;
-- Número de contrato del ejecutor, para la hoja impresa. Se autocompleta desde
-- la empresa cuando esta tenga uno cargado.
alter table ordenes_trabajo add column if not exists contrato text;

create index if not exists ordenes_tipo_idx on ordenes_trabajo (tipo, estado);
create index if not exists ordenes_distrito_idx on ordenes_trabajo (distrito_id);
create index if not exists ordenes_barrio_idx on ordenes_trabajo (barrio_id);

comment on column ordenes_trabajo.ambito is
  'Cómo se delimitó el trabajo. La FK que acompaña depende de este valor: circuito_id, distrito_id, barrio_id, corredor_id o colector.';

/**
 * Qué tipos de orden sabe hacer cada empresa. Sin esto, al elegir "imbornales"
 * aparecerían las cinco contratistas de bacheo y la orden podría salir mal
 * dirigida — que es justamente lo que Leo quiere evitar: "ya sé que estas las
 * tienen que hacer Luxury".
 *
 * Una empresa sin ninguna fila acá se considera habilitada para todo: así el
 * alta de una contratista nueva no queda muda hasta que alguien la configure.
 */
create table empresa_tipos_orden (
  empresa_id bigint not null references empresas(id) on delete cascade,
  tipo       tipo_orden not null,
  primary key (empresa_id, tipo)
);

alter table empresa_tipos_orden enable row level security;
create policy empresa_tipos_select on empresa_tipos_orden for select using (cimba_rol() <> '');

-- El número de contrato vive en la empresa: la orden se lo copia al emitirse,
-- para que la hoja impresa quede congelada aunque el contrato cambie después.
alter table empresas add column if not exists contrato text;
