import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: { headers: req.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options) {
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options) {
          res.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const path = req.nextUrl.pathname;
  const isDashboardAdmin = path === "/dashboard" || path.startsWith("/dashboard/");
  const isDashboardCliente = path.startsWith("/dashboard-cliente");
  const isReportes = path.startsWith("/reportes");
  const isTelefonia = path.startsWith("/telefonia");
  const isTickets = path.startsWith("/tickets");
  const isContratos = path.startsWith("/contratos");
  const isCorreos = path.startsWith("/correos");
  const isAltaCliente = path.startsWith("/alta-cliente");
  const isBajaCliente = path.startsWith("/baja-cliente");
  const isTours = path.startsWith("/tours");
  const isSalaJuntas = path.startsWith("/sala-juntas");
  const isMapaOficinas = path.startsWith("/mapa-oficinas");
  const isCotizaciones = path.startsWith("/cotizaciones");
  const isCobranza = path.startsWith("/cobranza");
  const isMantenimiento = path.startsWith("/mantenimiento");
  const isInventario = path.startsWith("/inventario");
  const isCentro = path.startsWith("/centro");
  const isUsuarios = path.startsWith("/usuarios");
  const isEquipos = path.startsWith("/equipos");
  const isPagos = path.startsWith("/pagos");
  const isRegistrarPlan = path.startsWith("/registrar-plan");
  const isPaquetes = path.startsWith("/paquetes");
  const isFacturasAdmin = path.startsWith("/facturas-admin");
  const isExperienciaCliente = path.startsWith("/experiencia-cliente");
  const isIngresosCentro = path.startsWith("/ingresos-centro");
  const isGastos = path.startsWith("/gastos");
  const isProveedores = path.startsWith("/proveedores");
  const isAtencionCliente = path.startsWith("/atencion-cliente");
  const isDiseno = path.startsWith("/diseno");
  const isDecoraciones = path.startsWith("/decoraciones");
  const isDocumentacionCentro = path.startsWith("/documentacion-centro");
  const isProspectos = path.startsWith("/prospectos");
  const isPreciosSalaJuntas = path.startsWith("/precios-sala-juntas");
  const isDepositoGarantia = path.startsWith("/deposito-garantia");
  // El QR del Day Pass manda aquí — es la pantalla donde el staff acepta
  // la llegada del invitado. Requiere sesión, a diferencia del resto de
  // /day-pass/[id] que es público (el link que se le manda al invitado).
  const isDayPassCheckin = /^\/day-pass\/[^/]+\/checkin\/?$/.test(path);
  const isClienteSubpage = [
    "/estado-cuenta",
    "/facturas",
    "/contrato",
    "/soporte",
    "/reservaciones",
    "/mis-reservaciones",
    "/subir-comprobante",
    "/pagar-spei",
    "/quejas-sugerencias",
    "/logros",
    "/mis-encuestas",
    "/mis-visitas",
    "/mi-paqueteria",
    "/calendario-eventos",
    // "Paquetería y Mensajería": la usan tanto clientes como staff, igual
    // que /reservaciones — sin esto, alguien sin sesión se quedaba viendo
    // "Cargando..." sin fin en vez de que lo mandara a /login.
    "/paqueteria",
  ].some((p) => path === p || path.startsWith(p + "/"));
  const isProtected = isDashboardAdmin || isDashboardCliente || isReportes || isTelefonia || isTickets || isCentro || isUsuarios || isEquipos || isContratos || isCorreos || isAltaCliente || isBajaCliente || isTours || isSalaJuntas || isMapaOficinas || isCotizaciones || isCobranza || isMantenimiento || isInventario || isPagos || isRegistrarPlan || isPaquetes || isFacturasAdmin || isGastos || isProveedores || isAtencionCliente || isDiseno || isDecoraciones || isDocumentacionCentro || isExperienciaCliente || isIngresosCentro || isClienteSubpage || isDayPassCheckin || isProspectos || isPreciosSalaJuntas || isDepositoGarantia;

  if (!session && isProtected) {
    // A diferencia de las demás secciones (que se abren desde dentro de la
    // app ya con sesión), aquí es común llegar recién desde el QR sin
    // haber iniciado sesión todavía — con "next" lo regresamos a esta
    // misma pantalla justo después de que ponga usuario y contraseña.
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  let role: string | undefined;
  let suspendido = false;
  if (session) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("rol, suspendido")
      .eq("id", session.user.id)
      .single();
    role = profile?.rol;
    suspendido = !!profile?.suspendido;
  }

  const homeFor = (r?: string) => (r === "cliente" ? "/dashboard-cliente" : "/dashboard");

  // Mismo cuidado que abajo: sin rol reconocido no se saca de /login hacia
  // admin por default — se deja ver /login (una cuenta rota no tiene a
  // dónde más ir de todos modos).
  if (session && path === "/login" && role) {
    return NextResponse.redirect(new URL(homeFor(role), req.url));
  }

  if (session && role === "cliente" && suspendido && path !== "/cuenta-suspendida") {
    return NextResponse.redirect(new URL("/cuenta-suspendida", req.url));
  }

  if (session) {
    // Cuenta autenticada pero sin fila en `profiles` todavía (ej. un alta
    // que falló a medias) — `role` queda undefined. Antes, undefined !==
    // "cliente" mandaba a esa cuenta directo al panel de ADMINISTRADOR por
    // default (ver isDashboardCliente más abajo) — justo el bug reportado.
    // Sin un rol reconocido no se puede decidir a qué panel pertenece, así
    // que se manda a login en vez de caer en admin por default.
    if (!role && path !== "/login") {
      return NextResponse.redirect(new URL("/login", req.url));
    }
    // panel admin, reportes y telefonía son solo para staff (no clientes)
    if ((isDashboardAdmin || isReportes || isTelefonia || isTickets || isCentro || isUsuarios || isEquipos || isContratos || isCorreos || isAltaCliente || isBajaCliente || isTours || isSalaJuntas || isMapaOficinas || isCotizaciones || isCobranza || isMantenimiento || isInventario || isPagos || isRegistrarPlan || isPaquetes || isFacturasAdmin || isGastos || isProveedores || isAtencionCliente || isDiseno || isDecoraciones || isDocumentacionCentro || isExperienciaCliente || isIngresosCentro || isDayPassCheckin || isProspectos || isPreciosSalaJuntas || isDepositoGarantia) && role === "cliente") {
      return NextResponse.redirect(new URL("/dashboard-cliente", req.url));
    }
    // el dashboard de cliente es solo para clientes
    if (isDashboardCliente && role !== "cliente") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
  }

  return res;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/dashboard-cliente/:path*",
    "/reportes/:path*",
    "/telefonia/:path*",
    "/tickets/:path*",
    "/centro/:path*",
    "/usuarios/:path*",
    "/equipos/:path*",
    "/prospectos/:path*",
    "/precios-sala-juntas/:path*",
    "/deposito-garantia/:path*",
    "/contratos/:path*",
    "/correos/:path*",
    "/alta-cliente/:path*",
    "/baja-cliente/:path*",
    "/tours/:path*",
    "/sala-juntas/:path*",
    "/mapa-oficinas/:path*",
    "/cotizaciones/:path*",
    "/cobranza/:path*",
    "/mantenimiento/:path*",
    "/inventario/:path*",
    "/pagos/:path*",
    "/registrar-plan/:path*",
    "/paquetes/:path*",
    "/facturas-admin/:path*",
    "/gastos/:path*",
    "/proveedores/:path*",
    "/atencion-cliente/:path*",
    "/diseno/:path*",
    "/decoraciones/:path*",
    "/documentacion-centro/:path*",
    "/calendario-eventos/:path*",
    "/quejas-sugerencias/:path*",
    "/logros/:path*",
    "/estado-cuenta/:path*",
    "/facturas/:path*",
    "/contrato/:path*",
    "/soporte/:path*",
    "/reservaciones/:path*",
    "/mis-reservaciones/:path*",
    "/subir-comprobante/:path*",
    "/pagar-spei/:path*",
    "/experiencia-cliente/:path*",
    "/mis-encuestas/:path*",
    "/mis-visitas/:path*",
    "/mi-paqueteria/:path*",
    "/paqueteria/:path*",
    "/ingresos-centro/:path*",
    "/day-pass/:id/checkin",
    "/login",
  ],
};
