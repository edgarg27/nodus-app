"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Estado = "cargando" | "confirmar" | "form" | "invalido" | "exito";

export default function CrearPasswordPage() {
  const router = useRouter();
  const supabase = createClient();

  const [estado, setEstado] = useState<Estado>("cargando");
  const [tokenHash, setTokenHash] = useState<string | null>(null);
  const [tipoOtp, setTipoOtp] = useState<"invite" | "recovery" | "email">("invite");
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  // El enlace de "¿Olvidaste tu contraseña?" trae type=recovery; el de una
  // invitación de alta trae type=invite. Cambia el texto y a dónde se va.
  const [esReset, setEsReset] = useState(false);

  useEffect(() => {
    async function revisarEnlace() {
      const query = new URLSearchParams(window.location.search);
      const th = query.get("token_hash");
      const tipo = query.get("type");

      // Enlace nuevo (ver lib/correoContrasena.ts): trae token_hash + type
      // en vez de activar la sesión solo con visitarlo. No se llama a
      // verifyOtp aquí todavía — se espera a que la persona le dé clic a
      // "Continuar" (ver por qué en el comentario de correoContrasena.ts:
      // así un escáner de correo automático no gasta el enlace).
      if (th && tipo) {
        setTokenHash(th);
        setTipoOtp(tipo === "recovery" ? "recovery" : tipo === "email" ? "email" : "invite");
        setEsReset(tipo === "recovery");
        setEstado("confirmar");
        return;
      }

      // Compatibilidad con enlaces viejos (type=... + tokens en el "#" de
      // la URL, el flujo clásico/implícito de Supabase) o con una sesión
      // que ya esté activa.
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
      const hashParams = new URLSearchParams(hash);
      const access_token = hashParams.get("access_token");
      const refresh_token = hashParams.get("refresh_token");

      if (access_token && refresh_token) {
        setEsReset(hashParams.get("type") === "recovery");
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        window.history.replaceState(null, "", window.location.pathname);
        setEstado(error ? "invalido" : "form");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      setEstado(session ? "form" : "invalido");
    }
    revisarEnlace();
  }, []);

  async function confirmarEnlace() {
    if (!tokenHash) return;
    setConfirmando(true);
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipoOtp });
    setConfirmando(false);
    setEstado(error ? "invalido" : "form");
  }

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
      setError(
        updateError.code === "same_password"
          ? "La nueva contraseña debe ser distinta a la anterior."
          : "No se pudo guardar tu contraseña. Intenta de nuevo."
      );
      return;
    }
    setEstado("exito");
    setTimeout(() => {
      // Tras recuperar contraseña puede ser cliente o staff: /login los manda
      // a su panel (el middleware redirige según el rol de la sesión).
      router.push(esReset ? "/login" : "/dashboard-cliente");
      router.refresh();
    }, 1800);
  }

  if (estado === "cargando") {
    return <div className="login-wrap" />;
  }

  if (estado === "confirmar") {
    return (
      <div className="login-wrap">
        <div className="login-card" style={{ textAlign: "center" }}>
          <h1>{esReset ? "Restablecer contraseña" : "Bienvenido a Nodus"}</h1>
          <p className="subtitle">
            {esReset
              ? "Confirma para poner la contraseña de tu cuenta."
              : "Confirma para crear la contraseña de tu cuenta."}
          </p>
          <button onClick={confirmarEnlace} disabled={confirmando} style={{ marginTop: 8 }}>
            {confirmando ? "Confirmando..." : "Continuar"}
          </button>
        </div>
      </div>
    );
  }

  if (estado === "invalido") {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Enlace no válido</h1>
          <p className="subtitle">
            {esReset
              ? "Este enlace ya expiró o ya se usó. Pide uno nuevo desde “¿Olvidaste tu contraseña?” en el inicio de sesión."
              : "Este enlace ya expiró o ya se usó. Pide al centro que te reenvíe la invitación."}
          </p>
          {esReset && (
            <a href="/login" style={{ display: "block", textAlign: "center", marginTop: 12, fontWeight: 600, color: "#0d1b3e" }}>
              Ir al inicio de sesión
            </a>
          )}
        </div>
      </div>
    );
  }

  if (estado === "exito") {
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
        <h1>{esReset ? "Tu contraseña" : "Bienvenido a Nodus"}</h1>
        <p className="subtitle">
          {esReset ? "Escribe la contraseña de tu cuenta" : "Crea una contraseña para tu cuenta"}
        </p>

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
          {guardando ? "Guardando..." : esReset ? "Guardar contraseña" : "Guardar y entrar"}
        </button>
      </form>
    </div>
  );
}
