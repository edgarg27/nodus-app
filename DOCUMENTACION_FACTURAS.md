# Módulo "Facturas / Cobranza / Pagos" — Documentación técnica completa

> A diferencia de `DOCUMENTACION_COTIZAR.md` (que describe un módulo que
> se construyó en una sesión concreta), este módulo ya existía en el
> sistema antes de esa sesión — esta documentación es un levantamiento
> del estado actual (código ya en producción), escrita para que sirva
> de referencia si hay que tocarlo o replicarlo en otro proyecto.
> Cotizar/Contratos **generan** pagos (ver `DOCUMENTACION_COTIZAR.md`
> regla #3), pero el ciclo de vida completo de cobro — SPEI automático,
> comprobantes manuales, cobranza mensual, sincronización de estatus —
> vive aquí.

---

## 1. Los dos "mundos" de pago que coexisten

El sistema tiene **dos flujos de pago distintos**, que comparten la
misma tabla `pagos` pero no se cruzan en la práctica:

### 1.1 Pagos simulados ligados a un Contrato (sin factura)

Los que genera Cotizar/Contratos al aprobar un contrato (renta,
depósito, adicionales — ver `DOCUMENTACION_COTIZAR.md` regla #3) o una
Reserva al crearse. Se insertan con `factura_id: null` vía
`POST /api/pagos/crear`, que arma un link `/pagar-simulado/{pagoId}` y
lo guarda en `pagos.link_pago`. El cliente (o quien tenga el link)
entra ahí y da clic en "Simular pago" → `POST /api/pagos/simular` pasa
ese pago a `estado: 'pagado'`. **No hay dinero real de por medio**, es
un botón de confirmación manual — de ahí el nombre.

### 1.2 Facturación real de renta mensual (con factura + Openpay SPEI)

Las facturas de renta mensual que genera el cron `facturacion-diaria`
automáticamente cada mes, ligadas a un `contrato.dia_pago`. Estas sí
tienen una `factura_id` y dos formas de pagarse:
- **SPEI automático vía Openpay** (`/pagar-spei` → `/api/generar-spei`
  → `/api/verificar-spei` y/o el webhook `/api/webhooks/openpay`) — el
  cliente transfiere a una CLABE real y el pago se confirma solo.
- **Comprobante manual** (`/subir-comprobante`) — el cliente sube una
  imagen/PDF y el pago queda `en_revision` hasta que el staff lo
  aprueba a mano desde `/pagos` (botón "✓ Marcar como pagado", que
  internamente llama al mismo `/api/pagos/simular` del punto 1.1).

En ambos casos, el **estatus de la factura nunca se actualiza a mano**
— lo hace un trigger de base de datos (`sync_factura_estado`, ver
sección 3) cada vez que cambia un `pago` vinculado a ella.

---

## 2. Modelo de datos

### 2.1 `facturas`

Columnas usadas por el código: `id, user_id, folio, concepto, monto,
fecha_emision, fecha_vencimiento, estado, centro, archivo_url,
created_at`.

- `estado`: `'pendiente'` | `'parcial'` | `'pagada'` | `'vencida'`.
- `archivo_url`: PDF/imagen subido por staff al crear la factura desde
  `/facturas-admin` (bucket de storage `facturas`, público de lectura
  — creado en `supabase_facturas_modulo.sql`). Las facturas generadas
  automáticamente por el cron **no** traen `archivo_url`.
- No hay FK explícita de `facturas.user_id` a `contratos` — una
  factura es del cliente, no de un contrato específico (un cliente con
  varios contratos igual solo recibe una factura de renta al mes, ver
  sección 4).

### 2.2 `pagos` (tabla compartida entre los dos "mundos" de la sección 1)

Columnas relevantes (algunas agregadas en `supabase_pagos_modulo.sql`:
`concepto`, `contrato_id`, `centro`, `link_pago`; el resto —
`factura_id`, `openpay_charge_id`, `clabe`, `banco`, `referencia`,
`fecha_limite`, `notas`, `comprobante_url`, `fecha_pago` — ya existían
en la tabla antes de esa migración, no hay un archivo `.sql` en el
repo que las cree):

- `id, user_id, monto, concepto, estado, contrato_id, centro,
  link_pago` — usados por el flujo 1.1 (simulado).
- `factura_id` — FK a `facturas`; presente en los pagos del flujo 1.2,
  `null` en los del 1.1. Es la columna que el trigger `sync_factura_estado`
  usa para saber a qué factura recalcularle el estatus.
- `openpay_charge_id, clabe, banco, referencia, fecha_limite` — datos
  del cargo SPEI devueltos por Openpay (`crearCargoSPEI`, ver 5.2).
- `comprobante_url` — imagen/PDF subido por el cliente en
  `/subir-comprobante` (bucket de storage `comprobantes`).
- `notas` — texto libre, se usa para dejar constancia de cómo se
  generó el pago (`"Cargo SPEI generado automático (cobranza
  mensual)"`, `"Comprobante enviado por cliente"`, etc.) — es
  informativo, ningún código lo lee para tomar decisiones.
- `estado`: `'pendiente'` | `'pendiente_spei'` | `'en_revision'` |
  `'pagado'`. `'pendiente'` es del flujo simulado; `'pendiente_spei'`
  y `'en_revision'` son del flujo real (SPEI generado / comprobante
  subido, ambos esperando confirmación); `'pagado'` es el estado final
  de cualquiera de los dos flujos.

### 2.3 `profiles.suspendido` / `.suspendido_desde`

Un cliente queda `suspendido: true` cuando el cron detecta que pasó su
fecha límite de gracia sin pagar (sección 4). Se vuelve a poner en
`false` automáticamente en cuanto se confirma cualquier pago SPEI
(`/api/verificar-spei` y el webhook de Openpay lo hacen explícito) —
**no** se limpia solo al aprobar un comprobante manual vía
`/api/pagos/simular` (ver "cosas a vigilar", sección 7).

### 2.4 Buckets de Storage

- `facturas` — PDF/imagen de una factura subida por staff.
- `comprobantes` — comprobante de pago subido por el cliente.
- `contratos` y `cotizaciones` — de otros módulos, no de este, se
  mencionan aquí solo para no confundirlos.

---

## 3. El trigger `sync_factura_estado` (regla central del módulo)

Definido en `supabase_facturas_modulo.sql`. Se dispara `after insert
or update of estado or delete on public.pagos` — es decir, cualquier
alta, cambio de `estado`, o borrado de un pago recalcula el estatus de
la factura a la que apunte `pagos.factura_id` (si tiene una).

```sql
select count(*), count(*) filter (where estado = 'pagado')
  into total, pagados
  from public.pagos
  where factura_id = fid;

if total > 0 and pagados = total then
  update facturas set estado = 'pagada' where id = fid and estado is distinct from 'pagada';
elsif pagados > 0 then
  update facturas set estado = 'parcial' where id = fid and estado not in ('pagada');
end if;
```

**Regla clave: el trigger solo "sube" el estatus, nunca lo baja.** Si
ningún pago vinculado está `pagado` todavía, no toca nada — deja lo
que ya estaba (`pendiente` o `vencida`). Esto es deliberado para no
pisar el estado `'vencida'` que pone el cron de facturación (sección
4) ni el `'pendiente'` inicial. Si se necesita revertir una factura de
`'pagada'` a otra cosa (ej. un pago se marcó por error), hay que
hacerlo a mano — el trigger no lo hace.

**Implicación para `/facturas-admin`:** cuando el staff vincula pagos
existentes a una factura (`POST /api/pagos/vincular`, solo hace
`update pagos set factura_id = ...`), el trigger normal de `pagos` no
se dispara porque ese `update` cambia `factura_id`, no `estado` — el
estatus de la factura solo se recalcula la próxima vez que alguno de
esos pagos cambie de `estado` (ej. cuando se marque como pagado). Si
se vincula un pago que **ya estaba** `pagado` antes de vincularse, la
factura **no se actualiza automáticamente en ese momento** — queda
pendiente hasta el siguiente cambio de estado de algún pago vinculado.
Es un caso raro (normalmente se vincula un pago recién creado, en
`pendiente`), pero vale la pena tenerlo presente.

---

## 4. `app/api/cron/facturacion-diaria/route.ts` — cobranza mensual automática

Se puede invocar de dos formas: con el secreto de cron
(`Authorization: Bearer ${CRON_SECRET}`, para la tarea programada real)
o con sesión de staff autenticado (para el botón "⚡ Ejecutar cobranza
ahora" de `/cobranza`, útil para probar/forzar mientras el cron real
no está configurado). Recorre **el contrato `vigente` más reciente por
cliente** (`contratoPorCliente`, un `Map` por `user_id` — si un
cliente tiene más de un contrato vigente, el cron **solo cobra el más
reciente**, no la suma de todos) con `dia_pago` definido, y por cada
uno, según el día del mes actual:

| Momento | Acción |
|---|---|
| `dia_pago - 3` | Notificación + email de recordatorio (una sola vez al mes, controlado con `yaExisteNotifEsteMs`). |
| `dia_pago` | Si no existe ya una factura de ese mes para el cliente: crea la factura (`folio: FAC-{año}{mes}-{id.slice(0,6)}`, `monto: contrato.renta_mensual`, `estado: 'pendiente'`) **+** genera un cargo SPEI automático vía Openpay y su `pago` correspondiente (`estado: 'pendiente_spei'`) **+** si el centro tiene UniFi real configurado (`centroTieneUnifi`), renueva el voucher de wifi del cliente (43200 min = 30 días). Además manda notificación/email de "hoy es tu día de pago". |
| `dia_pago + 3` | Si la factura de ese mes **no** quedó `pagada`: la marca `vencida`, suspende al cliente (`profiles.suspendido = true`), revoca su voucher de wifi real si tenía uno, y notifica. |

Los tres bloques son independientes entre sí y se evalúan cada uno
según si `diaHoy` coincide exactamente con esa fecha — el cron está
pensado para correr **una vez al día**, no en batch retroactivo (si se
salta un día de corrida, esos eventos puntuales no se recuperan solos).

`resumen` (devuelto en la respuesta y mostrado en `/cobranza`) trae
contadores de cada acción más un arreglo de `errores` — los `try/catch`
por cliente están para que un error de Openpay/UniFi con un cliente no
tumbe la corrida completa de los demás.

---

## 5. SPEI real vía Openpay

### 5.1 `lib/openpay.ts`

Cliente REST mínimo, dos funciones, ambas solo llamables desde
servidor (usan `OPENPAY_PRIVATE_KEY`, nunca debe llegar al navegador):

- `crearCargoSPEI({ monto, descripcion, ordenId, nombre, email,
  diasVigencia })` → `POST /{merchantId}/charges` con `method:
  "bank_account"`, `due_date` a N días (default 3). Devuelve
  `{ id, status, payment_method: { clabe, bank, reference }, due_date
  }`.
- `consultarCargo(chargeId)` → `GET .../charges/{chargeId}`. Se usa
  para **siempre reconfirmar** el estatus real en vez de confiar en lo
  que llega en un webhook o en lo que el cliente dice.

### 5.2 Flujo cliente: `/pagar-spei` → `/api/generar-spei` → `/api/verificar-spei`

1. `/pagar-spei?facturaId=...` llama `POST /api/generar-spei` al
   montar. Ese endpoint valida que la factura sea del propio usuario
   autenticado (`.eq("user_id", session.user.id)`) y que no esté ya
   `pagada`; si ya existe un `pago` `pendiente_spei` **vigente**
   (`fecha_limite > ahora`) para esa factura, lo reutiliza en vez de
   pedirle a Openpay un cargo nuevo cada vez que el cliente entra a la
   pantalla.
2. La pantalla muestra CLABE/banco/referencia/vigencia y un botón "🔄
   Ya transferí, verificar" → `POST /api/verificar-spei`, que llama
   `consultarCargo` y, si `status === "completed"`: marca el `pago`
   `pagado`, des-suspende al cliente (`profiles.suspendido = false`),
   marca la `factura` `pagada` **directamente** (no depende del
   trigger aquí, lo hace explícito) y manda una notificación al staff
   del centro.

### 5.3 `app/api/webhooks/openpay/route.ts`

Endpoint público que Openpay llama cuando cambia el estatus de un
cargo (server-to-server, sin sesión de usuario). **Nunca confía en el
contenido del webhook a ciegas** — vuelve a llamar `consultarCargo`
con la llave privada antes de marcar cualquier cosa como pagada. Hace
exactamente lo mismo que `/api/verificar-spei` (marcar pago + factura
+ des-suspender + notificar), pero localizando el `pago` por
`openpay_charge_id` en vez de por `pagoId` de sesión — es la vía por
la que se confirma un pago aunque el cliente nunca vuelva a abrir
`/pagar-spei` después de transferir. Siempre responde `200 { ok: true
}` (Openpay solo necesita eso para dejar de reintentar), incluso si
hubo un error interno — los errores se loggean con `console.error`,
no se propagan al llamador.

### 5.4 Comprobante manual: `/subir-comprobante` → revisión en `/pagos`

Camino alterno para clientes que prefieren pagar por otro medio y
subir su comprobante en vez de usar SPEI. `POST` directo (desde el
cliente, con su propia sesión) un `insert` en `pagos` con `estado:
'en_revision'` y `comprobante_url`. **No hay validación automática
del comprobante** — un staff tiene que entrar a `/pagos`, ver el pago
en `en_revision`, y darle "✓ Marcar como pagado" (llama
`/api/pagos/simular`, el mismo endpoint del flujo simulado de la
sección 1.1). Esto dispara el trigger `sync_factura_estado`, que
recién ahí marca la factura como `pagada`/`parcial`.

---

## 6. Componentes / páginas

| Archivo | Rol |
|---|---|
| `app/facturas-admin/page.tsx` | (staff) CRUD de facturas: crear factura manual, vincular pagos existentes sin factura, ver pagos vinculados, exportar a Excel, asignar cliente a facturas importadas sin RFC identificado, filtros de búsqueda (texto/estado/fuente/fechas/sin cliente — ver sección 9.5). |
| `app/facturas-admin/importar/page.tsx` | (staff) Importación masiva de CFDI (XML/PDF/ZIP) — ver sección 9. |
| `lib/cfdi.ts` | Parseo de CFDI (XML → objeto tipado) con `DOMParser`, sin dependencias — ver sección 9.2. |
| `app/facturas/page.tsx` | (cliente) **Placeholder** — hace `redirect("/estado-cuenta")`, no está conectado a Supabase todavía (ver sección 7). |
| `app/estado-cuenta/page.tsx` | (cliente) Vista real de sus facturas: pendientes/vencidas/pagadas, marca vencidas al vuelo si `fecha_vencimiento` ya pasó (`update` directo desde el cliente antes de leer), botones "Pagar por SPEI" y "Ya pagué, subir comprobante" por cada factura pendiente/vencida. |
| `app/pagar-spei/page.tsx` | (cliente) Genera/muestra la ficha SPEI (CLABE, banco, referencia, vigencia) y botón de verificación manual. |
| `app/subir-comprobante/page.tsx` | (cliente) Sube el comprobante y crea el `pago` en `en_revision`. |
| `app/pagar-simulado/[id]/page.tsx` | (cualquiera con el link) Pantalla de "Simular pago" para pagos del flujo 1.1 (renta/depósito/adicionales de un contrato recién aprobado, o una reserva). |
| `app/pagos/page.tsx` | (staff) Lista todos los pagos del centro (ambos flujos mezclados), botón "✓ Marcar como pagado" — es la vía de aprobación tanto de comprobantes `en_revision` como de cualquier otro pago pendiente. |
| `app/cobranza/page.tsx` | (staff) Panel de estatus de cobranza por cliente (día de pago, última factura, suspendido) + botón para forzar la corrida del cron manualmente. |
| `app/api/cron/facturacion-diaria/route.ts` | Cron diario: recordatorios, generación de factura+SPEI+voucher, suspensión por impago (sección 4). |
| `app/api/generar-spei/route.ts` | Genera/reutiliza un cargo SPEI para una factura del propio usuario autenticado. |
| `app/api/verificar-spei/route.ts` | Reconsulta un cargo en Openpay y confirma el pago si ya está `completed`. |
| `app/api/webhooks/openpay/route.ts` | Webhook público de Openpay — confirma pagos server-to-server. |
| `app/api/pagos/crear/route.ts` | (staff, usado por Cotizar/Contratos) Crea un `pago` simulado (sin factura) + su `link_pago`. |
| `app/api/pagos/simular/route.ts` | **Público, sin auth** — pasa a `pagado` un pago **sin `factura_id`**. Usado solo por el cliente en `/pagar-simulado` (flujo 1.1). Ya no lo usa `/pagos`. |
| `app/api/pagos/marcar-pagado/route.ts` | (staff, con sesión + rol ≠ cliente) Pasa a `pagado` cualquier pago, incluidos los vinculados a una factura. Usado por `/pagos` (botón "Marcar como pagado"), reemplazando el uso que antes le daba a `/api/pagos/simular`. |
| `app/api/pagos/vincular/route.ts` | (staff) Asocia uno o más `pagos.id` existentes a una `facturas.id`. |
| `app/api/pagos/route.ts` | (staff) Lista pagos de un centro, con nombre/email/empresa del cliente resueltos. |
| `app/api/pagos/[id]/route.ts` | Detalle de un pago (usado por `/pagar-simulado/[id]`). |
| `lib/openpay.ts` | Cliente REST mínimo de Openpay (`crearCargoSPEI`, `consultarCargo`). |

---

## 7. Cosas a vigilar / gaps conocidos

1. **`app/facturas/page.tsx` es un placeholder.** El tile "Facturas"
   del lado cliente no muestra nada propio — redirige a
   `/estado-cuenta`, que sí es la vista real y funcional. Si en algún
   momento se separan conceptualmente "Facturas" de "Estado de
   Cuenta" en el producto, aquí es donde hay que construir la vista de
   verdad.
2. ~~`/api/pagos/simular` no valida sesión ni rol.~~ **Resuelto
   (2026-08-19).** Se separaron los dos usos: `/api/pagos/simular` sigue
   público (lo necesita el link sin sesión de `/pagar-simulado`) pero
   ahora solo acepta pagos **sin `factura_id`** — un pagoId adivinado ya
   no puede aprobar un pago real de facturación. El botón "Marcar como
   pagado" de `/pagos` (staff) ahora llama a
   `app/api/pagos/marcar-pagado/route.ts`, que sí exige sesión y
   `rol !== 'cliente'` y acepta cualquier pago, incluidos los que tienen
   `factura_id`.
3. ~~Des-suspensión automática solo cubre el camino SPEI.~~ **Resuelto
   (2026-08-19).** Tanto `/api/pagos/simular` como
   `/api/pagos/marcar-pagado` ahora limpian `profiles.suspendido = false`
   del `user_id` del pago al marcarlo `pagado`, igual que ya hacían
   `/api/verificar-spei` y el webhook de Openpay.
4. **El cron solo cobra el contrato `vigente` más reciente por
   cliente.** Un cliente con dos contratos vigentes (dos espacios
   distintos, ver `DOCUMENTACION_COTIZAR.md` regla #14) solo genera
   una factura de renta al mes, por el contrato más reciente — la
   renta del otro contrato no se factura automáticamente por este
   cron.
5. **No hay archivo `.sql` en el repo para varias columnas de `pagos`**
   (`factura_id`, `openpay_charge_id`, `clabe`, `banco`, `referencia`,
   `fecha_limite`, `notas`, `comprobante_url`, `fecha_pago`) ni para las
   columnas base de la tabla `facturas` (`id, user_id, folio, concepto,
   monto, fecha_emision, fecha_vencimiento, estado, centro,
   archivo_url, created_at`) — ya existían en la base antes de que este
   repo empezara a versionar migraciones en archivos `.sql` sueltos.
   Las columnas CFDI agregadas para la importación masiva (sección 9)
   sí están versionadas en `supabase_facturas_cfdi_import.sql`. Si se
   replica este módulo en otro proyecto desde cero, hay que crear las
   tablas/columnas base a mano (ver checklist, sección 8).
6. **El reporte de una importación es efímero.** Vive solo en el
   estado de React de `/facturas-admin/importar` mientras esa corrida
   está en pantalla — no se persiste en ninguna tabla. Si el staff
   recarga la página o cierra la pestaña después de importar, pierde
   la lista de "qué salió con problema" (aunque las facturas ya
   importadas siguen ahí, por supuesto). El único rastro persistente
   de una corrida es exportar el reporte a Excel antes de salir, o
   filtrar después en `/facturas-admin` por `fuente = 'cfdi_import'`
   y `user_id is null` para encontrar las que quedaron sin cliente.

---

## 8. Checklist de replicación en otro proyecto

1. Crear la tabla `facturas` (`id, user_id, folio, concepto, monto,
   fecha_emision, fecha_vencimiento, estado, centro, archivo_url,
   created_at`) si no existe.
2. Agregar a `pagos` las columnas de la sección 2.2 que falten
   (`factura_id`, `openpay_charge_id`, `clabe`, `banco`, `referencia`,
   `fecha_limite`, `notas`, `comprobante_url`, `fecha_pago`, más las
   cuatro de `supabase_pagos_modulo.sql`: `concepto`, `contrato_id`,
   `centro`, `link_pago`).
3. Correr `supabase_facturas_modulo.sql` (bucket `facturas` + trigger
   `sync_factura_estado`) y crear también el bucket `comprobantes`.
4. Agregar `profiles.suspendido` / `.suspendido_desde` si no existen.
5. Configurar las variables de entorno de Openpay
   (`OPENPAY_API_URL`, `OPENPAY_MERCHANT_ID`, `OPENPAY_PRIVATE_KEY`) y
   dar de alta el webhook `POST /api/webhooks/openpay` en el panel de
   Openpay.
6. Programar la tarea cron (`POST /api/cron/facturacion-diaria` una
   vez al día, con header `Authorization: Bearer ${CRON_SECRET}`) en
   el proveedor de hosting — mientras tanto, el botón de `/cobranza`
   sirve para forzarlo a mano.
7. Replicar `lib/openpay.ts` tal cual (sin dependencias externas más
   que `fetch`).
8. El gap de seguridad de `/api/pagos/simular` ya está resuelto (punto 2
   de la sección 7) — replicar también `app/api/pagos/marcar-pagado/route.ts`.
9. Correr `tsc --noEmit` al final.
10. Si se replica también la importación masiva de CFDI: correr
    `supabase_facturas_cfdi_import.sql`, instalar `jszip`, y copiar
    `lib/cfdi.ts` + `app/facturas-admin/importar/page.tsx` (sección 9).

---

## 9. Importación masiva de CFDI (XML/PDF/ZIP)

Vía adicional para dar de alta facturas — **no reemplaza** el
formulario manual de `/facturas-admin` ni el cron de cobranza mensual
(sección 4), que siguen intactos. Vive en `/facturas-admin/importar`,
protegida por el mismo matcher de `middleware.ts` que ya cubre
`/facturas-admin/:path*` (staff-only, sin cambios en el middleware).

### 9.1 Modelo de datos

`supabase_facturas_cfdi_import.sql` agrega a `facturas` (todas
nullable, no rompe nada de lo que ya inserta el cron ni el formulario
manual):

`uuid_cfdi` (folio fiscal del Timbre Fiscal Digital — **único, índice
parcial `where uuid_cfdi is not null`**, es la base de la
deduplicación), `serie`, `folio_fiscal`, `rfc_emisor`, `nombre_emisor`,
`rfc_receptor`, `nombre_receptor`, `subtotal`, `iva`, `retenciones`,
`moneda`, `tipo_comprobante`, `forma_pago`, `metodo_pago`, `uso_cfdi`,
`conceptos` (jsonb, arreglo completo de líneas), `impuestos` (jsonb,
traslados/retenciones completos, no solo los totales), `xml_url`,
`fuente` (`'manual'` default | `'cfdi_import'`).

Columnas existentes reutilizadas para no romper nada de lo que ya lee
el resto del sistema: `monto` = Total del CFDI; `folio` = `` `${serie} ${folio_fiscal}` `` (o los primeros 8 caracteres del UUID si el CFDI no trae serie/folio); `concepto` = descripción de los conceptos, unida y truncada a 200 caracteres; `fecha_emision`/`fecha_vencimiento` = misma fecha del CFDI en ambas (igual criterio que ya usa el cron para sus propias facturas); `archivo_url` = URL del PDF; `user_id` = `null` si no se encontró el cliente ("Cliente no identificado").

### 9.2 `lib/cfdi.ts` — parseo del XML

`parsearCfdi(xmlText: string): { data: CfdiParseado | null; error?: string }`
— corre en el navegador con `DOMParser` nativo, **sin ninguna
dependencia**. Busca los elementos por nombre local en vez de tag
calificado (`getElementsByTagNameNS("*", nombre)` con fallback a
`getElementsByTagName`), para no importar si el XML es CFDI 3.3 o 4.0
— ambas versiones usan los mismos nombres de tag/atributo para lo que
se lee aquí (`Comprobante`, `Emisor`, `Receptor`, `Concepto`,
`Impuestos`, `Traslado`, `Retencion`, `TimbreFiscalDigital`).

Falla (`error`, sin `data`) si: el parser generó un nodo
`parsererror` (XML mal formado), no hay un elemento `Comprobante`, no
hay `TimbreFiscalDigital[@UUID]`, o no hay `Receptor[@Rfc]` — sin
UUID no hay forma de deduplicar, y sin RFC receptor no hay forma de
relacionar cliente, así que ambos son requisito mínimo para
considerar el CFDI válido para este flujo.

`normalizarRfc()` (`trim().toUpperCase()`) y `nombreBase()`
(nombre de archivo sin extensión, en minúsculas) son los dos
helpers de matching que usa la página de importación.

### 9.3 Flujo en `app/facturas-admin/importar/page.tsx`

1. Selector de centro (mismo patrón `ROLES_GLOBALES`/`esGlobal` que
   `/facturas-admin`) — se usa como `centro` de respaldo cuando el
   XML no matchea a ningún cliente.
2. `<input type="file" multiple accept=".xml,.pdf,.zip">`. Al elegir
   archivos: cualquier `.zip` se descomprime en memoria con `jszip`
   (única dependencia nueva del proyecto para este flujo); sus
   entradas `.xml`/`.pdf` se suman al lote, el resto se ignora. Los
   XML y PDF (sueltos o de dentro de un zip) se emparejan por **mismo
   nombre de archivo, sin extensión, sin distinguir mayúsculas**.
3. Botón "Procesar": recorre los XML con 5 workers concurrentes
   (`CONCURRENCIA = 5`, un pool simple con un índice compartido, no
   `Promise.all` de todo el lote de una vez) actualizando una barra de
   progreso en vivo. Antes de arrancar, precarga **una sola vez**
   todos los `profiles` con `rol='cliente'` y `rfc` no nulo en un
   `Map<rfcNormalizado, {id, centro}>` — evita una consulta por
   archivo en lotes de cientos.

   Por cada XML (`procesarUnPar`):
   - `parsearCfdi` → si falla, fila de reporte `{ problema: <mensaje>,
     accion: "Revisar" }`, cuenta en "Con errores", no se importa.
   - Busca el PDF pareado (por nombre base) y sube XML (siempre) y PDF
     (si hay) al bucket `facturas`, mismo patrón de subida que el
     resto de la app (`archivo-timestamp-random.ext`, `upsert: true`,
     `getPublicUrl`). Si la subida falla, se sigue de todos modos e
     inserta la factura sin esos archivos — los datos del XML ya se
     leyeron y son lo que más importa.
   - `insert` en `facturas` con `fuente: 'cfdi_import'`. **No hay
     pre-check de duplicado** — se inserta directo y se atrapa el
     código de Postgres `23505` (unique violation) del índice de
     `uuid_cfdi`; así también cubre duplicados que la RLS del staff no
     le dejaría ver si están en otro centro. Si es duplicado: fila
     `{ problema: "UUID duplicado", accion: "No importar" }`, cuenta
     en "Duplicadas", no se guarda nada.
   - Si el insert sí funciona pero no hubo cliente y/o no hubo PDF: la
     factura **se importa igual** (cuenta en "Importadas"), pero se
     agrega una fila informativa al reporte — `"Cliente no
     encontrado"` (acción "Asignar cliente", y suma a "Sin cliente")
     y/o `"Falta PDF"` (acción "Importar XML", solo informativo), unidas
     con `·` si aplican ambas.
4. Al terminar: tarjeta de resumen (Total archivos, Facturas
   encontradas, Importadas, Duplicadas, Con errores, Sin cliente) +
   tabla de reporte para todo lo que no fue una importación 100%
   limpia, con exportación a Excel vía `lib/exportExcel.ts` (mismo
   helper que ya usa el resto del módulo).

`facturasEncontradas` = número de XML detectados (sin importar el
resultado); `totalArchivos` = XML + PDF detectados (el ZIP en sí no
cuenta, solo sus entradas válidas extraídas).

### 9.4 Asignar cliente después de importar

En `/facturas-admin`, cualquier factura con `user_id === null` ahora
muestra un aviso "⚠️ Cliente no identificado" con un `<select>` de
clientes inline (reutiliza el `clientes` ya cargado en esa página) —
al elegir uno hace `update facturas set user_id = ...` y refresca.
Esta es la vía manual de la sección 3 del pedido original ("puedes
asignarlo manualmente" después). Las facturas con `uuid_cfdi` también
muestran una línea compacta `🧾 CFDI · {rfc_receptor} · {uuid_cfdi}`
en su tarjeta, solo informativa.

### 9.5 Filtros de búsqueda en `/facturas-admin`

Con la importación masiva, la lista de `/facturas-admin` puede crecer
a cientos de filas de golpe — se agregaron filtros 100% client-side
(no se toca la consulta a Supabase, que sigue trayendo todas las
facturas del centro de una vez, igual que el resto de la app; no hay
paginación en ningún lado del proyecto). Todo vive en un solo
`useMemo` (`facturasFiltradas`, calculado a partir de `facturas` +
los estados de filtro) que reemplaza a `facturas` tanto en el listado
como en el contador del header y en la exportación a Excel — exportar
exporta lo que está filtrado, no todo.

Filtros disponibles, todos combinables entre sí (AND):
- **Búsqueda de texto** (`search-box`, mismo componente visual que ya
  usa `AdminPanel.tsx` en la pestaña Clientes) — compara contra
  `folio`, `concepto`, `uuid_cfdi`, `rfc_receptor` y
  nombre/email/empresa del cliente relacionado (vía `nombrePorId`),
  todo en minúsculas.
- **Estado** (`pendiente` | `parcial` | `pagada` | `vencida`).
- **Fuente** (`fuente` — `'manual'` o `'cfdi_import'`, ver sección
  9.1) — para separar rápido lo dado de alta a mano de lo que entró
  por importación de CFDI. Como `fuente` puede venir `null` en
  facturas viejas (dadas de alta antes de que existiera la columna),
  el filtro trata `null` como `'manual'` (`f.fuente || "manual"`).
- **Rango de fechas** (`fecha_emision >= desde` y `<= hasta`).
- **"Solo sin cliente"** — checkbox directo sobre `user_id === null`,
  para encontrar rápido las facturas importadas que necesitan
  "Asignar cliente" (sección 9.4) sin tener que escribir nada.

Botón "Limpiar filtros" aparece solo si hay algún filtro activo
(`hayFiltrosActivos`). El contador del header pasa de `(N)` a
`(N de Total)` en cuanto hay algún filtro puesto, para que quede claro
que no se está viendo la lista completa.
