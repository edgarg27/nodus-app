# nodus-login

Proyecto aparte de nodus-portal y voucher-app: réplica web del panel que ya tiene la app móvil
(OficinaApp), contra la misma base de Supabase (tabla `profiles`, `facturas`, `contratos`,
`pagos`, `oficinas`, `tickets`, `reservaciones`).

## Instalación

```bash
npm install
npm run dev
```

Abre `http://127.0.0.1:3003` (usa `127.0.0.1`, no `localhost`, si tienes el mismo problema de
red que en nodus-portal).

## Rutas y quién ve qué

**Login y ruteo por rol**
- `/login` — correo y contraseña reales contra Supabase Auth. Al iniciar sesión, revisa
  `profiles.rol` y te manda al panel que corresponde. El middleware lo refuerza en cada
  request (un `cliente` no puede forzar `/dashboard` ni `/reportes`, y viceversa).

**Panel staff (rol distinto de `cliente`)**
- `/dashboard` — Panel Admin: resumen (clientes activos, facturas pendientes/vencidas,
  comprobantes por revisar), tab de Clientes con buscador + modal de detalle, grid de Módulos.
- `/reportes` — ocupación de oficinas por centro, clientes por centro, tickets, reservaciones.
  Bloqueado para rol `cliente`.

**Panel cliente (rol `cliente`)**
- `/dashboard-cliente` — próximo pago o "estás al corriente", accesos a Mi espacio y Reservar
  servicios, modal de perfil.
- `/estado-cuenta` — facturas pendientes/vencidas/pagadas con totales, botón para subir
  comprobante en cada una.
- `/subir-comprobante` — sube el comprobante (imagen o PDF) de una factura específica; se
  guarda en el bucket `comprobantes` de Storage e inserta en `pagos` con estado `en_revision`.
- `/facturas` — redirige a `/estado-cuenta` (la pantalla "Facturas" de la app todavía usa datos
  de prueba fijos, no está conectada a Supabase).
- `/contrato` — datos del contrato vigente, tiempo restante con barra de progreso, link al PDF
  si existe.
- `/soporte` — formulario para crear tickets (categoría Sistemas/Mantenimiento, foto opcional u
  obligatoria según categoría) + lista de tickets propios. Intenta notificar por correo vía la
  Edge Function `send-email` que ya tiene el proyecto (si falla, no bloquea el ticket).
- `/reservaciones` — reservar Sala de Juntas A/B, Coworking o Sala de Capacitación: elige
  espacio, fecha (próximos 5 días) y hora inicio/fin, con detección de horarios ocupados en
  vivo.
- `/mis-reservaciones` — lista de reservaciones propias con opción de cancelar (solo si están
  confirmadas).

## Notas

- Los módulos del Panel Admin (Reservaciones, Cobranza, Tickets, Contratos, Mapa oficinas)
  siguen marcados "Próximamente" — solo Reportes está conectado, que fue lo pedido.
- Para que suban archivos (comprobantes, fotos de tickets) sin error, los buckets
  `comprobantes` y `tickets` deben existir en Supabase Storage con permisos de `insert` para
  usuarios autenticados — son los mismos que ya usa la app móvil, así que deberían funcionar
  igual aquí.
# nodus-app
