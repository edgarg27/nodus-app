import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { crearCargoSPEI } from "@/lib/openpay";
import { PAGOS_EN_LINEA_ACTIVOS } from "@/lib/pagosEnLinea";
import { centroTieneUnifi, generarVoucherReal, eliminarVoucherReal } from "@/lib/unifi";
import { clientesConCoworking } from "@/lib/coworking";
import { DIA_LIMITE_PAGO_MENSUAL, recargoConIva } from "@/lib/formaPago";
import { totalAdicionalesMensuales } from "@/lib/adicionales";
import { enviarAvisoPago } from "@/lib/correosPagos";
import { intentarCobroAutomatico } from "@/lib/cobroAutomatico";
import { rolPuede } from "@/lib/permisosApi";
import { apartarCargo, cargoDelPeriodo, estadoDelCargo, ligarCargoAFactura, periodoDe, soltarCargo } from "@/lib/cargosPeriodo";
import { conceptoDelPeriodo } from "@/lib/conceptoFactura";
import { correosExtraDe } from "@/lib/correosFactura";

// El concepto de la renta del mes: el predefinido del cliente (Configuración fiscal) con el mes de hoy, o el de siempre.
// Si la consulta falla, se queda el de siempre: nunca deja de generarse la renta por esto.
async function conceptoRentaDe(admin: Admin, userId: string, hoy: Date, porDefecto: string) {
  const { data } = await admin.from("profiles").select("concepto_factura").eq("id", userId).maybeSingle();
  const plantilla = (data as { concepto_factura?: string | null } | null)?.concepto_factura;
  return plantilla && plantilla.trim() ? conceptoDelPeriodo(plantilla, hoy.getMonth() + 1, hoy.getFullYear()) : porDefecto;
}

const DIAS_RECORDATORIO_ANTES = 3;
const DIAS_GRACIA_DESPUES = 3;

type Admin = ReturnType<typeof createAdminClient>;
type Resumen = {
  recordatorios: number;
  facturasGeneradas: number;
  speiGenerados: number;
  vouchersGenerados: number;
  suspendidos: number;
  // Cobro automático con tarjeta guardada (ver lib/cobroAutomatico.ts)
  cobrosAutomaticos: number;
  cobrosAutomaticosFallidos: number;
  errores: string[];
};

// Lo que se cobra cada mes: la renta del contrato MÁS los adicionales de cobro
// mensual (hoy el Estacionamiento, ver lib/adicionales.ts). El primer mes ya
// lo cobró ContratoModal.tsx → aprobar(), por eso esto aplica desde el
// siguiente cobro.
async function montoMensualConAdicionales(admin: Admin, contratoId: string, renta: number): Promise<number> {
  const { data } = await admin.from("contrato_adicionales").select("concepto, monto").eq("contrato_id", contratoId);
  return Math.round((renta + totalAdicionalesMensuales(data || [])) * 100) / 100;
}

// Voucher de WiFi del mes (solo Coworking y solo en centros con UniFi real configurado).
async function generarVoucherMensual(
  admin: Admin,
  resumen: Resumen,
  userId: string,
  cliente: { nombre: string | null; email: string | null; centro: string | null }
) {
  if (!cliente.centro || !centroTieneUnifi(cliente.centro)) return;
  try {
    const { codigo, unifiId } = await generarVoucherReal(cliente.centro, {
      notaBase: `Nodus - ${cliente.nombre} (renovación mensual)`,
      minutos: 43200,
    });
    await admin.from("vouchers").insert({
      user_id: userId,
      codigo,
      folio: `VCH-${Date.now().toString().slice(-6)}`,
      centro: cliente.centro,
      duracion_minutos: 43200,
      expira_en: new Date(Date.now() + 43200 * 60 * 1000).toISOString(),
      unifi_id: unifiId,
    });
    resumen.vouchersGenerados++;
  } catch (err: any) {
    resumen.errores.push(`Voucher ${cliente.email}: ${err.message}`);
  }
}

