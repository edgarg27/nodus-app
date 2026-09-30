"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { conceptoParaCliente } from "@/lib/adicionales";

// "Pagar todo junto": junta en un solo total lo que el cliente tiene
// pendiente — facturas pendientes/vencidas y los otros pagos sueltos (renta,
// depósito, adicionales) — con el mismo criterio que su Estado de cuenta.
// Por ahora solo muestra el desglose: todavía no hay forma de pago activa
// (tarjeta/SPEI). Cuando la haya, aquí se cobra el total en un solo cargo y
// se marcan pagados todos los conceptos juntos.

type Concepto = { id: string; tipo: "Factura" | "Pago"; titulo: string; monto: number; vencida: boolean };

export default function PagarTodoPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [conceptos, setConceptos] = useState<Concepto[]>([]);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      const [{ data: facturas }, { data: pagos }] = await Promise.all([
        supabase
          .from("facturas")
          .select("id, folio, concepto, monto, estado")
          .eq("user_id", user.id)
          .in("estado", ["pendiente", "vencida"])
          .order("fecha_vencimiento", { ascending: true }),
        supabase
          .from("pagos")
          .select("id, concepto, monto, estado")
          .eq("user_id", user.id)
          .is("factura_id", null)
          .neq("estado", "pagado")
          .order("created_at", { ascending: true }),
      ]);
      setConceptos([
        ...(facturas || []).map((f) => ({
          id: f.id,
          tipo: "Factura" as const,
          titulo: [f.folio, conceptoParaCliente(f.concepto, "")].filter(Boolean).join(" · "),
          monto: Number(f.monto) || 0,
          vencida: f.estado === "vencida",
        })),
        ...(pagos || []).map((p) => ({
          id: p.id,
          tipo: "Pago" as const,
          titulo: conceptoParaCliente(p.concepto),
          monto: Number(p.monto) || 0,
          vencida: false,
        })),
      ]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = conceptos.reduce((s, c) => s + c.monto, 0);
  const fmt = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/estado-cuenta">
          ← Regresar
        </a>
        <p className="rep-title">Estado de cuenta</p>
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
        ) : conceptos.length === 0 ? (
          <>
            <div className="empty-card">🎉 No tienes pagos pendientes.</div>
            <a className="exito-btn" href="/estado-cuenta">
              Volver a mi estado de cuenta
            </a>
          </>
        ) : (
          <>
            <div className="resumen-reserva-card">
              <p className="resumen-reserva-title">Detalle del pago</p>
              {conceptos.map((c) => (
                <div className="resumen-reserva-row" key={c.tipo + c.id}>
                  <span className="resumen-reserva-label">
                    {c.titulo}
                    {c.vencida ? " (vencida)" : ""}
                  </span>
                  <span className="resumen-reserva-val">{fmt(c.monto)}</span>
                </div>
              ))}
              <div className="resumen-reserva-row" style={{ fontWeight: 700 }}>
                <span className="resumen-reserva-label" style={{ fontWeight: 700 }}>
                  Total ({conceptos.length} {conceptos.length === 1 ? "concepto" : "conceptos"})
                </span>
                <span className="resumen-reserva-val" style={{ fontWeight: 700 }}>
                  {fmt(total)}
                </span>
              </div>
            </div>

            <div className="nota-info">
              La liquidación del saldo total todavía no está disponible. Por ahora puedes pagar cada concepto por separado
              desde tu estado de cuenta.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
