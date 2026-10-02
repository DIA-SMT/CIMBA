# El bot de Telegram

El canal de CIMBA en el teléfono: se le pregunta por el estado del bacheo, llegan
los avisos y se resuelven baches propuestos y órdenes con botones.

**Este código no corre acá.** Vive en una VPS de la Dirección, adentro de una
plataforma de bots con PM2 que es de otro proyecto, y depende de `@bots/core`, que
es de esa plataforma. Está en este repositorio por una sola razón, y es
suficiente: **para que exista en algún lado versionado.**

El 25-09-2026 el script de despliegue de esa plataforma borró `src/` entero del
servidor. El proceso siguió andando porque Node ya tenía el código en memoria,
pero cualquier reinicio lo habría dejado caído y sin forma de levantar: no había
copia en el servidor, ni respaldo, ni el archivo abierto. Se recuperó de una copia
que existía por casualidad. Esto es para que no dependa de la casualidad.

## Qué es cada archivo

| Archivo | Qué hace |
|---|---|
| `src/index.ts` | El ciclo de vida, los comandos y los botones. Es el único que arranca algo. |
| `src/cimba.ts` | El cliente contra CIMBA: las llamadas a las puertas del bot. |
| `src/propuestos.ts` | Baches propuestos: la tarjeta, los botones, la bandeja. |
| `src/ordenes.ts` | Cerrar y reasignar una orden. |
| `src/formato.ts` | Del Markdown que escribe el modelo al HTML que entiende Telegram. |
| `src/partir.ts` | Partir mensajes de más de 4096 caracteres. |
| `src/conversacion.ts` | El hilo de cada chat, en memoria y descartable. |

## Dónde corre

- Servidor: alias SSH `cimba-vps` (clave en `~/.ssh/cimba_vps`).
- Carpeta: `/srv/bots/bots/cimba/`.
- Secretos: `/srv/bots/.secrets/cimba.env`, con un symlink desde `.env` en la
  carpeta del bot. Tres variables: `TELEGRAM_BOT_TOKEN`, `CIMBA_URL`,
  `CIMBA_BOT_SECRET`.
- Proceso: PM2, con el nombre `cimba`.

Conviven ahí tres procesos de otro proyecto (`migue-ambiente`, `migue-worker`,
`migue-panel`). **No se los toca.**

## Desplegar o restaurar

Desde la raíz de este repositorio:

```bash
cd bot-telegram && tar czf - src package.json tsconfig.json \
  | ssh cimba-vps 'tar xzf - -C /srv/bots/bots/cimba \
      && chown -R bots:bots /srv/bots/bots/cimba'
```

Y para que tome el código nuevo, **solo ese proceso**:

```bash
ssh cimba-vps 'su - bots -c "pm2 restart cimba --update-env"'
```

Nunca `pnpm bots:start` ni `bots:reload` en esa VPS: actúan sobre los cuatro
procesos, incluidos los tres del otro proyecto.

Para comprobar que quedó bien:

```bash
ssh cimba-vps 'su - bots -c "pm2 logs cimba --lines 5 --nostream --raw"'
```

Tiene que decir `escuchando` con el usuario `@Cimba_smt_bot`.

## Las dos puertas del lado de CIMBA

El bot no toca la base: le habla a CIMBA por HTTP y actúa con los permisos de
quien escribe. Las rutas están en `apps/web/src/app/api/auth/telegram/`:

- `route.ts` — preguntar (las herramientas del asistente, todas de lectura)
- `propuesto/route.ts` — validar o rechazar un bache propuesto
- `pendientes/route.ts` — la bandeja
- `orden/route.ts` — cerrar o reasignar una orden

Todas exigen el secreto compartido, traducen el chat a una persona
(`telegram_vinculos`) y chequean el rol con `exigirRol`.
