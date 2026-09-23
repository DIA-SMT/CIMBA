# Cómo se trabaja en CIMBA

Este archivo es el contrato de trabajo del agente en este repositorio. Se lee
completo antes de tocar nada.

## 1. Quién pide y quién decide

Quien pide los cambios **usa CIMBA todos los días y no es programador**. Las dos
mitades de esa frase pesan igual:

- **Conoce el dominio mejor que nadie**: bacheo, órdenes, cuadrillas, empresas,
  actas, certificación, la brecha, los circuitos. Es la autoridad sobre cómo
  tiene que comportarse el sistema. No se le explica qué es un pedido ni qué es
  una certificación: eso lo sabe, y explicárselo es una falta de respeto.
- **No decide implementación** ni puede evaluar riesgo técnico. Los límites de
  este documento existen por la fragilidad del proyecto (§2), no por su
  competencia.

Se comunica por un **bot de Telegram que es solo un canal**: no ve la terminal,
ni el código, ni el diff, ni el navegador. Solo texto y, si se le manda,
imágenes.

De eso salen cuatro obligaciones:

- **Nunca delegar una decisión técnica.** Qué archivo, qué componente, si hace
  falta migración, qué validación, qué endpoint: lo decide el agente.
  Preguntar eso es incumplir el contrato.
- **Sí preguntar las decisiones de dominio, y preguntarlas sin miedo.** Las
  contesta en el momento y con precisión: qué pasa con el circuito cuando se
  anula un trabajo, si una orden vencida sigue contando en la brecha, qué
  significa "duplicado" para la Dirección, quién firma un mensaje que sale
  hacia afuera. Ante una duda de comportamiento, preguntar sale más barato que
  suponer. Una pregunta por vez, corta, contestable con una palabra.
- **Hablarle en el idioma del sistema, no en tecnicismos ni en lenguaje
  simplificado.** Los términos son los de la UI y del glosario: pedido,
  problema, trabajo, certificación, orden, acta, cuadrilla, empresa. Nunca
  `demandas`, `incidentes`, `orden_items`, `server action` ni `migración`.
- **La evidencia se muestra, no se afirma.** "Funciona" no es un reporte. Si el
  cambio se ve en pantalla, va una captura de la pantalla real. Si no se pudo
  verificar, se dice que no se pudo.

Antes de preguntar cualquier cosa: *¿esto define el comportamiento del sistema o
define cómo se implementa?* Implementación → decidir. Comportamiento →
preguntar.

**Es un usuario diario, y eso cambia tres cosas:**

1. **Es la capa de verificación más confiable que tiene el proyecto.** Nota una
   regresión en la bandeja o en el mapa que ningún test detectaría, porque sabe
   cómo se ve un día normal. Al cerrar un cambio, decirle **qué mirar** y en qué
   pantalla, en términos de lo que hace todos los días.
2. **Pero su verificación ocurre en el sistema real.** No hay entorno de prueba
   (§2): cuando él comprueba, ya está mirando producción. Por eso la
   verificación propia del agente va primero y completa, no se terceriza en él.
3. **Un cambio roto lo golpea a él, de inmediato.** No hay CI ni tests de la
   app: el primero que ve una pantalla en blanco es él o una cuadrilla en la
   calle. Los cambios van **de a uno, chicos e independientes**, para que
   cualquiera se pueda volver atrás sin arrastrar a los demás.

## 2. Los seis hechos que cambian toda decisión

Verificados en el código, no heredados de la documentación. Cualquier plan que
los contradiga está mal.

1. **Hay una sola base de datos y es producción.** La misma en desarrollo, en
   los previews de Vercel y en producción (`README.md:34-35`, un único
   `DATABASE_URL`). No existe entorno de prueba. Escribir una fila es escribir
   en producción, siempre.
2. **No hay forma de deshacer nada de la base.** `scripts/db.mjs` solo tiene
   `migrar`, `seed` y `estado`: sin reversión, sin archivos `down`, sin backup
   ni restauración en todo el repo. El código se revierte con git en segundos;
   los datos no se revierten nunca. Esa asimetría se le explica a la persona
   cada vez que un cambio toque datos.
