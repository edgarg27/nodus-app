"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Paquete = {
  id: string;
  created_at: string;
  tipo: "paquete" | "correspondencia" | "otro";
  remitente: string | null;
  descripcion: string | null;
  estado: "por_recoger" | "entregado";
  entregado_en: string | null;
};

const ETIQUETA_TIPO: Record<Paquete["tipo"], string> = {
  paquete: "Paquete",
  correspondencia: "Correspondencia",
  otro: "Otro",
};

function formatFechaHora(iso: string) {
  return new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function MiPaqueteriaPage() {
  const supabase = createClient();
  const [items, setItems] = useState<Paquete[]>([]);
  const [loading, setLoading] = useState(true);
  const [sub, setSub] = useState("");

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { data: perfil } = await supabase.from("profiles").select("numero_oficina, centro").eq("id", user.id).single();
    if (perfil) {
      setSub(`${perfil.numero_oficina ? `Oficina ${perfil.numero_oficina} · ` : ""}${perfil.centro || ""}`);
    }
    const { data } = await supabase
      .from("paqueteria_cliente")
      .select("id, created_at, tipo, remitente, descripcion, estado, entregado_en")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(60);
    setItems((data as Paquete[]) || []);
    setLoading(false);
  }

  const porRecoger = items.filter((i) => i.estado === "por_recoger");
  const entregados = items.filter((i) => i.estado === "entregado");

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">Mis Paquetes</p>
        <p className="rep-sub">{sub}</p>
      </div>

      <div className="sub-content">
        {loading ? (
          <div className="nodus-inline-loading">
            <div className="nodus-spinner nodus-spinner-sm">
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
              <span className="nodus-spinner-petal"></span>
            </div>
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>Cargando...</p>
          </div>
        ) : (
          <>
            <p className="panel-section-label">Por recoger en recepción ({porRecoger.length})</p>
            {porRecoger.length === 0 ? (
              <div className="empty-card">No tienes paquetes ni correspondencia pendiente</div>
            ) : (
              porRecoger.map((p) => (
                <div className="item-card" key={p.id}>
                  <div className="item-card-info">
                    <p className="item-card-titulo">
                      {ETIQUETA_TIPO[p.tipo]}
                      {p.remitente ? ` · ${p.remitente}` : ""}
                    </p>
                    <p className="item-card-sub">
                      Llegó el {formatFechaHora(p.created_at)}
                      {p.descripcion ? ` · ${p.descripcion}` : ""}
                    </p>
                  </div>
                  <span className="factura-badge" style={{ background: "#FAEEDA" }}>
                    <span className="factura-badge-text" style={{ color: "#854F0B" }}>
                      ⏳ Por recoger
                    </span>
                  </span>
                </div>
              ))
            )}

            {entregados.length > 0 && (
              <>
                <p className="panel-section-label" style={{ marginTop: 8 }}>
                  Ya recogidos
                </p>
                {entregados.map((p) => (
                  <div className="item-card" key={p.id}>
                    <div className="item-card-info">
                      <p className="item-card-titulo">
                        {ETIQUETA_TIPO[p.tipo]}
                        {p.remitente ? ` · ${p.remitente}` : ""}
                      </p>
                      <p className="item-card-sub">
                        Recogido el {p.entregado_en ? formatFechaHora(p.entregado_en) : "—"}
                      </p>
                    </div>
                    <span className="factura-badge" style={{ background: "#E1F5EE" }}>
                      <span className="factura-badge-text" style={{ color: "#0F6E56" }}>
                        ✓ Entregado
                      </span>
                    </span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
