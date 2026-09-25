import { NextResponse } from "next/server";

// Chequeo de salud: lo usa Docker y el monitor de disponibilidad (UptimeRobot) para
// saber si la app responde. No toca la base de datos ni revela nada.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true });
}
