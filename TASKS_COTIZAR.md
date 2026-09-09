# Tareas — Módulo "Cotizar" (implementación en este proyecto)

> Lista de seguimiento derivada de `DOCUMENTACION_COTIZAR.md`. Este
> proyecto (`C:\Users\Edgar\Desktop\nodus-login`) es el **"otro
> proyecto Next.js + Supabase que comparte la misma base de datos"**
> al que se refiere la documentación — comparte el mismo Supabase
> (`xpywjzdsbngcdqqzfgoh`) que el proyecto de referencia en
> `Downloads\nodus-login\nodus-login`, donde el módulo Cotizar **ya
> está implementado**. Aquí, en cambio, el módulo **no existe
> todavía** — hay que construirlo desde cero siguiendo el checklist de
> replicación (sección 7 de la documentación).
>
> Auditado el 2026-08-05: no existe `app/paquetes`, `app/registrar-plan`,
> `CotizarForm.tsx`, ni ninguna referencia a `paquete_id`, `oficina_id`,
> `cotizacion_id`, `horas_bolsa` o `bloquea_reasignacion` en todo el
> código de este proyecto. La base de datos ya tiene el esquema (no
> hace falta migrar), pero el frontend/backend de este proyecto aún no
> lo usa.
>
> Cualquier agente que retome este trabajo debe **releer el código
> citado antes de confiar en el estado marcado aquí** — esta lista es
> una foto de un momento dado, no la fuente de verdad. El proyecto de
> Downloads (`Downloads\nodus-login\nodus-login`) es la referencia viva
> para copiar/adaptar código real, no solo la documentación.
>
> Leyenda: ✅ Hecho · 🟡 Parcial/en progreso · ⬜ Pendiente

---

## 0. Diferencias de contexto a tener en cuenta al portar

- Este proyecto **no tiene `lib/reservaciones.ts`** ni ningún helper
  compartido de fechas/horas: `HORAS`, `esSalaDeJuntas`,
  `esFueraDeHorario`, `formatFechaISO`, `formatHora` están duplicados
  **inline** dentro de `app/reservaciones/page.tsx` (líneas 8, 23, 38,
  47, 56, 63) y variantes propias (`calFormatFechaISO`,
  `calFormatHora`, etc.) dentro de `app/centro/CentroPanel.tsx` (líneas
  32, 41, 48). Al portar `CotizarForm.tsx`, que también necesita
  `HORAS`/`formatHora`/`formatFechaISO` (sección 5.6), lo más
  consistente con el estilo de este proyecto es duplicarlas igual
  (inline en `CotizarForm.tsx`) en vez de crear un `lib/` nuevo — a
  menos que se decida como mejora aparte consolidar en un solo lugar.
- `app/reservaciones/page.tsx` y `app/centro/CentroPanel.tsx` ya
  existen en este proyecto con lógica de reservaciones **previa al
  módulo Cotizar** (sin categorías Sala de Juntas/Horas Bolsa
  desacopladas, sin `contrato_id`/`cotizacion_id`). Falta confirmar
  cuánta de esa lógica coincide con la versión "antigua" del proyecto
  de referencia antes de aplicarle los cambios de las secciones 6.9/6.10.
- `app/api/gestion-usuarios`, `app/mi-wifi`, `app/wifi-solicitudes`,
  `app/usuarios` existen aquí y no existen en el proyecto de
  referencia — son módulos propios de este proyecto, no tocar.
- `middleware.ts` aquí protege rutas distintas (no incluye
  `isPaquetes`/`isCotizarPlan`) — hay que agregarlas siguiendo el
  patrón de las que ya existen (`isContratos`, `isBajaCliente`, etc.,
  visto en la línea 58).

---

## 1. Componentes / páginas a crear o modificar (sección 4 de la doc)

