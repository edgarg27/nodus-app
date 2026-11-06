"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import AvisosPush from "@/app/components/AvisosPush";
import { AVISOS_POR_ROL } from "@/lib/avisosPorRol";
import { labelRol } from "@/lib/roles";

type Aviso = { id: string; mensaje: string | null; leida: boolean | null; created_at: string };

// Encabezado de Contabilidad (rol "gastos"), igual al de los paneles del personal
// (app/dashboard/AdminPanel.tsx): saludo, campana con los gastos nuevos y el menú de la
// cuenta con "Cerrar sesión". Gastos es su única pantalla, así que no tiene panel propio.
export default function EncabezadoContabilidad({
  nombre,
  rol,
  numeroUsuario,
  onCerrarSesion,
  onAbrirAviso,
}: {
  nombre: string;
  rol: string;
  numeroUsuario: string | null;
  onCerrarSesion: () => void;
  // Al tocar un aviso: la lista de gastos ya está en esta pantalla, solo se recarga.
  onAbrirAviso: () => void;
}) {
  const supabase = createClient();
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [menuNotif, setMenuNotif] = useState(false);
  const [menuCuenta, setMenuCuenta] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("notificaciones")
        .select("id, mensaje, leida, created_at")
        .in("tipo", AVISOS_POR_ROL[rol] || [])
        .order("created_at", { ascending: false })
        .limit(20);
      setAvisos((data as Aviso[]) || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rol]);

  const sinLeer = avisos.filter((a) => !a.leida).length;
  const primerNombre = nombre.trim().split(/\s+/)[0] || "";

  async function cambiarAviso(id: string, accion: "leida" | "descartar") {
    await fetch("/api/notificaciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, accion }) });
  }

  return (
    <div className="panel-header">
      <div>
        <p className="panel-header-title">{primerNombre ? `Hola, ${primerNombre}` : "Hola"}</p>
        <p className="panel-header-sub">Nodus Flex Center · Gastos de todos los centros</p>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ position: "relative" }}>
          <button className={"notif-bell" + (sinLeer > 0 ? " notif-bell-ring" : "")} onClick={() => setMenuNotif((v) => !v)} title="Notificaciones">
            <svg className="notif-bell-svg" viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg">
              <path d="M224 0c-17.7 0-32 14.3-32 32V49.9C119.5 61.4 64 124.2 64 200v33.4c0 45.4-15.5 89.5-43.8 124.9L5.3 377c-5.8 7.2-6.9 17.1-2.9 25.4S14.8 416 24 416H424c9.2 0 17.6-5.3 21.6-13.6s2.9-18.2-2.9-25.4l-14.9-18.6c-28.3-35.4-43.8-79.5-43.8-124.9V200c0-75.8-55.5-138.6-128-150.1V32c0-17.7-14.3-32-32-32zm0 96h8c57.4 0 104 46.6 104 104v33.4c0 47.9 13.9 94.6 39.7 134.6H72.3c25.8-40 39.7-86.7 39.7-134.6V200c0-57.4 46.6-104 104-104h8zm64 352H160c0 17 6.7 33.3 18.7 45.3S207 512 224 512s33.3-6.7 45.3-18.7S288 465 288 448z" />
            </svg>
            {sinLeer > 0 && <span className="notif-badge">{sinLeer}</span>}
          </button>
          {menuNotif && (
            <>
              <div className="menu-overlay-click" onClick={() => setMenuNotif(false)} />
              <div className="notif-dropdown">
                {avisos.length === 0 ? (
                  <p className="notif-empty">Sin notificaciones</p>
                ) : (
                  avisos.map((a) => (
                    <div
                      key={a.id}
                      className={"notif-item" + (!a.leida ? " no-leida" : "")}
                      style={{ position: "relative", paddingRight: 26 }}
                      onClick={() => {
                        if (!a.leida) {
                          cambiarAviso(a.id, "leida");
                          setAvisos((prev) => prev.map((x) => (x.id === a.id ? { ...x, leida: true } : x)));
                        }
                        setMenuNotif(false);
                        onAbrirAviso();
                      }}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setAvisos((prev) => prev.filter((x) => x.id !== a.id));
                          cambiarAviso(a.id, "descartar");
                        }}
                        title="Quitar"
                        style={{ position: "absolute", top: 6, right: 6, border: "none", background: "transparent", color: "#aaa", fontSize: 14, lineHeight: 1, cursor: "pointer", padding: 4 }}
                      >
                        ✕
                      </button>
                      <p className="notif-item-msg">{a.mensaje}</p>
                      <p className="notif-item-fecha">{new Date(a.created_at).toLocaleString("es-MX")}</p>
                    </div>
                  ))
                )}
                <AvisosPush />
              </div>
            </>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <button className="panel-avatar" onClick={() => setMenuCuenta((v) => !v)} title="Opciones de cuenta">
            {nombre.charAt(0).toUpperCase() || "C"}
          </button>
          {menuCuenta && (
            <>
              <div className="menu-overlay-click" onClick={() => setMenuCuenta(false)} />
              <div className="avatar-dropdown">
                <p className="avatar-dropdown-nombre">{nombre}</p>
                <p className="avatar-dropdown-rol">{labelRol(rol)}</p>
                {numeroUsuario && (
                  <p className="avatar-dropdown-rol" style={{ marginTop: 2 }}>
                    N.º de usuario: <strong style={{ color: "#0d1b3e" }}>{numeroUsuario}</strong>
                  </p>
                )}
                <button className="avatar-dropdown-item" onClick={onCerrarSesion}>
                  🚪 Cerrar sesión
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
