import type { NextRequest } from "next/server";

// req.nextUrl.origin refleja la petición tal como la ve el proceso de
// Next.js detrás de Caddy dentro del contenedor (ej. http://0.0.0.0:8080),
// no el dominio público real — por eso se usa NEXT_PUBLIC_SITE_URL cuando
// está configurada (siempre en producción; en local no existe y cae al
// origin de la petición, que ahí sí es el correcto: http://localhost:8080).
export function origenPublico(req: NextRequest) {
  return process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin;
}