// La renta integrada a mano no pasa por la creación de factura de aquí, que es donde
// sale el voucher: sin esto, un cliente de Coworking se quedaría sin WiFi ese mes.
async function voucherMensualSiFalta(
  admin: Admin,
  resumen: Resumen,
  userId: string,
  cliente: { nombre: string | null; email: string | null; centro: string | null },
  inicioMes: string
) {
  if (!cliente.centro || !centroTieneUnifi(cliente.centro)) return;
  const { data: yaTiene, error } = await admin
    .from("vouchers")
    .select("id")
    .eq("user_id", userId)
    .eq("duracion_minutos", 43200)
    .gte("created_at", `${inicioMes}T00:00:00`)
    .limit(1)
    .maybeSingle();
  if (error) {
    resumen.errores.push(`Voucher ${cliente.email}: ${error.message}`);
    return;
  }
  if (!yaTiene) await generarVoucherMensual(admin, resumen, userId, cliente);
}

// Crea una factura pendiente y su cargo SPEI, ya ligada a su apartado en
// cargos_periodo (antes de cobrar nada, para que el mes nunca quede sin marca).
// Devuelve el id de la factura; si no se pudo, suelta el apartado.
async function crearFacturaConSpei(
  admin: Admin,
  resumen: Resumen,
  datos: {
    userId: string;
    cargoId: string;
    cliente: { nombre: string | null; email: string | null; centro: string | null };
    monto: number;
    concepto: string;
    folio: string;
    hoyISO: string;
    fechaVencimiento: string;
    notaSpei: string;
    // Si el cliente autorizó el cobro automático, primero se intenta cobrar su
    // tarjeta; solo si falla (o no hay) se genera la CLABE SPEI de respaldo.
    autopago?: boolean;
  }
): Promise<string | undefined> {
  const { data: nuevaFactura, error: errFactura } = await admin
    .from("facturas")
    .insert({
      user_id: datos.userId,
      folio: datos.folio,
      concepto: datos.concepto,
      monto: datos.monto,
      fecha_emision: datos.hoyISO,
      fecha_vencimiento: datos.fechaVencimiento,
      estado: "pendiente",
      centro: datos.cliente.centro,
    })
    .select("id")
    .single();
  const facturaId = nuevaFactura?.id as string | undefined;
  if (!facturaId) {
    resumen.errores.push(`Factura ${datos.cliente.email}: ${errFactura?.message || "no se pudo crear"}`);
    await soltarCargo(admin, datos.cargoId);
    return undefined;
  }
  try {
    await ligarCargoAFactura(admin, datos.cargoId, facturaId);
  } catch (err) {
    // Sin la marca, mañana se generaría otra: se deshace antes de cobrar nada.
    await admin.from("facturas").delete().eq("id", facturaId);
    await soltarCargo(admin, datos.cargoId);
    throw err;
  }
  resumen.facturasGeneradas++;

  if (datos.autopago) {
    const r = await intentarCobroAutomatico(admin, {
      userId: datos.userId,
      facturaId,
      monto: datos.monto,
      concepto: datos.concepto,
      cliente: datos.cliente,
    });
    if (r.pagado) {
      resumen.cobrosAutomaticos++;
      return facturaId;
    }
    if (r.intento) resumen.cobrosAutomaticosFallidos++;
  }

  // Pagos en línea apagados (lib/pagosEnLinea.ts): sin referencia SPEI; el cliente paga por transferencia.
  if (!PAGOS_EN_LINEA_ACTIVOS) return facturaId;

  try {
    const cargo = await crearCargoSPEI({
      monto: Number(datos.monto),
      descripcion: datos.concepto,
      ordenId: facturaId,
      nombre: datos.cliente.nombre || "Cliente Nodus",
      email: datos.cliente.email || "",
    });
    await admin.from("pagos").insert({
      factura_id: facturaId,
      user_id: datos.userId,
      monto: datos.monto,
      estado: "pendiente_spei",
      notas: datos.notaSpei,
      openpay_charge_id: cargo.id,
      clabe: cargo.payment_method?.clabe || null,
      banco: cargo.payment_method?.bank || null,
      referencia: cargo.payment_method?.reference || cargo.payment_method?.agreement || null,
      fecha_limite: cargo.due_date || null,
    });
    resumen.speiGenerados++;
  } catch (err: any) {
    resumen.errores.push(`SPEI ${datos.cliente.email}: ${err.message}`);
  }
  return facturaId;
}

