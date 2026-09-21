import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { crearCargoSPEI } from "@/lib/openpay";
import { centroTieneUnifi, generarVoucherReal, eliminarVoucherReal } from "@/lib/unifi";
import { DIA_LIMITE_PAGO_MENSUAL, recargoConIva } from "@/lib/formaPago";

const DIAS_RECORDATORIO_ANTES = 3;
const DIAS_GRACIA_DESPUES = 3;

type Admin = ReturnType<typeof createAdminClient>;
type Resumen = {
  recordatorios: number;
  facturasGeneradas: number;
  speiGenerados: number;
  vouchersGenerados: number;
  suspendidos: number;
  errores: string[];
};

// Crea una factura pendiente y su cargo SPEI (mismo mecanismo que la renta
// del flujo normal de abajo). Devuelve el id de la factura.
async function crearFacturaConSpei(
  admin: Admin,
  resumen: Resumen,
  datos: {
    userId: string;
    cliente: { nombre: string | null; email: string | null; centro: string | null };
    monto: number;
    concepto: string;
    folio: string;
    hoyISO: string;
    fechaVencimiento: string;
    notaSpei: string;
  }
): Promise<string | undefined> {
  const { data: nuevaFactura } = await admin
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
  if (!facturaId) return undefined;
  resumen.facturasGeneradas++;

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
async function procesarMensual(
  admin: Admin,
  resumen: Resumen,
  ctx: {
    userId: string;
    contrato: { renta_mensual: number | null; fecha_inicio: string | null; fecha_vencimiento: string | null };
    cliente: { nombre: string | null; email: string | null; centro: string | null };
    hoy: Date;
    hoyISO: string;
    inicioMes: string;
    finMes: string;
  }
) {
  const { userId, contrato, cliente, hoy, hoyISO, inicioMes, finMes } = ctx;
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

  const { data: facturaRenta } = await admin
    .from("facturas")
    .select("id, estado")
    .eq("user_id", userId)
    .eq("concepto", conceptoRenta)
    .gte("fecha_emision", inicioMes)
    .lte("fecha_emision", finMes)
    .maybeSingle();

  // ---------- Días 1 al 10: facturar la renta del mes (una sola vez) ----------
  if (!facturaRenta && diaHoy <= DIA_LIMITE_PAGO_MENSUAL) {
    const facturaId = await crearFacturaConSpei(admin, resumen, {
      userId,
      cliente,
      monto: renta,
      concepto: conceptoRenta,
      folio: `FAC-${sufijoFolio}`,
      hoyISO,
      fechaVencimiento: fechaLimiteISO,
      notaSpei: "Cargo SPEI generado automático (renta mensual, mes a mes)",
    });

    if (facturaId && cliente.centro && centroTieneUnifi(cliente.centro)) {
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

    if (facturaId && !(await yaExisteNotifEsteMs(admin, userId, "pago_hoy"))) {
      await admin.from("notificaciones").insert({
        centro: cliente.centro,
        user_id: userId,
        tipo: "pago_hoy",
        mensaje: `💰 Tu renta de ${nombreMes} ya está disponible. Tienes hasta el día ${DIA_LIMITE_PAGO_MENSUAL} para pagarla sin recargo.`,
      });
    }
    return;
  }

  if (!facturaRenta || facturaRenta.estado === "pagada") return;

  // ---------- Recordatorio dos días antes del límite ----------
  if (diaHoy === DIA_LIMITE_PAGO_MENSUAL - 2 && !(await yaExisteNotifEsteMs(admin, userId, "recordatorio_pago"))) {
    await admin.from("notificaciones").insert({
      centro: cliente.centro,
      user_id: userId,
      tipo: "recordatorio_pago",
      mensaje: `📅 Recuerda pagar tu renta a más tardar el día ${DIA_LIMITE_PAGO_MENSUAL} para evitar el recargo del 3%.`,
    });
    resumen.recordatorios++;
  }

  // ---------- Pasado el día 10 sin pagar: recargo del 3% (una sola vez) ----------
  if (diaHoy > DIA_LIMITE_PAGO_MENSUAL) {
    const { data: recargoExistente } = await admin
      .from("facturas")
      .select("id")
      .eq("user_id", userId)
      .eq("concepto", conceptoRecargo)
      .maybeSingle();
    if (recargoExistente) return;

    // Vence junto con la renta del mes siguiente (día límite de ese mes).
    const siguiente = new Date(hoy.getFullYear(), hoy.getMonth() + 1, DIA_LIMITE_PAGO_MENSUAL);
    const vencimientoSiguiente = `${siguiente.getFullYear()}-${String(siguiente.getMonth() + 1).padStart(2, "0")}-${String(
      siguiente.getDate()
    ).padStart(2, "0")}`;
    await crearFacturaConSpei(admin, resumen, {
      userId,
      cliente,
      monto: recargoConIva(renta),
      concepto: conceptoRecargo,
      folio: `REC-${sufijoFolio}`,
      hoyISO,
      fechaVencimiento: vencimientoSiguiente,
      notaSpei: "Cargo SPEI generado automático (recargo por pago tardío)",
    });
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
    if (!miProfile || miProfile.rol === "cliente") {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
  }

  const admin = createAdminClient();
  const hoy = new Date();
  const diaHoy = hoy.getDate();
  const hoyISO = hoy.toISOString().split("T")[0];
  const { inicio: inicioMes, fin: finMes } = inicioFinDeMes(hoy);

  const resumen = {
    recordatorios: 0,
    facturasGeneradas: 0,
    speiGenerados: 0,
    vouchersGenerados: 0,
    suspendidos: 0,
    errores: [] as string[],
  };

  // Todos los contratos vigentes con día de pago definido
  const { data: contratos } = await admin
    .from("contratos")
    .select("id, user_id, renta_mensual, dia_pago, estatus, forma_pago, fecha_inicio, fecha_vencimiento")
    .eq("estatus", "vigente")
    .not("dia_pago", "is", null);

  if (!contratos) {
    return NextResponse.json({ ok: true, resumen });
  }

  // Solo el contrato más reciente por cliente
  const contratoPorCliente = new Map<string, (typeof contratos)[number]>();
  for (const c of contratos) {
    if (!contratoPorCliente.has(c.user_id)) contratoPorCliente.set(c.user_id, c);
  }

  for (const [userId, contrato] of contratoPorCliente) {
    const diaPago = contrato.dia_pago as number;

    const { data: cliente } = await admin
      .from("profiles")
      .select("id, nombre, email, centro, activo, suspendido")
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
          hoy,
          hoyISO,
          inicioMes,
          finMes,
        });
      } catch (err: any) {
        resumen.errores.push(`${cliente.email}: ${err.message}`);
      }
      continue;
    }

    try {
      // ---------- Recordatorio X días antes ----------
      const diaRecordatorio = diaPago - DIAS_RECORDATORIO_ANTES;
      if (diaRecordatorio >= 1 && diaHoy === diaRecordatorio) {
        const yaEnviado = await yaExisteNotifEsteMs(admin, userId, "recordatorio_pago");
        if (!yaEnviado) {
          await admin.from("notificaciones").insert({
            centro: cliente.centro,
            user_id: userId,
            tipo: "recordatorio_pago",
            mensaje: `📅 No se te olvide, tu fecha de pago es el día ${diaPago} de este mes.`,
          });
          if (cliente.email) {
            try {
              await admin.functions?.invoke?.("send-email", {
                body: {
                  tipo: "recordatorio_pago",
                  clienteEmail: cliente.email,
                  clienteNombre: cliente.nombre,
                  diaPago,
                  monto: contrato.renta_mensual,
                },
              });
            } catch {
              /* no crítico */
            }
          }
          resumen.recordatorios++;
        }
      }

      // ---------- Día de pago: generar factura + SPEI + voucher ----------
      if (diaHoy === diaPago) {
        const { data: facturaExistente } = await admin
          .from("facturas")
          .select("id")
          .eq("user_id", userId)
          .gte("fecha_emision", inicioMes)
          .lte("fecha_emision", finMes)
          .maybeSingle();

        let facturaId = facturaExistente?.id;

        if (!facturaExistente) {
          const nombreMes = hoy.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
          const { data: nuevaFactura } = await admin
            .from("facturas")
            .insert({
              user_id: userId,
              folio: `FAC-${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, "0")}-${userId.slice(0, 6)}`,
              concepto: `Renta mensual - ${nombreMes}`,
              monto: contrato.renta_mensual,
              fecha_emision: hoyISO,
              fecha_vencimiento: hoyISO,
              estado: "pendiente",
              centro: cliente.centro,
            })
            .select("id")
            .single();
          facturaId = nuevaFactura?.id;
          resumen.facturasGeneradas++;

          // SPEI automático para esa factura
          if (facturaId) {
            try {
              const cargo = await crearCargoSPEI({
                monto: Number(contrato.renta_mensual),
                descripcion: `Renta mensual - ${nombreMes}`,
                ordenId: facturaId,
                nombre: cliente.nombre || "Cliente Nodus",
                email: cliente.email || "",
              });
              await admin.from("pagos").insert({
                factura_id: facturaId,
                user_id: userId,
                monto: contrato.renta_mensual,
                estado: "pendiente_spei",
                notas: "Cargo SPEI generado automático (cobranza mensual)",
                openpay_charge_id: cargo.id,
                clabe: cargo.payment_method?.clabe || null,
                banco: cargo.payment_method?.bank || null,
                referencia: cargo.payment_method?.reference || cargo.payment_method?.agreement || null,
                fecha_limite: cargo.due_date || null,
              });
              resumen.speiGenerados++;
            } catch (err: any) {
              resumen.errores.push(`SPEI ${cliente.email}: ${err.message}`);
            }
          }

          // Voucher nuevo del mes (solo en centros con UniFi real configurado)
          if (cliente.centro && centroTieneUnifi(cliente.centro)) {
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
        }

        const yaAvisado = await yaExisteNotifEsteMs(admin, userId, "pago_hoy");
        if (!yaAvisado) {
          await admin.from("notificaciones").insert({
            centro: cliente.centro,
            user_id: userId,
            tipo: "pago_hoy",
            mensaje: `💰 Hoy es tu fecha de pago (día ${diaPago}).`,
          });
          if (cliente.email) {
            try {
              await admin.functions?.invoke?.("send-email", {
                body: {
                  tipo: "fecha_pago_hoy",
                  clienteEmail: cliente.email,
                  clienteNombre: cliente.nombre,
                  monto: contrato.renta_mensual,
                },
              });
            } catch {
              /* no crítico */
            }
          }
        }
      }

      // ---------- Después de la gracia: pausar si no pagó ----------
      const diaLimiteGracia = diaPago + DIAS_GRACIA_DESPUES;
      if (diaHoy === diaLimiteGracia) {
        const { data: facturaDelMes } = await admin
          .from("facturas")
          .select("id, estado")
          .eq("user_id", userId)
          .gte("fecha_emision", inicioMes)
          .lte("fecha_emision", finMes)
          .maybeSingle();

        if (facturaDelMes && facturaDelMes.estado !== "pagada") {
          await admin.from("facturas").update({ estado: "vencida" }).eq("id", facturaDelMes.id);
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
