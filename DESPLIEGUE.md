# Guía de despliegue de Nodus (producción con Docker)

Esta guía lleva a Nodus de tu computadora a un servidor en internet, con dominio propio, HTTPS y las tareas automáticas (cobro diario). Está pensada para seguirse paso a paso, sin ser experto.

> **Aviso honesto:** el paquete (Dockerfile, docker-compose, Caddy, cron) se preparó y revisó pero **la imagen de Docker no se pudo probar en la PC de desarrollo** (no tiene Docker). La primera vez que se construya en el servidor será su prueba real. Si algo falla, el mensaje del error suele decir qué es; la sección "Problemas comunes" cubre los más probables.

---

## 1. Qué se va a montar

```
Internet ──► Caddy (HTTPS, puertos 80/443) ──► app (Nodus, con LibreOffice)
                                                  ▲
                        cron (llama cada día) ────┘
Base de datos, usuarios y archivos ──► Supabase (en la nube, aparte)
```

- **app**: Nodus corriendo en un contenedor. Trae LibreOffice para convertir las cotizaciones de PowerPoint a PDF.
- **caddy**: recibe las visitas, saca y renueva **solo** el certificado HTTPS y se las pasa a la app. Es lo único abierto a internet.
- **cron**: cada día llama al cobro diario (7:00 am, hora de México) y a los recordatorios de tours (6:00 pm).
- **Supabase** (base de datos, cuentas y archivos) **no** vive en el servidor: sigue en su nube.

El servidor no guarda datos importantes: si se pierde, se levanta otro igual con esta guía y no se pierde información.

## 2. Antes de empezar (lista de pendientes tuyos)

| Qué | Para qué |
|---|---|
| Dominio comprado (ej. `app.nodusbc.mx`) | Dirección de la aplicación |
| Servidor (VPS) con Ubuntu 22.04 o 24.04, 2 CPU y 4 GB de RAM | Donde corre todo (Hetzner, DigitalOcean o similar) |
| Supabase en plan **Pro** | Respaldos diarios y sin pausas |
| Cuenta de **Resend** con el dominio verificado | Correos (SPF y DKIM) |
| Cuenta de **Openpay** de producción aprobada | Cobros reales (llaves de producción) |
| Todo a nombre de la **empresa**, no de una persona | Que no dependa de nadie |

## 3. Apuntar el dominio al servidor

En el panel donde compraste el dominio, crea un registro **DNS tipo A**:

- Nombre: `app` (o el que uses)  → Valor: la **IP pública del servidor**.
- Si quieres que `www.` también funcione, otro registro A o CNAME hacia el mismo destino.

Puede tardar de minutos a unas horas. Se revisa con `nslookup app.nodusbc.mx` (debe responder la IP del servidor). **Caddy no puede sacar el certificado HTTPS hasta que esto funcione.**

## 4. Preparar el servidor (una sola vez)

1. Entra por SSH: `ssh root@IP-DEL-SERVIDOR`. Conviene entrar con **llave SSH** y desactivar la contraseña.
2. Baja el proyecto:
   ```bash
   apt-get update && apt-get install -y git
   git clone https://github.com/edgarg27/nodus-app.git /opt/nodus
   cd /opt/nodus
   ```
   Si el repositorio es privado, usa una *deploy key* de solo lectura (GitHub → Settings → Deploy keys) o un token de acceso.
3. Prepara el servidor (firewall, Docker, seguridad):
   ```bash
   sudo bash deploy/instalar-servidor.sh
   ```
   Deja abiertos únicamente los puertos 22 (SSH), 80 y 443.

## 5. Llenar la configuración (`.env`)

```bash
cd /opt/nodus
cp .env.production.example .env
nano .env            # llena cada valor (el archivo trae comentarios de cada uno)
chmod 600 .env       # que solo el dueño pueda leerlo
```

Puntos importantes:

- `DOMINIO` va **sin** `https://`; `NEXT_PUBLIC_SITE_URL` va **con** `https://` y sin diagonal al final.
- `CRON_SECRET`: genera uno con `openssl rand -hex 32`.
- Openpay: usa las llaves de **producción** y `OPENPAY_API_URL=https://api.openpay.mx/v1`, `NEXT_PUBLIC_OPENPAY_SANDBOX=false`.
- `SUPABASE_SERVICE_ROLE_KEY` es **secreta** y solo debe estar en este archivo.
- **Nunca** pegues este archivo en chats, correos ni lo subas a git.

## 6. Levantar la aplicación

```bash
cd /opt/nodus
docker compose up -d --build
```

La primera vez tarda varios minutos (descarga imágenes, instala dependencias, construye la app e instala LibreOffice). Después:

```bash
docker compose ps                      # los 3 servicios deben estar "running" (app: "healthy")
docker compose logs -f app             # registros de la app (Ctrl+C para salir)
curl -fsS https://TU-DOMINIO/api/health   # debe responder {"ok":true}
```

Abre `https://TU-DOMINIO` en el navegador: debe cargar el login con candado de HTTPS.

## 7. Configurar los servicios externos

### Supabase
1. **Authentication → URL Configuration**:
   - *Site URL*: `https://TU-DOMINIO`
   - *Redirect URLs*: `https://TU-DOMINIO/**`
   (sin esto, los correos de invitación y de recuperar contraseña mandan a la dirección equivocada).