// Oficina Privada mes a mes: la renta se factura el día 1 y se puede pagar
// del 1 al 10 (DIA_LIMITE_PAGO_MENSUAL). Si pasa el día 10 sin pagar, se
// genera un cobro aparte de recargo del 3% (RECARGO_PAGO_TARDIO) que el
// cliente paga junto con la siguiente factura. NO se suspende el servicio
// automáticamente — eso lo decide cobranza. El primer mes lo cobra
// ContratoModal.tsx → aprobar(), por eso este flujo arranca el mes siguiente
// al de fecha_inicio y termina en fecha_vencimiento.
// Si finanzas ya integró la renta del mes, la cobranza de esa factura es suya: aquí
// no se reintenta la tarjeta, no se avisa del día 10 (trae su propio vencimiento) ni
// se genera el recargo (finanzas agrega su penalización por atraso, también de 3%).
async function procesarMensual(
  admin: Admin,
  resumen: Resumen,
  ctx: {
    userId: string;
    contrato: { id: string; renta_mensual: number | null; fecha_inicio: string | null; fecha_vencimiento: string | null };
    cliente: { nombre: string | null; email: string | null; centro: string | null };
    // Solo Coworking recibe voucher de WiFi (ver lib/coworking.ts).
    esCoworking: boolean;
    hoy: Date;
    hoyISO: string;
    inicioMes: string;
  }
) {
  const { userId, contrato, cliente, esCoworking, hoy, hoyISO, inicioMes } = ctx;
  const renta = Number(contrato.renta_mensual) || 0;
  if (renta <= 0) return;

  const diaHoy = hoy.getDate();
  const indiceMes = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  if (contrato.fecha_inicio && indiceMes(hoy) <= indiceMes(new Date(contrato.fecha_inicio + "T00:00:00"))) return;
  if (contrato.fecha_vencimiento && hoyISO > contrato.fecha_vencimiento) return;

  const nombreMes = hoy.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
  const conceptoRenta = `Renta mensual - ${nombreMes}`;
  const conceptoRecargo = `Recargo 3% por pago tardío - ${nombreMes}`;
  const sufijoFolio = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}-${userId.slice(0, 6)}`;
  const fechaLimiteISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(DIA_LIMITE_PAGO_MENSUAL).padStart(2, "0")}`;

  const periodo = periodoDe(hoy);
  const rentaMes = await cargoDelPeriodo(admin, { userId, contratoId: contrato.id, periodo, tipo: "renta" });

  // ---------- Días 1 al 10: facturar la renta del mes (una sola vez) ----------
  if (!rentaMes && diaHoy <= DIA_LIMITE_PAGO_MENSUAL) {
    const cargoId = await apartarCargo(admin, { userId, contratoId: contrato.id, periodo, tipo: "renta", origen: "cron" });
    if (!cargoId) return;
    // Renta + adicionales de cobro mensual (Estacionamiento).
    const montoMes = await montoMensualConAdicionales(admin, contrato.id, renta);
    const facturaId = await crearFacturaConSpei(admin, resumen, {
      userId,
      cargoId,
      cliente,
      monto: montoMes,
      concepto: await conceptoRentaDe(admin, userId, hoy, conceptoRenta),
      folio: `FAC-${sufijoFolio}`,
      hoyISO,
      fechaVencimiento: fechaLimiteISO,
      notaSpei:
        montoMes !== renta
          ? "Cargo SPEI generado automático (renta mensual + adicionales, mes a mes)"
          : "Cargo SPEI generado automático (renta mensual, mes a mes)",
      autopago: true,
    });

    if (facturaId && esCoworking) await generarVoucherMensual(admin, resumen, userId, cliente);

    const { data: estadoFactura } = facturaId
      ? await admin.from("facturas").select("estado").eq("id", facturaId).maybeSingle()
      : { data: null };
    if (facturaId && estadoFactura?.estado !== "pagada" && !(await yaExisteNotifEsteMs(admin, userId, "pago_hoy"))) {
      await admin.from("notificaciones").insert({
        centro: cliente.centro,
        user_id: userId,
        tipo: "pago_hoy",
        mensaje: `💰 Tu renta${montoMes !== renta ? " y adicionales" : ""} de ${nombreMes} ya está disponible. Tienes hasta el día ${DIA_LIMITE_PAGO_MENSUAL} para pagarla sin recargo.`,
      });
    }
    return;
  }

  if (!rentaMes) return;
  const estadoRenta = await estadoDelCargo(admin, rentaMes);
  // Sin factura: otra corrida la está creando. Cancelada: alguien lo decidió; no se regenera ni se le cobra nada más.
  if (!estadoRenta || estadoRenta.cancelada) return;
  if (rentaMes.origen === "integrada") {
    if (esCoworking) await voucherMensualSiFalta(admin, resumen, userId, cliente, inicioMes);
    return;
  }
  if (estadoRenta.liquidada) return;
  const facturaRenta = estadoRenta.factura;
  const montoFactura = Number(facturaRenta.monto);

  // ---------- Reintento del cobro automático (días 3 y 7) ----------
  // Se cobra lo que dice la factura. Si ya tiene líneas a mano (una penalización agregada) no se
  // reintenta: el pago con tarjeta la marcaría pagada completa, con esas líneas todavía pendientes.
  if ((diaHoy === 3 || diaHoy === 7) && !estadoRenta.tieneLineas) {
    const r = await intentarCobroAutomatico(admin, {
      userId,
      facturaId: facturaRenta.id,
      monto: montoFactura,
      concepto: facturaRenta.concepto,
      cliente,
    });
    if (r.pagado) {
      resumen.cobrosAutomaticos++;
      return;
    }
    if (r.intento) resumen.cobrosAutomaticosFallidos++;
  }

  // ---------- Recordatorio dos días antes del límite ----------
  if (diaHoy === DIA_LIMITE_PAGO_MENSUAL - 2 && !(await yaExisteNotifEsteMs(admin, userId, "recordatorio_pago"))) {
    await admin.from("notificaciones").insert({
      centro: cliente.centro,
      user_id: userId,
      tipo: "recordatorio_pago",
      mensaje: `📅 Recuerda pagar tu renta a más tardar el día ${DIA_LIMITE_PAGO_MENSUAL} para evitar el recargo del 3%.`,
    });
    await enviarAvisoPago({
      to: cliente.email,
      nombre: cliente.nombre,
      tipo: "antes",
      monto: montoFactura,
      diasFaltan: 2,
    });
    resumen.recordatorios++;
  }

  // ---------- Último día para pagar sin recargo ----------
  if (diaHoy === DIA_LIMITE_PAGO_MENSUAL && !(await yaExisteNotifHoy(admin, userId, "recordatorio_pago", hoyISO))) {
    await admin.from("notificaciones").insert({
      centro: cliente.centro,
      user_id: userId,
      tipo: "recordatorio_pago",
      mensaje: "⏰ Hoy es el último día para pagar tu renta sin recargo.",
    });
    await enviarAvisoPago({
      to: cliente.email,
      nombre: cliente.nombre,
      tipo: "ultimo_dia",
      monto: montoFactura,
    });
    resumen.recordatorios++;
  }

  // ---------- Pasado el día 10 sin pagar: recargo del 3% (una sola vez) ----------
  // Si finanzas le movió la fecha a la factura, se respeta su vencimiento.
  if (diaHoy > DIA_LIMITE_PAGO_MENSUAL && (!facturaRenta.fecha_vencimiento || hoyISO > facturaRenta.fecha_vencimiento)) {
    if (await cargoDelPeriodo(admin, { userId, contratoId: contrato.id, periodo, tipo: "recargo" })) return;
    const cargoRecargoId = await apartarCargo(admin, { userId, contratoId: contrato.id, periodo, tipo: "recargo", origen: "cron" });
    if (!cargoRecargoId) return;

    // Vence junto con la renta del mes siguiente (día límite de ese mes).
    const siguiente = new Date(hoy.getFullYear(), hoy.getMonth() + 1, DIA_LIMITE_PAGO_MENSUAL);
    const vencimientoSiguiente = `${siguiente.getFullYear()}-${String(siguiente.getMonth() + 1).padStart(2, "0")}-${String(
      siguiente.getDate()
    ).padStart(2, "0")}`;
    const facturaRecargoId = await crearFacturaConSpei(admin, resumen, {
      userId,
      cargoId: cargoRecargoId,
      cliente,
      monto: recargoConIva(renta),
      concepto: conceptoRecargo,
      folio: `REC-${sufijoFolio}`,
      hoyISO,
      fechaVencimiento: vencimientoSiguiente,
      notaSpei: "Cargo SPEI generado automático (recargo por pago tardío)",
    });
    if (!facturaRecargoId) return;
    await admin.from("facturas").update({ estado: "vencida" }).eq("id", facturaRenta.id);
    await admin.from("notificaciones").insert({
      centro: cliente.centro,
      user_id: userId,
      tipo: "recordatorio_pago",
      mensaje: `⚠️ No recibimos tu pago de ${nombreMes} antes del día ${DIA_LIMITE_PAGO_MENSUAL}. Se generó un recargo del 3% que se cobra junto con tu siguiente factura.`,
    });
  }
}

