#!/bin/bash
# Prepara un servidor Ubuntu 22.04 / 24.04 NUEVO para correr Nodus con Docker.
# Se corre UNA vez, como root:   sudo bash instalar-servidor.sh
# Hace: actualizaciones, firewall (solo SSH, 80 y 443), Docker, protección contra
# intentos de acceso (fail2ban) y actualizaciones de seguridad automáticas.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Corre este script como root: sudo bash instalar-servidor.sh"
  exit 1
fi

echo "==> Actualizando el sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo "==> Instalando herramientas"
apt-get install -y ca-certificates curl git ufw fail2ban unattended-upgrades

echo "==> Firewall: solo SSH (22), HTTP (80) y HTTPS (443)"
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> Instalando Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> Zona horaria de México (para los registros del servidor)"
timedatectl set-timezone America/Mexico_City || true

echo "==> Actualizaciones de seguridad automáticas y fail2ban"
dpkg-reconfigure -f noninteractive unattended-upgrades || true
systemctl enable --now fail2ban

echo
echo "Listo. Siguiente paso: clonar el repositorio, crear el archivo .env y correr:"
echo "  docker compose up -d --build"
echo "(la guía completa está en DESPLIEGUE.md)"
