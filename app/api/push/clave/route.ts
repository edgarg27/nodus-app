import { NextResponse } from "next/server";

// Se lee en cada petición: sin esto Next lo calcula al construir la imagen (cuando la llave todavía no existe) y siempre responde vacío.
export const dynamic = "force-dynamic";

// Llave pública VAPID: el navegador la necesita para suscribirse a los avisos. Es pública por
// diseño (la privada nunca sale del servidor). Vacía = los avisos al celular no están activados.
export async function GET() {
  return NextResponse.json({ clave: process.env.VAPID_PUBLIC_KEY || null });
}
