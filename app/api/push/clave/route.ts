import { NextResponse } from "next/server";

// Llave pública VAPID: el navegador la necesita para suscribirse a los avisos. Es pública por
// diseño (la privada nunca sale del servidor). Vacía = los avisos al celular no están activados.
export async function GET() {
  return NextResponse.json({ clave: process.env.VAPID_PUBLIC_KEY || null });
}
