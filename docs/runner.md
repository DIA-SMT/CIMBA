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
| *(pendiente)* SIGOV Obras Viales, MySQL | — | **Sí** |
| *(pendiente)* Bachía, MySQL | — | **Sí** |

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
sincronización con novedades en la tabla `sync_runs`. Si pasan varias horas sin
una corrida nueva de `bacheo_empresas`, se cayó.

```sql
select sistema, iniciado_en, insertados, actualizados, detalle
from sync_runs
where sistema = 'bacheo_empresas'
order by id desc limit 5;
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
