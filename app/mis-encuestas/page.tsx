"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Envio = {
  id: string;
  token: string;
  estado: string;
  enviado_en: string;
  encuesta_titulo: string;
};

export default function MisEncuestasPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [envios, setEnvios] = useState<Envio[]>([]);

  useEffect(() => {
    fetchTodo();
  }, []);

  async function fetchTodo() {
    setLoading(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { data } = await supabase
      .from("encuestas_envios")
      .select("id, token, estado, enviado_en, encuestas(titulo)")
      .eq("cliente_id", user.id)
      .order("enviado_en", { ascending: false });

    setEnvios(
      (data || []).map((e: any) => ({
        id: e.id,
        token: e.token,
        estado: e.estado,
        enviado_en: e.enviado_en,
        encuesta_titulo: e.encuestas?.titulo || "Encuesta",
      }))
    );
    setLoading(false);
  }

  const pendientes = envios.filter((e) => e.estado === "pendiente");
  const respondidas = envios.filter((e) => e.estado === "respondida");

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard-cliente">
          ← Regresar
        </a>
        <p className="rep-title">Mis encuestas</p>
      </div>

      <div className="rep-content">
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
        ) : envios.length === 0 ? (
          <div className="empty-card">No tienes encuestas todavía</div>
        ) : (
          <>
            {pendientes.length > 0 && (
              <>
                <p className="panel-section-label">📝 Pendientes ({pendientes.length})</p>
                {pendientes.map((e) => (
                  <a className="contrato-card-admin" key={e.id} href={`/encuesta/${e.token}`} style={{ display: "block" }}>
                    <p className="contrato-cliente-nombre">{e.encuesta_titulo}</p>
                    <p className="contrato-detalle">Enviada el {new Date(e.enviado_en).toLocaleDateString("es-MX")}</p>
                  </a>
                ))}
              </>
            )}

            {respondidas.length > 0 && (
              <>
                <p className="panel-section-label" style={{ marginTop: 16 }}>
                  ✓ Respondidas ({respondidas.length})
                </p>
                {respondidas.map((e) => (
                  <div className="contrato-card-admin" key={e.id}>
                    <p className="contrato-cliente-nombre">{e.encuesta_titulo}</p>
                    <p className="contrato-detalle">Respondida</p>
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
