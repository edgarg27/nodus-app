import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabaseAdmin";
import { centroTienePlantillaCotizacionEspacio, generarPptxCotizacionEspacio } from "@/lib/cotizacionEspacioPptx";
import { convertirPptxAPdf } from "@/lib/cotizacionSalaPptx";

// Mismo flujo que /api/cotizar-sala-pptx, pero para Coworking y Oficina
// Privada (Working Desk se agrega en cuanto llegue su plantilla). Se llama
// justo después de crear la cotización en CotizarForm.tsx → crearCotizacion(),
// para esos tipos de espacio.
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
    tipoEspacio,
    descripcion,
    cantidad,
    personas,
    horasSalaJuntas,
    precioUnitario,
    totalFila,
    subtotal,
    ivaMonto,
    total,
    nombreCotizacion,
    notas,
    nombreDestinatario,
    adicionales,
  } = await req.json();

  if (!centro || !tipoEspacio || !descripcion || precioUnitario == null || subtotal == null || ivaMonto == null || total == null) {
    return NextResponse.json({ error: "Faltan datos de la cotización" }, { status: 400 });
  }

  if (!centroTienePlantillaCotizacionEspacio(tipoEspacio, centro)) {
    return NextResponse.json(
      { error: `Todavía no hay plantilla de PowerPoint para "${tipoEspacio}" en "${centro}".` },
      { status: 400 }
    );
  }

  try {
    const pptxBuffer = await generarPptxCotizacionEspacio({
      centro,
      tipoEspacio,
      descripcion,
      cantidad: cantidad != null ? Number(cantidad) : undefined,
      personas: personas != null ? Number(personas) : undefined,
      horasSalaJuntas: horasSalaJuntas != null ? Number(horasSalaJuntas) : undefined,
      precioUnitario: Number(precioUnitario),
      totalFila: totalFila != null ? Number(totalFila) : undefined,
      subtotal: Number(subtotal),
      ivaMonto: Number(ivaMonto),
      total: Number(total),
      fecha: new Date(),
      notas,
      nombreDestinatario,
      adicionales: Array.isArray(adicionales)
        ? adicionales.map((a: any) => ({
            concepto: String(a.concepto ?? ""),
            cantidad: Number(a.cantidad) || 1,
            costoUnitario: Number(a.costoUnitario) || 0,
          }))
        : undefined,
    });

    const admin = createAdminClient();
    const fileName = `${centro}-${tipoEspacio.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.pptx`;
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
        nombre: nombreCotizacion || `${tipoEspacio}`,
        notas: notas || descripcion,
        archivo_url: archivoUrl,
        archivo_pdf_url: archivoPdfUrl,
        registrado_por: session.user.id,
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