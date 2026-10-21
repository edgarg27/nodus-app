// Avisos push de la app móvil (Capacitor, carpeta mobile/): Android por Firebase Cloud Messaging (API HTTP v1) e
// iPhone directo por Apple (APNs). No usa librerías extra: firma los JWT con crypto de Node y habla HTTP/2 con Apple.
//
// Variables del servidor (.env):
//   Android → FIREBASE_SERVICE_ACCOUNT: el JSON de la cuenta de servicio de Firebase (tal cual o en base64).
//   iPhone  → APNS_KEY (contenido del archivo .p8, tal cual o en base64), APNS_KEY_ID, APNS_TEAM_ID,
//             APNS_BUNDLE_ID (mx.nodusbc.app) y APNS_PRODUCCION=1 para la app publicada (sin ella usa el sandbox).
// Si faltan, esa plataforma simplemente no se envía.

import { createSign, sign as firmar } from "crypto";
import { connect } from "http2";
import { createAdminClient } from "@/lib/supabaseAdmin";

type Admin = ReturnType<typeof createAdminClient>;
export type AvisoNativo = { title: string; body: string; url: string; tag?: string };

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function leerSecreto(valor: string | undefined) {
  if (!valor) return "";
  const t = valor.trim();
  if (t.startsWith("{") || t.startsWith("-----")) return t.replace(/\\n/g, "\n");
  try {
    return Buffer.from(t, "base64").toString("utf8");
  } catch {
    return t;
  }
}

// ---------- Firebase (Android) ----------
type CuentaServicio = { project_id: string; client_email: string; private_key: string };
let cuentaFirebase: CuentaServicio | null | undefined;
function cuenta(): CuentaServicio | null {
  if (cuentaFirebase !== undefined) return cuentaFirebase;
  try {
    const c = JSON.parse(leerSecreto(process.env.FIREBASE_SERVICE_ACCOUNT));
    cuentaFirebase = c?.project_id && c?.client_email && c?.private_key ? c : null;
  } catch {
    cuentaFirebase = null;
  }
  return cuentaFirebase;
}

