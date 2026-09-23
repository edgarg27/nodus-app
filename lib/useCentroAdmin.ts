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
// centro de su propio perfil. `rolesExtra` permite que una pantalla en
// particular abra el acceso a más roles sin tocar ROLES_ADMIN_CENTRO (que
// comparten Decoraciones, Eventos y Documentación) — hoy lo usan
// Documentación del centro y Decoraciones para sumar a "diseno" y
// "atencion_cliente". `rolesGlobales` es aparte: son los roles de esos
// que además deben ver TODOS los centros con selector (no quedar fijos a
// su propio perfil) — hoy solo "atencion_cliente", que es una cuenta
// compartida sin centro propio.
export function useCentroAdmin(rolesExtra: string[] = [], rolesGlobales: string[] = []) {
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
      const esGlobalParaMi = r === "superadmin" || rolesGlobales.includes(r);
      setRol(r);
      setNombre(perfil?.nombre || "");
      setUserId(user.id);
      setCentro(esGlobalParaMi ? perfil?.centro || CENTROS[0] : perfil?.centro || null);
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
    esGlobal: rol === "superadmin" || rolesGlobales.includes(rol),
    permitido: ROLES_ADMIN_CENTRO.includes(rol) || rolesExtra.includes(rol),
  };
}