3. **La RLS está escrita y no se aplica.** La app conecta como dueño de las
   tablas y ninguna de las 34 migraciones hace `FORCE ROW LEVEL SECURITY`
   (`docs/decisiones.md:73-83`). Las políticas de `supabase/migrations` son
   decorativas. El control real está repartido a mano: `requerirRol` /
   `requerirSesion` / chequeos ad-hoc en cada acción (49 llamadas a
   `requerirRol` en 9 archivos), más la allowlist de prefijos del middleware
   (`apps/web/src/middleware.ts:23-44`, que el propio comentario llama "el
   perímetro real"). Ninguna de las 21 rutas de API usa `requerirRol`.
4. **La aplicación no tiene ni un test.** Toda la cobertura son 31 tests en 5
   archivos de lógica pura (`packages/domain` más un parser), ~1 segundo.
   `apps/web` (211 archivos, 46.537 líneas, 40 pantallas, 21 endpoints, 74
   server actions) tiene cero. No hay ESLint: `lint` es `tsc --noEmit`. No hay
   CI: no existe `.github`. El primer control automático de la app es el build
   de Vercel, o sea después de subir.
5. **Los previews de Vercel no son un entorno de prueba.**
   `scripts/vercel-env.mjs` sube las variables con target `production` **y**
   `preview`: un branch en preview corre contra la base real y con las claves
   reales.
6. **`.env.local` contiene credenciales de infraestructura.** `VERCEL_TOKEN`,
   `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
   `SUPABASE_SERVICE_ROLE_KEY`, `MYSQL_BACHEO_PASSWORD`. Con esas llaves se
   borra el proyecto Supabase entero o se reescribe producción. **No se abre
   ese archivo.** Si hace falta saber si una variable existe, se mira
   `.env.example` o se pregunta por el nombre. Nunca se imprime un valor de
   secreto en una respuesta, un commit, un comentario ni un archivo.

Detalle operativo que se malinterpreta siempre: **Next no lee ningún archivo de
entorno acá.** `apps/web` no tiene `.env*` y `next.config.ts:8` busca
`../../.env`, que no existe (en la raíz hay `.env.example` y `.env.local`).
`scripts/db.mjs:17` tiene el mismo problema. Entonces, al levantar la app,
cualquier pantalla con datos falla con "DATABASE_URL no configurada" **y eso no
significa que se rompió algo**: falta el entorno en el shell.

## 3. Niveles de autonomía

### Nivel 1 — se hace solo, sin preguntar

Leer y analizar código, buscar errores, modificar componentes y estilos,
corregir lógica, agregar validaciones, escribir funciones, agregar tests en
`packages/domain`, correr `pnpm test`, `pnpm lint`, `pnpm build`, `git status`,
y los modos secos `pnpm ingest:sigov --dry` / `pnpm ingest:empresas --dry`.

### Nivel 2 — se decide solo, se avisa mientras se hace

Modificar server actions y endpoints, crear endpoints, cambiar el esquema
Drizzle, escribir una migración nueva, refactorizar, instalar dependencias,
reorganizar módulos. Secuencia obligatoria:

1. `git status` y rama limpia registrados como punto de partida.
2. Implementar con el patrón que ya usa el proyecto, no con uno nuevo.
3. `pnpm test` más `pnpm lint`; si toca `apps/web`, además `pnpm build`.
4. Si toca pantalla, abrirla y sacar captura.
5. Reportar en dos listas: verificado / no verificado.

### Nivel 3 — no se ejecuta; se prepara y se explica

Nunca se ejecuta por decisión propia, aunque el pedido lo implique:

- Cualquier `drop table`, `drop column`, `truncate`, `alter column type`,
  `alter column set not null` sobre una tabla con datos.
- Cualquier `delete` o `update` masivo sobre datos reales.
- `pnpm db:migrar` cuando la migración nueva transforme datos existentes
  (agregar una columna vacía es Nivel 2; transformar filas es Nivel 3).
- `node scripts/vercel-env.mjs`: sobrescribe las variables de producción con lo
  que haya en el `.env` local. Si hay que cambiar una variable de producción, se
  le dice cuál y la cambia la persona en el panel de Vercel.
- Los scripts de `scripts/*.mjs` con `delete from` sin condición:
  `cargar-territorio.mjs` (`red_vial`, 10.392 cuadras; `sectores_licitacion`;
  `barrios`), `cargar-hidraulica.mjs` (`imbornales`, `zonas_inundables`),
  `cargar-corredores.mjs`. Vacían tablas enteras fuera de las migraciones y sin
  auditoría, y su recuperación depende de un GeoJSON local.
- `pnpm ingest:mock` y `CIMBA_FUENTE_AC=mock`: fabrican demandas inventadas en
  la base real. Ya pasó: ~66 demandas falsas contaminaron la brecha y las
  métricas por distrito (`apps/web/src/app/api/sync/[fuente]/route.ts:36-41`).
- Tocar `CIMBA_JWT_SECRET`: es el apagón total, expulsa a todos los conectados,
  cuadrillas en la calle incluidas.
- Desplegar a Vercel.
- Cualquier cosa que mande mensajes reales (ver §5).

En Nivel 3 se explica en lenguaje simple: qué se quiere hacer, por qué, qué
riesgo hay, qué se vería afectado. Sin jerga y sin preguntar nada técnico.

## 4. Datos: lo que se preserva

- **Nunca borrar ni fusionar destructivamente** una demanda, un incidente ni
  una intervención. Es la regla de oro declarada del proyecto: la
  deduplicación es "asistida, nunca destructiva" (`README.md:8`,
  `apps/web/src/app/(app)/calidad/page.tsx:144`). Si la persona pide "unificar
  los repetidos" o "limpiar duplicados", se traduce a **vincular** o
  **descartar con motivo**, que dejan rastro en `auditoria`, y se le explica
  que el pedido original se conserva. Es exactamente el dato que el sistema
  existe para poder responder ante el Concejo o una intimación de la SAT.
- **No bajar ni eludir los umbrales de deduplicación**: `confianzaMinimaAuto`
  0.75 y `umbralAutomatico` 0.85 (`packages/domain/src/dedup.ts:18-28`). Si un
  cambio hace fallar `dedup.test.ts:31`, el cambio está mal, no el test.
  Vincular dos reclamos de vecinos distintos al mismo bache hace desaparecer
  un pedido real de la deuda.
- **Re-importar no agrega: pisa.** La ingesta hace `UPDATE` sobre filas ya
  cargadas, y `demandas.contacto` se sobrescribe **sin ninguna guarda**
  (`packages/integrations/src/pipeline.ts:153`). Solo se preserva lo que esté
  en `MARCAS_HUMANAS` (`pipeline.ts:31`) — y en incidentes se preserva
  únicamente `estado='verificado'`; `geom`, `direccion`, `distrito_id` y
  `cuadrante_id` se reescriben siempre. **Cualquier dato nuevo que vaya a
  editar una persona tiene que sumarse a esas guardas en el mismo cambio**, o
  la próxima sincronización borra el trabajo humano en silencio. Si el pedido
  es "que el vecino edite su teléfono", ese dato **no puede vivir en
  `contacto`**: va a una columna o clave protegida. (Hoy `apps/web` no escribe
  `contacto` en ningún camino.)
- **No borrar filas con `external_ref`**: la próxima sincronización las vuelve
  a insertar como nuevas, con otro id, perdiendo la historia.
- **La etapa "staging → promover" no existe.** `staging.registros` solo recibe
  inserts; nadie la lee. La ingesta escribe directo sobre filas promovidas, sin
  transacción y sin lock: dos corridas simultáneas dejan incidentes duplicados
  que solo se limpian a mano. Antes de una ingesta manual, confirmar que el
  runner de la máquina municipal está detenido.
- **Preferir siempre el borrado lógico** que ya usa el proyecto (`estado =
  'descartada'`, `'anulada'`, `activo = false`). Antes de escribir un delete
  físico nuevo, enumerar las cascadas (`0000_init.sql:165-166`, `205-206`,
  `0005_ordenes_trabajo.sql:203`): borrar una demanda se lleva sus vínculos y
  sus filas de `fotografias`.
- **Las fotos de Storage se borran físicamente y sin rastro** en seis lugares,
  todos con el error tragado (`acciones-ordenes.ts:1053-1058`, `:1423`,
  `:1567`, `:1983`, `:2149`, `acciones-carga-libre.ts:271`). No hay papelera,
  ni versionado, ni auditoría, ni backup. La foto de "antes" no se puede volver
  a sacar porque el bache ya está tapado. **No "limpiar huérfanos" en Storage.**
- **`auditoria` no está cubierta para todo**: el trigger cubre 7 tablas de 35.
  `perfiles` no está (cambiar el rol de alguien no deja rastro),
  `demanda_incidente` tampoco y se borra físicamente, y **`actas_medicion`,
  `acta_items` e `inspecciones_calidad` tampoco** — que es el dato con el que
  se le paga a las contratistas.
- **`auditoria` contiene datos personales**: guarda la fila entera de
  `demandas`, contacto incluido, fuera de `puedeVerContacto`. Tratarla como
  dato sensible.

## 5. Lo que sale hacia afuera

Nunca sin autorización explícita en el mensaje anterior:

- **Mensajes a personas reales.** Push y email a personal municipal y a los
  teléfonos de las 13 contratistas. Antes de tocar
  `apps/web/src/lib/notificar.ts`, `push.ts`, `apps/web/src/app/api/cron/` o la
  tabla `avisos_destinatarios`, decirlo con esas palabras y esperar respuesta.
  El cron diario recorre **todas** las órdenes vencidas sin `LIMIT`: un
  `UPDATE` masivo sobre `vence_en`, `estado` o `metadata` dispara una tanda de
  avisos reales que no se puede cancelar.
- **Al ciudadano hoy no le llega nada automático.** El único camino es manual:
  en `/cierres` una persona abre WhatsApp o el mail con el texto precargado y
  lo manda ella. Ese límite vive en datos, no en código (el canal email solo
  valida formato), así que **no agregar como destinatario de avisos el mail o
  el teléfono de un vecino**, y si piden "avisarle al vecino", preguntar quién
  firma ese mensaje.
- **Llamadas pagas a OpenRouter.** Sin límite de gasto por usuario, sesión ni
  día; una pregunta a Migue son hasta 5 llamadas. No agregar una llamada dentro
  de un bucle, un cron o una acción que procese muchas filas. Si el pedido
  implica análisis en masa, decir cuántas llamadas serían y pedir autorización
  con ese número.
- **La descripción libre de la demanda viaja a OpenRouter**, y el propio repo
  dice que ahí los vecinos "suelen escribir su nombre y teléfono"
  (`expedientes.ts:29-32`). La protección de datos personales del proyecto está
  puesta en la columna `contacto`; el camino de fuga real es este. No ampliar
  lo que se manda al modelo.
- **Nunca exponer `demandas.contacto`** en un endpoint, una exportación,
  `/api/geodata`, un prompt de IA ni un reporte. Toda consulta nueva sobre
  demandas pasa por `puedeVerContacto` (`apps/web/src/lib/auth.ts:81`).
- **Nunca corregir datos en la fuente** (planilla de empresas, SIGOV, reclamos
  de Atención Ciudadana): son sistemas de otras direcciones. CIMBA solo lee de
  ellos, y eso hoy lo sostiene la prosa, no el código. Cambiar el SQL de
  `sigov-mysql.ts`, el path del POST de Atención Ciudadana o el nombre del RPC
  `getPuntos` requiere autorización explícita.
- **No reprocesar geocodificación en masa**: usa el Nominatim público y el
  propio comentario advierte que pasarse bloquea la IP de la Municipalidad, lo
  que afecta a otros sistemas municipales.
- **No subir `CIMBA_AC_LOTE`** ni bajar la espera del barrido: son POSTs contra
  un servidor de otra dirección, en producción.

## 6. Acceso y permisos

- **Nunca escribir un server action o endpoint nuevo sin elegir explícitamente
  su guard** (`requerirRol('rol', ...)` o `requerirSesion()`) y decir en una
  frase quién va a poder usarlo. Dejarlo con solo `leerSesion()` lo abre a
  cualquier sesión: abajo no hay nada.
- **Nunca quitar, aflojar ni ampliar** un `requerirRol` / `requerirSesion` /
  `exigirSuperadmin` sin avisar que eso elimina el único control que corre.
  Nunca agregar el rol `empresa` a nada fuera de `/empresa`: son contratistas
  externos al municipio.
- **El aislamiento entre contratistas es una línea de TypeScript.** Nunca
  aceptar el id de empresa desde la URL, el formulario o el body para un rol
  `empresa` o `cuadrilla`: siempre `empresaDelEjecutor(sesion)`
  (`apps/web/src/lib/ordenes.ts:717`, 15 puntos de llamada).
- **No tocar `apps/web/src/app/api/auth/dev/route.ts` ni `DEV_FAKE_SSO`.** Con
  `DEV_FAKE_SSO=1` y `DEV_SSO_CODIGO` vacío, cualquiera que haga un POST a ese
  endpoint obtiene una cookie de administrador sin identidad, válida 12 horas.
  Si el pedido es "abrir el acceso para que prueben", la respuesta son usuarios
  locales con clave temporal, no esta puerta.
- **El middleware decide por prefijo, no por ruta exacta.** Antes de agregar
  una página o ruta, verificar que su nombre no empiece con ninguno de los
  prefijos de `PUBLICAS` (9) ni de `PREFIJOS_EMPRESA` (7).
- **Nunca una variable `NEXT_PUBLIC_` para una credencial**: queda legible en
  el bundle del navegador y el script de deploy la sube sin cifrar.
- **Claves**: hoy son SHA-256 sin sal, comparadas con `===`, sin límite de
  intentos y sin registro de los fallidos. No cambiar el algoritmo sin un plan
  de regeneración de todas las claves: cambiarlo deja afuera a todo el personal
  y a todas las contratistas.
- **No modificar** `derivarRolInicial` (`sso.ts:59`) ni el `upsertPerfil` que
  conserva el rol (`perfiles.ts:26`): ahí se decide quién se vuelve
  administrador automáticamente cuando se conecte el SSO.
- **Endpoints de cron**: el middleware deja pasar `/api/sync` y `/api/cron` sin
  sesión. Toda ruta nueva ahí arranca con el patrón completo de
  `vencimientos/route.ts:19` (`if (!secreto || ...)`). El de `sync` hoy no lo
  tiene: sin `CRON_SECRET`, compara contra `"Bearer undefined"`.

## 7. Migraciones

- **Nunca editar una migración ya aplicada**: el runner decide por nombre de
  archivo (`scripts/db.mjs:43-47`), así que el cambio no corre nunca y la base
  queda distinta del repo, con todos convencidos de lo contrario. Todo cambio
  de esquema va en un archivo nuevo con el número siguiente de cuatro dígitos,
  en `supabase/migrations`, escrito a mano. No usar `drizzle-kit` ni la CLI de
  Supabase (decisión cerrada).
- **Toda migración idempotente** (`if exists` / `if not exists` / `not
  exists`): se aplica contra la base que también es producción.
- **Numeración concurrente**: cualquier número correlativo nuevo se toma con
  `pg_advisory_xact_lock`, como `0018_numero_orden.sql` y
  `acciones-tratamiento.ts:138`. El `count(*)+1` sin lock ya rompió dos veces
  en producción. `actas_medicion.numero` todavía tiene ese bug.

## 8. Verificación

Lo único que existe:

```
pnpm test     # 31 tests, 5 archivos, ~1 s. NO ejecuta una sola línea de apps/web
pnpm lint     # NO es un linter: es tsc --noEmit en los 4 paquetes
pnpm build    # obligatorio si el cambio toca apps/web
```

- **Nunca decir "los tests pasan, está listo"** si el cambio toca `apps/web`.
  Nombrar siempre el comando literal y su resultado.
- **Verde no es seguro.** `pnpm test` en verde significa: las reglas de
  deduplicación, el score de priorización, la normalización de direcciones, el
  alcance de órdenes y dos parsers siguen dando lo mismo. No significa que la
  app arranque, que una pantalla se vea, que un botón guarde ni que un permiso
  siga cerrado.
- `tsc --noEmit` corre **sin** los tipos que genera Next (`.next/types` y
  `next-env.d.ts` no existen en el árbol), así que `pnpm build` es lo único que
  detecta errores de `"use server"` / `"use client"` y de tipos de rutas.
- **Si es una regla de negocio** (dedup, priorización, direcciones, alcance),
  se verifica con un test en `packages/domain`, no abriendo una pantalla: es el
  único lugar donde una regla queda verificada en un segundo y para siempre.
- **Verificación manual mínima**: `pnpm dev` (puerto 3300,
  `.claude/launch.json`), con `DATABASE_URL` y `CIMBA_JWT_SECRET` presentes en
  el shell; entrar, abrir `/mapa` (KPIs arriba y puntos en el mapa),
  `/demandas` (filas en la bandeja), `/ordenes` y una `/ordenes/[id]`. Mirar
  siempre la consola del navegador y la salida del server: para los componentes
  de cliente son el único detector.
- **Entrar a verificar no es de solo lectura**: el login de prueba hace un
  upsert en `perfiles` y un `UPDATE` del rol. Avisarlo y usar siempre el mismo
  rol.
- **Cambios de permisos, rol o middleware** se prueban a mano con al menos dos
  roles (`admin` y `empresa`), comprobando en cada uno lo que ve y lo que no
  alcanza. Ningún test ejercita eso.
- Después de cualquier cambio que haya escrito en la base: `pnpm db:estado` y
  comparar los conteos con los de antes. Si un conteo bajó y no estaba
  previsto, decirlo de inmediato.

## 9. Convenciones del proyecto

Decisiones **cerradas**, en `docs/decisiones.md` (D1–D9): MapLibre en lugar de
Leaflet, sin Supabase Auth ni contraseñas propias (solo SSO de Ciudad Digital),
`packages/ui` pospuesto, migraciones SQL planas, TypeScript strict con
`noUncheckedIndexedAccess`. No se re-discuten; si un pedido las contradice, se
dice en español simple y se pide confirmación.

- **Todo en español**: funciones, variables, tipos, archivos en kebab-case,
  tablas y columnas. Inglés solo donde lo impone una API externa (drizzle,
  Next, scripts estándar de npm). El único legado es `getDb`.
- **Commits en español**, una frase narrativa que cuenta el efecto para el
  usuario. Sin `feat:`/`fix:`, sin scope, sin número de issue. Mirar
  `git log --oneline -5` antes de redactar.
- **Vocabulario doble deliberado**: la base y el código usan demanda /
  incidente / intervención; la UI usa pedido / problema / trabajo /
  certificación. Antes de escribir texto de UI, leer `glosario.ts` **y**
  `formato.ts` (ya divergen en un caso: `fuera_de_alcance` se muestra como
  "Derivado", pedido de la Dirección).
- **Errores para personas**: si el mensaje está en español y le habla a
  alguien, va como `ErrorVisible` (`apps/web/src/lib/errores.ts`). Un `throw
  new Error` común desaparece en producción y se reemplaza por un párrafo en
  inglés.
- **Nunca sumar m2 de escalas distintas**: un bache son ~4 m2 y una obra SIGOV
  ~172. Todo KPI o pantalla que muestre superficie separa por
  `metadata.escala`.
- **Tokens CSS, nunca hex** en componentes nuevos; `fondoTenue()` para fondos
  tenues. Un hex desaparece al cambiar de tema.
- **Listas `IN` de SQL parametrizadas con `sql.join`**, nunca concatenadas.
- **El geocodificador es siempre server-side** y cacheado. Nunca importar
  `better-sqlite3` en código que entre al bundle web.
- **Los checkboxes de `docs/mejoras.md` no son el estado real**: están
  desactualizados. Verificar en el código antes de implementar un item.
- **Los pendientes de `docs/decisiones.md:101-122` están bloqueados por otra
  repartición.** No fabricar el endpoint o el archivo que falta: reportar el
  bloqueo.
- **Cero slots de cron libres**: Vercel Hobby permite 2 y los dos están usados.
  Lo automático nuevo se encadena a un cron existente. Máximo 60 s por
  función.
- **El runner** (`pnpm runner`) es un proceso de larga duración con su propio
  reloj. No convertirlo en una tarea cada N minutos: el solapamiento es el modo
  de falla a evitar.

## 10. Cómo se reporta

En Telegram, corto y en el idioma del sistema. Al cerrar cualquier tarea, tres
partes y nunca una sola frase de "funciona":

1. **Qué cambió**, dicho como lo vive él: qué pantalla, qué botón, qué se ve
   distinto ahora.
2. **Qué comprobé**: la captura de la pantalla real, y las pruebas que corrí.
3. **Qué te pido que mires**: la pantalla concreta y qué tendría que verse en un
   día normal. Es el único control que existe sobre las 40 pantallas de la app,
   y él es el que sabe cómo se ven bien.

Y siempre que el cambio haya tocado datos: si se borró algo, si se pisó algo, y
cuántas filas.

**Todo cambio de código se puede volver atrás con una palabra.** Decirlo así:
"si no te gusta, decime *volvelo* y lo dejo como estaba". Eso vale para el
código, no para los datos, y la diferencia se aclara cuando corresponda.

El detalle técnico se ofrece, no se impone: una línea de resumen y "si querés,
te paso el detalle".
