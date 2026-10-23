#!/bin/bash
#
# El respaldo diario de CIMBA, en el servidor propio.
#
# QUÉ COPIA
#   · la base "cimba" del Postgres local, entera (estructura y datos), con
#     pg_dump en su formato propio: se restaura con pg_restore;
#   · las fotos que suben las cuadrillas y el portal (CIMBA_FOTOS_DIR), que no
#     viven en la base sino en archivos;
#   · la configuración del servidor que no está en git (.env, pm2, cron, nginx).
# Y sube todo, cifrado, a Backblaze (paso 5), una vez configurado con
# poner-clave-respaldo-cimba.
#
# POR QUÉ CAMBIÓ (23/10/2026): hasta ese día esto copiaba, tabla por tabla, la
# base de Supabase, que quedó congelada el 15/10 con la mudanza al servidor
# propio. El registro decía "ok" todos los días y la base real no tenía ninguna
# copia: la del 22/10 tenía 3.409 pedidos y la real 3.461, y las fotos (664 MB)
# no entraban en ningún respaldo. Ahora la base es local y de la misma versión
# que las herramientas (16), así que pg_dump anda sin conectarse a ningún lado.
# Para que un error así se vea a simple vista, el estado dice cuántos pedidos
# tiene la copia y cuándo fue el último movimiento de la base copiada.
#
# LAS FOTOS: una carpeta por día, pero los archivos que no cambiaron se
# comparten con la carpeta del día anterior (rsync --link-dest), así que cada
# día ocupa solo lo nuevo. La app borra fotos de verdad en varios lugares
# (CLAUDE.md §4): con esto, una foto borrada sigue en las copias CONSERVAR días.
#
# Son datos personales de vecinos y claves del servidor: todo queda solo para
# root (umask 077).
#
# RESTAURAR (ver también el final de este archivo)
#   base:    sudo -u postgres createdb cimba
#            sudo -u postgres pg_restore -d cimba < cimba-AAAAMMDD-HHMM.dump
#   fotos:   rsync -a fotos/AAAAMMDD-HHMM/ /var/www/cimba/fotos/
#   config:  tar xzf config-AAAAMMDD-HHMM.tar.gz -C /
#
set -uo pipefail
umask 077
cd /   # el cron arranca en /root, donde el usuario postgres no puede entrar

DESTINO=/srv/respaldos/cimba
CONSERVAR=14                          # cuántas copias diarias se guardan
MINIMO_BYTES=1000000                  # 1 MB: por debajo de eso algo salió mal
FOTOS=$(grep -m1 -oP '^CIMBA_FOTOS_DIR=\K.*' /srv/cimba/app/.env 2>/dev/null || true)
FOTOS=${FOTOS:-/var/www/cimba/fotos}

marca=$(date +%Y%m%d-%H%M)
registro="$DESTINO/respaldo.log"
mkdir -p "$DESTINO/fotos"

decir() { echo "[$(date +'%F %T')] $*" | tee -a "$registro"; }

# El aviso por Telegram reusa el bot que ya existe. Si no se puede, no importa:
# el fallo igual queda en el registro y en el archivo de estado.
avisar() {
  local texto="$1" token chat
  token=$(grep -m1 '^TELEGRAM_BOT_TOKEN=' /srv/bots/.secrets/cimba.env 2>/dev/null | cut -d= -f2-)
  chat=$(cat "$DESTINO/avisar-a" 2>/dev/null)
  [ -n "$token" ] && [ -n "$chat" ] || return 0
  curl -s -m 15 -o /dev/null -X POST \
    "https://api.telegram.org/bot${token}/sendMessage" \
    -H 'content-type: application/json' \
    -d "$(printf '{"chat_id":"%s","text":%s}' "$chat" "$(printf '%s' "$texto" | sed 's/\\/\\\\/g;s/"/\\"/g;s/^/"/;s/$/"/')")" || true
}

fallar() {
  decir "FALLÓ: $1"
  echo "fallo $(date +%F\ %T): $1" > "$DESTINO/estado"
  avisar "⚠️ El respaldo de CIMBA falló: $1"
  exit 1
}

decir "empieza el respaldo $marca"

# ── 1. La base ───────────────────────────────────────────────────────────────
base="$DESTINO/cimba-$marca.dump"
sudo -u postgres pg_dump -Fc -d cimba > "$base" 2>>"$registro" || fallar "pg_dump no terminó"
tamano=$(stat -c%s "$base")
[ "$tamano" -ge "$MINIMO_BYTES" ] || fallar "la copia de la base quedó en $tamano bytes, sospechosamente chica"
# Que se pueda leer entera: mejor enterarse hoy que el día que haga falta.
pg_restore --list "$base" > /dev/null 2>>"$registro" || fallar "la copia de la base no se puede leer"
pedidos=$(sudo -u postgres psql -d cimba -Atc "select count(*) from demandas" 2>>"$registro") \
  || fallar "no pude contar los pedidos de la base"
ultimo=$(sudo -u postgres psql -d cimba -Atc \
  "select to_char(max(ocurrido_en) at time zone 'America/Argentina/Tucuman', 'YYYY-MM-DD HH24:MI') from auditoria" 2>/dev/null)
decir "base: $(basename "$base"), $(du -h "$base" | cut -f1), $pedidos pedidos, último movimiento $ultimo"

