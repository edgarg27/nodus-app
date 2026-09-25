"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { pedirLinkFirmado } from "@/lib/storage";

type Aviso = {
  clave: string; // contrato + fecha de envío: si la administradora lo vuelve a mandar, vuelve a avisar
  id: string;
  cliente: string;
  centro: string;
  archivo: string | null;
  nombreArchivo: string | null;
};

const LLAVE = "nodus_contratos_vistos_ventas";

function leerVistos(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LLAVE) || "[]");
  } catch {
    return [];
  }
}

// Aviso que le sale a Ventas en su panel cuando la administradora le manda un
// contrato a firma: "esta es la última versión que subió la administradora".
// Lleva la cuenta de lo ya visto en este navegador (localStorage), y revisa
// cada minuto por si llega uno mientras tiene el panel abierto.
export default function AvisoContratoVentas() {
  const supabase = createClient();
  const router = useRouter();
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    revisar();
    const t = setInterval(revisar, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function revisar() {
    const { data: contratos } = await supabase
      .from("contratos")
      .select("id, centro, user_id, cliente_nombre_historico, cliente_email_historico, archivo_url, archivo_machote_url, enviado_a_ventas_at")
      .eq("estatus", "pre_aprobado")
      .not("enviado_a_ventas_at", "is", null)
      .is("archivo_firmado_url", null);
    const vistos = leerVistos();
    const nuevos = (contratos || []).filter((c) => !vistos.includes(`${c.id}:${c.enviado_a_ventas_at}`));
    if (nuevos.length === 0) {
      setAvisos([]);
      return;
    }

    const userIds = Array.from(new Set(nuevos.map((c) => c.user_id).filter((id): id is string => !!id)));
    const { data: perfiles } = userIds.length
      ? await supabase.from("profiles").select("id, nombre").in("id", userIds)
      : { data: [] as { id: string; nombre: string | null }[] };
    const nombre: Record<string, string> = Object.fromEntries((perfiles || []).map((p) => [p.id, p.nombre || ""]));

    const { data: versiones } = await supabase
      .from("contrato_versiones")
      .select("contrato_id, archivo_url, nombre_archivo, created_at")
      .in(
        "contrato_id",
        nuevos.map((c) => c.id)
      )
      .order("created_at", { ascending: false });
    const ultima: Record<string, { archivo_url: string; nombre_archivo: string | null }> = {};
    (versiones || []).forEach((v) => {
      if (!ultima[v.contrato_id]) ultima[v.contrato_id] = v;
    });

    setAvisos(
      nuevos.map((c) => ({
        clave: `${c.id}:${c.enviado_a_ventas_at}`,
        id: c.id,
        cliente: c.cliente_nombre_historico || (c.user_id && nombre[c.user_id]) || c.cliente_email_historico || "Cliente",
        centro: c.centro,
        archivo: ultima[c.id]?.archivo_url || c.archivo_machote_url || c.archivo_url,
        nombreArchivo: ultima[c.id]?.nombre_archivo || null,
      }))
    );
  }

  function marcarVistos() {
    try {
      localStorage.setItem(LLAVE, JSON.stringify(Array.from(new Set([...leerVistos(), ...avisos.map((a) => a.clave)]))));
    } catch {
      // sin localStorage el aviso solo se repite en la próxima visita
    }
    setAvisos([]);
  }

  async function abrir(url: string) {
    setAbriendo(url);
    const { url: firmado, error: signErr } = await pedirLinkFirmado(url);
    setAbriendo(null);
    if (!firmado) {
      setError("No se pudo abrir el archivo: " + (signErr || "intenta de nuevo"));
      return;
    }
    setError("");
    window.open(firmado, "_blank");
  }

  if (avisos.length === 0) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <p className="modal-nombre">📥 {avisos.length === 1 ? "Te llegó un contrato a firma" : `Te llegaron ${avisos.length} contratos a firma`}</p>
        <p className="modal-email">Esta es la última versión que subió la administradora.</p>
        {avisos.map((a) => (
          <div key={a.clave} className="cotizacion-card" style={{ padding: "8px 10px", margin: "8px 0", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
            <div>
              <p className="item-card-titulo" style={{ fontSize: 13 }}>
                {a.cliente}
              </p>
              <p className="item-card-sub">{a.centro}</p>
            </div>
            {a.archivo && (
              <button
                type="button"
                className="ver-pdf-btn"
                style={{ maxWidth: "100%", whiteSpace: "normal", wordBreak: "break-word", textAlign: "left" }}
                onClick={() => abrir(a.archivo!)}
                disabled={abriendo === a.archivo}
              >
                {abriendo === a.archivo ? "Abriendo…" : `📥 ${a.nombreArchivo || "Ver archivo"}`}
              </button>
            )}
          </div>
        ))}
        {error && <p style={{ color: "#A32D2D", fontSize: 13 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="tel-borrar-btn" onClick={marcarVistos}>
            Entendido
          </button>
          <button
            className="btn-aceptar"
            onClick={() => {
              marcarVistos();
              router.push("/contratos");
            }}
          >
            Ir a Contratos
          </button>
        </div>
      </div>
    </div>
  );
}
