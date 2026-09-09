# Módulo "Alta de Cliente" (`/alta-cliente`) — Documentación técnica

> Levantamiento del estado actual, igual que `DOCUMENTACION_FACTURAS.md`
> — este módulo ya existía en el sistema, esta documentación es una
> foto de cómo funciona hoy. Se escribe justo antes de diseñar el
> nuevo módulo de "Atención al Cliente" (cumpleaños, eventos,
> calendario, encuestas) porque ese módulo va a **leer/depender** de
> lo que `/alta-cliente` guarda hoy en `profiles` (especialmente
> `empresa`), así que hay que tener claro el punto de partida.

---

## 1. Resumen del flujo

1. Un miembro de staff (cualquier rol que no sea `cliente` ni
   `sistemas` — ver sección 4) entra a **Nuevo cliente**
   (`/alta-cliente`, tile 👤 en `AdminPanel.tsx`).
2. Llena un formulario simple: nombre, correo, empresa, RFC, teléfono,
   día del mes que paga. El campo "Registrado por" se muestra
   **deshabilitado**, solo informativo (nombre del staff logueado,
   leído de su propio `profiles.nombre`).
3. Si el rol es `sistemas`/`superadmin` (global), también elige el
   **centro** desde un selector; si no, el centro queda fijo al
   `profiles.centro` del propio staff — no hay forma de dar de alta un
   cliente en un centro distinto al del staff, salvo para roles
   globales.
4. Al enviar, el formulario llama `POST /api/crear-cliente` — **no**
   inserta nada directo a Supabase desde el cliente (a diferencia de
   casi todo el resto de la app, que sí usa `supabase.from(...).insert`
   directo). Esto es porque el alta necesita crear una cuenta de
   `auth.users` real, lo cual requiere la Service Role Key
   (`createAdminClient()`), que nunca puede vivir en el navegador.
5. El endpoint:
   - Valida sesión + rol (staff, no cliente).
   - Genera un **número de usuario único** (`N-####`, 4 dígitos
     aleatorios, hasta 15 intentos chocando contra
     `profiles.numero_usuario` antes de caer a un timestamp de
     respaldo).
   - Manda una **invitación real de Supabase Auth**
     (`admin.auth.admin.inviteUserByEmail`), que crea el usuario en
     `auth.users` y le manda un correo con link a `/crear-password`
     — el cliente nunca recibe una contraseña generada por el sistema,
     la define él mismo al abrir ese link.
   - Hace `upsert` en `profiles` con el mismo `id` que acaba de crear
     el invite, incluyendo `ciudad` **derivada automáticamente del
     centro** (tabla fija `CIUDAD_POR_CENTRO`, no la captura el staff)
     y `registrado_por: session.user.id` (regla ya documentada en
     `DOCUMENTACION_COTIZAR.md` sección 6.6).
6. Si todo sale bien, redirige a `/dashboard?exito=cliente&numero=N-####`
   — `AdminPanel.tsx` lee esos query params una sola vez al montar, ya
   con `useEffect` (no en cada render), muestra el banner de éxito con
   el número de usuario, y limpia la URL con `router.replace("/dashboard")`.

**Lo que NO hace hoy** (relevante para el módulo nuevo): no captura
fecha de nacimiento, no valida formato de RFC/teléfono, no verifica
que el correo no esté ya registrado antes de invitar (se entera por el
error que regresa `inviteUserByEmail`), y no permite elegir plan/
oficina/paquete en este mismo formulario — eso es exclusivo de
Cotizar (`DOCUMENTACION_COTIZAR.md`).

---

## 2. Modelo de datos

### 2.1 `profiles` — columnas que este flujo escribe

Todas via el `upsert` de `POST /api/crear-cliente`:

| Columna | Origen | Notas |
|---|---|---|
| `id` | `auth.users.id` del invite | Mismo id en ambas tablas — no hay tabla de clientes separada de `profiles`; un cliente **es** una fila de `profiles` con `rol = 'cliente'`. |
| `email` | Form | — |
| `nombre` | Form | — |
| `rol` | Fijo | Siempre `"cliente"` — este endpoint no puede crear staff. |
| `centro` | Form (o `profiles.centro` del staff si no es rol global) | — |
| `ciudad` | Derivado | Tabla fija `CIUDAD_POR_CENTRO` en el propio route.ts — **no viene de ningún lado editable**, si se abre un centro nuevo hay que agregar su ciudad ahí a mano. |
| `empresa` | Form | **Texto libre, opcional.** Sin normalización, sin catálogo — dos clientes de la "misma" empresa pueden quedar con el nombre escrito distinto (`"ABC"` vs `"Abc S.A."`) y el sistema no los relaciona. **Esto es crítico para el módulo de cumpleaños** que el usuario quiere ligar a `empresa` (ver sección 5). |
| `rfc` | Form | Texto libre, sin validar (mismo hallazgo que documentó `DOCUMENTACION_FACTURAS.md` sección "9.1" al construir el matching de CFDI). |
| `numero_usuario` | Generado | `N-####`, único, es el identificador "amigable" que ve el cliente en su propio dashboard. |
| `telefono` | Form | Texto libre. |
| `dia_pago` | Form | Numérico 1–31, opcional — alimenta el cron de cobranza (`DOCUMENTACION_FACTURAS.md` sección 4). |
| `activo` | Fijo | Siempre `true` al crearse. |
| `registrado_por` | Sesión | `session.user.id` del staff que hizo el alta — nunca el valor mostrado en pantalla (que es solo informativo). |