let tokenGoogle: { valor: string; vence: number } | null = null;
async function accesoGoogle(c: CuentaServicio): Promise<string> {
  if (tokenGoogle && tokenGoogle.vence > Date.now() + 60_000) return tokenGoogle.valor;
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const cuerpo = b64url(
    JSON.stringify({
      iss: c.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: ahora,
      exp: ahora + 3600,
    })
  );
  const firma = createSign("RSA-SHA256").update(`${cabecera}.${cuerpo}`).sign(c.private_key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${cabecera}.${cuerpo}.${b64url(firma)}` }),
  });
  const d = await res.json();
  if (!res.ok || !d.access_token) throw new Error("Firebase: no se pudo obtener acceso (" + (d.error_description || d.error || res.status) + ")");
  tokenGoogle = { valor: d.access_token, vence: Date.now() + (Number(d.expires_in) || 3600) * 1000 };
  return tokenGoogle.valor;
}

// "ok" | "invalido" (el token ya no sirve: se borra) | "error"
async function enviarAndroid(token: string, aviso: AvisoNativo): Promise<"ok" | "invalido" | "error"> {
  const c = cuenta();
  if (!c) return "error";
  const acceso = await accesoGoogle(c);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${acceso}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: aviso.title, body: aviso.body },
        data: { url: aviso.url },
        android: { priority: "high", notification: { tag: aviso.tag, color: "#F07E3A" } },
      },
    }),
  });
  if (res.ok) return "ok";
  const d = await res.json().catch(() => ({}));
  const codigo = d?.error?.details?.find((x: { errorCode?: string }) => x.errorCode)?.errorCode || d?.error?.status;
  if (res.status === 404 || codigo === "UNREGISTERED" || codigo === "INVALID_ARGUMENT") return "invalido";
  console.error("[push nativo] Android:", res.status, codigo || d?.error?.message);
  return "error";
}

// ---------- Apple (iPhone) ----------
function datosApple() {
  const key = leerSecreto(process.env.APNS_KEY);
  const keyId = process.env.APNS_KEY_ID || "";
  const teamId = process.env.APNS_TEAM_ID || "";
  const bundle = process.env.APNS_BUNDLE_ID || "mx.nodusbc.app";
  return key && keyId && teamId ? { key, keyId, teamId, bundle, produccion: process.env.APNS_PRODUCCION === "1" } : null;
}

let tokenApple: { valor: string; creado: number } | null = null;
function jwtApple(a: NonNullable<ReturnType<typeof datosApple>>) {
  // Apple pide renovarlo entre 20 y 60 minutos.
  if (tokenApple && Date.now() - tokenApple.creado < 40 * 60 * 1000) return tokenApple.valor;
  const cabecera = b64url(JSON.stringify({ alg: "ES256", kid: a.keyId }));
  const cuerpo = b64url(JSON.stringify({ iss: a.teamId, iat: Math.floor(Date.now() / 1000) }));
  const firma = firmar("sha256", Buffer.from(`${cabecera}.${cuerpo}`), { key: a.key, dsaEncoding: "ieee-p1363" });
  tokenApple = { valor: `${cabecera}.${cuerpo}.${b64url(firma)}`, creado: Date.now() };
  return tokenApple.valor;
}

function enviarIos(token: string, aviso: AvisoNativo): Promise<"ok" | "invalido" | "error"> {
  const a = datosApple();
  if (!a) return Promise.resolve("error");
  return new Promise((resolver) => {
    const cliente = connect(a.produccion ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com");
    cliente.on("error", (e) => {
      console.error("[push nativo] iPhone:", e.message);
      resolver("error");
    });
    const peticion = cliente.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${jwtApple(a)}`,
      "apns-topic": a.bundle,
      "apns-push-type": "alert",
      "apns-priority": "10",
      ...(aviso.tag ? { "apns-collapse-id": aviso.tag.slice(0, 64) } : {}),
    });
    let estado = 0;
    let respuesta = "";
    peticion.on("response", (h) => (estado = Number(h[":status"])));
    peticion.on("data", (d) => (respuesta += d));
    peticion.on("end", () => {
      cliente.close();
      if (estado === 200) return resolver("ok");
      const razon = (() => {
        try {
          return JSON.parse(respuesta).reason as string;
        } catch {
          return "";
        }
      })();
      if (estado === 410 || razon === "BadDeviceToken" || razon === "Unregistered") return resolver("invalido");
      console.error("[push nativo] iPhone:", estado, razon);
      resolver("error");
    });
    peticion.end(JSON.stringify({ aps: { alert: { title: aviso.title, body: aviso.body }, sound: "default" }, url: aviso.url }));
  });
}

export function pushNativoConfigurado(): boolean {
  return !!cuenta() || !!datosApple();
}

// Manda el aviso a los celulares con la app de esas personas; los tokens que ya no sirven se borran.
export async function enviarPushNativo(admin: Admin, userIds: string[], aviso: AvisoNativo) {
  const resultado = { enviados: 0, fallidos: 0, borrados: 0 };
  if (!pushNativoConfigurado() || userIds.length === 0) return resultado;
  const { data: dispositivos, error } = await admin
    .from("push_dispositivos")
    .select("id, token, plataforma")
    .in("user_id", Array.from(new Set(userIds)));
  if (error) return resultado; // tabla aún sin crear (migracion_push_nativo.sql)
  for (const d of dispositivos || []) {
    let r: "ok" | "invalido" | "error" = "error";
    try {
      r = d.plataforma === "ios" ? await enviarIos(d.token, aviso) : await enviarAndroid(d.token, aviso);
    } catch (e: any) {
      console.error("[push nativo]", e?.message || e);
    }
    if (r === "ok") {
      resultado.enviados++;
      await admin.from("push_dispositivos").update({ ultimo_envio_at: new Date().toISOString() }).eq("id", d.id);
    } else if (r === "invalido") {
      resultado.borrados++;
      await admin.from("push_dispositivos").delete().eq("id", d.id);
    } else resultado.fallidos++;
  }
  return resultado;
}
