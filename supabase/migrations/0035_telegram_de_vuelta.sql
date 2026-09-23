-- ═══════════════════════════════════════════════════════════════════════════
-- TELEGRAM, EL CAMINO DE VUELTA: QUIÉN ES EL QUE ESCRIBE
--
-- La 0034 abrió la puerta de salida: CIMBA le manda avisos a un chat y se
-- olvida. Esa puerta no necesita saber quién está del otro lado.
--
-- La de entrada sí. El bot corre afuera, en una VPS, y NO se conecta a esta
-- base: le habla a CIMBA por HTTP y tiene que actuar CON LOS PERMISOS de
-- quien escribió, con los mismos requerirRol que usa cualquier pantalla. Para
-- eso hay que traducir "chat 123456789" a "perfiles.id = …, rol planificacion".
-- Esa traducción es lo único que agrega esta migración: no prende ningún
-- aviso, no toca ninguna fila y no le da acceso a nadie.
--
-- Va en tabla propia y NO en una columna de perfiles, por tres razones de
-- este esquema:
--
--   1. Un chat vinculado es una CREDENCIAL: quien lo tenga emite órdenes como
--      esa persona. Vincular y revocar otorgan y quitan permisos, así que
--      tienen que quedar en el feed de /actividad. perfiles no tiene trigger
--      de auditoría y no puede tenerlo con la función genérica: auditar()
--      escribe new.id en auditoria.entidad_id, que es bigint, y perfiles.id
--      es uuid. Una tabla con id bigint identity lo toma tal cual.
--   2. Lo que hay que garantizar es que un chat activo mapee a UNA persona
--      —si no, el bot no puede decidir con qué permisos actuar—, y que una
--      persona pueda tener más de un chat (teléfono nuevo, segundo aparato).
--      Eso es un único por chat_id, no por perfil.
--   3. push_suscripciones (0002) resolvió el mismo problema —un canal que
--      representa al aparato de una persona, que se da de alta y se revoca
--      solo— con tabla propia y FK al perfil. Esto es la misma forma.
--
-- Solo chats PRIVADOS. En Telegram el id de un grupo es negativo, y en un
-- grupo escribe cualquiera de los miembros: vincular un grupo sería darle los
-- permisos de una persona a todos los que estén adentro. Para RECIBIR avisos
-- el grupo sigue sirviendo — eso es avisos_destinatarios, que a propósito no
-- tiene esta restricción. Son dos problemas distintos y se ven distintos.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists telegram_vinculos (
  -- bigint identity como avisos_destinatarios: es lo que necesita el trigger
  -- auditar() de más abajo.
  id               bigint generated always as identity primary key,
  perfil_id        uuid not null references perfiles (id) on delete cascade,
  -- El id del chat tal como lo reporta Telegram. bigint y no text: la base
  -- valida sola que sea un número. postgres.js devuelve bigint como STRING,
  -- que es justo lo que espera enviarTelegram({ chatId }): sin conversión en
  -- ningún borde.
  chat_id          bigint not null check (chat_id > 0),
  -- @usuario y nombre como los reporta Telegram: para mostrar en pantalla y
  -- nada más. Los cambia la persona cuando quiere; nunca se identifica por acá.
  usuario_telegram text,
  nombre_telegram  text,
  vinculado_en     timestamptz not null default now(),
  vinculado_por    uuid references perfiles (id),
  ultimo_uso       timestamptz,
  -- Revocar no borra: apagar tiene que ser reversible con un clic, y la fila
  -- queda para la auditoría. Quién pudo actuar como quién no se tira.
  revocado_en      timestamptz,
  revocado_por     uuid references perfiles (id)
);

-- La restricción que sostiene todo: un chat ACTIVO pertenece a una sola
-- persona. Índice parcial y no `unique` de tabla, para que un chat revocado se
-- pueda volver a vincular: con un único duro, revocarle el chat a alguien lo
-- dejaría bloqueado para siempre salvo borrando la fila, que es justo lo que
-- no queremos.
create unique index if not exists telegram_vinculos_chat_activo
  on telegram_vinculos (chat_id) where revocado_en is null;

create index if not exists telegram_vinculos_perfil_idx
  on telegram_vinculos (perfil_id) where revocado_en is null;

comment on table telegram_vinculos is
  'Traduce un chat de Telegram a una persona del padrón. Es lo que le permite al bot (que corre afuera y no toca esta base) actuar por HTTP con los permisos de quien escribe.';
comment on column telegram_vinculos.chat_id is
  'Id del chat privado, tal como lo reporta Telegram. Solo positivos: un grupo (id negativo) puede recibir avisos, pero no puede autorizar acciones.';
comment on column telegram_vinculos.revocado_en is
  'Vínculo dado de baja: el bot ignora las filas con este campo no nulo. No se borra la fila.';

-- ── El alta: un código de un solo uso ───────────────────────────────────────
-- El vínculo no puede crearse desde Telegram (cualquiera escribe "soy Leo") ni
-- copiando ids a mano en una pantalla. CIMBA emite un código corto, la persona
-- se lo manda al bot, y el bot lo canjea por HTTP.
--
-- Se guarda el HASH y no el código, por la misma razón que perfiles.clave_hash:
-- en claro es una llave para actuar como esa persona. Y es esta tabla la que
-- permite que chat_id sea `not null` arriba: el código se le emite a una
-- PERSONA, cuando todavía no hay ningún chat del otro lado.
create table if not exists telegram_codigos (
  id            bigint generated always as identity primary key,
  perfil_id     uuid not null references perfiles (id) on delete cascade,
  codigo_hash   text not null unique,
  creado_en     timestamptz not null default now(),
  creado_por    uuid references perfiles (id),
  expira_en     timestamptz not null default now() + interval '15 minutes',
  usado_en      timestamptz,
  usado_chat_id bigint
);

create index if not exists telegram_codigos_pendientes_idx
  on telegram_codigos (perfil_id) where usado_en is null;

comment on table telegram_codigos is
  'Códigos de un solo uso para vincular un chat. Solo el hash: el código en claro sería una credencial para actuar como esa persona.';

-- ── Auditoría ───────────────────────────────────────────────────────────────
-- Al mismo feed que el resto (0011). En telegram_codigos no hace falta: emitir
-- un código no otorga nada, y el canje queda registrado como el insert del
-- vínculo.
drop trigger if exists trg_auditar_telegram_vinculos on telegram_vinculos;
create trigger trg_auditar_telegram_vinculos
  after insert or update or delete on telegram_vinculos
  for each row execute function auditar();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Escrita como el resto y, como el resto, hoy NO se aplica: la app conecta
-- como dueña de las tablas. El control real son los requerirRol de las
-- acciones y el chequeo del secreto en el endpoint del bot. Queda escrita para
-- el día que se ponga un rol de aplicación.
alter table telegram_vinculos enable row level security;
alter table telegram_codigos enable row level security;

drop policy if exists telegram_vinculos_select on telegram_vinculos;
create policy telegram_vinculos_select on telegram_vinculos for select
  using (cimba_rol() in ('admin', 'planificacion') or perfil_id = cimba_perfil());

drop policy if exists telegram_vinculos_escribir on telegram_vinculos;
create policy telegram_vinculos_escribir on telegram_vinculos for all
  using (cimba_rol() in ('admin', 'planificacion'))
  with check (cimba_rol() in ('admin', 'planificacion'));

drop policy if exists telegram_codigos_escribir on telegram_codigos;
create policy telegram_codigos_escribir on telegram_codigos for all
  using (cimba_rol() in ('admin', 'planificacion'))
  with check (cimba_rol() in ('admin', 'planificacion'));