# ── 2. Las fotos ─────────────────────────────────────────────────────────────
[ -d "$FOTOS" ] || fallar "no encuentro la carpeta de fotos $FOTOS"
anterior=$(ls -1d "$DESTINO"/fotos/20* 2>/dev/null | tail -n 1)
rsync -a ${anterior:+--link-dest="$anterior"} "$FOTOS/" "$DESTINO/fotos/$marca/" 2>>"$registro"
r=$?
# 24 = algún archivo desapareció mientras se copiaba (lo borró la app): no es falla.
[ "$r" -eq 0 ] || [ "$r" -eq 24 ] || fallar "la copia de las fotos terminó con código $r"
originales=$(find "$FOTOS" -type f | wc -l)
copiadas=$(find "$DESTINO/fotos/$marca" -type f | wc -l)
[ "$copiadas" -ge "$originales" ] || [ "$r" -eq 24 ] || fallar "se copiaron $copiadas de $originales fotos"
decir "fotos: $copiadas archivos ($(du -sh "$FOTOS" | cut -f1) en la carpeta original)"

# ── 3. La configuración que no está en git ───────────────────────────────────
nginx=$(grep -l "cimba.smt.gob.ar" /etc/nginx/sites-enabled/* 2>/dev/null | head -n 1)
tar czf "$DESTINO/config-$marca.tar.gz" -C / \
  srv/cimba/app/.env srv/cimba/app/ecosystem.config.cjs srv/cimba/cron-cimba.sh \
  etc/cron.d/respaldo-cimba usr/local/bin/respaldo-cimba.sh ${nginx:+"${nginx#/}"} \
  2>>"$registro" || fallar "no pude guardar la configuración"

# ── 4. Retención: se borran las más viejas, nunca la última ──────────────────
ls -1t "$DESTINO"/cimba-*.dump 2>/dev/null | tail -n +$((CONSERVAR + 1)) | while read -r viejo; do
  decir "borro copia vieja: $(basename "$viejo")"
  rm -f "$viejo"
done
ls -1t "$DESTINO"/config-*.tar.gz 2>/dev/null | tail -n +$((CONSERVAR + 1)) | xargs -r rm -f
ls -1dt "$DESTINO"/fotos/20* 2>/dev/null | tail -n +$((CONSERVAR + 1)) | xargs -r rm -rf

# ── 5. La copia fuera del servidor (Backblaze, cifrada) ──────────────────────
# Si el servidor se pierde, las copias de acá se pierden con él. Se suben
# cifradas (rclone crypt): en Backblaze solo hay archivos ilegibles. La base y
# la configuración van con --immutable (nunca se pisa nada allá; además el
# bucket tiene Object Lock). Las fotos se copian sin borrar nada de allá: si la
# app borra una, la de Backblaze queda. Se configura una vez con
# poner-clave-respaldo-cimba; hasta entonces, esto no hace nada.
RCLONE=/usr/local/bin/rclone
RCONF=/srv/respaldos/cimba-rclone.conf
if [ -f "$RCONF" ] && [ -x "$RCLONE" ]; then
  if "$RCLONE" --config "$RCONF" copy --immutable --transfers 2 \
       --include "cimba-*.dump" --include "config-*.tar.gz" "$DESTINO" respaldos-cimba:base 2>>"$registro" \
     && "$RCLONE" --config "$RCONF" copy --transfers 4 "$FOTOS" respaldos-cimba:fotos 2>>"$registro"; then
    afuera="copia cifrada en Backblaze"
    decir "Backblaze: subido"
  else
    afuera="FALLÓ la subida a Backblaze"
    decir "Backblaze: falló la subida (la copia local está bien)"
    avisar "⚠️ El respaldo de CIMBA se hizo, pero no se pudo subir a Backblaze. Mirar $registro"
  fi
else
  afuera="sin copia fuera del servidor (falta poner-clave-respaldo-cimba)"
fi

decir "listo: $(basename "$base") — $pedidos pedidos, $copiadas fotos, $afuera"
echo "ok $(date +%F\ %T) $(basename "$base") $(du -h "$base" | cut -f1) · $pedidos pedidos · $copiadas fotos · último movimiento $ultimo · $afuera" > "$DESTINO/estado"

# ── Cómo se restaura ─────────────────────────────────────────────────────────
#
#   # la base, en una base vacía (estructura y datos vienen juntos). La copia
#   # es solo de root: se le pasa por la entrada estándar, porque pg_restore
#   # corre como postgres y no puede abrir el archivo (probado el 23/10: con el
#   # archivo como argumento restaura cero tablas).
#   sudo -u postgres createdb cimba
#   sudo -u postgres pg_restore -d cimba < /srv/respaldos/cimba/cimba-AAAAMMDD-HHMM.dump
#
#   # las fotos del día elegido:
#   rsync -a /srv/respaldos/cimba/fotos/AAAAMMDD-HHMM/ /var/www/cimba/fotos/
#
#   # la configuración (.env, pm2, cron, nginx), en sus lugares:
#   tar xzf /srv/respaldos/cimba/config-AAAAMMDD-HHMM.tar.gz -C /
#
# Las copias de antes del 23/10 (cimba-*.tar.gz con su manifiesto) son de la
# base de Supabase: hasta el 15/10 era la base real; después, una copia
# congelada. Se restauran como dice la versión vieja de este archivo en git.