2. **Archivos privados**: ya con la app en producción, corre `migracion_buckets_privados.sql` en el SQL Editor. Después verifica que un contrato, un comprobante y una foto de ticket se sigan abriendo (la app ya usa enlaces firmados).
3. Confirma que todos los `migracion_*.sql` que se han usado en pruebas estén aplicados en el proyecto que uses en producción.
4. Limpia los **datos de prueba** (clientes, contratos, pagos y reservaciones de prueba) antes de abrir a clientes reales.

### Openpay
1. En el panel de Openpay → Webhooks, agrega: `https://TU-DOMINIO/api/webhooks/openpay` (eventos de cargos).
2. Haz un pago real pequeño con tu propia tarjeta para confirmar el ciclo completo (cobro, factura pagada, correo de gracias).
3. Confirma con Openpay cómo prefieren manejar los **cobros recurrentes** (el cobro automático manda una huella antifraude generada por el servidor).

### Resend
Verifica el dominio del remitente (`EMAIL_FROM`) con los registros SPF y DKIM que te indique. Sin eso, los correos caen en spam o no salen.

### UniFi (WiFi de Bosques)
El servidor en la nube **no ve la red de la oficina** (el controlador está en una dirección interna). Opciones:
- Instalar **Tailscale** (gratis) en el servidor y en una computadora de la oficina configurada como "subnet router", y poner en `UNIFI_BOSQUES_HOST` la dirección por la que el servidor llega al controlador.
- O posponer los vouchers reales de WiFi: la app sigue funcionando y solo registra el error al generar el voucher.
Esto lo debe definir quien administra la red de la oficina.

## 8. Tareas automáticas (cobro diario)

El contenedor `cron` llama solo a las tareas a las horas de México. Para ver que corren:

```bash
docker compose logs cron                 # cada llamada deja una línea con su resultado (HTTP 200)
```

⚠️ **No las corras a mano "para probar" en producción**: el cobro diario genera facturas reales, intenta cobrar tarjetas guardadas y manda correos a clientes.

Revisa con cuidado el **primer ciclo** (día 1 al 10 del mes): que se generen las facturas, que el cobro automático funcione o caiga al SPEI de respaldo, y que lleguen los correos.

## 9. Monitoreo

- **UptimeRobot** (gratis): monitor tipo HTTP a `https://TU-DOMINIO/api/health` cada 5 minutos, con aviso por correo o WhatsApp si se cae.
- **Sentry** (gratis) opcional para registrar errores.
- Espacio en disco y memoria: `df -h` y `docker stats --no-stream`.

## 10. Actualizar y volver atrás

Cada vez que haya cambios en `main`:

```bash
cd /opt/nodus
bash deploy/actualizar.sh
```

Construye la nueva versión y solo entonces reemplaza la vieja. Para **volver a la versión anterior**:

```bash
git checkout $(cat .version-anterior)
docker compose up -d --build
```

## 11. Respaldos

- **Base de datos y archivos**: Supabase Pro hace respaldos diarios. Es lo que importa.
- **Servidor**: no guarda datos propios. Activa las *snapshots* del proveedor (cuestan poco) para levantarlo rápido si hiciera falta.
- Guarda una copia de tu `.env` en un gestor de contraseñas de la empresa.

## 12. Seguridad (revisión antes de abrir al público)

- [ ] Solo SSH con llave; contraseña desactivada. Firewall activo (`sudo ufw status`).
- [ ] `.env` con permisos `600` y sin copias sueltas.
- [ ] Llaves de **producción** de Openpay (las de pruebas que se compartieron en chats ya no sirven en producción; cámbialas si alguna vez se pegaron en algún lugar público).
- [ ] Contraseñas de las cuentas de prueba (admin, cliente) **cambiadas o eliminadas**.
- [ ] Buckets `contratos` y `comprobantes` privados.
- [ ] Aviso de Privacidad y Términos y Condiciones publicados (con el texto de cobro automático revisado por un abogado).
- [ ] Datos de prueba borrados.

## 13. Problemas comunes

| Síntoma | Qué revisar |
|---|---|
| Caddy no saca el certificado | El dominio no apunta a la IP del servidor todavía, o los puertos 80/443 están cerrados. `docker compose logs caddy` |
| `docker compose build` falla en `npm run build` | Lee el error: suele ser una variable `NEXT_PUBLIC_*` vacía en `.env` o un error de TypeScript |
| La app arranca pero el login falla | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` mal, o falta el Site URL en Supabase |
| El PDF de la cotización no se genera | `docker compose exec app soffice --version` para confirmar LibreOffice; si el PDF sale con letras raras, faltan las tipografías de la plantilla: agrégalas al `Dockerfile` (`apt-get install fonts-...`) |
| El cron responde 401 | `CRON_SECRET` distinto entre `.env` y lo que usa el contenedor; reinicia con `docker compose up -d` |
| Los pagos con tarjeta no regresan del banco | Falta `NEXT_PUBLIC_SITE_URL` o la URL del webhook en Openpay |
| Cambié `.env` y no pasa nada | Las variables `NEXT_PUBLIC_*` se hornean al construir: `docker compose up -d --build`; las demás, `docker compose up -d` |

## 14. Lista de prueba el primer día

1. Abrir `https://TU-DOMINIO` con candado y entrar con la cuenta de administrador.
2. Crear una reservación de prueba y confirmarla.
3. Generar una cotización de Sala de Juntas y comprobar que el PDF se genera.
4. Recuperar contraseña: el correo llega y su liga abre la pantalla correcta.
5. Pago real pequeño con tarjeta; factura pagada y correo de gracias.
6. Subir un comprobante y abrirlo (archivos privados con enlace firmado).
7. Al día siguiente: `docker compose logs cron` muestra el cobro diario con HTTP 200.
