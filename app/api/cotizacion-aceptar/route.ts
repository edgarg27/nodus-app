import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { generarContratoDocx, normalizarTipoEspacioContrato } from "@/lib/contratoDocx";
import { rentaMensualConIva } from "@/lib/formaPago";
import { esFueraDeHorario, parseHorarioSala, salasDelCentro } from "@/lib/horarioSala";

// Botón "✓ Aceptar" en /cotizaciones: redacta el contrato en .docx con los
// datos de la venta ya capturados en CotizarForm.tsx (cotizaciones_comerciales)
// y crea el registro en `contratos` como "pre_aprobado" — mismo patrón de
// auth y de doble cliente Supabase que /api/cotizar-espacio-pptx.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const { data: miProfile } = await supabase.from("profiles").select("rol").eq("id", session.user.id).single();
  if (!miProfile || miProfile.rol === "cliente") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "Falta el id de la cotización" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: cotizacion, error: cotizacionError } = await admin
    .from("cotizaciones")
    .select("*")
    .eq("id", id)
    .single();
  if (cotizacionError || !cotizacion) {
    return NextResponse.json({ error: "No se encontró la cotización" }, { status: 404 });
  }
  if (cotizacion.estatus === "aceptada") {
    return NextResponse.json({ error: "Esta cotización ya fue aceptada" }, { status: 400 });
  }
  if (!cotizacion.cotizacion_comercial_id) {
    return NextResponse.json({ error: "Esta cotización todavía no está ligada a una venta" }, { status: 400 });
  }

  const { data: venta, error: ventaError } = await admin
    .from("cotizaciones_comerciales")
    .select("*")
    .eq("id", cotizacion.cotizacion_comercial_id)
    .single();
  if (ventaError || !venta) {
    return NextResponse.json({ error: "No se encontró la venta ligada a esta cotización" }, { status: 404 });
  }

  const tipoEspacio = normalizarTipoEspacioContrato(venta.tipo_espacio || "");
  if (!tipoEspacio) {
    return NextResponse.json({ error: `Tipo de espacio "${venta.tipo_espacio}" no reconocido para generar el contrato.` }, { status: 400 });
  }
  // Sala de Juntas es una reserva: no lleva contrato ni RFC (el formulario ni
  // siquiera lo pide). Aceptar la cotización aparta el horario en el calendario
  // y la marca como aceptada.
  if (tipoEspacio === "Sala de Juntas") {
    const horario = parseHorarioSala(venta.tipo_espacio);
    const fecha = venta.fecha_inicio ? String(venta.fecha_inicio).slice(0, 10) : "";
    if (!horario || !fecha) {
      return NextResponse.json(
        { error: "No se pudo leer la fecha y el horario de esta cotización para reservar la sala." },
        { status: 400 }
      );
    }
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    if (fecha < hoy) {
      return NextResponse.json({ error: "La fecha de esta cotización ya pasó: no se puede reservar la sala." }, { status: 400 });
    }

    const hhmm = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;
    const hora12 = (h: number) => {
      const n = h % 24;
      if (n === 0) return "12:00 AM";
      if (n < 12) return `${n}:00 AM`;
      if (n === 12) return "12:00 PM";
      return `${n - 12}:00 PM`;
    };
    const horasDelRango = Array.from({ length: horario.horaFin - horario.horaInicio }, (_, i) => horario.horaInicio + i);

    // A nombre del cliente si ya tiene cuenta; si no, de quien acepta (igual que
    // cuando el admin reserva directo desde el calendario). En el calendario se
    // muestra el nombre de la cotización (cotizacion_id).
    let reservada = false;
    for (const espacio of salasDelCentro(venta.centro)) {
      const { error: resError } = await admin.from("reservaciones").insert({
        user_id: venta.cliente_id ?? session.user.id,
        espacio,
        fecha,
        hora: `${hora12(horario.horaInicio)} - ${hora12(horario.horaFin)}`,
        hora_inicio: hhmm(horario.horaInicio),
        hora_fin: hhmm(horario.horaFin),
        centro: venta.centro,
        estado: "confirmada",
        fuera_horario: horasDelRango.some((h) => esFueraDeHorario(fecha, h)),
        horas_incluidas: 0,
        horas_extra: 0,
        costo_extra: 0,
        cotizacion_id: venta.id,
      });
      if (!resError) {
        reservada = true;
        break;
      }
      // 23P01 = ese horario ya está ocupado en esa sala (ver
      // migracion_no_traslape_reservaciones.sql): se prueba con la siguiente.
      if (resError.code !== "23P01") {
        return NextResponse.json({ error: "No se pudo reservar la sala: " + resError.message }, { status: 500 });
      }
    }
    if (!reservada) {
      return NextResponse.json(
        { error: "Ese horario ya está ocupado en el calendario. Libera el horario o cotiza otra fecha antes de aceptar." },
        { status: 409 }
      );
    }

    const { error: salaError } = await admin.from("cotizaciones").update({ estatus: "aceptada" }).eq("id", id);
    if (salaError) {
      return NextResponse.json({ error: "La sala se reservó pero no se pudo marcar la cotización como aceptada." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, contrato: null, reservada: true });
  }
  if (!venta.rfc || !String(venta.rfc).trim()) {
    return NextResponse.json({ error: "Falta el RFC del cliente — captúralo al cotizar en CotizarForm." }, { status: 400 });
  }
  // tipo_persona lo agrega la migración de Persona A — mientras no exista
  // la columna (o no se haya capturado), se asume persona física.
  const tipoPersona = venta.tipo_persona === "moral" ? "moral" : "fisica";

  try {
    const fmtFecha = (f: string | null) =>
      f ? new Date(f).toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" }) : null;

    const precioMensual = Number(venta.precio_pactado ?? venta.cargo_recurrente ?? venta.precio_neto ?? 0);
    const depositoGarantia = Number(venta.deposito_garantia ?? 0);
    const rentaPeriodoConIva =
      venta.precio_neto != null ? Number(venta.precio_neto) : Math.round(precioMensual * 1.16 * 100) / 100;
    const rentaContrato =
      venta.forma_pago === "mensual"
        ? rentaMensualConIva(rentaPeriodoConIva, Number(venta.duracion_meses) || 1)
        : rentaPeriodoConIva;

    // Se necesita el nombre del paquete para detectar el paquete "30
    // Horas" (contrato de término fijo distinto al resto de Coworking) —
    // ver lib/contratoDocx.ts → resolverVarianteCoworking — y las horas de
    // sala de juntas que incluye, para reflejarlas en el contrato.
    let nombrePaquete: string | null = null;
    let horasSalaJuntas: number | null = null;
    if (venta.paquete_id) {
      const { data: paquete } = await admin
        .from("paquetes")
        .select("nombre, incluye_horas_sala_juntas")
        .eq("id", venta.paquete_id)
        .maybeSingle();
      nombrePaquete = paquete?.nombre ?? null;
      horasSalaJuntas = paquete?.incluye_horas_sala_juntas ?? null;
    }

    // Identificador del espacio asignado ("Coworking 3", "Oficina 10") —
    // se saca de la oficina que ya se ligó al cotizar, no se vuelve a
    // preguntar (ver oficinas.numero).
    let numeroEspacio = "";
    if (venta.oficina_id) {
      const { data: oficina } = await admin.from("oficinas").select("numero").eq("id", venta.oficina_id).maybeSingle();
      numeroEspacio = oficina?.numero ?? "";
    }

    const rfcLimpio = String(venta.rfc).trim().toUpperCase();

    const docxBuffer = await generarContratoDocx({
      centro: venta.centro,
      tipoEspacio,
      tipoPersona,
      nombrePaquete,
      folio: cotizacion.id,
      nombreCliente: venta.nombre_contesta_telefono || "",
      razonSocial: venta.razon_social || "",
      rfc: rfcLimpio,
      numeroEspacio,
      correoCliente: venta.correo_contesta || "",
      fechaInicio: fmtFecha(venta.fecha_inicio),
      fechaFin: fmtFecha(venta.fecha_fin),
      duracionMeses: venta.duracion_meses ?? null,
      horasSalaJuntas,
      precioMensual,
      depositoGarantia,
    });

    const fileName = `${venta.centro}-contrato-${Date.now()}.docx`;
    const { error: upErr } = await admin.storage.from("contratos").upload(fileName, docxBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
    if (upErr) {
      return NextResponse.json({ error: "No se pudo subir el contrato: " + upErr.message }, { status: 500 });
    }
    const archivoUrl = admin.storage.from("contratos").getPublicUrl(fileName).data.publicUrl;

    // Coworking/Oficina Privada/Working Desk ya crean su contrato
    // "pre_aprobado" de inmediato al cotizar (CotizarForm.tsx →
    // crearCotizacion(), líneas ~1225-1254) — solo Sala de Juntas llega
    // aquí sin uno todavía. Para no duplicar el contrato en esos casos,
    // si ya existe uno ligado a esta venta se actualiza (se le pega el
    // .docx recién generado) en vez de crear uno nuevo.
    const { data: contratoExistente } = await admin
      .from("contratos")
      .select("id")
      .eq("cotizacion_id", venta.id)
      .maybeSingle();

    const datosContrato = {
      centro: venta.centro,
      archivo_url: archivoUrl,
      // El machote se preserva aparte de archivo_url — si el staff sube
      // una versión corregida después (ver ContratoModal.tsx), ya no se
      // sobreescribe este campo, solo archivo_url cuando marquen una
      // versión como final.
      archivo_machote_url: archivoUrl,
      cotizacion_id: venta.id,
      user_id: venta.cliente_id ?? null,
      cliente_nombre_historico: venta.nombre_contesta_telefono ?? null,
      cliente_email_historico: venta.correo_contesta ?? null,
      fecha_inicio: venta.fecha_inicio ?? null,
      fecha_vencimiento: venta.fecha_fin ?? null,
      // La renta del contrato se guarda con IVA incluido, igual que la
      // cotización y que al crearse desde CotizarForm.tsx (renta_mensual:
      // precioNeto). Antes se guardaba precio_pactado (sin IVA) y
      // sobrescribía ese valor al aceptar la cotización — y como
      // ContratoModal.tsx → aprobar() cobra renta_mensual tal cual, el
      // cliente quedaba sin IVA en el cobro. El texto del contrato en Word
      // (precioMensual, arriba) no cambia. En mes a mes (Oficina Privada)
      // se guarda la renta de UN mes: precio_neto es el de todo el periodo.
      renta_mensual: rentaContrato,
      forma_pago: venta.forma_pago ?? null,
      deposito_garantia: depositoGarantia,
      horas_sala_juntas: horasSalaJuntas ?? 0,
      paquete_id: venta.paquete_id ?? null,
      oficina_id: venta.oficina_id ?? null,
      rfc: rfcLimpio,
    };

    const { data: contratoCreado, error: insertError } = contratoExistente
      ? await admin.from("contratos").update(datosContrato).eq("id", contratoExistente.id).select().single()
      : await admin
          .from("contratos")
          .insert({ ...datosContrato, estatus: "pre_aprobado" })
          .select()
          .single();
    if (insertError) {
      return NextResponse.json({ error: "El contrato se generó pero no se pudo registrar: " + insertError.message }, { status: 500 });
    }

    const { error: updateError } = await admin.from("cotizaciones").update({ estatus: "aceptada" }).eq("id", id);
    if (updateError) {
      return NextResponse.json({ error: "El contrato se creó pero no se pudo marcar la cotización como aceptada." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, archivo_url: archivoUrl, contrato: contratoCreado });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "No se pudo generar el contrato" }, { status: 500 });
  }
}
