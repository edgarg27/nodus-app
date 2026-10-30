"use client";

import { useEffect, useState } from "react";
import type { ServicioCatalogo } from "@/lib/catalogoServicios";
import Link from "next/link";

// Servicios: quien puede editar el catálogo (ventasit@nodusbc.mx, finanzas@nodusbc.mx y el superadmin) agrega o
// quita servicios y sus claves del SAT. No tienen precio fijo: el precio lo pone quien cobra, según el cliente. Las demás personas solo los eligen en
// Adicionales y en Nueva factura.

type Edicion = { etiqueta: string; satProdServ: string; satUnidad: string };

const aEdicion = (s: ServicioCatalogo): Edicion => ({ etiqueta: s.etiqueta, satProdServ: s.satProdServ, satUnidad: s.satUnidad });

export default function CatalogoServiciosPage() {
  const [servicios, setServicios] = useState<ServicioCatalogo[]>([]);
  const [ediciones, setEdiciones] = useState<Record<string, Edicion>>({});
  const [puedeEditar, setPuedeEditar] = useState(false);
  const [deBase, setDeBase] = useState(true);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [nuevo, setNuevo] = useState({ etiqueta: "", satProdServ: "", satUnidad: "E48" });
  const [agregando, setAgregando] = useState(false);

  async function cargar() {
    const res = await fetch("/api/catalogo-servicios?todos=1");
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setServicios(d.servicios || []);
      setEdiciones(Object.fromEntries((d.servicios || []).map((s: ServicioCatalogo) => [s.clave, aEdicion(s)])));
      setPuedeEditar(!!d.puedeEditar);
      setDeBase(d.deBase !== false);
    }
    setCargando(false);
  }

  useEffect(() => {
    cargar();
  }, []);

  function cambiado(s: ServicioCatalogo) {
    const e = ediciones[s.clave];
    if (!e) return false;
    const a = aEdicion(s);
    return e.etiqueta !== a.etiqueta || e.satProdServ !== a.satProdServ || e.satUnidad !== a.satUnidad;
  }

  async function guardar(s: ServicioCatalogo) {
    const e = ediciones[s.clave];
    setGuardando(s.clave);
    setError("");
    setMensaje("");
    const res = await fetch("/api/catalogo-servicios", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clave: s.clave, etiqueta: e.etiqueta, satProdServ: e.satProdServ, satUnidad: e.satUnidad }),
    });
    const d = await res.json().catch(() => ({}));
    setGuardando(null);
    if (!res.ok) return setError(`${s.etiqueta}: ${d.error || "no se pudo guardar"}`);
    setMensaje(`Guardado: ${e.etiqueta}`);
    cargar();
  }

  async function cambiarActivo(s: ServicioCatalogo, activo: boolean) {
    if (!activo && !confirm(`¿Quitar "${s.etiqueta}"? Ya no se ofrecerá para cobros nuevos; los cobros anteriores se conservan.`)) return;
    setGuardando(s.clave);
    setError("");
    setMensaje("");
    const res = await fetch("/api/catalogo-servicios", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave: s.clave, activo }) });
    const d = await res.json().catch(() => ({}));
    setGuardando(null);
    if (!res.ok) return setError(d.error || "No se pudo cambiar");
    setMensaje(activo ? `Se volvió a ofrecer: ${s.etiqueta}` : `Se quitó: ${s.etiqueta}`);
    cargar();
  }

  async function agregar(ev: React.FormEvent) {
    ev.preventDefault();
    setError("");
    setMensaje("");
    setAgregando(true);
    const res = await fetch("/api/catalogo-servicios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nuevo),
    });
    const d = await res.json().catch(() => ({}));
    setAgregando(false);
    if (!res.ok) return setError(d.error || "No se pudo agregar");
    setMensaje(`Servicio agregado: ${nuevo.etiqueta}`);
    setNuevo({ etiqueta: "", satProdServ: "", satUnidad: "E48" });
    cargar();
  }

  const poner = (clave: string, campo: keyof Edicion, valor: string) => setEdiciones((m) => ({ ...m, [clave]: { ...m[clave], [campo]: valor } }));

  return (
    <div className="panel">
      <div className="rep-header">
        <Link className="rep-back" href="/facturas-admin">
          ← Regresar
        </Link>
        <p className="rep-title">Catálogo de conceptos</p>
        <p className="rep-sub">Los servicios adicionales que se cobran y se facturan, con su clave del SAT · el precio lo pone quien cobra, según el cliente</p>
      </div>

      <div className="rep-content rep-content-completo">
        {cargando ? (
          <div className="empty-card">Cargando...</div>
        ) : !puedeEditar ? (
          <div className="empty-card">Solo ventasit@nodusbc.mx, finanzas@nodusbc.mx y el superadmin pueden cambiar los servicios.</div>
        ) : (
          <>
            {!deBase && (
              <div className="form-card" style={{ fontSize: 13, color: "#854F0B" }}>
                El catálogo todavía no está en la base de datos (falta correr la migración), así que por ahora no se pueden guardar cambios.
              </div>
            )}
            {mensaje && <div className="form-card" style={{ fontSize: 13, color: "#0F6E56" }}>{mensaje}</div>}
            {error && <div className="form-card" style={{ fontSize: 13, color: "#A32D2D" }}>{error}</div>}

            <form className="form-card" onSubmit={agregar}>
              <p className="sub-label" style={{ fontWeight: 700, color: "#0d1b3e" }}>
                Agregar un servicio <span style={{ fontWeight: 400, color: "#888" }}>· los campos con * son obligatorios</span>
              </p>
              <div className="servicios-fila servicios-fila-nueva">
                <div>
                  <p className="sub-label" style={{ marginBottom: 6 }}>Nombre <span style={{ color: "#A32D2D" }}>*</span></p>
                  <input type="text" maxLength={80} value={nuevo.etiqueta} onChange={(e) => setNuevo({ ...nuevo, etiqueta: e.target.value })} />
                </div>
                <div>
                  <p className="sub-label" style={{ marginBottom: 6 }}>Clave del SAT (8 números) <span style={{ color: "#A32D2D" }}>*</span></p>
                  <input type="text" inputMode="numeric" maxLength={8} value={nuevo.satProdServ} onChange={(e) => setNuevo({ ...nuevo, satProdServ: e.target.value.replace(/\D/g, "") })} />
                </div>
                <div>
                  <p className="sub-label" style={{ marginBottom: 6 }}>Unidad <span style={{ color: "#A32D2D" }}>*</span></p>
                  <select value={nuevo.satUnidad} onChange={(e) => setNuevo({ ...nuevo, satUnidad: e.target.value })}>
                    <option value="E48">E48 · servicio</option>
                    <option value="H87">H87 · pieza</option>
                    <option value="HUR">HUR · hora</option>
                    <option value="DAY">DAY · día</option>
                    <option value="MON">MON · mes</option>
                  </select>
                </div>
                <div style={{ alignSelf: "end" }}>
                  <button type="submit" className="fac-btn fac-btn-verde" disabled={agregando || !deBase || nuevo.etiqueta.trim().length < 2 || nuevo.satProdServ.length !== 8}>
                    {agregando ? "Agregando..." : "Agregar"}
                  </button>
                </div>
              </div>
            </form>

            <div className="form-card">
              <p className="sub-label" style={{ fontWeight: 700, color: "#0d1b3e" }}>
                Servicios ({servicios.filter((s) => s.activo).length} activos)
              </p>
              <div className="servicios-fila servicios-encabezado">
                <span>Nombre</span>
                <span>Clave del SAT</span>
                <span>Unidad</span>
                <span></span>
              </div>
              {servicios.map((s) => {
                const e = ediciones[s.clave] || aEdicion(s);
                return (
                  <div className="servicios-fila" key={s.clave} style={{ opacity: s.activo ? 1 : 0.55 }}>
                    <input type="text" maxLength={80} value={e.etiqueta} onChange={(ev) => poner(s.clave, "etiqueta", ev.target.value)} />
                    <input type="text" inputMode="numeric" maxLength={8} value={e.satProdServ} onChange={(ev) => poner(s.clave, "satProdServ", ev.target.value.replace(/\D/g, ""))} />
                    <input type="text" maxLength={3} value={e.satUnidad} onChange={(ev) => poner(s.clave, "satUnidad", ev.target.value.toUpperCase())} />
                    <div className="servicios-acciones">
                      <button type="button" className="fac-btn fac-btn-verde" disabled={!cambiado(s) || guardando === s.clave || !deBase} onClick={() => guardar(s)}>
                        {guardando === s.clave ? "..." : "Guardar"}
                      </button>
                      {s.activo ? (
                        <button type="button" className="tel-borrar-btn" disabled={guardando === s.clave || !deBase} onClick={() => cambiarActivo(s, false)}>
                          Quitar
                        </button>
                      ) : (
                        <button type="button" className="tel-borrar-btn" style={{ color: "#0F6E56", fontWeight: 600 }} disabled={guardando === s.clave || !deBase} onClick={() => cambiarActivo(s, true)}>
                          Volver a ofrecer
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
