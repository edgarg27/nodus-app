# Módulo "Atención al Cliente" — Documentación técnica

> Módulo nuevo (construido en esta sesión). Centraliza cuatro cosas
> relacionadas con experiencia de cliente que antes no existían en el
> CRM: cumpleaños de contactos, eventos internos del centro, un
> calendario que junta ambos, y encuestas de satisfacción con
> seguimiento de respuestas. Depende de cómo `/alta-cliente` guarda
> `profiles.empresa` — ver `DOCUMENTACION_ALTA_CLIENTE.md` para el
> levantamiento de ese módulo.

---

## 1. Resumen del flujo

Todo vive en un solo hub con tabs: **`/atencion-cliente`** (mismo
patrón que `CentroPanel.tsx`: tabs arriba, contenido condicional
abajo, selector de centro para roles globales). Un solo tile nuevo en
`AdminPanel.tsx` ("🎉 Atención al Cliente"), no cuatro tiles sueltos.

1. **Cumpleaños** — el staff da de alta contactos (personas dentro de
   una empresa cliente) con su fecha de nacimiento. La empresa se
   **elige de una lista**, nunca se escribe — sale de los valores
   distintos de `profiles.empresa` para ese centro, así el contacto
   siempre queda ligado a una empresa real ya existente en el CRM.
2. **Eventos** — el staff da de alta eventos internos del centro
   (título, fecha, hora, lugar, descripción).
3. **Calendario** — vista de mes que junta cumpleaños (proyectados al
   año que se está viendo, por recurrencia anual) y eventos, con
   detalle al hacer click en un día.
4. **Encuestas** — el staff arma una encuesta (preguntas de
   calificación 1-5 o texto libre) y la manda a una mezcla de: cuentas
   reales del portal (`profiles` con `rol='cliente'`) **y** contactos
   sin cuenta (tabla `clientes`, los mismos de la pestaña
   Cumpleaños). Ambos responden por el **mismo link público sin
   sesión** (`/encuesta/{token}`) — un contacto no tiene forma de
   loguearse, así que responder nunca puede depender de tener cuenta.

---

## 2. Modelo de datos

`supabase_atencion_cliente_modulo.sql` — cuatro tablas nuevas, RLS
habilitado con una sola policy amplia (`authenticated` puede todo),
mismo nivel de rigor que el resto de las tablas de la app (el
filtrado real por centro lo hace cada página, no RLS fino por rol).

### 2.1 `clientes` — contactos de una empresa (⚠️ no es lo mismo que `profiles`)

`id, centro, empresa, nombre, fecha_nacimiento, email, created_by,
created_at`.

- **No tiene cuenta de acceso.** Es solo un registro de contacto —
  nombre, cumpleaños, correo — para poder celebrar su cumpleaños y/o
  mandarle encuestas, aunque nunca inicie sesión en el portal.
- `empresa` se guarda ya **normalizada** (`lib/empresa.ts`,
  `normalizarEmpresa()`) y se elige de un `<select>` poblado con los
  valores distintos de `profiles.empresa` de ese centro — nunca se
  escribe a mano en este formulario, así queda automáticamente
  consistente con `profiles.empresa`.
- `centro` lo copia la página internamente (el centro activo en ese
  momento), el formulario no lo pide.
- El formulario de captura es deliberadamente mínimo: **empresa,
  nombre, fecha de nacimiento, email** — nada de puesto, teléfono ni
  notas (decisión explícita del usuario al revisar el plan).

### 2.2 `eventos_centro`

`id, centro, titulo, descripcion, fecha, hora, lugar, created_by,
created_at`. `hora` y `lugar` son texto libre opcional (no hay
integración con ningún calendario externo).

### 2.3 `encuestas` (plantilla) y `encuestas_envios` (instancia enviada + respuesta)

```
encuestas: id, centro, titulo, descripcion,
           preguntas jsonb [{ id, texto, tipo: 'rating'|'texto' }],
           created_by, created_at

encuestas_envios: id, encuesta_id,
                  cliente_id (-> profiles, nullable),
                  contacto_id (-> clientes, nullable),
                  nombre_destinatario, email_destinatario,
                  token (uuid único),
                  estado ('pendiente'|'respondida'),
                  respuestas jsonb [{ pregunta_id, valor }],
                  enviado_en, respondido_en
```

- **`respuestas` vive en `jsonb` sobre el propio envío** — no hay una
  tabla `encuestas_respuestas` aparte. Un survey de este tamaño no
  necesita consultas relacionales por pregunta, y esto ahorra un join
  en cada lectura.
- **Constraint `encuestas_envios_un_solo_destinatario`**: exactamente
  uno de `cliente_id`/`contacto_id` debe estar lleno, nunca ambos, y
  nunca ninguno — `check ((cliente_id is not null) <> (contacto_id is
  not null))`. `nombre_destinatario`/`email_destinatario` se copian al
  momento de crear el envío (no dependen de un join después, y
  sobreviven aunque el contacto/cliente se edite o borre más tarde).
