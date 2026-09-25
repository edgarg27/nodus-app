#!/bin/sh
# Llama a una tarea programada de la app y deja el resultado en el registro del
# contenedor (docker compose logs cron). Uso: llamar.sh <nombre-de-la-tarea>
TAREA="$1"
CRON_SECRET="${CRON_SECRET:-$(cat /run/cron-secret 2>/dev/null)}"
[ -n "$TAREA" ] || { echo "[cron] falta el nombre de la tarea"; exit 1; }

RESPUESTA=$(curl -sS -m 300 -w '\nHTTP %{http_code}' -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "http://app:8080/api/cron/${TAREA}" 2>&1)

# Se escribe en la salida principal del contenedor para verlo con: docker compose logs cron
echo "[cron] $(date '+%F %T') ${TAREA}: ${RESPUESTA}" > /proc/1/fd/1
