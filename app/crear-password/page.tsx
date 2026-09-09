"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function CrearPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [listo, setListo] = useState(false);
  const [sesionValida, setSesionValida] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState(false);

  useEffect(() => {
    async function activarSesion() {
      // @supabase/ssr no procesa automático el token que viene en el "#" de
      // la URL (eso es del flujo clásico/implícito); hay que leerlo a mano
      // y activarlo con setSession.
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const params = new URLSearchParams(hash);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        setSesionValida(!error);
        // Limpia el token de la URL para que no se quede visible/copiable
        window.history.replaceState(null, "", window.location.pathname);
      } else {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        setSesionValida(!!session);
      }
      setListo(true);
    }
    activarSesion();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres");
      return;
    }
    if (password !== confirmar) {
      setError("Las contraseñas no coinciden");
      return;
    }
    setGuardando(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setGuardando(false);
    if (updateError) {
      setError("No se pudo guardar tu contraseña. Intenta de nuevo.");
      return;
    }
    setExito(true);
    setTimeout(() => {
      router.push("/dashboard-cliente");
      router.refresh();
    }, 1800);
  }

  if (!listo) {
    return <div className="login-wrap" />;
  }

  if (!sesionValida) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Enlace no válido</h1>
          <p className="subtitle">
            Este enlace ya expiró o ya se usó. Pide al centro que te reenvíe la invitación.
          </p>
        </div>
      </div>
    );
  }

  if (exito) {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: "center" }}>
          <p style={{ fontSize: 40, margin: 0 }}>🎉</p>
          <h1>¡Listo!</h1>
          <p className="subtitle">Tu contraseña quedó guardada. Entrando a tu cuenta...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Bienvenido a Nodus</h1>
        <p className="subtitle">Crea una contraseña para tu cuenta</p>

        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          type="password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <label htmlFor="confirmar">Confirmar contraseña</label>
        <input
          id="confirmar"
          type="password"
          required
          value={confirmar}
          onChange={(e) => setConfirmar(e.target.value)}
        />

        <p className="error">{error}</p>

        <button type="submit" disabled={guardando}>
          {guardando ? "Guardando..." : "Guardar y entrar"}
        </button>
      </form>
    </div>
  );
}
