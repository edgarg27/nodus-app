"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export const CENTROS = [
  "Bosques",
  "Punto 45",
  "San Telmo",
  "Puerta Bajío Piso 2",
  "Puerta Bajío Piso 8",
  "Stadium",
  "ILEVA",
];

// Por ahora los módulos de Decoraciones, Eventos y Documentación del centro
// los administra solo admin y superadmin (las políticas RLS de
// migracion_atencion_clientes_modulos.sql usan la misma lista).
export const ROLES_ADMIN_CENTRO = ["admin", "superadmin"];

// Superadmin ve todos los centros con un selector; admin queda fijo al
// centro de su propio perfil.
export function useCentroAdmin() {
  const [cargando, setCargando] = useState(true);
  const [rol, setRol] = useState("");
  const [nombre, setNombre] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [centro, setCentro] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setCargando(false);
        return;
      }
      const { data: perfil } = await supabase.from("profiles").select("rol, nombre, centro").eq("id", user.id).single();
      const r = perfil?.rol || "";
      setRol(r);
      setNombre(perfil?.nombre || "");
      setUserId(user.id);
      setCentro(r === "superadmin" ? perfil?.centro || CENTROS[0] : perfil?.centro || null);
      setCargando(false);
    })();
  }, []);

  return {
    cargando,
    rol,
    nombre,
    userId,
    centro,
    setCentro,
    esGlobal: rol === "superadmin",
    permitido: ROLES_ADMIN_CENTRO.includes(rol),
  };
}