- **`token`** es lo único que identifica un envío en el link público
  — no depende de RLS para estar protegido (mismo criterio que ya usa
  `/pagar-simulado/[id]` con su UUID de pago): la lectura/escritura
  del lado público siempre pasa por
  `app/api/encuestas/[token]/route.ts` con `createAdminClient()`
  (service role), nunca por una consulta directa del navegador con la
  anon key filtrando por token.

---

## 3. Reglas de negocio no obvias

1. **`clientes.empresa` nunca es texto libre.** El `<select>` de la
   pestaña Cumpleaños se construye con `empresasDistintas()`
   (`lib/empresa.ts`) sobre `profiles.empresa` del centro activo — si
   no hay ninguna empresa capturada todavía, el formulario muestra un
   mensaje pidiendo llenarla desde `/alta-cliente` primero, en vez de
   dejar escribir cualquier cosa.
2. **La normalización de `empresa` es forward-only, sin backfill.**
   `POST /api/crear-cliente` ahora normaliza `empresa` antes del
   `upsert` (vía `normalizarEmpresa()`), pero los `profiles`
   existentes con casing inconsistente **no se tocan**. El picker de
   empresas normaliza y deduplica **al leer**, así que datos viejos
   igual aparecen agrupados correctamente en el `<select>` sin
   necesidad de migrar nada — pero si se lee `profiles.empresa`
   directo en algún otro lugar del sistema (no vía
   `empresasDistintas()`), el casing inconsistente histórico sigue
   ahí.
3. **Responder una encuesta nunca depende de tener sesión — para
   nadie, ni siquiera para clientes con cuenta.** Hay una sola
   implementación de "responder" (`/encuesta/[token]`), pública. Los
   clientes con cuenta tienen además una comodidad extra
   (`/mis-encuestas`, autenticada, lista sus propios envíos) que
   simplemente enlaza a la misma pantalla pública — no hay una
   segunda implementación de responder-encuesta para el lado
   autenticado.
4. **`/encuesta/[token]` está deliberadamente fuera de
   `middleware.ts`.** No aparece en `isProtected` ni en
   `config.matcher`, igual que `/pagar-simulado` — si se agrega por
   error a cualquiera de las dos listas, un contacto sin cuenta ya no
   podría abrir su link.
5. **Notificación en-app solo para quien tiene cuenta.** Al enviar una
   encuesta, `insert` en `notificaciones` (`tipo:
   "encuesta_pendiente"`) solo ocurre si el destinatario es un
   `cliente_id` (cuenta del portal) — un `contacto_id` no tiene
   `user_id` al cual notificar, así que su único aviso es el correo
   con el link.
6. **El envío de correo es una llamada por destinatario, no bulk.**
   A diferencia de `/correos` (que manda un solo `send-email` con un
   arreglo de `destinatarios` para el mismo cuerpo), cada envío de
   encuesta necesita su **propio** link (`/encuesta/{token}`), así que
   el loop de creación de `encuestas_envios` invoca `send-email` una
   vez por seleccionado. Si el `invoke` falla para alguno, el error se
   traga silenciosamente (`catch {}`) — el `insert` en
   `encuestas_envios` ya quedó guardado de todos modos, así que el
   staff puede reenviar el link manualmente desde el detalle
   expandido de la encuesta si hace falta (el link no se muestra ahí
   todavía — ver sección 5, gap conocido).
7. **El clic en una notificación del lado cliente ahora sí navega.**
   Antes (`ClientePanel.tsx`) solo marcaba la notificación como
   leída. Se agregó `abrirNotificacion()` (mismo patrón que ya usaba
   `AdminPanel.tsx` por `tipo`) — hoy solo maneja
   `"encuesta_pendiente"` → `/mis-encuestas`; si se agregan más tipos
   de notificación al cliente en el futuro, es aquí donde hay que
   sumar los `else if`.
8. **Los cumpleaños se proyectan por día/mes, ignorando el año
   guardado.** `diasHastaProximoCumple()` y el cálculo del calendario
   comparan solo día+mes contra la fecha de hoy/mes que se está
   viendo — el año de `fecha_nacimiento` es obligatorio en la columna
   (`not null`) pero irrelevante para la lógica de recurrencia anual.

---

## 4. Componentes / páginas

