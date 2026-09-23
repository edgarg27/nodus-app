"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  TIPOS_ESPACIO_FIDELIDAD,
  LABEL_TIPO_ESPACIO_FIDELIDAD,
  calcularRegalo,
  formatFolioFidelidad,
  type TipoEspacioFidelidad,
} from "@/lib/fidelidad";
import FidelidadCard from "@/app/components/FidelidadCard";

// Módulo de tarjetas de fidelidad para el staff: ver las tarjetas, buscar
// por folio, poner o quitar sellos, entregar el regalo y eliminar tarjetas.
const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];

type TarjetaFidelidad = {
  id: string;
  folio: number;
  created_at: string;
  centro: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  estado: "activa" | "completada" | "canjeada";
};

type SelloFidelidadRow = {
  id: string;
  tarjeta_id: string;
  numero: number;
  created_at: string;
  tipo_espacio: TipoEspacioFidelidad;
  detalle: string | null;
  capturado_por: string | null;
};

export default function FidelidadAdminPage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [centro, setCentro] = useState<string | null>(null);
  const [esGlobal, setEsGlobal] = useState(false);

  const [tarjetasFidelidad, setTarjetasFidelidad] = useState<TarjetaFidelidad[]>([]);
  const [folioBuscado, setFolioBuscado] = useState("");
  const [buscandoTarjeta, setBuscandoTarjeta] = useState(false);
  const [errorBusquedaTarjeta, setErrorBusquedaTarjeta] = useState("");
  const [tarjetaEncontrada, setTarjetaEncontrada] = useState<TarjetaFidelidad | null>(null);
  const [sellosTarjetaEncontrada, setSellosTarjetaEncontrada] = useState<SelloFidelidadRow[]>([]);
  const [casillaSel, setCasillaSel] = useState<number | null>(null);
  const [selloForm, setSelloForm] = useState<{ tipo_espacio: TipoEspacioFidelidad; detalle: string }>({
    tipo_espacio: "coworking",
    detalle: "",
  });
  const [guardandoSello, setGuardandoSello] = useState(false);
  const [errorSello, setErrorSello] = useState("");
  const [regaloModal, setRegaloModal] = useState<{ tipo_espacio: TipoEspacioFidelidad; detalle: string | null } | null>(null);

  useEffect(() => {
    cargarTarjetas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargarTarjetas() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }
    const { data: profile } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
    const global = ROLES_GLOBALES.includes(profile?.rol || "");
    setEsGlobal(global);
    setCentro(profile?.centro || null);

    let query = supabase.from("tarjetas_fidelidad").select("*").order("created_at", { ascending: false }).limit(100);
    if (!global && profile?.centro) query = query.eq("centro", profile.centro);
    const { data } = await query;
    setTarjetasFidelidad(data || []);
    setLoading(false);
  }

  // Búsqueda por folio — sin filtrar por centro, porque el cliente puede
  // presentarse en cualquier Nodus con su tarjeta.
  async function buscarTarjetaPorFolio(e: React.FormEvent) {
    e.preventDefault();
    setErrorBusquedaTarjeta("");
    setTarjetaEncontrada(null);
    setSellosTarjetaEncontrada([]);
    const folioNum = Number(folioBuscado.replace(/\D/g, ""));
    if (!folioNum) {
      setErrorBusquedaTarjeta("Escribe el folio de la tarjeta");
      return;
    }
    setBuscandoTarjeta(true);
    const { data: tarjeta } = await supabase.from("tarjetas_fidelidad").select("*").eq("folio", folioNum).maybeSingle();
    if (!tarjeta) {
      setBuscandoTarjeta(false);
      setErrorBusquedaTarjeta("No se encontró ninguna tarjeta con ese folio");
      return;
    }
    await cargarTarjeta(tarjeta);
    setBuscandoTarjeta(false);
  }

  // Trae los sellos de una tarjeta y la deja abierta en pantalla.
  async function cargarTarjeta(tarjeta: TarjetaFidelidad) {
    const { data: sellos } = await supabase
      .from("tarjetas_fidelidad_sellos")
      .select("*")
      .eq("tarjeta_id", tarjeta.id)
      .order("numero", { ascending: true });
    setErrorBusquedaTarjeta("");
    setErrorSello("");
    setCasillaSel(null);
    setTarjetaEncontrada(tarjeta);
    setSellosTarjetaEncontrada(sellos || []);
  }

  async function abrirTarjetaDeLista(tarjeta: TarjetaFidelidad) {
    await cargarTarjeta(tarjeta);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Deja la tarjeta al día: estado según cuántas casillas hay selladas
  // (8 = completa, menos = activa). Una tarjeta ya canjeada no se toca.
  async function sincronizarEstadoTarjeta(tarjeta: TarjetaFidelidad, sellos: SelloFidelidadRow[]) {
    if (tarjeta.estado === "canjeada") return tarjeta;
    const nuevoEstado = sellos.length >= 8 ? "completada" : "activa";
    if (nuevoEstado === tarjeta.estado) return tarjeta;
    await supabase.from("tarjetas_fidelidad").update({ estado: nuevoEstado }).eq("id", tarjeta.id);
    const actualizada = { ...tarjeta, estado: nuevoEstado } as TarjetaFidelidad;
    setTarjetaEncontrada(actualizada);
    setTarjetasFidelidad((prev) => prev.map((t) => (t.id === actualizada.id ? actualizada : t)));
    return actualizada;
  }

  // Registra el sello de la casilla elegida (el staff dice qué se rentó).
  // Al llegar a 8, la tarjeta pasa a "completada" y se muestra el regalo
  // calculado (lo que más se rentó de esos 8 usos).
  async function registrarSello() {
    if (!tarjetaEncontrada) return;
    setErrorSello("");
    setGuardandoSello(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const numero =
      casillaSel ?? Array.from({ length: 8 }, (_, i) => i + 1).find((n) => !sellosTarjetaEncontrada.some((s) => s.numero === n));
    if (!numero || sellosTarjetaEncontrada.some((s) => s.numero === numero)) {
      setGuardandoSello(false);
      setErrorSello("Esa casilla ya tiene sello.");
      return;
    }
    const { error: insertError } = await supabase.from("tarjetas_fidelidad_sellos").insert({
      tarjeta_id: tarjetaEncontrada.id,
      numero,
      tipo_espacio: selloForm.tipo_espacio,
      detalle: selloForm.detalle.trim() || null,
      capturado_por: user?.id,
    });
    if (insertError) {
      setGuardandoSello(false);
      setErrorSello("No se pudo registrar el sello. Intenta de nuevo.");
      return;
    }
    // Se vuelve a leer para tener el id real del sello (hace falta para quitarlo).
    const { data: sellosActuales } = await supabase
      .from("tarjetas_fidelidad_sellos")
      .select("*")
      .eq("tarjeta_id", tarjetaEncontrada.id)
      .order("numero", { ascending: true });
    const nuevosSellos: SelloFidelidadRow[] = sellosActuales || [];
    setSellosTarjetaEncontrada(nuevosSellos);
    setCasillaSel(null);
    setSelloForm({ tipo_espacio: "coworking", detalle: "" });

    const estabaCompleta = tarjetaEncontrada.estado === "completada";
    const actualizada = await sincronizarEstadoTarjeta(tarjetaEncontrada, nuevosSellos);
    if (!estabaCompleta && actualizada.estado === "completada") {
      const regalo = calcularRegalo(nuevosSellos);
      if (regalo) setRegaloModal({ tipo_espacio: regalo.tipo_espacio, detalle: regalo.detalle });
    }
    setGuardandoSello(false);
  }

  // Quita un sello (por error de captura). Si la tarjeta estaba completa,
  // vuelve a activa. Una tarjeta ya canjeada no se modifica.
  async function quitarSello(sello: SelloFidelidadRow) {
    if (!tarjetaEncontrada || tarjetaEncontrada.estado === "canjeada") return;
    if (!confirm(`¿Quitar el sello ${sello.numero} de esta tarjeta?`)) return;
    setErrorSello("");
    const { data: borrados, error } = await supabase
      .from("tarjetas_fidelidad_sellos")
      .delete()
      .eq("id", sello.id)
      .select("id");
    if (error || !borrados || borrados.length === 0) {
      setErrorSello("No se pudo quitar el sello. Intenta de nuevo.");
      return;
    }
    const restantes = sellosTarjetaEncontrada.filter((s) => s.id !== sello.id);
    setSellosTarjetaEncontrada(restantes);
    setCasillaSel(null);
    await sincronizarEstadoTarjeta(tarjetaEncontrada, restantes);
  }

  // Borra la tarjeta completa (sus sellos se van con ella).
  async function eliminarTarjeta(tarjeta: TarjetaFidelidad) {
    if (
      !confirm(
        `¿Eliminar la tarjeta #${String(tarjeta.folio).padStart(6, "0")} de ${tarjeta.nombre}? Se borran también todos sus sellos y no se puede deshacer.`
      )
    )
      return;
    setErrorSello("");
    const { data: borradas, error } = await supabase.from("tarjetas_fidelidad").delete().eq("id", tarjeta.id).select("id");
    if (error || !borradas || borradas.length === 0) {
      setErrorSello("No se pudo eliminar la tarjeta. Si el problema sigue, falta aplicar la migración de permisos de eliminación.");
      return;
    }
    setTarjetasFidelidad((prev) => prev.filter((t) => t.id !== tarjeta.id));
    setTarjetaEncontrada(null);
    setSellosTarjetaEncontrada([]);
    setCasillaSel(null);
  }

  // El staff marca que ya entregó el regalo de la casilla 9 — cierra el
  // ciclo de esa tarjeta (un nuevo ciclo implica pedir una tarjeta nueva).
  async function marcarRegaloEntregado(tarjeta: TarjetaFidelidad) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase
      .from("tarjetas_fidelidad")
      .update({ estado: "canjeada", regalo_canjeado_en: new Date().toISOString(), regalo_canjeado_por: user?.id })
      .eq("id", tarjeta.id);
    const actualizada = { ...tarjeta, estado: "canjeada" as const };
    setTarjetasFidelidad((prev) => prev.map((t) => (t.id === tarjeta.id ? actualizada : t)));
    if (tarjetaEncontrada?.id === tarjeta.id) setTarjetaEncontrada(actualizada);
  }

  return (
    <div className="panel">
      <div className="rep-header">
        <a className="rep-back" href="/dashboard">
          ← Regresar
        </a>
        <p className="rep-title">Tarjeta de fidelidad</p>
        <p className="rep-sub">{esGlobal ? "Todos los centros" : centro || ""}</p>
      </div>

      <div className="rep-content">
        {loading ? (
          <p className="empty-card">Cargando...</p>
        ) : (
          <>
            <form className="form-card" onSubmit={buscarTarjetaPorFolio}>
              <p className="sub-label">Buscar tarjeta por folio</p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="text"
                  placeholder="Ej. 123 o NODUS-FID-000123"
                  value={folioBuscado}
                  onChange={(e) => setFolioBuscado(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button className="btn-enviar" type="submit" disabled={buscandoTarjeta}>
                  {buscandoTarjeta ? "Buscando..." : "Buscar"}
                </button>
              </div>
              {errorBusquedaTarjeta && <p style={{ color: "#A32D2D", fontSize: 13 }}>{errorBusquedaTarjeta}</p>}
            </form>

            {tarjetaEncontrada && (
              <div style={{ marginTop: 12 }}>
                <p className="sub-label">
                  #{String(tarjetaEncontrada.folio).padStart(6, "0")} · {tarjetaEncontrada.nombre} ·{" "}
                  {tarjetaEncontrada.centro}
                </p>
                <FidelidadCard
                  sellos={sellosTarjetaEncontrada}
                  regalo={calcularRegalo(sellosTarjetaEncontrada)}
                  nombre={tarjetaEncontrada.nombre}
                  folio={tarjetaEncontrada.folio}
                  casillaSeleccionada={casillaSel}
                  onCasillaClick={(n) => {
                    setErrorSello("");
                    setCasillaSel(casillaSel === n ? null : n);
                  }}
                />
                <p className="fidelidad-card-nota" style={{ color: "#8b93a7", marginTop: 6 }}>
                  Toca una casilla para ponerle o quitarle el sello.
                </p>
                <p className="fidelidad-card-nota" style={{ color: "#8b93a7" }}>
                  {sellosTarjetaEncontrada.length}/8 sellos ·{" "}
                  {tarjetaEncontrada.estado === "activa"
                    ? "Activa"
                    : tarjetaEncontrada.estado === "completada"
                      ? "Completa — falta entregar el regalo"
                      : "Regalo ya entregado"}
                </p>

                {tarjetaEncontrada.estado === "activa" && casillaSel === null && sellosTarjetaEncontrada.length < 8 && (
                  <button
                    className="reservar-btn"
                    style={{ marginTop: 12 }}
                    onClick={() =>
                      setCasillaSel(
                        Array.from({ length: 8 }, (_, i) => i + 1).find(
                          (n) => !sellosTarjetaEncontrada.some((s) => s.numero === n)
                        ) ?? null
                      )
                    }
                  >
                    + Agregar sello
                  </button>
                )}

                {casillaSel !== null && sellosTarjetaEncontrada.find((s) => s.numero === casillaSel) && (
                  <div className="form-card" style={{ marginTop: 12 }}>
                    {(() => {
                      const sello = sellosTarjetaEncontrada.find((s) => s.numero === casillaSel)!;
                      return (
                        <>
                          <p className="sub-label" style={{ color: "#0d1b3e" }}>
                            Sello {sello.numero} · {LABEL_TIPO_ESPACIO_FIDELIDAD[sello.tipo_espacio]}
                            {sello.detalle ? ` (${sello.detalle})` : ""}
                          </p>
                          <p className="item-card-sub">{new Date(sello.created_at).toLocaleString("es-MX")}</p>
                          {errorSello && <p style={{ color: "#A32D2D", fontSize: 13 }}>{errorSello}</p>}
                          {tarjetaEncontrada.estado === "canjeada" ? (
                            <p className="item-card-sub">El regalo ya se entregó: esta tarjeta ya no se modifica.</p>
                          ) : (
                            <button
                              className="tel-borrar-btn"
                              style={{ marginTop: 8, color: "#A32D2D", fontWeight: 600 }}
                              onClick={() => quitarSello(sello)}
                            >
                              Quitar este sello
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                )}

                {tarjetaEncontrada.estado !== "canjeada" &&
                  casillaSel !== null &&
                  !sellosTarjetaEncontrada.some((s) => s.numero === casillaSel) && (
                    <div className="form-card" style={{ marginTop: 12 }}>
                      <p className="sub-label" style={{ color: "#0d1b3e" }}>
                        Sello {casillaSel} · ¿Qué rentó en esta visita?
                      </p>
                      <select
                        value={selloForm.tipo_espacio}
                        onChange={(e) => setSelloForm({ ...selloForm, tipo_espacio: e.target.value as TipoEspacioFidelidad })}
                      >
                        {TIPOS_ESPACIO_FIDELIDAD.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Detalle (opcional, ej. 8 personas)"
                        value={selloForm.detalle}
                        onChange={(e) => setSelloForm({ ...selloForm, detalle: e.target.value })}
                      />
                      {errorSello && <p style={{ color: "#A32D2D", fontSize: 13 }}>{errorSello}</p>}
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button className="tel-borrar-btn" onClick={() => setCasillaSel(null)} disabled={guardandoSello}>
                          Cancelar
                        </button>
                        <button className="reservar-btn" onClick={registrarSello} disabled={guardandoSello}>
                          {guardandoSello ? "Guardando..." : "Guardar sello"}
                        </button>
                      </div>
                    </div>
                  )}

                {tarjetaEncontrada.estado === "completada" && (
                  <button
                    className="reservar-btn"
                    style={{ marginTop: 12 }}
                    onClick={() => marcarRegaloEntregado(tarjetaEncontrada)}
                  >
                    🎁 Marcar regalo como entregado
                  </button>
                )}

                {casillaSel === null && errorSello && (
                  <p style={{ color: "#A32D2D", fontSize: 13, marginTop: 8 }}>{errorSello}</p>
                )}

                <button
                  className="tel-borrar-btn"
                  style={{ marginTop: 16, color: "#A32D2D", fontWeight: 600 }}
                  onClick={() => eliminarTarjeta(tarjetaEncontrada)}
                >
                  🗑 Eliminar tarjeta
                </button>
              </div>
            )}

            <p className="panel-section-label" style={{ marginTop: 16 }}>
              {esGlobal ? "Todas las tarjetas" : `Tarjetas de ${centro || "tu centro"}`} ({tarjetasFidelidad.length})
            </p>
            {tarjetasFidelidad.length === 0 ? (
              <div className="empty-card">Sin tarjetas de fidelidad todavía</div>
            ) : (
              tarjetasFidelidad.map((t) => (
                <div
                  className="item-card"
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  style={{
                    cursor: "pointer",
                    outline: tarjetaEncontrada?.id === t.id ? "2px solid #f07e3a" : undefined,
                  }}
                  onClick={() => abrirTarjetaDeLista(t)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") abrirTarjetaDeLista(t);
                  }}
                >
                  <div className="item-card-info">
                    <p className="item-card-titulo">
                      {formatFolioFidelidad(t.folio).replace("NODUS-FID-", "#")} · {t.nombre}
                    </p>
                    <p className="item-card-sub">
                      {t.telefono || "Sin teléfono"}
                      {esGlobal ? ` · ${t.centro}` : ""}
                    </p>
                  </div>
                  <span
                    className="factura-badge"
                    style={{
                      background: t.estado === "canjeada" ? "#E1F5EE" : t.estado === "completada" ? "#FFF3E8" : "#E6F1FB",
                    }}
                  >
                    <span className="factura-badge-text">
                      {t.estado === "canjeada" ? "✓ Canjeada" : t.estado === "completada" ? "🎁 Completa" : "Activa"}
                    </span>
                  </span>
                </div>
              ))
            )}
          </>
        )}
      </div>

      {regaloModal && (
        <div className="modal-overlay" onClick={() => setRegaloModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <p className="modal-nombre">🎉 ¡Tarjeta completa!</p>
            <p className="modal-email">
              El regalo de la casilla 9 es: <strong>{LABEL_TIPO_ESPACIO_FIDELIDAD[regaloModal.tipo_espacio]}</strong>
              {regaloModal.detalle ? ` (${regaloModal.detalle})` : ""} — fue lo que más rentó en sus 8 visitas.
            </p>
            <button className="reservar-btn" style={{ marginTop: 10 }} onClick={() => setRegaloModal(null)}>
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
