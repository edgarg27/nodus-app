"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const RECORDAR_KEY = "nodus_recordar_identificador";

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();
  const [identificador, setIdentificador] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [recordarme, setRecordarme] = useState(false);
  const [mostrarPassword, setMostrarPassword] = useState(false);

  // Si la vez pasada dejó marcado "Recuérdame", recuperamos su usuario/correo
  // para no hacerlo escribirlo de nuevo. La contraseña en sí NO la guardamos
  // nosotros — eso lo maneja el propio administrador de contraseñas del
  // navegador (por eso los autoComplete="username"/"current-password" de
  // abajo), que es la forma segura de que se autocomplete sola.
  useEffect(() => {
    const guardado = localStorage.getItem(RECORDAR_KEY);
    if (guardado) {
      setIdentificador(guardado);
      setRecordarme(true);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    // Si lo que escribió no es un correo (ej. "N-1356"), primero lo
    // resolvemos a su correo real antes de intentar el login.
    let email = identificador.trim();
    if (!email.includes("@")) {
      try {
        const res = await fetch("/api/resolver-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identificador: email }),
        });
        const data = await res.json();
        if (!data.email) {
          setError("Correo, número de usuario o contraseña incorrectos.");
          setLoading(false);
          return;
        }
        email = data.email;
      } catch {
        setError("No se pudo conectar. Intenta de nuevo.");
        setLoading(false);
        return;
      }
    }

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (authError) {
      setError("Correo, número de usuario o contraseña incorrectos.");
      return;
    }

    if (recordarme) {
      localStorage.setItem(RECORDAR_KEY, identificador.trim());
    } else {
      localStorage.removeItem(RECORDAR_KEY);
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    let destino = "/dashboard";
    if (user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("rol")
        .eq("id", user.id)
        .single();
      if (profile?.rol === "cliente") destino = "/dashboard-cliente";
    }

    // Si llegó aquí desde una pantalla protegida (ej. escaneó el QR de un
    // Day Pass sin haber iniciado sesión), lo regresamos ahí en vez de
    // siempre mandarlo al dashboard. Se valida que sea una ruta interna
    // para no poder usarlo como redirección a otro sitio.
    const nextParam = searchParams.get("next");
    if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") && !nextParam.includes("://")) {
      destino = nextParam;
    }

    router.push(destino);
    router.refresh();
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Nodus Flex Center</h1>
        <p className="subtitle">Inicia sesión con tu cuenta</p>

        <label htmlFor="identificador">Correo o número de usuario</label>
        <div className="login-input-wrap">
          <span className="login-input-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <circle cx="12" cy="12" r="4" />
              <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-5.5 8.28" />
            </svg>
          </span>
          <input
            id="identificador"
            type="text"
            required
            autoFocus
            autoComplete="username"
            placeholder="tu@correo.com o N-1356"
            value={identificador}
            onChange={(e) => setIdentificador(e.target.value)}
          />
        </div>

        <label htmlFor="password">Contraseña</label>
        <div className="login-input-wrap">
          <span className="login-input-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <input
            id="password"
            type={mostrarPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="login-eye-btn"
            onClick={() => setMostrarPassword((v) => !v)}
            aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            title={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {mostrarPassword ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.5 18.5 0 0 0 1 12s4 8 11 8a10.94 10.94 0 0 0 5.39-1.61M1 1l22 22" />
                <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>

        <div className="login-row">
          <label className="login-remember">
            <input
              type="checkbox"
              checked={recordarme}
              onChange={(e) => setRecordarme(e.target.checked)}
            />
            Recuérdame
          </label>
          <a
            href="#"
            className="login-forgot-link"
            onClick={(e) => e.preventDefault()}
          >
            ¿Olvidaste tu contraseña?
          </a>
        </div>

        <p className="error">{error}</p>

        <button type="submit" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <a
          href="/agendar-invitado"
          style={{
            textAlign: "center",
            fontSize: 13,
            color: "#0d1b3e",
            fontWeight: 600,
            textDecoration: "none",
            marginTop: 4,
          }}
        >
          ¿No eres cliente aún? Agenda o pide tu Day Pass aquí
        </a>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