| Archivo | Rol |
|---|---|
| `app/atencion-cliente/page.tsx` | (staff) Hub con 4 tabs: Calendario, Cumpleaños, Eventos, Encuestas. Todo el CRUD de `clientes`/`eventos_centro`/`encuestas` vive aquí, en componentes internos del mismo archivo (`TabCalendario`, `TabCumpleanos`, `TabEventos`, `TabEncuestas`, `TarjetaEncuesta`). |
| `lib/empresa.ts` | `normalizarEmpresa()` + `empresasDistintas()` — normalización de texto libre y deduplicación de la lista de empresas. |
| `app/api/encuestas/[token]/route.ts` | Público, sin sesión. `GET` regresa la encuesta + estado del envío; `POST` guarda las respuestas y marca `estado='respondida'`. Usa `createAdminClient()`, nunca la anon key. |
| `app/encuesta/[token]/page.tsx` | Público, sin sesión. Renderiza las preguntas (selector 1-5 o textarea) y envía. Muestra pantalla de agradecimiento si ya estaba respondida. |
| `app/mis-encuestas/page.tsx` | (cliente, autenticado) Lista sus propios `encuestas_envios`, pendientes primero, cada uno enlaza a `/encuesta/{token}`. |
| `app/api/crear-cliente/route.ts` | Ahora normaliza `empresa` antes del `upsert` (única línea tocada). |
| `app/dashboard-cliente/ClientePanel.tsx` | Tarjeta condicional "📝 Encuestas pendientes" (solo si tiene ≥1 envío `pendiente`) + `abrirNotificacion()` nuevo para rutear al hacer click en una notificación de tipo `encuesta_pendiente`. |
| `app/dashboard/AdminPanel.tsx` | Tile nuevo "🎉 Atención al Cliente" → `/atencion-cliente`, mismo wrapper `{rol !== "sistemas"}` que Correos/Tours. |
| `middleware.ts` | `/atencion-cliente` agregado como ruta staff (igual que `/correos`); `/mis-encuestas` agregado a `isClienteSubpage`; `/encuesta/[token]` deliberadamente **no** agregado (público). |

---

## 5. Gaps conocidos / cosas a vigilar

1. **No se probó en navegador real** — este entorno no tiene acceso a
   un proyecto Supabase real. Antes de dar por buena la implementación
   hay que verificar en vivo: alta de contacto, calendario mostrando
   el cumpleaños en el mes correcto, creación y envío de una encuesta
   a un cliente con cuenta **y** a un contacto sin cuenta a la vez, y
   que ambas respuestas se reflejen del lado staff.
2. ~~El link de una encuesta no se puede volver a ver/copiar desde el
   panel de staff.~~ **Resuelto (2026-08-19).** `cargarEnvios()` ahora
   trae `token`, y cada fila `pendiente` en el detalle expandido de
   `TarjetaEncuesta` tiene un botón "📋 Copiar link" que copia
   `${origin}/encuesta/{token}` al portapapeles (mismo patrón que
   `copiarLink()` en `app/pagos/page.tsx`). No se muestra para envíos ya
   `respondida`.
3. ~~Sin edición de encuestas ya creadas.~~ **Resuelto (2026-08-19).**
   `TabEncuestas` gana un `editandoId`: el botón "✎ Editar" de cada
   `TarjetaEncuesta` reabre el mismo formulario de creación pre-llenado
   (título/descripción/preguntas) y hace `update` en vez de `insert` al
   guardar. El botón "🗑 Eliminar" borra la encuesta — como
   `encuestas_envios.encuesta_id` tiene `on delete cascade`
   (`supabase_atencion_cliente_modulo.sql`), también borra sus envíos y
   respuestas, por lo que el `confirm()` lo advierte explícitamente.
4. **Sin paginación en ningún lado del módulo**, consistente con el
   resto de la app — si un centro acumula cientos de contactos o
   envíos de encuesta, todo se carga y filtra del lado del cliente.
5. **RLS es de "cualquier autenticado puede todo"**, no fino por rol
   ni por centro — mismo nivel de rigor que el resto de las tablas de
   este proyecto (ver el gap equivalente documentado en
   `DOCUMENTACION_FACTURAS.md` para `facturas`/`pagos`). El filtrado
   por centro lo hace cada página con `.eq("centro", c)`, no la base
   de datos.

---

## 6. Checklist de replicación en otro proyecto

1. Correr `supabase_atencion_cliente_modulo.sql`.
2. Copiar `lib/empresa.ts` tal cual.
3. Copiar `app/atencion-cliente/page.tsx`, ajustando `CENTROS_SUGERIDOS`
   si el otro proyecto maneja centros distintos.
4. Replicar el patrón de link público sin sesión
   (`app/api/encuestas/[token]/route.ts` + `app/encuesta/[token]/page.tsx`)
   copiando la estructura de `/api/pagos/[id]` + `/pagar-simulado/[id]`
   si el otro proyecto ya tiene ese precedente, o construyéndolo desde
   cero si no.
5. Agregar las rutas nuevas a `middleware.ts` del otro proyecto
   siguiendo el mismo patrón `isXxx` — **recordar dejar el link
   público de encuesta fuera** de `isProtected`/`config.matcher`.
6. Si el otro proyecto también tiene `notificaciones` del lado
   cliente, extender su manejador de click igual que se hizo en
   `ClientePanel.tsx` (`abrirNotificacion`).
7. Correr `tsc --noEmit` al final.