function inicioFinDeMes(fecha: Date) {
  const inicio = new Date(fecha.getFullYear(), fecha.getMonth(), 1).toISOString().split("T")[0];
  const fin = new Date(fecha.getFullYear(), fecha.getMonth() + 1, 0).toISOString().split("T")[0];
  return { inicio, fin };
}

async function yaExisteNotifHoy(admin: ReturnType<typeof createAdminClient>, userId: string, tipo: string, hoyISO: string) {
  const { data } = await admin
    .from("notificaciones")
    .select("id")
    .eq("user_id", userId)
    .eq("tipo", tipo)
    .gte("created_at", `${hoyISO}T00:00:00`)
    .limit(1)
    .maybeSingle();
  return !!data;
}

async function yaExisteNotifEsteMs(admin: ReturnType<typeof createAdminClient>, userId: string, tipo: string) {
  const { inicio } = inicioFinDeMes(new Date());
  const { data } = await admin
    .from("notificaciones")
    .select("id")
    .eq("user_id", userId)
    .eq("tipo", tipo)
    .gte("created_at", `${inicio}T00:00:00`)
    .limit(1)
    .maybeSingle();
  return !!data;
}

// Bajas "con adeudo" (contratos inactivo_debe): en cuanto el cliente ya no
// tiene facturas ni pagos pendientes, su baja pasa sola a "pagado". Su
// cuenta sigue bloqueada y no se borra nada (ver /api/dar-baja-cliente).
async function cerrarBajasPagadas(admin: Admin, errores: string[]) {
  let cerradas = 0;
  const { data: bajas } = await admin
    .from("contratos")
    .select("id, user_id")
    .eq("estatus", "inactivo_debe")
    .not("user_id", "is", null);
  for (const b of bajas || []) {
    const [{ count: pagosPend }, { count: facturasPend }] = await Promise.all([
      admin
        .from("pagos")
        .select("id", { count: "exact", head: true })
        .eq("user_id", b.user_id)
        .not("estado", "in", "(pagado,cancelado,rechazado)"),
      admin
        .from("facturas")
        .select("id", { count: "exact", head: true })
        .eq("user_id", b.user_id)
        .not("estado", "in", "(pagada,cancelada)"),
    ]);
    if ((pagosPend || 0) > 0 || (facturasPend || 0) > 0) continue;
    const { error } = await admin.from("contratos").update({ estatus: "inactivo_pagado", monto_adeudado: 0 }).eq("id", b.id);
    if (error) errores.push(`Baja ${b.id}: ${error.message}`);
    else cerradas++;
  }
  return cerradas;
}