Columnas que **existen en `profiles`** (usadas por otras partes del
sistema, ver `DOCUMENTACION_COTIZAR.md`) pero que **este flujo no
toca en absoluto**: `numero_oficina`, `tipo_oficina`, `suspendido`,
`suspendido_desde`. Esos se llenan después, desde otros módulos
(Cotizar/Panel de Centro asigna oficina, el cron de cobranza suspende).

**No existe ninguna columna de fecha de nacimiento en `profiles` hoy.**

### 2.2 `auth.users`

Se crea vía `inviteUserByEmail`, no vía `admin.createUser` — la
diferencia importa: el invite manda automáticamente el correo de
Supabase con el magic link a `/crear-password` (el `redirectTo`
apunta ahí), y dispara `data: { nombre }` como metadata del usuario
(no se usa en ningún lado del código actual, es informativo por si se
necesita más adelante, ej. en la plantilla de correo de Supabase).

---

## 3. Reglas de negocio no obvias

1. **El alta es dos escrituras separadas que pueden quedar
   inconsistentes**: primero se crea el usuario en `auth.users`
   (invite), después se hace `upsert` en `profiles`. Si el invite
   funciona pero el `upsert` de `profiles` falla (`profileError`), el
   endpoint regresa error **pero el usuario de Auth ya quedó creado**
   — no hay rollback del invite. El mensaje de error se lo dice
   explícitamente al staff ("La cuenta se creó pero no se pudo guardar
   el perfil..."), pero no hay ninguna limpieza automática ni alerta —
   queda un `auth.users` huérfano sin fila en `profiles` hasta que
   alguien lo note o reintente el alta con el mismo correo (que
   fallaría en el invite, porque el correo ya existe).
2. **`ciudad` nunca la captura el staff** — sale 100% de
   `CIUDAD_POR_CENTRO[centro]` dentro del propio endpoint. Si se abre
   un centro nuevo y no se actualiza ese `Record` a mano en el código,
   los clientes de ese centro quedan con `ciudad: null` silenciosamente
   (no es un error, el `|| null` lo permite).
3. **El centro solo es elegible para roles `sistemas`/`superadmin`.**
   El resto del staff da de alta siempre en su propio centro — no hay
   forma de que, por ejemplo, un admin de "Bosques" registre un
   cliente de "Punto 45" desde esta pantalla.
4. **`empresa` es completamente de texto libre** (mismo patrón que
   `rfc`, documentado también en `DOCUMENTACION_FACTURAS.md`) — no hay
   ningún catálogo de empresas ni autocompletado contra empresas ya
   capturadas de otros clientes. Dos altas de la misma empresa real
   pueden terminar con dos strings distintos.
5. **El número de usuario (`N-####`) es el único identificador
   generado por el sistema que el cliente ve/usa como "su número"** —
   no es el UUID de Supabase. Vive únicamente en `profiles`, no hay
   tabla de secuencia ni counter — la unicidad se garantiza
   consultando antes de insertar (con una ventana de carrera teórica
   si dos altas simultáneas generan el mismo número al mismo
   milisegundo, mitigado por ser 9000 combinaciones posibles y hasta
   15 reintentos).
6. **No hay paso de confirmación ni de "¿este cliente ya existe?"**
   antes de invitar — si alguien intenta dar de alta un correo que ya
   tiene cuenta, el único indicio es el mensaje de error que devuelva
   Supabase Auth desde `inviteUserByEmail` (texto no controlado por
   esta app).

---

## 4. Protección de ruta

`middleware.ts`:
- `isAltaCliente = path.startsWith("/alta-cliente")`, incluida en
  `isProtected` (requiere sesión) y en el bloque que redirige a los
  clientes fuera de rutas de staff (`role === "cliente"` → afuera).
- `config.matcher` incluye `"/alta-cliente/:path*"`.
- **No hay restricción de rol más granular en middleware** — el
  `rol !== "sistemas"` que oculta el tile en `AdminPanel.tsx` (línea
  615) es **solo visual**; el rol `sistemas` sí podría entrar a
  `/alta-cliente` escribiendo la URL directo y el formulario
  funcionaría igual (el endpoint solo exige "no ser cliente", no
  excluye `sistemas`). Es una inconsistencia menor entre lo que se
  oculta en el menú y lo que el backend realmente permite.

---

## 5. Lo que le falta a `/alta-cliente` para el módulo de Atención al Cliente

El usuario quiere una tabla de cumpleaños "ligada a empresa de la
tabla profiles". Puntos a resolver en el plan de diseño (sección
siguiente de este mismo hilo de trabajo, no en este documento):

- `profiles.empresa` es texto libre sin normalizar (sección 3, punto
  4) — si la tabla de cumpleaños se liga por el **string** de
  `empresa`, heredará el mismo problema de inconsistencia (empresas
  "iguales" escritas distinto no matchean). Alternativas a evaluar en
  el plan: normalizar `empresa` al guardar (trim + un solo casing), o
  crear un catálogo de empresas propio y que `profiles.empresa_id`
  apunte ahí (cambio más grande, pero resuelve el problema de raíz).
- Hoy no existe ningún campo de fecha de nacimiento en `profiles` ni
  en el formulario de `/alta-cliente` — hay que decidir si el
  cumpleaños se captura **por cliente individual** (agregar el campo
  al alta) o **por empresa** (un solo cumpleaños/aniversario por
  empresa, sin relación a una persona en particular) — el pedido dice
  "cumpleaños de los clientes" pero "ligado a empresa", lo cual admite
  ambas lecturas y hay que aclarar antes de diseñar el esquema.
