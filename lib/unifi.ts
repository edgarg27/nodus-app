// Cliente mínimo para la API del controlador UniFi. Corre solo en el servidor
// (dentro de Route Handlers de Next.js) — las credenciales nunca llegan al navegador.
//
// Por ahora solo tenemos configurado el centro "Bosques". Cuando tengamos las
// credenciales UniFi de los demás centros, se agregan aquí mismo al mapa
// CENTROS_UNIFI y automáticamente quedan disponibles.

import https from "node:https";

type CentroConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  site: string;
  controllerType: "unifios" | "classic";
  allowSelfSigned: boolean;
};

const CENTROS_UNIFI: Record<string, CentroConfig> = {
  Bosques: {
    host: process.env.UNIFI_BOSQUES_HOST || "10.40.10.122",
    port: Number(process.env.UNIFI_BOSQUES_PORT || 443),
    username: process.env.UNIFI_BOSQUES_USERNAME || "",
    password: process.env.UNIFI_BOSQUES_PASSWORD || "",
    site: process.env.UNIFI_BOSQUES_SITE || "default",
    controllerType: "unifios",
    allowSelfSigned: true,
  },
};

export function centroTieneUnifi(centro: string) {
  const cfg = CENTROS_UNIFI[centro];
  return !!(cfg && cfg.host && cfg.username && cfg.password);
}

// Sesión en memoria del proceso (cookie + csrf token), una por centro.
const sesiones = new Map<string, { cookie: string | null; csrfToken: string | null }>();

function getSesion(centro: string) {
  if (!sesiones.has(centro)) sesiones.set(centro, { cookie: null, csrfToken: null });
  return sesiones.get(centro)!;
}

function rawRequest(
  cfg: CentroConfig,
  sesion: { cookie: string | null; csrfToken: string | null },
  path: string,
  opts: { method?: string; body?: any } = {}
): Promise<{ status: number; body: any }> {
  const agent = new https.Agent({ rejectUnauthorized: !cfg.allowSelfSigned });
  const data = opts.body ? JSON.stringify(opts.body) : null;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sesion.cookie) headers["Cookie"] = sesion.cookie;
  if (sesion.csrfToken && opts.method && opts.method !== "GET") {
    headers["X-CSRF-Token"] = sesion.csrfToken;
  }
  if (data) headers["Content-Length"] = String(Buffer.byteLength(data));

  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: cfg.host, port: cfg.port, path, method: opts.method || "GET", headers, agent },
      (res) => {
        let chunks = "";
        res.on("data", (d) => (chunks += d));
        res.on("end", () => {
          const setCookie = res.headers["set-cookie"];
          if (setCookie && setCookie.length) {
            sesion.cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
          }
          const newCsrf = res.headers["x-csrf-token"] || res.headers["x-updated-csrf-token"];
          if (newCsrf) sesion.csrfToken = String(newCsrf);

          let parsed: any = null;
          try {
            parsed = chunks ? JSON.parse(chunks) : null;
          } catch {
            // respuesta no era JSON
          }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function apiPrefix(cfg: CentroConfig) {
  return cfg.controllerType === "classic" ? "" : "/proxy/network";
}

function loginPath(cfg: CentroConfig) {
  return cfg.controllerType === "classic" ? "/api/login" : "/api/auth/login";
}

async function login(cfg: CentroConfig, sesion: { cookie: string | null; csrfToken: string | null }) {
  const res = await rawRequest(cfg, sesion, loginPath(cfg), {
    method: "POST",
    body:
      cfg.controllerType === "classic"
        ? { username: cfg.username, password: cfg.password, strict: true }
        : { username: cfg.username, password: cfg.password, rememberMe: false },
  });
  if (res.status !== 200) {
    sesion.cookie = null;
    sesion.csrfToken = null;
    throw new Error(`No se pudo iniciar sesión en UniFi (status ${res.status})`);
  }
}

async function callApi(
  cfg: CentroConfig,
  sesion: { cookie: string | null; csrfToken: string | null },
  path: string,
  opts: { method?: string; body?: any } = {}
) {
  if (!sesion.cookie) await login(cfg, sesion);
  let res = await rawRequest(cfg, sesion, path, opts);
  if (res.status === 401) {
    sesion.cookie = null;
    sesion.csrfToken = null;
    await login(cfg, sesion);
    res = await rawRequest(cfg, sesion, path, opts);
  }
  if (res.status < 200 || res.status >= 300) {
    const msg = res.body?.meta?.msg || `status ${res.status}`;
    throw new Error(`Error de UniFi: ${msg}`);
  }
  return res.body;
}

/**
 * Genera un voucher real de acceso a internet en el controlador UniFi del
 * centro indicado. Regresa el código real que UniFi generó.
 */
export async function generarVoucherReal(
  centro: string,
  opts: { minutos?: number; notaBase: string }
) {
  const cfg = CENTROS_UNIFI[centro];
  if (!cfg) throw new Error(`No hay configuración de UniFi para el centro "${centro}"`);
  const sesion = getSesion(centro);
  const site = cfg.site;
  const batchTag = Math.random().toString(36).slice(2, 8);
  const note = `${opts.notaBase} #${batchTag}`;

  await callApi(cfg, sesion, `${apiPrefix(cfg)}/api/s/${site}/cmd/hotspot`, {
    method: "POST",
    body: {
      cmd: "create-voucher",
      expire: opts.minutos || 43200, // 30 días por default
      n: 1,
      quota: 0, // 0 = reutilizable mientras no expire
      note,
    },
  });

  // create-voucher no regresa el código directo; hay que volver a listar y
  // filtrar por la nota única de este batch para recuperarlo.
  const list = await callApi(cfg, sesion, `${apiPrefix(cfg)}/api/s/${site}/stat/voucher`);
  const match = (list.data || []).find((v: any) => v.note === note);
  if (!match) {
    throw new Error(
      `El voucher se creó en UniFi pero no se pudo confirmar el código. Búscalo en el Hotspot Manager con la nota: ${note}`
    );
  }
  return { codigo: match.code as string, unifiId: match._id as string };
}

/**
 * Elimina un voucher del controlador UniFi del centro indicado.
 */
export async function eliminarVoucherReal(centro: string, unifiId: string) {
  const cfg = CENTROS_UNIFI[centro];
  if (!cfg) throw new Error(`No hay configuración de UniFi para el centro "${centro}"`);
  const sesion = getSesion(centro);
  const site = cfg.site;

  await callApi(cfg, sesion, `${apiPrefix(cfg)}/api/s/${site}/cmd/hotspot`, {
    method: "POST",
    body: { cmd: "delete-voucher", _id: unifiId },
  });
}
