"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function CuentaSuspendidaPage() {
  const supabase = createClient();
  const router = useRouter();
  const [fecha, setFecha] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      const { data } = await supabase.from("profiles").select("suspendido_desde").eq("id", user.id).single();
      setFecha(data?.suspendido_desde || null);
    });
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ textAlign: "center" }}>
        <img src="/icons/advertencia.png" alt="" style={{ width: 40, height: 40, margin: "0 auto" }} />
        <h1>Servicio pausado</h1>
        <p className="subtitle">
          Tu fecha límite de pago{fecha ? ` fue el ${new Date(fecha + "T00:00:00").toLocaleDateString("es-MX")}` : ""} y
          no detectamos tu pago.
          <br />
          <br />
          Por este motivo, tu acceso al sitio y a internet dentro del centro han sido pausados.
          <br />
          <br />
          Comunícate con el administrador de tu centro para regularizar tu situación.
        </p>
        <button type="button" onClick={handleLogout}>
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}
