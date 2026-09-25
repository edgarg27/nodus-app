# syntax=docker/dockerfile:1
#
# Imagen de producción de Nodus (Next.js). Tres etapas: instalar dependencias,
# construir la app y una imagen final pequeña que además trae LibreOffice, que se
# usa para convertir las cotizaciones de PowerPoint a PDF.
#
# Las variables NEXT_PUBLIC_* se "hornean" en la app al construirla, por eso entran
# como argumentos de construcción (docker-compose.yml las toma del archivo .env).
# Los secretos (llave de servicio de Supabase, Openpay, correo…) NO se hornean: entran
# solo al arrancar el contenedor.

FROM node:20-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1

# ---------- 1. Dependencias ----------
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- 2. Construcción ----------
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_OPENPAY_MERCHANT_ID
ARG NEXT_PUBLIC_OPENPAY_PUBLIC_KEY
ARG NEXT_PUBLIC_OPENPAY_SANDBOX=false
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_OPENPAY_MERCHANT_ID=$NEXT_PUBLIC_OPENPAY_MERCHANT_ID \
    NEXT_PUBLIC_OPENPAY_PUBLIC_KEY=$NEXT_PUBLIC_OPENPAY_PUBLIC_KEY \
    NEXT_PUBLIC_OPENPAY_SANDBOX=$NEXT_PUBLIC_OPENPAY_SANDBOX \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

RUN npm run build

# ---------- 3. Imagen final ----------
FROM base AS runner
WORKDIR /app

# LibreOffice (solo Impress) + tipografías para que los PDF de las cotizaciones se vean
# bien; curl para el chequeo de salud. La zona horaria importa: el cobro diario y los
# recordatorios calculan el "día de hoy" con la hora del servidor.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-impress libreoffice-core \
      fonts-liberation fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea \
      curl tzdata ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    TZ=America/Mexico_City \
    HOME=/home/nextjs

# Usuario sin privilegios (LibreOffice necesita una carpeta HOME donde escribir).
RUN groupadd --system --gid 1001 nextjs \
 && useradd --system --uid 1001 --gid nextjs --create-home --home-dir /home/nextjs nextjs

COPY --from=build --chown=nextjs:nextjs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nextjs /app/.next/static ./.next/static
# Las plantillas de contratos y cotizaciones se leen de public/ en tiempo de ejecución.
COPY --from=build --chown=nextjs:nextjs /app/public ./public

USER nextjs
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://localhost:8080/api/health || exit 1

CMD ["node", "server.js"]