| # | Archivo | Estado | Nota |
|---|---|---|---|
| 1 | `app/centro/CotizarForm.tsx` | ✅ | Portado 2026-08-05. Sin `lib/reservaciones.ts` compartido: helpers de fecha/hora duplicados inline (mismos que ya usa `app/reservaciones/page.tsx`). `profiles` de este proyecto no tiene `dia_pago` (vive en `contratos`) — se quitó el prefill automático, el staff lo captura a mano. |
| 2 | `app/registrar-plan/page.tsx` | ✅ | Creado, monta `CotizarForm`, título "Cotizar". Envuelto en `Suspense` (patrón ya usado en `pagar-spei`/`subir-comprobante` de este proyecto para `useSearchParams`). |
| 3 | `app/paquetes/page.tsx` | ✅ | CRUD completo, port directo (misma UI/validación que referencia). |
| 4 | `app/contratos/page.tsx` | ✅ | Se agregó sección "⏳ Pendientes de aprobación" con `aprobarContrato()`/`rechazarContrato()`, resolución de `plan_nombre` vía `cotizacion_id`, badges ampliados (`pre_aprobado`/`rechazado` vía `ESTATUS_LABEL` importado de `ContratoModal.tsx`), botón "✎ Editar" en cada tarjeta. De paso se corrigió un bug preexistente (faltaba `dia_pago` en el reset del form de "+ Nuevo contrato"). |
| 5 | `app/contratos/ContratoModal.tsx` | ✅ | Creado desde cero (el archivo no existía; `app/contratos/page.tsx` no tenía ningún modal). Versión simplificada vs. referencia: **no incluye** los campos `deposito_devuelto`/`deposito_monto_devuelto`/`deposito_motivo_descuento`/`fecha_devolucion_deposito` ni el lookup a `planes.max_extra_coworking` — no son parte del alcance de Cotizar y no hay evidencia de que esas columnas existan en este proyecto; si se necesitan, agregarlas en una tarea aparte. |
| 6 | `app/baja-cliente/page.tsx` | ✅ | `seleccionarCliente()` ahora consulta en paralelo `pagos` (no pagados) y el depósito ya pagado, calcula `netoAdeudado`, autoselecciona el radio "debe" y precarga el monto (editable). Se agregó tarjeta "💰 Lo que debe el cliente" con el desglose (cada pago pendiente → subtotal → resta del depósito → total neto). |
| 7 | `app/alta-cliente/page.tsx` | ✅ | Campo deshabilitado "Registrado por" con el nombre del staff logueado (solo informativo, `profiles.nombre` propio). |
| 8 | `app/api/crear-cliente/route.ts` | ✅ | El upsert de `profiles` ahora guarda `registrado_por: session.user.id` (fuente de verdad del backend, no el valor mostrado en pantalla). |
| 9 | `app/dashboard/AdminPanel.tsx` | ✅ | Tiles nuevos "📝 Cotizar" (`/registrar-plan`), "🎁 Paquetes" (`/paquetes`), "💰 Pagos" (`/pagos`) junto al tile "Contratos" existente; botón "🧾 Cotizar" (`/registrar-plan?clienteId=...`) agregado dentro del modal de detalle de cliente (no existía ningún botón de este tipo antes, se creó); sección "📄 Contratos" agregada antes de "💰 Estado de cuenta" en ese mismo modal. |
| 10 | `middleware.ts` | ✅ | `/pagos`, `/registrar-plan` y `/paquetes` protegidos (se había adelantado en Fase 1/2). No se identificó nada adicional que faltara agregar en esta fase. |
| 11 | `app/dashboard-cliente/ClientePanel.tsx` + `page.tsx` | ✅ | El fetch de contrato se movió de `page.tsx` (server, solo traía el más reciente) a `ClientePanel.tsx` (client): ahora trae **todos** los contratos `vigente`, resuelve nombre de paquete/oficina vía `contratos.paquete_id`/`oficina_id` (nunca `cotizaciones_comerciales`, regla #13), selector si hay más de uno, dos bancos de horas condicionales (sala/bolsa), y dos tarjetas de "Reservar servicios" condicionales con querystring `categoria=sala\|bolsa&contratoId=...`. |
| 12 | `app/reservaciones/page.tsx` | ✅ | Reescrito: `categoria` como estado explícito desde `useSearchParams()` (envuelto en `Suspense`, patrón ya usado en este proyecto), sin auto-cambio; resuelve el contrato de la URL o el más reciente `vigente` como respaldo; envuelve la lógica ya existente de fuera-de-horario/hora-extra dentro de "sala"; agrega "bolsa" topando la selección al banco de horas restante y bloqueando por completo los slots fuera de horario (sin extra, regla #17); `esSalaDeJuntas` cambiado a `startsWith`; `oficinasBolsaDelCentro` dinámico si el catálogo estático del centro no trae ningún espacio de bolsa (caso Bosques — **aquí Bosques usa "Sala de 10 personas" como único espacio estático, sin ningún Coworking/Capacitación, así que si no hay oficinas reales de ese tipo en la BD, Horas Bolsa simplemente no estará disponible para Bosques; revisar con datos reales**). También se agregó `contrato_id` al insert de reservaciones (antes no se guardaba). |
| 13 | `app/centro/CentroPanel.tsx` | ✅ | Se agregó `cotizacion_id` al select de `reservaciones` y un join manual `cotizacion_id → cotizaciones_comerciales(paquete_id, modalidad_paquete) → paquetes(nombre)` que arma `📦 {nombre} · {modalidad}`, mostrado tanto en "Pendientes de confirmar" como en el listado completo del tab Reservaciones. |

**Nuevo, no listado originalmente:**
- `app/api/pagos/crear/route.ts` — creado. **Decisión de producto importante (confirmada con el usuario):** a diferencia de la referencia (pago suelto con link a `/pagar-simulado`, que no existe en este proyecto) o de generar automáticamente una factura + cargo SPEI real, aquí el endpoint **solo inserta el registro en `pagos`** (`estado: "pendiente"`, sin `factura_id`, sin link de cobro). El cobro real es manual — resuelto con la pantalla de abajo.
- `app/pagos/page.tsx` — creado 2026-08-05 (a petición del usuario tras notar que no había forma de ver estos pagos). Pantalla mínima de staff: lista pagos por centro con nombre/email del cliente, concepto, monto, fecha y badge de estado; botón "✓ Marcar como pagado" (`update estado: "pagado"`) para cerrar manualmente el cobro. Filtro "solo pendientes"/"ver todos". No tiene link/tile todavía en `AdminPanel.tsx` (pendiente para Fase 3, junto con los tiles de Cotizar/Paquetes) — se accede por URL directa a `/pagos`.
- `middleware.ts` — se adelantó de Fase 3 la protección de las 3 rutas nuevas de esta fase: `/pagos`, `/registrar-plan`, `/paquetes` (agregadas en los 4 lugares: constantes, `isProtected`, redirección de rol cliente, `matcher`). Verificado en navegador: sin sesión, `/pagos` redirige a `/login` correctamente.

---

## 2. Reglas de negocio clave a implementar (sección 3 de la doc)

- [x] #1 Oficina y Paquete son selects independientes, no excluyentes; precio prioriza paquete.
- [x] #2 Precio recalculado en cadena cada vez que cambian cantidad/oficina/paquete/modalidad.
- [x] #3 Reserva paga de inmediato; Contrato nace `pre_aprobado` sin generar ningún pago — aplicado en **los dos** lugares con botón "Aprobar" (`ContratoModal.tsx` y la lista de pendientes en `contratos/page.tsx`). Nota: "pagar" aquí solo significa "queda registrado en `pagos`", ver hueco de cobro manual arriba.
- [x] #4 `contratos.renta_mensual` siempre = precio neto pactado (nunca $0 aunque "Cargo recurrente" esté desmarcado).
- [x] #5 Adicionales en dos momentos (borrador al cotizar sin pago / picker post-aprobación con pago), picker oculto si no `vigente`.
- [x] #6 Depósito en garantía se registra como pago propio al aprobar.
- [x] #7 Depósito por defecto = `precio_mes` del paquete o `deposito_garantia` de la oficina, editable.
- [x] #8 Baja de cliente: deuda neta = pendientes − depósito pagado, precargada y editable.
- [x] #9 `plan_id` siempre `null` desde Cotizar; resolver nombre vía join manual `cotizacion_id → cotizaciones_comerciales`.
- [x] #10 Moneda/tipo de cambio solo de referencia visual, nunca altera lo guardado en MXN.
- [x] #11 `horas_bolsa` del paquete se copia al contrato igual que `incluye_horas_sala_juntas`.
- [x] #12 Bloqueo de reasignación de paquete por cliente, configurable vía `bloquea_reasignacion` (no aplica a Reservas).
- [x] #13 Cliente lee `contratos.paquete_id`/`oficina_id`, nunca `cotizaciones_comerciales` (RLS).
- [x] #14 Selector de contrato en dashboard del cliente si tiene más de un contrato vigente.
- [x] #15/#16 Categorías Sala de Juntas / Horas Bolsa totalmente desacopladas, `categoria` como estado explícito, sin auto-cambio.
- [x] #17 Horas Bolsa sin hora extra ni fuera de horario (a diferencia de Sala de Juntas).
- [x] #18 Horas Bolsa armada dinámicamente desde `oficinas` para centros sin espacio genérico de Coworking. **Sin verificar con datos reales todavía**: en este proyecto Bosques usa "Sala de 10 personas" como único espacio estático (ni Coworking ni Capacitación) — el fallback dinámico solo mostrará Horas Bolsa ahí si existen oficinas reales con `tipo` que no sea "Sala de..." en la BD de ese centro. Pedir al usuario que confirme al probar.

---

## 3. Orden de trabajo sugerido

1. **Confirmar estructura actual de `app/contratos/page.tsx`** (¿tiene
   modal inline o falta modal de edición por completo?) antes de tocar
   items #4/#5 — puede cambiar si se crea `ContratoModal.tsx` nuevo o
   se adapta el archivo existente.
2. Portar `CotizarForm.tsx` + montarlo en `registrar-plan/page.tsx`
   (items #1-#2) — es el núcleo, todo lo demás depende de que exista.
3. Crear `app/paquetes/page.tsx` (item #3) — Cotizar necesita el
   catálogo de paquetes para funcionar.
4. Implementar aprobación con pagos diferidos en contratos (item #4/#5,
   reglas #3-#7).
5. Baja de cliente con deuda neta (item #6, regla #8).
6. Alta de cliente + "Registrado por" (items #7-#8).
7. Tiles del dashboard + protección de rutas (items #9-#10).
8. Dashboard-cliente + reservaciones con categorías desacopladas
   (items #11-#12, reglas #13-#18) — es la parte más grande y propensa
   a bugs ya documentados (ver sección 6.10 de la doc, los dos bugs de
   auto-cambio de categoría).
9. Join de labels en `CentroPanel.tsx` (item #13).
10. Correr `tsc --noEmit` al final.
11. Prueba manual end-to-end (cotizar → aprobar contrato → baja de
    cliente → reservar con banco de horas).

---

## 4. Estado general

**Fase 1 completada (2026-08-05): 5 de 13 componentes implementados
(+1 endpoint nuevo no listado originalmente), 11 de 18 reglas de
negocio aplicadas.** `tsc --noEmit` limpio (solo 2 errores preexistentes
sin relación con Cotizar: iteración de `Map` en
`api/cron/facturacion-diaria` y una expresión siempre-verdadera en
`api/dar-baja-cliente`).

**✅ Verificado por el usuario (2026-08-05):** probó el flujo completo
manualmente en el navegador — cotizar con paquete → contrato
`pre_aprobado` sin pagos → aprobar desde "Pendientes de aprobación" →
pagos generados correctamente, visibles y marcables como pagados en
`/pagos`. Fase 1 cerrada y confirmada funcionando.

**Fase 2 completada (2026-08-05): 7 de 13 componentes implementados,
16 de 18 reglas de negocio aplicadas.** `tsc --noEmit` sigue limpio
(mismos 2 errores preexistentes de siempre). No se pudo forzar la
compilación real de `/reservaciones` en el navegador sin sesión (el
middleware redirige antes de renderizar) — pendiente de que el usuario
la pruebe manualmente.

**Pendiente de verificar por el usuario:** probar reservar en ambas
categorías (Sala de Juntas / Horas Bolsa) desde `/dashboard-cliente`
con un contrato que tenga horas de ambos tipos, y confirmar si Bosques
(u otro centro) realmente tiene oficinas de tipo Coworking/Capacitación
en la base para que el fallback dinámico de Horas Bolsa (regla #18)
funcione ahí.

**Fase 3 completada (2026-08-05): 13 de 13 componentes implementados,
18 de 18 reglas de negocio aplicadas.** `tsc --noEmit` limpio (mismos
2 errores preexistentes de siempre, sin relación con Cotizar). No se
pudo probar en navegador por falta de sesión — pendiente de que el
usuario lo confirme manualmente.

**Pendiente de verificar por el usuario:**
1. Dar de baja a un cliente con pagos pendientes y depósito ya pagado
   — confirmar que el desglose y el monto neto precargado sean
   correctos.
2. Alta de cliente nuevo — confirmar que `registrado_por` quede
   guardado en `profiles` (no hay forma de verlo en pantalla todavía,
   solo en la base).
3. Ver los tiles nuevos ("📝 Cotizar", "🎁 Paquetes", "💰 Pagos") en el
   dashboard y el botón "🧾 Cotizar" + sección "📄 Contratos" dentro del
   modal de detalle de cliente.
4. Confirmar que el label 📦 aparezca en `/centro?tab=reservaciones`
   para reservaciones creadas desde Cotizar.

**Con esto se completa el checklist de replicación de la sección 7 de
`DOCUMENTACION_COTIZAR.md`.** Huecos conocidos que quedan fuera de las
18 reglas documentadas (ver notas en la sección 1 de arriba):
- Cobro manual de los pagos generados por Cotizar (sin factura ni SPEI
  automático) — resuelto parcialmente con `/pagos`, pero sigue siendo
  manual por decisión de producto.
- Verificar con datos reales si algún centro (Bosques u otro) necesita
  el fallback dinámico de Horas Bolsa (regla #18) o si ningún centro
  de este proyecto tiene ese caso.
