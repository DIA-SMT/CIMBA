# El enlace: sincronización desde adentro de la red municipal

CIMBA corre en Vercel, o sea en la nube. Las fuentes de bacheo que viven en la
red interna del municipio —el MySQL de Obras Viales en `172.16.8.214`— no son
alcanzables desde ahí: es una IP privada, y eso no se arregla con credenciales
ni con permisos, es topología de red.

El **enlace** (`pnpm runner`) resuelve eso desde el otro lado: es un proceso que
corre en una máquina *dentro* de la red, lee las fuentes y empuja los datos a la
base de CIMBA. La conexión sale de adentro hacia afuera, así que no hay que
abrir ningún puerto ni exponer nada del municipio a internet.

## Qué sincroniza hoy

| Fuente | Cada | Necesita estar en la red interna |
|---|---|---|
| Planilla de empresas (Google Apps Script) | 15 min | No — pero conviene tenerla junta con el resto |
| SIGOV Obras Viales (MySQL `smt_obrasviales`) | 20 min | **Sí** |
| *(pendiente)* Bachía, MySQL | — | **Sí** |

Los períodos son distintos a propósito: así las dos tareas se desfasan solas en
vez de pegarle a la base al mismo tiempo en cada vuelta. Se cambian con
`CIMBA_RUNNER_MIN_EMPRESAS` y `CIMBA_RUNNER_MIN_SIGOV`.

Atención Ciudadana **no** está acá: se sincroniza por un cron de Vercel, porque
su API es pública y no necesita la red interna. Que sea el único camino que no
depende de esta máquina es deliberado.

### Qué trae SIGOV

Las 472 obras con sus 2.567 fotos, y —esto es lo nuevo— el avance de estado.
Antes SIGOV entraba por un `obras_SMT.xlsx` que alguien exportaba a mano: una
obra cargada como programada se quedaba programada para siempre. Ahora una que
pasa a EJECUTADA aparece terminada en CIMBA en la vuelta siguiente.

Dos cosas para tener presentes al mirar los números:

- **SIGOV no son baches.** La obra mediana son 172 m² —paños de hormigón,
  tramos de asfalto— contra los 4 m² del bache promedio de las empresas. Sumar
  las dos cosas en un mismo total hace que SIGOV se coma el número. Por eso lo
  que sale de esta fuente queda marcado con `metadata.escala = "obra"`.
- **97 obras están marcadas por SIGOV como posible duplicado**, y 80 de ellas
  siguen vivas: unos 7.300 m². Es una marca automática que nadie resolvió
  todavía. CIMBA las carga con la marca puesta y no decide por SIGOV; hay que
  revisarlas allá.

## Cómo arrancarlo

```
pnpm runner
```

Para probar sin dejarlo corriendo:

```
pnpm runner --una-vez
```

Necesita el `.env` de la raíz con `DATABASE_URL`. Lo lee solo; no hace falta
exportar nada a mano.

## Dejarlo prendido en Windows

Es un proceso de larga duración con su propio reloj, **no** una tarea que se
dispara cada 15 minutos. La diferencia importa: con Task Scheduler disparando
seguido, dos corridas se pisan cuando una tarda más de lo previsto, y ese es el
modo de falla típico. Acá hay un solo proceso y no puede solaparse consigo mismo.

Para que sobreviva a un reinicio, registralo con disparador **al iniciar el
equipo** (no "al iniciar sesión", que exige que alguien loguee):

```powershell
$accion = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" `
  -Argument "node_modules\tsx\dist\cli.mjs packages\integrations\src\cli\runner.ts" `
  -WorkingDirectory "C:\Users\MRossi-DIA\Desktop\CIMBA\cimba"
$disparador = New-ScheduledTaskTrigger -AtStartup
$opciones = New-ScheduledTaskSettingsSet -RestartInterval (New-TimeSpan -Minutes 5) `
  -RestartCount 999 -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "CIMBA enlace" -Action $accion -Trigger $disparador `
  -Settings $opciones -RunLevel Highest
```

`ExecutionTimeLimit` en cero es importante: sin eso Windows lo mata a las 72
horas. `RestartCount` alto hace que vuelva solo si se cae.

## Cómo saber si está vivo

El enlace escribe una línea `sigo vivo` cada hora, y registra cada
sincronización con novedades en la tabla `sync_runs`. Ojo con el matiz: una
corrida **sin** novedades no escribe nada, así que la falta de filas nuevas no
distingue "no cambió nada" de "el enlace está muerto". Para eso está la línea
del log.

```sql
select sistema, max(iniciado_en) ultima
from sync_runs
where sistema in ('bacheo_empresas', 'sigov')
group by 1;
```

## Lo que hay que decidir y no es técnico

Esa máquina pasa a ser infraestructura del sistema. Antes de depender de ella
hay que definir tres cosas:

- **Cuál es la máquina** y quién se asegura de que quede prendida.
- **Quién recibe el aviso** cuando deja de sincronizar. Hoy no avisa a nadie:
  hay que mirar `sync_runs`. Es lo próximo a construir.
- **Qué pasa con las actualizaciones de Windows** que reinician sola la máquina
  a la madrugada. Con el disparador "al iniciar el equipo" vuelve solo, pero
  conviene verificarlo una vez en la práctica.

La alternativa a todo esto es que Soporte habilite un túnel de salida, y ahí el
enlace puede correr en cualquier lado o desaparecer. Mientras tanto, esto
funciona y no depende de nadie.
