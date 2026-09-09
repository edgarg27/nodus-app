# Tareas — Módulo "Facturas / Cobranza / Pagos"

> Lista de seguimiento derivada de `DOCUMENTACION_FACTURAS.md`.
> A diferencia de `TASKS_COTIZAR.md`, aquí la mayor parte del módulo
> **ya existe en este proyecto** (Desktop) — no hay que replicarlo
> desde cero, solo cerrar piezas específicas que faltan. Auditado el
> 2026-08-06.
>
> Leyenda: ✅ Ya existe y coincide con la doc · ⬜ Falta

---

## 1. Lo que ya existe y coincide con la documentación

| Pieza | Estado |
|---|---|
| `lib/openpay.ts` (`crearCargoSPEI`, `consultarCargo`) | ✅ |
| `app/api/cron/facturacion-diaria/route.ts` (recordatorio/factura+SPEI+voucher/suspensión) | ✅ |
| `app/pagar-spei/page.tsx` + `app/api/generar-spei` + `app/api/verificar-spei` | ✅ |
| `app/subir-comprobante/page.tsx` (comprobante manual → `en_revision`) | ✅ |
| `app/api/webhooks/openpay/route.ts` | ✅ |
| `app/estado-cuenta/page.tsx` (vista real de facturas del cliente) | ✅ |
| `app/facturas/page.tsx` — placeholder que redirige a `/estado-cuenta` | ✅ (coincide con el gap #1 documentado, es intencional) |
| `app/cobranza/page.tsx` (panel de estatus + botón forzar cron) | ✅ |
| Variables de entorno Openpay + `CRON_SECRET` | ✅ (ya configuradas en `.env.local`) |
| `profiles.suspendido`/`.suspendido_desde` en uso | ✅ |

## 2. Lo que faltaba (sección 6 de la doc) — implementado 2026-08-06

| Archivo | Estado | Nota |
|---|---|---|
| `app/facturas-admin/page.tsx` | ✅ | CRUD de facturas: crear factura manual (con PDF opcional a bucket `facturas`) permitiendo **vincular pagos sueltos del cliente elegido en el mismo formulario de alta** (checkboxes, corregido 2026-08-06 tras feedback del usuario — antes solo se podía vincular después de crear la factura), listar por centro, expandir cada factura para ver sus pagos vinculados, vincular más pagos sueltos después si aparecen nuevos, exportar Excel. |
| `app/pagar-simulado/[id]/page.tsx` | ✅ | Pantalla pública (sin sesión): muestra concepto/monto del pago vía `GET /api/pagos/[id]`, botón "✓ Simular pago" → `POST /api/pagos/simular`. |
| `app/api/pagos/simular/route.ts` | ✅ | Público, sin auth — **pero acotado**: rechaza (403) cualquier pago que tenga `factura_id` (ver decisión de seguridad en sección 4 de este archivo). |
| `app/api/pagos/marcar-pagado/route.ts` | ✅ (nuevo, no estaba en la doc original) | Requiere sesión de staff; marca pagado **cualquier** pago, con o sin factura. `/pagos/page.tsx` se actualizó para usar este endpoint en vez de hacer el `update` directo desde el cliente. |
| `app/api/pagos/vincular/route.ts` | ✅ | Asocia `pagos.id[]` existentes a una `facturas.id`. |
| `app/api/pagos/[id]/route.ts` | ✅ | Detalle público, pero solo devuelve pagos con `factura_id: null` (404 para el resto) — mismo criterio de seguridad. |
| `app/api/pagos/route.ts` | ⬜ (omitido a propósito) | No se creó — `/pagos/page.tsx` y `/facturas-admin/page.tsx` ya listan con queries directas desde el cliente (RLS de staff), que funcionan igual sin necesitar este endpoint adicional. Si en el futuro se topa con un límite de RLS, crear este endpoint con `createAdminClient()`. |
| Trigger `sync_factura_estado` | ❔ | Sigue sin verificar directamente — no se tocó nada de DB en esta tarea. Ninguno de los endpoints nuevos depende de que exista (todos actualizan `pagos.estado`, igual que ya hacían `/api/verificar-spei` y el webhook de Openpay antes). Si en algún momento una factura no sube de estatus sola al marcarse un pago como pagado, ese es el primer lugar a revisar en el SQL editor de Supabase. |

## 3. Decisiones tomadas con el usuario (2026-08-06)

1. **Activar el flujo simulado completo para Cotizar.**
   `app/api/pagos/crear/route.ts` (de `DOCUMENTACION_COTIZAR.md` regla
   #3) ahora **sí genera `link_pago`** apuntando a
   `/pagar-simulado/{id}` después del insert — revierte la decisión de
   "cobro manual por ahora" tomada durante la Fase 1 de Cotizar. El
   cliente puede confirmar sus pagos de renta/depósito/adicionales
   directamente desde ese link, sin dinero real de por medio.
2. **Separar `/api/pagos/simular` en dos endpoints por seguridad** (en
   vez de replicar tal cual el gap documentado en la sección 7, punto
   2, de `DOCUMENTACION_FACTURAS.md`):
   - `POST /api/pagos/simular` — público, sin sesión, pero **rechaza
     con 403 cualquier pago que tenga `factura_id`**. Solo puede
     marcar pagado a los pagos sueltos del flujo 1.1.
   - `POST /api/pagos/marcar-pagado` — exige sesión de staff, puede
     marcar pagado cualquier pago (con o sin `factura_id`). Es el que
     usa el botón de `/pagos`.
   - `GET /api/pagos/[id]` (detalle usado por `/pagar-simulado`) sigue
     el mismo criterio: 404 si el pago tiene `factura_id`.

   Con esto, un pago de facturación real (renta mensual, con
   `factura_id`) **nunca** puede marcarse pagado por alguien que solo
   tenga el UUID — necesita sesión de staff sí o sí.

## 4. Estado general

**Implementación completada (2026-08-06): 7 de 7 piezas resueltas**
(una omitida a propósito por redundancia, ver tabla arriba; una nueva
no prevista originalmente — `marcar-pagado` — agregada por la decisión
de seguridad). `tsc --noEmit` limpio (mismos 2 errores preexistentes
de siempre, sin relación con este módulo). Se agregó el tile "🧾
Facturas" en `AdminPanel.tsx` (visible para todos los roles de staff
excepto `sistemas`/`operaciones`, igual que Cobranza) y se protegió
`/facturas-admin` en `middleware.ts` — **`/pagar-simulado` se dejó
deliberadamente sin proteger**, debe ser accesible sin sesión.

**Pendiente de verificar por el usuario** (no se pudo probar en
navegador por falta de sesión):
1. Aprobar un contrato de Cotizar → confirmar que el pago generado
   trae `link_pago` y que `/pagar-simulado/{id}` carga correctamente.
2. Confirmar un pago desde esa pantalla → verificar que quede
   `pagado` en `/pagos`.
3. Crear una factura manual en `/facturas-admin`, subir el PDF, y
   vincular un pago suelto existente.
4. Confirmar que un pago con `factura_id` **no se pueda** marcar
   pagado llamando directo a `/api/pagos/simular` (debe devolver 403)
   — validación del gap de seguridad cerrado.
