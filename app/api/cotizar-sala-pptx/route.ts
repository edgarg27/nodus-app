import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { centroTienePlantillaCotizacionSala, generarPptxCotizacionSala, convertirPptxAPdf } from "@/lib/cotizacionSalaPptx";

// RECONSTRUCCIÓN (2026-09-07): este archivo tenía por error el flujo de
// Coworking/Oficina Privada — se movió a app/api/cotizar-espacio-pptx/route.ts
// (que es la ruta que ya llama CotizarForm.tsx aparte, línea ~1263), y
// este es el flujo real de Sala de Juntas, reconstruido desde el payload
// que ya envía CotizarForm.tsx en su llamada a "/api/cotizar-sala-pptx"
// (línea ~974) justo después de crear la cotización en crearCotizacion().
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

  const {
    centro,
    tamano,
    descripcion,
    precioUnitario,
    subtotal,
    ivaMonto,
    total,
    coffeeDescripcion,
    coffeeCantidad,
    coffeePrecioUnitario,
    coffeeTotal,
    nombreCotizacion,
    notas,
    nombreDestinatario,
    cotizacionComercialId,
  } = await req.json();

  if (!centro || !descripcion || precioUnitario == null || subtotal == null || ivaMonto == null || total == null) {
    return NextResponse.json({ error: "Faltan datos de la cotización" }, { status: 400 });
  }

  if (!centroTienePlantillaCotizacionSala(centro)) {
    return NextResponse.json(
      { error: `Todavía no hay plantilla de PowerPoint de Sala de Juntas para "${centro}".` },
      { status: 400 }
    );
  }

  try {
    const pptxBuffer = await generarPptxCotizacionSala({
      centro,
      tamano,
      descripcion,
      precioUnitario: Number(precioUnitario),
      subtotal: Number(subtotal),
      ivaMonto: Number(ivaMonto),
      total: Number(total),
      fecha: new Date(),
      notas,
      nombreDestinatario,
      coffeeDescripcion,
      coffeeCantidad: coffeeCantidad != null ? Number(coffeeCantidad) : undefined,
      coffeePrecioUnitario: coffeePrecioUnitario != null ? Number(coffeePrecioUnitario) : undefined,
      coffeeTotal: coffeeTotal != null ? Number(coffeeTotal) : undefined,
    });

    const admin = createAdminClient();
    const fileName = `${centro}-sala-de-juntas-${Date.now()}.pptx`;
    const { error: upErr } = await admin.storage.from("cotizaciones").upload(fileName, pptxBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      upsert: true,
    });
    if (upErr) {
      return NextResponse.json({ error: "No se pudo subir el PowerPoint: " + upErr.message }, { status: 500 });
    }
    const archivoUrl = admin.storage.from("cotizaciones").getPublicUrl(fileName).data.publicUrl;

    let archivoPdfUrl: string | null = null;
    const pdfBuffer = await convertirPptxAPdf(pptxBuffer);
    if (pdfBuffer) {
      const pdfFileName = fileName.replace(/\.pptx$/, ".pdf");
      const { error: upPdfErr } = await admin.storage.from("cotizaciones").upload(pdfFileName, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (!upPdfErr) {
        archivoPdfUrl = admin.storage.from("cotizaciones").getPublicUrl(pdfFileName).data.publicUrl;
      }
    }

    const { data: cotizacionGuardada, error: insertError } = await admin
      .from("cotizaciones")
      .insert({
        centro,
        nombre: nombreCotizacion || `Sala de Juntas ${tamano || ""}`.trim(),
        notas: notas || descripcion,
        archivo_url: archivoUrl,
        archivo_pdf_url: archivoPdfUrl,
        registrado_por: session.user.id,
        cotizacion_comercial_id: cotizacionComercialId || null,
        estatus: "pendiente",
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: "El PowerPoint se generó pero no se pudo registrar en Cotizaciones." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, archivo_url: archivoUrl, cotizacion: cotizacionGuardada });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "No se pudo generar el PowerPoint" }, { status: 500 });
  }
}
