#!/bin/bash
# Actualiza Nodus en el servidor a lo último de la rama main.
# Desde la carpeta del proyecto:   bash deploy/actualizar.sh
# Si algo sale mal, la versión anterior sigue funcionando hasta que la nueva termine de
# construirse (docker compose no toca el contenedor viejo si la construcción falla).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Guardando la versión actual por si hay que volver atrás"
git rev-parse --short HEAD > .version-anterior || true

echo "==> Bajando lo nuevo"
git pull --ff-only origin main

echo "==> Construyendo y reiniciando"
docker compose build app
docker compose up -d

echo "==> Limpiando imágenes viejas"
docker image prune -f >/dev/null

echo "==> Estado"
docker compose ps
echo
echo "Listo. Revisa que responda: curl -fsS https://\$(grep ^DOMINIO= .env | cut -d= -f2)/api/health"
echo "Para volver a la versión anterior: git checkout \$(cat .version-anterior) && docker compose up -d --build"
