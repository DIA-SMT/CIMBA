# Órdenes de trabajo: CIMBA deja de ser espejo

Hasta acá CIMBA miraba lo que otros sistemas hacían (SIGOV, la planilla de
empresas, Atención Ciudadana). Con este módulo la orden de trabajo **nace en
CIMBA**: el Director planifica por circuito, la empresa recibe la orden en su
portal, carga cada bache con medidas y foto, y esa carga crea la intervención
real. No hay un mundo paralelo de órdenes: todo lo reportado alimenta la
brecha, las métricas por distrito y el cierre de reclamos.

## El ciclo

```
Director (/ordenes/nueva)                 Empresa (/empresa)
────────────────────────                  ──────────────────
elige circuito
ve LA DEMANDA: pendientes con
  reclamos detrás de cada bache
ve LA OFERTA: empresas, cuadrillas,
  carga actual
arma la orden (baches + tramos)
  → borrador → EMITE ──────────────────►  la ve en su portal
                                          reporta cada item:
                                            ancho × largo × espesor
                                            foto del después (y antes)
                                            ubicación por GPS o DICTADA
                                          ─► se crea la INTERVENCIÓN real
                                             el incidente pasa a reparado
Atención Ciudadana (/cierres)                la orden avanza sola
──────────────────────────────
ve los reclamos cuyo problema
  ya está reparado → responde
  y CIERRA el ticket
```

## Decisiones que importan

- **El item reportado crea una intervención de verdad.** `reportarItemHecho`
  inserta en `intervenciones` (finalizada, con superficie y espesor en
  `materiales`) y cierra el incidente. La brecha, `/incidentes`, las métricas
  por distrito y la bandeja de cierres se enteran sin código extra.
- **Ancho × largo × espesor, no "un bache".** A veces es un solo pozo pero se
  pavimenta el paño completo: vale lo medido. Si el trabajo es carpeta (o
  supera 50 m²) queda marcado `metadata.escala = "obra"`, la misma regla que
  separa SIGOV del bacheo para no romper los promedios.
- **La empresa es un usuario externo.** Rol `empresa` con RLS en serio: solo
  ve sus órdenes no-borrador, y solo escribe sobre incidentes/intervenciones/
  fotos que una orden activa suya referencia. La clave se genera desde
  `/ordenes/empresas`, se muestra una única vez y en la base queda el hash.
- **Un incidente no entra en dos órdenes activas.** `crearOrden` lo salta si
  ya está pendiente en otra orden; si todos los elegidos estaban tomados, la
  orden no se crea.
- **La orden avanza sola.** Primera carga → `en_ejecucion`; sin items
  pendientes → `completada`. Anular una orden devuelve sus incidentes a la
  cola (`priorizado`).
- **Cierre de reclamos uno a uno.** Solo se puede cerrar una demanda cuyo
  incidente esté reparado — el botón no existe para promesas. El cierre queda
  en `metadata.cierre` y la demanda sale de la brecha.

## La regla de capacidad (los números del Director)

Una cuadrilla hace ~**10 baches por turno** (mañana y tarde). De **4 toneladas**
de mezcla salen ~**14 baches chicos o 4 carpetas**, por turno. Con eso
`lib/capacidad.ts` proyecta cualquier lote: turnos, toneladas, días según la
dotación. Los valores viven en la tabla `parametros` (clave
`capacidad_bacheo`) y se editan desde el panel de proyección sin tocar código.

Dotación cargada (sep 2026): Ingeco 4-5 cuadrillas por zona doble turno,
UOCRA 3 doble turno, Calleri 3-4 por zona, Administración 4 propias
(2 mañana, 1 tarde, 1 noche). Las **zonas** concesionadas se modelan como
circuitos asignados (`circuitos.empresa_id`) — cuando el Director pase el
detalle de las zonas de Ingeco, se marcan ahí y listo.

## Los circuitos

Los 47 polígonos (códigos tipo "15B") viven en la tabla `circuitos` con
prioridad vial (primaria/secundaria/terciaria) y empresa asignada. Todo
incidente y demanda con geometría sabe su circuito (trigger + backfill), así
que "programar por circuito" es un `where circuito_id = …`, no un cálculo.

## Lo que falta (a propósito)

- **Aviso push a la empresa al emitir la orden**: la infraestructura de push
  existe (`push_suscripciones`) pero está pensada para el personal; extenderla
  a empresas es un paso corto cuando se pida.
- **Cierre hacia CIDITUC**: `/cierres` cierra el ticket EN CIMBA. Responderle
  al vecino dentro del sistema de Atención Ciudadana necesita un endpoint de
  escritura de CIDITUC que hoy no tenemos (la API que conocemos es de lectura).
- **Zonas de Ingeco**: el Director las va a pasar; se cargan asignando
  circuitos, sin código nuevo.
