#!/bin/sh
# Arranca el planificador (cron de Alpine) con las tareas de Nodus.
# La hora es la de México (TZ=America/Mexico_City en docker-compose.yml).
set -e

apk add --no-cache curl tzdata >/dev/null

# El planificador arranca las tareas con un entorno limpio: el secreto se deja en un archivo
# que solo este contenedor puede leer.
printf '%s' "$CRON_SECRET" > /run/cron-secret
chmod 600 /run/cron-secret

# minuto hora día mes día-de-semana  comando
cat > /etc/crontabs/root <<'EOF'
# Cobro diario: facturas del mes, cobro automático con tarjeta, SPEI, recordatorios y recargos.
0 7 * * * /bin/sh /llamar.sh facturacion-diaria
# Recordatorio por correo de los tours del día siguiente.
0 18 * * * /bin/sh /llamar.sh recordatorio-tours
EOF

echo "[cron] listo: $(date)"
exec crond -f -l 8