export async function POST(req: NextRequest) {
  // Se puede llamar de dos formas: con el secreto del cron (para la tarea
  // programada), o con sesión de staff (para el botón "Ejecutar ahora").
  const authHeader = req.headers.get("authorization");
  const esCronValido = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!esCronValido) {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { data: miProfile } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
    if (!rolPuede(miProfile?.rol, "cobroDiarioManual")) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  const admin = createAdminClient();
  const hoy = new Date();
  const diaHoy = hoy.getDate();
  const hoyISO = hoy.toISOString().split("T")[0];
  const { inicio: inicioMes } = inicioFinDeMes(hoy);
  const periodo = periodoDe(hoy);

  const resumen = {
    recordatorios: 0,
    facturasGeneradas: 0,
    speiGenerados: 0,
    vouchersGenerados: 0,
    suspendidos: 0,
    cobrosAutomaticos: 0,
    cobrosAutomaticosFallidos: 0,
    bajasPagadas: 0,
    errores: [] as string[],
  };

  try {
    resumen.bajasPagadas = await cerrarBajasPagadas(admin, resumen.errores);
  } catch (err: any) {
    resumen.errores.push(`Bajas pagadas: ${err.message}`);
  }

  // Todos los contratos vigentes con día de pago definido
  const { data: contratos } = await admin
    .from("contratos")
    .select("id, user_id, renta_mensual, dia_pago, estatus, forma_pago, fecha_inicio, fecha_vencimiento")
    .eq("estatus", "vigente")
    .not("dia_pago", "is", null)
    .order("fecha_inicio", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (!contratos) {
    return NextResponse.json({ ok: true, resumen });
  }

  // Solo el contrato más reciente por cliente. Uno ya firmado que todavía no
  // arranca (una renovación a futuro) no le gana al que sigue corriendo.
  const contratoPorCliente = new Map<string, (typeof contratos)[number]>();
  for (const c of contratos) {
    const elegido = contratoPorCliente.get(c.user_id);
    if (!elegido || (elegido.fecha_inicio && elegido.fecha_inicio > hoyISO)) contratoPorCliente.set(c.user_id, c);
  }

  // El voucher mensual de WiFi ya solo es para clientes de Coworking.
  const conCoworking = await clientesConCoworking(admin, Array.from(contratoPorCliente.keys()));

  for (const [userId, contrato] of contratoPorCliente) {
    const diaPago = contrato.dia_pago as number;

    const { data: cliente } = await admin
      .from("profiles")
      .select("id, nombre, email, centro, activo, suspendido, correos_factura")
      .eq("id", userId)
      .single();

    if (!cliente || !cliente.activo || cliente.suspendido) continue;

    // Por adelantado: todo el periodo ya se cobró al aprobar el contrato,
    // no hay factura mensual. Contratos anteriores (forma_pago null) siguen
    // exactamente el flujo de siempre, más abajo.
    if (contrato.forma_pago === "adelantado") continue;

    if (contrato.forma_pago === "mensual") {
      try {
        await procesarMensual(admin, resumen, {
          userId,
          contrato,
          cliente,
          esCoworking: conCoworking.has(userId),
          hoy,
          hoyISO,
          inicioMes,
        });
      } catch (err: any) {
        resumen.errores.push(`${cliente.email}: ${err.message}`);
      }
      continue;
    }

    try {
      // Renta + adicionales de cobro mensual (Estacionamiento).
      const montoMes = await montoMensualConAdicionales(admin, contrato.id, Number(contrato.renta_mensual) || 0);

      // ---------- Recordatorio X días antes ----------
      const diaRecordatorio = diaPago - DIAS_RECORDATORIO_ANTES;
      if (diaRecordatorio >= 1 && diaHoy === diaRecordatorio) {
        // A quien ya pagó (o le cancelaron) la renta del mes no se le recuerda.
        const rentaPrevia = await cargoDelPeriodo(admin, { userId, contratoId: contrato.id, periodo, tipo: "renta" });
        const estadoPrevio = rentaPrevia ? await estadoDelCargo(admin, rentaPrevia) : null;
        const yaEnviado =
          (!!estadoPrevio && (estadoPrevio.liquidada || estadoPrevio.cancelada)) || (await yaExisteNotifEsteMs(admin, userId, "recordatorio_pago"));
        if (!yaEnviado) {
          await admin.from("notificaciones").insert({
            centro: cliente.centro,
            user_id: userId,
            tipo: "recordatorio_pago",
            mensaje: `📅 No se te olvide, tu fecha de pago es el día ${diaPago} de este mes.`,
          });
          await enviarAvisoPago({
            to: cliente.email,
            nombre: cliente.nombre,
            tipo: "antes",
            monto: montoMes,
            diaPago,
            diasFaltan: DIAS_RECORDATORIO_ANTES,
            copias: correosExtraDe(cliente),
          });
          resumen.recordatorios++;
        }
      }

      // ---------- Día de pago: generar factura + SPEI + voucher ----------
      if (diaHoy === diaPago) {
        const rentaMes = await cargoDelPeriodo(admin, { userId, contratoId: contrato.id, periodo, tipo: "renta" });
        let rentaYaResuelta = false;
        // Lo que dice su estado de cuenta (si se integró a mano puede llevar más que la renta).
        let montoAviso = montoMes;

        if (!rentaMes) {
          const cargoId = await apartarCargo(admin, { userId, contratoId: contrato.id, periodo, tipo: "renta", origen: "cron" });
          if (cargoId) {
            const nombreMes = hoy.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
            const facturaId = await crearFacturaConSpei(admin, resumen, {
              userId,
              cargoId,
              cliente,
              monto: montoMes,
              concepto: await conceptoRentaDe(admin, userId, hoy, `Renta mensual - ${nombreMes}`),
              folio: `FAC-${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}-${userId.slice(0, 6)}`,
              hoyISO,
              fechaVencimiento: hoyISO,
              notaSpei: "Cargo SPEI generado automático (cobranza mensual)",
              autopago: true,
            });
            if (facturaId && conCoworking.has(userId)) await generarVoucherMensual(admin, resumen, userId, cliente);
          }
        } else {
          const estadoRenta = await estadoDelCargo(admin, rentaMes);
          rentaYaResuelta = !!estadoRenta && (estadoRenta.liquidada || estadoRenta.cancelada);
          if (estadoRenta) montoAviso = Number(estadoRenta.factura.monto);
          if (rentaMes.origen === "integrada" && !estadoRenta?.cancelada && conCoworking.has(userId)) {
            await voucherMensualSiFalta(admin, resumen, userId, cliente, inicioMes);
          }
        }

        // A quien ya pagó (o le cancelaron) esa renta no se le avisa que hoy le toca.
        const yaAvisado = rentaYaResuelta || (await yaExisteNotifEsteMs(admin, userId, "pago_hoy"));
        if (!yaAvisado) {
          await admin.from("notificaciones").insert({
            centro: cliente.centro,
            user_id: userId,
            tipo: "pago_hoy",
            mensaje: `💰 Hoy es tu fecha de pago (día ${diaPago}).`,
          });
          await enviarAvisoPago({ to: cliente.email, nombre: cliente.nombre, tipo: "hoy", monto: montoAviso, diaPago, copias: correosExtraDe(cliente) });
        }
      }

      // ---------- Día siguiente a la fecha límite: si no ha pagado, aviso de suspensión ----------
      if (diaHoy === diaPago + 1) {
        const rentaMes = await cargoDelPeriodo(admin, { userId, contratoId: contrato.id, periodo, tipo: "renta" });
        const estadoRenta = rentaMes ? await estadoDelCargo(admin, rentaMes) : null;
        if (estadoRenta && !estadoRenta.liquidada && !estadoRenta.cancelada && !(await yaExisteNotifEsteMs(admin, userId, "aviso_suspension"))) {
          await admin.from("notificaciones").insert({
            centro: cliente.centro,
            user_id: userId,
            tipo: "aviso_suspension",
            mensaje: `⚠️ Tu fecha límite de pago fue ayer (día ${diaPago}). Por favor, apóyanos con tu pago hoy; de lo contrario, mañana se suspenderán tus servicios.`,
          });
          await enviarAvisoPago({
            to: cliente.email,
            nombre: cliente.nombre,
            tipo: "suspension",
            monto: Number(estadoRenta.factura.monto),
            diaPago,
            copias: correosExtraDe(cliente),
          });
          resumen.recordatorios++;
        }
      }

      // ---------- Después de la gracia: pausar si no pagó ----------
      const diaLimiteGracia = diaPago + DIAS_GRACIA_DESPUES;
      if (diaHoy === diaLimiteGracia) {
        // Solo cuenta la renta de este contrato y mes, no cualquier factura del cliente (una
        // sala de juntas no suspende a nadie). Y no antes de su vencimiento: una integrada a
        // mano puede traer otra fecha.
        const rentaMes = await cargoDelPeriodo(admin, { userId, contratoId: contrato.id, periodo, tipo: "renta" });
        const estadoRenta = rentaMes ? await estadoDelCargo(admin, rentaMes) : null;

        if (
          estadoRenta &&
          !estadoRenta.liquidada &&
          !estadoRenta.cancelada &&
          (!estadoRenta.factura.fecha_vencimiento || hoyISO > estadoRenta.factura.fecha_vencimiento)
        ) {
          await admin.from("facturas").update({ estado: "vencida" }).eq("id", estadoRenta.factura.id);
          await admin
            .from("profiles")
            .update({ suspendido: true, suspendido_desde: hoyISO })
            .eq("id", userId);

          // Revocar su voucher activo (si tenía uno real)
          const { data: voucherActivo } = await admin
            .from("vouchers")
            .select("id, unifi_id, centro")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (voucherActivo?.unifi_id && voucherActivo.centro) {
            try {
              await eliminarVoucherReal(voucherActivo.centro, voucherActivo.unifi_id);
            } catch (err: any) {
              resumen.errores.push(`Revocar voucher ${cliente.email}: ${err.message}`);
            }
          }

          await admin.from("notificaciones").insert({
            centro: cliente.centro,
            user_id: userId,
            tipo: "cuenta_pausada",
            mensaje: `⚠️ Tu fecha límite de pago fue el día ${diaPago}. Comunícate con el administrador — tus servicios han sido pausados.`,
          });
          if (cliente.email) {
            try {
              await admin.functions?.invoke?.("send-email", {
                body: {
                  tipo: "cuenta_pausada",
                  clienteEmail: cliente.email,
                  clienteNombre: cliente.nombre,
                  diaPago,
                },
              });
            } catch {
              /* no crítico */
            }
          }
          resumen.suspendidos++;
        }
      }
    } catch (err: any) {
      resumen.errores.push(`${cliente.email}: ${err.message}`);
    }
  }

  return NextResponse.json({ ok: true, fecha: hoyISO, resumen });
}

// Los servicios de cron (cron-job.org, Vercel, etc.) suelen llamar con GET.
// Aquí SOLO se acepta con el secreto del cron — nunca con sesión — para que
// abrir esta URL en el navegador no dispare una facturación.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return POST(req);
}
