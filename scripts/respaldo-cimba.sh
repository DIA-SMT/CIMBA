#!/bin/bash
#
# El respaldo diario de los datos de CIMBA.
#
# POR QUÉ ES DE DATOS Y NO DE TODO: la estructura de la base —las tablas, los
# índices, las funciones, las políticas— ya está versionada en
# supabase/migrations, así que se reconstruye entera desde git. Lo único que no
# existe en ningún otro lado son los datos: los reclamos de los vecinos, las
# órdenes, las actas. Eso es lo que esto copia.
#
# POR QUÉ CON psql Y NO CON pg_dump: la base es PostgreSQL 17 y el servidor
# donde corre esto tiene las herramientas de la 16. pg_dump se niega a volcar
# una versión más nueva; psql conecta igual. Copiar tabla por tabla con COPY es
# el formato propio de Postgres — se encarga él de las geometrías, los jsonb y
# los escapes— así que se restaura con COPY sin ninguna conversión.
#
# POR QUÉ EN ESTE SERVIDOR: son datos personales de vecinos. Guardarlos acá los
# deja bajo control del municipio, en vez de en un servicio de afuera.
#
# RESTAURAR (ver también el final de este archivo):
#   1. Crear la base y correr las migraciones:  pnpm db:migrar
#   2. Descomprimir el respaldo y cargar cada tabla con COPY ... FROM
#
set -uo pipefail

DESTINO=/srv/respaldos/cimba
CONEXION=/srv/respaldos/cimba.url     # 600, solo root. Puerto 5432 (sesión).
CONSERVAR=14                          # cuántas copias diarias se guardan
MINIMO_BYTES=1000000                  # 1 MB: por debajo de eso algo salió mal

marca=$(date +%Y%m%d-%H%M)
registro="$DESTINO/respaldo.log"
mkdir -p "$DESTINO"

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

[ -r "$CONEXION" ] || fallar "no puedo leer $CONEXION"
URL=$(cat "$CONEXION")

trabajo=$(mktemp -d)
trap 'rm -rf "$trabajo"' EXIT

decir "empieza el respaldo $marca"

# Las tablas del esquema public. Se listan en cada corrida y no se fija una
# lista acá a propósito: una tabla nueva entra sola en el respaldo. Una lista
# escrita a mano es una tabla que un día nadie copia y nadie se entera.
psql "$URL" -Atc \
  "select tablename from pg_tables where schemaname='public' order by tablename" \
  > "$trabajo/tablas.txt" 2>>"$registro" || fallar "no pude listar las tablas"

total=$(wc -l < "$trabajo/tablas.txt")
[ "$total" -gt 0 ] || fallar "la lista de tablas vino vacía"
decir "$total tablas para copiar"

mkdir -p "$trabajo/datos"
: > "$trabajo/manifiesto.txt"
echo "respaldo: $marca" >> "$trabajo/manifiesto.txt"
echo "origen:   $(psql "$URL" -Atc 'select version()' 2>/dev/null | cut -c1-40)" >> "$trabajo/manifiesto.txt"
echo "" >> "$trabajo/manifiesto.txt"

while read -r tabla; do
  [ -n "$tabla" ] || continue
  if ! psql "$URL" -Atc "\copy (select * from public.\"$tabla\") to stdout" \
       2>>"$registro" | gzip -c > "$trabajo/datos/$tabla.tsv.gz"; then
    fallar "no pude copiar la tabla $tabla"
  fi
  # El conteo de filas va al manifiesto: es lo que permite comparar una copia
  # con la anterior y notar que una tabla se vació sin que nadie lo dijera.
  filas=$(gzip -dc "$trabajo/datos/$tabla.tsv.gz" | wc -l)
  printf '%-34s %10d filas\n' "$tabla" "$filas" >> "$trabajo/manifiesto.txt"
done < "$trabajo/tablas.txt"

copiadas=$(ls -1 "$trabajo/datos" | wc -l)
[ "$copiadas" -eq "$total" ] || fallar "se copiaron $copiadas de $total tablas"

# Qué migraciones estaban aplicadas: sin esto, quien restaure no sabe contra
# qué versión del esquema cargar los datos.
psql "$URL" -Atc "select nombre from cimba_migraciones order by nombre" \
  > "$trabajo/migraciones-aplicadas.txt" 2>/dev/null

archivo="$DESTINO/cimba-$marca.tar.gz"
tar czf "$archivo" -C "$trabajo" datos manifiesto.txt migraciones-aplicadas.txt tablas.txt \
  || fallar "no pude armar el archivo"

tamano=$(stat -c%s "$archivo")
[ "$tamano" -ge "$MINIMO_BYTES" ] || fallar "el archivo quedó en $tamano bytes, sospechosamente chico"

# Se guarda el manifiesto suelto también: permite ver qué hay adentro sin
# descomprimir 100 MB.
cp "$trabajo/manifiesto.txt" "$DESTINO/cimba-$marca.manifiesto.txt"

# Retención: se borran las más viejas, nunca la última.
ls -1t "$DESTINO"/cimba-*.tar.gz 2>/dev/null | tail -n +$((CONSERVAR + 1)) | while read -r viejo; do
  decir "borro copia vieja: $(basename "$viejo")"
  rm -f "$viejo" "${viejo%.tar.gz}.manifiesto.txt"
done

decir "listo: $(basename "$archivo") — $(du -h "$archivo" | cut -f1), $total tablas"
echo "ok $(date +%F\ %T) $(basename "$archivo") $total tablas $(du -h "$archivo" | cut -f1)" > "$DESTINO/estado"

# ── Cómo se restaura ─────────────────────────────────────────────────────────
#
#   tar xzf cimba-AAAAMMDD-HHMM.tar.gz -C /tmp/restaurar
#   cat /tmp/restaurar/migraciones-aplicadas.txt   # contra qué esquema es
#
#   # con la base ya migrada a esa altura:
#   for f in /tmp/restaurar/datos/*.tsv.gz; do
#     t=$(basename "$f" .tsv.gz)
#     gzip -dc "$f" | psql "$URL" -c "\copy public.\"$t\" from stdin"
#   done
#
# El orden importa si hay claves foráneas: conviene cargar con las
# restricciones diferidas, o restaurar en el orden en que las migraciones
# crearon las tablas. Para una restauración completa y ordenada, lo más simple
# es crear la base vacía, correr las migraciones y cargar en ese orden.
