#!/bin/bash
#
# poner-clave-respaldo-cimba: conecta el respaldo de CIMBA con Backblaze B2.
#
# Se corre UNA vez, como root, en el servidor:
#   poner-clave-respaldo-cimba
#
# Pide la keyID y la applicationKey de Backblaze (la segunda sin mostrarla:
# las claves nunca van en la línea de comando, donde las ven otros usuarios),
# genera la contraseña del cifrado, prueba que Backblaze acepte la clave y
# recién ahí guarda todo. Desde la próxima corrida, respaldo-cimba sube cada
# copia CIFRADA: en Backblaze solo hay archivos ilegibles, así que los datos
# personales de los vecinos no salen del municipio en claro.
#
# Mismo esquema que el respaldo de Estudia en este servidor, con su propio
# bucket (el de Estudia no se toca).
#
# ANTES, en Backblaze (lo hace quien tiene la cuenta):
#   1. Un bucket privado llamado smt-cimba-respaldos-2026, con Object Lock
#      (30 días). SIN regla de borrado por antigüedad (Estudia tiene una de 90
#      días): acá las fotos se suben una sola vez, y esa regla las borraría de
#      la copia a los 90 días. Ocupa poco: ~10 MB por día de base más las fotos
#      nuevas. Si el bucket se llama distinto: B2_BUCKET=nombre poner-clave-respaldo-cimba
#   2. Una Application Key con acceso SOLO a ese bucket (lectura y escritura).
#
# LA CONTRASEÑA DEL CIFRADO se muestra una vez al final y queda en
# /root/.clave-respaldo-cimba. Hay que guardarla FUERA del servidor (gestor de
# contraseñas): si se pierde el servidor y no está, las copias no se abren.
#
set -euo pipefail
umask 077

B=${B2_BUCKET:-smt-cimba-respaldos-2026}
C=/srv/respaldos/cimba-rclone.conf
CLAVE=/root/.clave-respaldo-cimba
RCLONE=/usr/local/bin/rclone

[ "$(id -u)" -eq 0 ] || { echo "Se corre como root."; exit 1; }
[ -x "$RCLONE" ] || { echo "Falta rclone en $RCLONE."; exit 1; }

pedir() { local v; read -rs -p "$1: " v; echo >&2; printf '%s' "$v"; }
pedir_visible() { local v; read -r -p "$1: " v; printf '%s' "$v"; }

echo "Bucket de Backblaze: $B"
ID=$(pedir_visible "keyID")
K=$(pedir "applicationKey (no se ve al escribir)")
[ -n "$ID" ] && [ -n "$K" ] || { echo "Faltan datos: no guardé nada."; exit 1; }
echo "Recibí la applicationKey (${#K} caracteres)."

# La contraseña del cifrado se genera una sola vez: si ya existe, se reusa.
# Cambiarla haría ilegibles las copias que ya están subidas.
if [ ! -f "$CLAVE" ]; then
  printf "%s\n%s\n" \
    "$(openssl rand -base64 33 | tr -d /+= | cut -c1-40)" \
    "$(openssl rand -base64 33 | tr -d /+= | cut -c1-40)" > "$CLAVE"
fi
O1=$(sed -n 1p "$CLAVE" | "$RCLONE" obscure -)
O2=$(sed -n 2p "$CLAVE" | "$RCLONE" obscure -)

{
  echo "[b2]"
  echo "type = b2"
  echo "account = $ID"
  echo "key = $K"
  echo "hard_delete = false"
  echo
  echo "[respaldos-cimba]"
  echo "type = crypt"
  echo "remote = b2:$B/cimba"
  echo "password = $O1"
  echo "password2 = $O2"
  echo "filename_encryption = standard"
  echo "directory_name_encryption = true"
} > "$C.nuevo"

if "$RCLONE" --config "$C.nuevo" lsf "b2:$B" > /dev/null 2> /tmp/b2-error.$$; then
  mv "$C.nuevo" "$C"
  rm -f /tmp/b2-error.$$
  echo "Backblaze la acepta (ve el bucket $B). Guardada."
  echo
  echo "IMPORTANTE: guardá estos dos renglones FUERA del servidor (gestor de contraseñas)."
  echo "Sin ellos, si se pierde el servidor, las copias de Backblaze no se pueden abrir:"
  echo
  cat "$CLAVE"
  echo
  echo "La próxima corrida de respaldo-cimba (6:30) ya sube la copia cifrada."
else
  echo "Backblaze no la acepta:"
  head -3 /tmp/b2-error.$$ | sed -E 's/(key|account)[^ ]*/\1 ****/g'
  rm -f /tmp/b2-error.$$ "$C.nuevo"
  echo "No guardé nada. Revisá la keyID, la applicationKey y que el bucket $B exista."
  exit 1
fi
