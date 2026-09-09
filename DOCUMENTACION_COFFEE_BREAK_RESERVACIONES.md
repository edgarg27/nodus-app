# Documentación: Coffee Break y Flujo de Reservaciones de Sala

> Referencia técnica para portar esta lógica a otro proyecto que ya tiene las mismas
> migraciones de base de datos (tablas `coffee_break_paquetes`, `reservaciones`,
> `notificaciones`, `profiles`, `cotizaciones_comerciales`, `paquetes`).
> Todo el acceso a datos aquí descrito es **directo a Supabase desde el cliente**
> (`createClient()` de `lib/supabase/client.ts`) — no hay API routes intermedias.

---

## 1. Coffee Break en `/paquetes` (rol admin)

**Archivo origen:** `app/paquetes/page.tsx`

### 1.1 Modelo de datos

Tabla: `coffee_break_paquetes` (independiente de `paquetes`, sin FK visible desde el
componente más allá de su propio `id`).

```ts
type CoffeeBreakPaquete = {
  id: string;
  numero: number;
  nombre: string;
  precio_persona: number;
  alimentos: string;
  bebidas: string;
  minimo_personas: number;
  activo: boolean;
  promocion_activa: boolean;
  descuento_porcentaje: number;
  promocion_hasta: string | null;
  promocion_texto: string | null;
};
```

### 1.2 Estructura de la pantalla

La funcionalidad vive como una **pestaña** dentro de la misma página `/paquetes`,
no en una ruta separada:

```ts
const [tab, setTab] = useState<"espacios" | "coffee">("espacios");
```

Pestañas: `"📦 Espacios"` y `"☕ Coffee Break"`.

### 1.3 Control de acceso / rol

**No hay guard de rol dentro del componente para coffee_break.** El único control
de rol presente es:

```ts
const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const esGlobal = ROLES_GLOBALES.includes(miRol);
```

`esGlobal` solo decide si se muestra el **selector de centro** (para roles que
gestionan más de un centro). La pestaña de Coffee Break se muestra a cualquier
usuario que ya tenga acceso a `/paquetes` — la protección real de la ruta depende
de RLS de Supabase / middleware, no de lógica en este archivo.

> Al portar: replicar esta misma filosofía — no añadir un guard nuevo aquí; el
> control de acceso a `/paquetes` debe resolverse a nivel de ruta/RLS, igual que
> en el proyecto origen.

### 1.4 Estados de UI

```ts
const [coffeeBreakPaquetes, setCoffeeBreakPaquetes] = useState<CoffeeBreakPaquete[]>([]);
const [coffeeLoading, setCoffeeLoading] = useState(false);
const [guardandoCoffeeId, setGuardandoCoffeeId] = useState<string | null>(null);
const [coffeeError, setCoffeeError] = useState("");
const [editandoCoffeeId, setEditandoCoffeeId] = useState<string | null>(null);
```

### 1.5 Carga de datos

```ts
async function fetchCoffeeBreak() {
  setCoffeeLoading(true);
  const { data } = await supabase
    .from("coffee_break_paquetes")
    .select("*")
    .order("numero", { ascending: true });
  setCoffeeBreakPaquetes(data || []);
  setCoffeeLoading(false);
}
```

### 1.6 Edición de un campo en memoria

```ts
function actualizarCampoCoffee(id: string, campo: keyof CoffeeBreakPaquete, valor: any) {
  setCoffeeBreakPaquetes((prev) =>
    prev.map((p) => (p.id === id ? { ...p, [campo]: valor } : p))
  );
}
```

### 1.7 Guardado (única operación soportada: UPDATE)

```ts
async function guardarCoffee(p: CoffeeBreakPaquete) {
  setGuardandoCoffeeId(p.id);
  setCoffeeError("");
  const { error: dbError } = await supabase
    .from("coffee_break_paquetes")
    .update({
      precio_persona: Number(p.precio_persona) || 0,
      alimentos: p.alimentos,
      bebidas: p.bebidas,
      minimo_personas: Number(p.minimo_personas) || 1,
      activo: p.activo,
      promocion_activa: p.promocion_activa,
      descuento_porcentaje: Number(p.descuento_porcentaje) || 0,
      promocion_hasta: p.promocion_hasta || null,
      promocion_texto: p.promocion_texto || null,
    })
    .eq("id", p.id);
  setGuardandoCoffeeId(null);
  if (dbError) setCoffeeError("No se pudo guardar el paquete. Intenta de nuevo.");
}
```

**Importante:**
- Solo existe `UPDATE`. **No hay crear ni eliminar** paquetes de coffee break desde
  la UI — se asume que los paquetes numerados (`#1`, `#2`, ...) ya están precargados
  en la tabla vía seed/migración.
- Al terminar de guardar exitosamente, se sale del modo edición
  (`setEditandoCoffeeId(null)`).
- Botón "Cancelar" en modo edición **no revierte manualmente el estado local**:
  vuelve a llamar `fetchCoffeeBreak()` para recargar desde la base de datos.

### 1.8 Validaciones

Mínimas, solo a nivel HTML — **no hay reglas de negocio JS**:

| Campo | Regla |
|---|---|
| `precio_persona` | `type="number" step="0.01" min={0}` |
| `minimo_personas` | `type="number" min={1}` |
| `descuento_porcentaje` | `type="number" min={0} max={100}` (solo visible si `promocion_activa`) |

El saneo en `guardarCoffee` usa `Number(...) || 0` / `|| 1` como fallback, sin
bloquear el guardado si el valor es 0 o inválido.

### 1.9 Checklist para portar

- [ ] Crear tabla `coffee_break_paquetes` con las columnas del tipo `CoffeeBreakPaquete`.
- [ ] Precargar (seed) los paquetes numerados — no hay flujo de "crear" en la UI.
- [ ] Agregar pestaña `"coffee"` en la página de paquetes del proyecto destino.
- [ ] Reutilizar `fetchCoffeeBreak`, `actualizarCampoCoffee`, `guardarCoffee` tal cual.
- [ ] No añadir guard de rol adicional salvo que el proyecto destino lo requiera explícitamente.

---

## 2. Solicitud de reservación en `/reservaciones?categoria=sala`

**Archivo origen:** `app/reservaciones/page.tsx`

### 2.1 Detección de categoría

```ts
type Categoria = "sala" | "bolsa";

const searchParams = useSearchParams();
const categoriaDesdeUrl: Categoria = searchParams.get("categoria") === "bolsa" ? "bolsa" : "sala";
const contratoIdDesdeUrl = searchParams.get("contratoId") || "";
const [categoria, setCategoria] = useState<Categoria>(categoriaDesdeUrl);
```

Cualquier valor de `categoria` que no sea exactamente `"bolsa"` cae en `"sala"`
(default seguro). El componente debe envolverse en `<Suspense>` porque usa
`useSearchParams()`.

Clasificación de espacios por nombre:

```ts
function esSalaDeJuntas(nombreEspacio: string) {
  return !nombreEspacio.startsWith("Coworking") && !nombreEspacio.startsWith("Sala de Capacitación");
}

const espaciosDeLaCategoria = categoria === "sala" ? salaEspacios : bolsaEspacios;
```

### 2.2 UI: calendario semanal de slots

No es un formulario tradicional — es un grid interactivo:

- **Horas:** 8am–8pm (`HORAS`), **días:** semana completa (`DIAS_CORTOS`).
- Tabs de espacio si hay más de uno (`espacio`).
- Navegación de semana (`inicioSemana`, botones `‹ ›`).
- Selección de rango horario por clic en slots → `seleccion: { fecha, horaInicio, horaFin } | null`.

### 2.3 Reglas de disponibilidad (`clickSlot`)

```ts
function clickSlot(fecha, hora) {
  if (estaOcupado || esPasado || bloqueadoPorHorario) return;

  // Para categoría "bolsa": no exceder horas disponibles del banco de horas
  if (esBolsaActual && duracionNueva > horasDisponiblesReales) return;

  // ... construir/ajustar `seleccion`
}
```

Reglas de horario especial (`esFueraDeHorario`): domingos, festivos MX, sábado
después de 2pm, entre semana después de 8pm.
- Para **bolsa**: el slot queda **bloqueado** (no seleccionable).
- Para **sala**: queda seleccionable, marcado como `fueraHorario`, con costo extra
  y advertencia de que debe cotizarlo recepción.

### 2.4 Coffee Break opcional (modal dentro del flujo de reserva)

Estados:

```ts
const [quiereCoffee, setQuiereCoffee] = useState<boolean | null>(null);
const [paqueteCoffeeId, setPaqueteCoffeeId] = useState<string | null>(null);
const [personasCoffee, setPersonasCoffee] = useState<number | "">("");
```

Carga de paquetes activos:

```ts
const { data } = await supabase
  .from("coffee_break_paquetes")
  .select("*")
  .eq("activo", true);
setCoffeeBreakPaquetes(data || []);
```

Validación de mínimo de personas:

```ts
const coffeeBreakFaltaMinimo = !!(
  paqueteCoffee && personasCoffeeNum > 0 && personasCoffeeNum < paqueteCoffee.minimo_personas
);
```

### 2.5 Validación previa a enviar (`continuarConReserva`)

```ts
if (quiereCoffee) {
  if (!paqueteCoffeeId) {
    setError("Elige un paquete de coffee break");
    return;
  }
  if (!personasCoffeeNum || coffeeBreakFaltaMinimo) {
    setError(`Ese paquete requiere un mínimo de ${paqueteCoffee?.minimo_personas} persona(s)`);
    return;
  }
}
```

- Botón "Solicitar reservación" deshabilitado si `!seleccion || enviando`.
- Botón "Confirmar reservación" (dentro del modal) deshabilitado si
  `enviando || !paqueteCoffeeId || !personasCoffeeNum || coffeeBreakFaltaMinimo`.
- Si no hay sesión activa al confirmar: `setError("Sesión expirada, vuelve a iniciar sesión")`.

### 2.6 Envío (`confirmarReserva`)

```ts
const { data: nuevaReserva, error: insertError } = await supabase
  .from("reservaciones")
  .insert({
    user_id: user.id,
    espacio,
    fecha: seleccion.fecha,
    hora: horarioTexto,
    hora_inicio: `${String(seleccion.horaInicio).padStart(2, "0")}:00`,
    hora_fin: `${String(seleccion.horaFin).padStart(2, "0")}:00`,
    centro,
    estado: "pendiente", // ← estado inicial, siempre
    fuera_horario: seleccionFueraHorario,
    horas_incluidas: horasIncluidas,
    horas_extra: horasExtra,
    costo_extra: costoExtra,
    contrato_id: contratoId || null,
    coffee_break_paquete_id: quiereCoffee && paqueteCoffee ? paqueteCoffee.id : null,
    coffee_break_personas: quiereCoffee && paqueteCoffee ? personasCoffeeNum : null,
    coffee_break_total: quiereCoffee && paqueteCoffee ? totalCoffeeBreak : null,
  })
  .select()
  .single();
```

Tras el insert exitoso:

```ts
// 1. Notificación in-app para admins del centro
await supabase.from("notificaciones").insert({
  centro,
  tipo: "nueva_reservacion",
  mensaje: /* incluye ⚠️ si fuera_horario */,
  reservacion_id: nuevaReserva.id,
});

// 2. Email a admins del centro (best-effort, error silenciado)
const { data: admins } = await supabase
  .from("profiles")
  .select("email")
  .eq("rol", "admin")
  .eq("centro", centro);

try {
  await supabase.functions.invoke("send-email", {
    body: { tipo: "nueva_reservacion", /* ... */ },
  });
} catch {
  // no crítico
}
```

### 2.7 Confirmación en UI

```tsx
setEnviado(true);
// ...
<p className="cli-al-corriente-text">Solicitud enviada</p>
<p className="cli-al-corriente-sub">
  Tu solicitud está pendiente. Te avisaremos aquí y por correo en cuanto el centro la confirme.
</p>
<button onClick={() => router.push("/mis-reservaciones")}>Ver mis reservaciones</button>
```

### 2.8 Checklist para portar

- [ ] Confirmar que `reservaciones` tiene columnas: `coffee_break_paquete_id`,
      `coffee_break_personas`, `coffee_break_total`, `fuera_horario`,
      `horas_incluidas`, `horas_extra`, `costo_extra`, `contrato_id`, `estado`.
- [ ] El estado inicial de toda reservación creada por cliente **debe ser `"pendiente"`**, nunca `"confirmada"`.
- [ ] Reutilizar la lógica de `esFueraDeHorario` / festivos MX tal cual si el negocio destino opera en México con el mismo calendario.
- [ ] Mantener el patrón: `INSERT` en `reservaciones` → `INSERT` en `notificaciones` (tipo `nueva_reservacion`) → `invoke("send-email")` best-effort.
- [ ] Edge Function `send-email` debe existir en el proyecto Supabase destino (no está en este repo; vive del lado de Supabase).

---

## 3. Rechazo de sala desde `/centro?tab=reservaciones` (admin)

**Archivo origen:** `app/centro/CentroPanel.tsx`

### 3.1 Detección de tab y restricción por rol

```ts
const TABS_RESTRINGIDAS_OPERACIONES = ["reservaciones", "prospectos", "telefonia", "vouchers", "internet"];
const tabInicial = searchParams.get("tab") || "resumen";

const [tab, setTab] = useState(
  rol === "sistemas" && ["reservaciones", "prospectos", "telefonia"].includes(tabInicial)
    ? "resumen"
    : rol === "operaciones" && TABS_RESTRINGIDAS_OPERACIONES.includes(tabInicial)
    ? "resumen"
    : tabInicial
);
```

Roles `sistemas` y `operaciones` **no pueden entrar** al tab `reservaciones` ni
por query param ni por el menú de tabs (se filtra del arreglo `TABS` visible).
Roles permitidos: `admin`, `superadmin`, `gerente`.

También se puede llegar a este tab haciendo clic en una notificación tipo
`"nueva_reservacion"` (`setTab("reservaciones")`).

### 3.2 Carga y clasificación de reservaciones

```ts
const { data } = await supabase
  .from("reservaciones")
  .select("id, espacio, fecha, hora, estado, user_id, fuera_horario, horas_extra, costo_extra, cotizacion_id")
  .eq("centro", c)
  .order("fecha", { ascending: false });
```

Enriquecido manual (joins hechos a mano, no vía Supabase `select` anidado):
- `cliente_nombre` ← join con `clientes`
- `paquete_label` ← join vía `cotizacion_id` → `cotizaciones_comerciales` → `paquetes`
- `motivo_rechazo` ← solo si `estado === "rechazada"`, resuelto desde `notificaciones` filtrando `tipo = "reservacion_rechazada"`

```ts
const reservasPendientes = reservaciones.filter((r) => r.estado === "pendiente");
```

> Nota: `reservasPendientes` **no distingue tipo de espacio** (sala vs. bolsa) —
> se listan todas las pendientes del centro juntas.

### 3.3 Disparo del rechazo

```ts
async function responderReserva(reserva: Reservacion, aceptar: boolean) {
  if (!aceptar) {
    setMotivoRechazo("");
    setRechazando(reserva); // solo abre el modal, no muta nada aún
    return;
  }
  // rama aceptar...
}
```

Modal de rechazo:
- `<textarea>` ligado a `motivoRechazo`.
- Placeholder: `Ej. Mantenimiento programado de 8am a 8pm ese día`.
- Label: **`"Motivo (opcional, el cliente lo verá)"`** — explícitamente no obligatorio.
- Sin `confirm()` adicional, sin validación de longitud mínima.

### 3.4 Confirmación del rechazo

```ts
async function confirmarRechazo() {
  if (!rechazando) return;
  const reserva = rechazando;
  const motivo = motivoRechazo.trim();

  // 1. Cambio de estado
  await supabase.from("reservaciones").update({ estado: "rechazada" }).eq("id", reserva.id);
  setReservaciones((prev) =>
    prev.map((r) => (r.id === reserva.id ? { ...r, estado: "rechazada" } : r))
  );

  // 2. Notificación in-app para el cliente
  const mensaje = motivo
    ? `Tu reservación de ${reserva.espacio} el ${reserva.fecha} (${reserva.hora}) fue rechazada. Motivo: ${motivo}`
    : `Tu reservación de ${reserva.espacio} el ${reserva.fecha} (${reserva.hora}) fue rechazada.`;

  const { error: notifError } = await supabase.from("notificaciones").insert({
    centro,
    user_id: reserva.user_id,
    tipo: "reservacion_rechazada",
    mensaje,
    reservacion_id: reserva.id,
  });
  if (notifError) {
    console.error("Error al crear notificación de rechazo:", notifError);
    alert("Se rechazó la reservación, pero no se pudo avisar al cliente: " + notifError.message);
  }

  // 3. Email al cliente (best-effort)
  const { data: cliente } = await supabase
    .from("profiles")
    .select("email, nombre")
    .eq("id", reserva.user_id)
    .single();

  if (cliente?.email) {
    try {
      await supabase.functions.invoke("send-email", {
        body: {
          tipo: "reservacion_rechazada",
          clienteEmail: cliente.email,
          clienteNombre: cliente.nombre,
          espacio: reserva.espacio,
          fecha: reserva.fecha,
          horario: reserva.hora,
          motivo,
        },
      });
    } catch {
      // no crítico
    }
  }

  setRechazando(null);
  setMotivoRechazo("");
}
```

**Orden de operaciones importante:** el `UPDATE` del estado se ejecuta **antes**
de intentar la notificación. Si el `INSERT` en `notificaciones` falla, el rechazo
**ya quedó persistido** — solo se le avisa al admin por `alert()`, no se revierte.

### 3.5 Cambio de estado

`reservaciones.estado`: **`"pendiente"` → `"rechazada"`**.

### 3.6 Checklist para portar

- [ ] Excluir el tab de reservaciones (o el equivalente) del menú/query param para los roles operativos que no deban ver reservaciones (definir la lista equivalente a `sistemas`/`operaciones` en el proyecto destino).
- [ ] Motivo de rechazo debe seguir siendo **opcional** salvo que el negocio destino decida lo contrario explícitamente.
- [ ] Reutilizar el orden: `UPDATE estado` → `INSERT notificacion` (no bloqueante) → `invoke send-email` (no bloqueante).
- [ ] Si se requiere mayor consistencia transaccional en el proyecto destino, considerar mover esto a una función de base de datos (RPC) — **no está así en el origen**, se documenta tal cual para portar el comportamiento exacto.

---

## 4. Lado cliente después del rechazo

### 4.1 Notificación in-app

**Archivo origen:** `app/dashboard-cliente/ClientePanel.tsx`

```ts
const { data } = await supabase
  .from("notificaciones")
  .select("id, tipo, mensaje, leida, created_at, reservacion_id")
  .eq("user_id", user.id)
  .order("created_at", { ascending: false })
  .limit(20);
setNotificaciones(data || []);
```

⚠️ **Se carga una sola vez al montar el componente** (`useEffect([])`). **No hay
canal realtime** (`supabase.channel(...)`) para notificaciones en este panel —
a diferencia de `app/reservaciones/page.tsx`, que sí usa `postgres_changes` para
el calendario. Si el cliente ya tiene el dashboard abierto cuando el admin
rechaza, no verá la notificación hasta recargar.

Click en notificación:

```ts
onClick={() => {
  marcarNotifLeida(n.id);
  if (n.tipo === "reservacion_rechazada" || n.tipo === "reservacion_confirmada") {
    router.push("/mis-reservaciones");
  } else if (n.tipo === "contrato_para_firmar") {
    router.push("/contrato/firmar");
  }
}}
```

### 4.2 Email

Vía Edge Function `send-email` (código vive en el proyecto Supabase remoto, no
en este repositorio) con `tipo: "reservacion_rechazada"` y el `motivo` incluido.

### 4.3 Reflejo en "Mis reservaciones"

**Archivo origen:** `app/mis-reservaciones/page.tsx`

Carga todas las reservaciones del cliente sin filtrar por estado:

```ts
const { data } = await supabase.from("reservaciones").select("*").eq("user_id", user.id);
```

⚠️ **Bug conocido a corregir/evitar al portar** — el badge de estado solo
contempla dos casos explícitos:

```tsx
<span
  className="estado-badge"
  style={{
    background:
      r.estado === "confirmada" ? "#E1F5EE" :
      r.estado === "cancelada"  ? "#FCEBEB" :
      "#FAEEDA", // fallback = amarillo "pendiente"
  }}
>
  {r.estado === "confirmada" ? "✓ Confirmada" :
   r.estado === "cancelada"  ? "✗ Cancelada" :
   "⏳ Pendiente"}
</span>
```

Como `"rechazada"` no es `"confirmada"` ni `"cancelada"`, **cae en el `else` y
se muestra incorrectamente como "⏳ Pendiente"**, contradiciendo el mensaje de
confirmación de envío ("te avisaremos aquí... en cuanto el centro la confirme")
y ocultando el motivo de rechazo (que ni siquiera está tipado en este archivo).

**Recomendación para el proyecto destino:** al portar, corregir el badge para
manejar los 4 estados explícitamente:

```tsx
{
  confirmada: { bg: "#E1F5EE", label: "✓ Confirmada" },
  cancelada:  { bg: "#FCEBEB", label: "✗ Cancelada" },
  rechazada:  { bg: "#FCEBEB", label: "✗ Rechazada" },
  pendiente:  { bg: "#FAEEDA", label: "⏳ Pendiente" },
}[r.estado]
```

Y añadir visualización de `motivo_rechazo` (traer el campo, ya sea desnormalizado
en `reservaciones` o resuelto desde `notificaciones` como hace `CentroPanel.tsx`).

### 4.4 Acciones disponibles al cliente

```tsx
{r.estado === "confirmada" && (
  <button className="cancelar-btn" onClick={() => cancelar(r.id)}>
    Cancelar reservación
  </button>
)}
```

Solo aplica a `"confirmada"`. Para `"rechazada"` **no hay ninguna acción** — ni
reintentar, ni contactar soporte. El cliente debe volver manualmente a
`/reservaciones` para solicitar una nueva.

```ts
async function cancelar(id: string) {
  await supabase.from("reservaciones").update({ estado: "cancelada" }).eq("id", id);
}
```

### 4.5 Checklist para portar

- [ ] Decidir si el proyecto destino implementa canal realtime para notificaciones del cliente (mejora sobre el origen) o replica el comportamiento de carga única.
- [ ] Corregir el badge de estado para manejar `"rechazada"` explícitamente (no heredar el bug).
- [ ] Mostrar `motivo_rechazo` en "Mis reservaciones" del proyecto destino.
- [ ] Definir si se agrega alguna acción para reservaciones rechazadas (ej. "Solicitar de nuevo" con los mismos datos precargados).

---

## 5. Resumen de tablas y campos involucrados

| Tabla | Campos relevantes a estos flujos |
|---|---|
| `coffee_break_paquetes` | `id, numero, nombre, precio_persona, alimentos, bebidas, minimo_personas, activo, promocion_activa, descuento_porcentaje, promocion_hasta, promocion_texto` |
| `reservaciones` | `id, user_id, espacio, fecha, hora, hora_inicio, hora_fin, centro, estado, fuera_horario, horas_incluidas, horas_extra, costo_extra, contrato_id, cotizacion_id, coffee_break_paquete_id, coffee_break_personas, coffee_break_total` |
| `notificaciones` | `id, centro, user_id, tipo, mensaje, reservacion_id, leida, created_at` — tipos usados: `nueva_reservacion`, `reservacion_rechazada`, `reservacion_confirmada`, `contrato_para_firmar` |
| `profiles` | `id, email, nombre, rol, centro` |
| `cotizaciones_comerciales` / `paquetes` | usados solo para resolver `paquete_label` en el panel admin |

**Estados posibles de `reservaciones.estado`:** `"pendiente"` (default al crear) →
`"confirmada"` | `"rechazada"` | `"cancelada"` (esta última solo disparada por el
propio cliente sobre una reserva `"confirmada"`).

## 7. Selección de tipo de espacio → disponibilidad de oficina en `/registrar-plan`

**Archivos origen:**
- `app/registrar-plan/page.tsx` (wrapper: resuelve `centro` según rol y monta el formulario)
- `app/centro/CotizarForm.tsx` (contiene toda la lógica real — es el mismo componente usado también desde `/centro?tab=cotizar` u otras entradas, `/registrar-plan` solo lo embebe)

### 7.1 Resolución de `centro` antes de mostrar el formulario

`/registrar-plan` no tiene lógica propia de tipo de espacio: solo determina el
`centro` a pasarle a `CotizarForm` y lo re-renderiza si cambia.

```ts
const ROLES_GLOBALES = ["sistemas", "superadmin", "gerente"];
const CENTROS_SUGERIDOS = ["Bosques", "Punto 45", "San Telmo", "Puerta Bajío Piso 2", "Puerta Bajío Piso 8", "Stadium", "ILEVA"];

async function init() {
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("rol, centro").eq("id", user.id).single();
  const rol = profile?.rol || "";
  if (ROLES_GLOBALES.includes(rol)) {
    setCentrosDisponibles(CENTROS_SUGERIDOS);
    setCentro(centroDesdeUrl || profile?.centro || CENTROS_SUGERIDOS[0]);
  } else {
    setCentro(profile?.centro || null); // rol de un solo centro: usa el suyo, sin selector
  }
}
```

Si `rol` está en `ROLES_GLOBALES`, se muestra un `<select>` de centro; si no, el
centro queda fijo al del perfil del usuario. `<CotizarForm key={refreshKey} centro={centro} .../>` se remonta por completo cada vez que cambia `centro` o se registra una cotización (`onRegistrado` incrementa `refreshKey`).

### 7.2 Carga de catálogo (oficinas, paquetes, ocupación) por centro

Dentro de `CotizarForm`, todo se recarga cuando cambia `centro`:

```ts
useEffect(() => { cargarDatos(); }, [centro]);

async function cargarDatos() {
  const [clisRes, ofisRes, paqsRes, catRes, contratosRes] = await Promise.all([
    supabase.from("profiles").select("id, nombre, email, empresa").eq("rol", "cliente").eq("centro", centro),
    supabase.from("oficinas")
      .select("id, numero, tipo, estado, precio, deposito_garantia, cliente_id")
      .eq("centro", centro)
      .order("numero"),
    supabase.from("paquetes").select("*").eq("centro", centro).order("nombre"),
    supabase.from("adicionales_catalogo").select("*").eq("centro", centro).eq("activo", true).order("nombre"),
    supabase.from("contratos")
      .select("oficina_id, user_id, fecha_vencimiento")
      .eq("centro", centro)
      .eq("estatus", "vigente")
      .not("oficina_id", "is", null),
  ]);
  // ...
}
```

**Punto clave de disponibilidad real:** la ocupación de una oficina **no se lee
solo de `oficinas.estado`** — se cruza en vivo con los contratos vigentes:

```ts
// Una oficina se considera ocupada si algún contrato vigente la tiene
// asignada, sin depender de que oficinas.estado se haya actualizado a mano.
const contratosConOficina = contratosRes.data || [];
const userIds = Array.from(new Set(contratosConOficina.map((c) => c.user_id).filter(Boolean)));
const { data: perfiles } = await supabase.from("profiles").select("id, nombre").in("id", userIds);
const nombrePorUserId = Object.fromEntries((perfiles || []).map((p) => [p.id, p.nombre]));

const mapaOcupacion: Record<string, { clienteNombre: string; fechaVencimiento: string }> = {};
contratosConOficina.forEach((c) => {
  if (!c.oficina_id) return;
  mapaOcupacion[c.oficina_id] = {
    clienteNombre: (c.user_id && nombrePorUserId[c.user_id]) || "Cliente",
    fechaVencimiento: c.fecha_vencimiento,
  };
});
setOcupacionPorOficina(mapaOcupacion);
```

### 7.3 Tipos de espacio disponibles (derivados, no catálogo aparte)

```ts
const tiposEspacioDisponibles = useMemo(() => {
  return Array.from(new Set(oficinas.map((o) => o.tipo).filter(Boolean))).sort();
}, [oficinas]);
```

No hay una tabla de "tipos de espacio" — el `<select>` de tipo de espacio se
arma dinámicamente a partir de los valores distintos presentes en
`oficinas.tipo` para el centro actual (orden alfabético).

### 7.4 Al elegir un tipo de espacio: filtra oficinas y paquetes de ese tipo

```ts
const [tipoEspacio, setTipoEspacio] = useState("");

const oficinasDelTipo = useMemo(() => {
  return oficinas
    .filter((o) => o.tipo === tipoEspacio)
    .sort((a, b) => {
      const aOcupada = !!ocupacionPorOficina[a.id];
      const bOcupada = !!ocupacionPorOficina[b.id];
      if (!aOcupada && bOcupada) return -1; // disponibles primero
      if (aOcupada && !bOcupada) return 1;
      return a.numero.localeCompare(b.numero);
    });
}, [oficinas, tipoEspacio, ocupacionPorOficina]);

const paquetesDelTipo = useMemo(() => {
  return paquetes.filter((p) => p.tipo_espacio === tipoEspacio);
}, [paquetes, tipoEspacio]);

function seleccionarTipoEspacio(t: string) {
  setTipoEspacio(t);
  setOficinaId("");
  setPaqueteId("");
  setModalidadPaquete("");
  setPrecioLista("");
  setDepositoGarantia("");
}
```

Cambiar el tipo de espacio **resetea toda la selección posterior** (oficina,
paquete, modalidad, precio, depósito) para evitar arrastrar datos de un tipo
distinto.

### 7.5 Render: lista de oficinas con estado de disponibilidad visible

Para cada oficina del tipo elegido se muestra un botón-tarjeta con tres estados
posibles, en este orden de prioridad:

```tsx
{oficinasDelTipo.map((o) => {
  const ocupacion = ocupacionPorOficina[o.id];
  const bloqueada = !!ocupacion || o.estado === "mantenimiento";
  const seleccionada = oficinaId === o.id;
  return (
    <button key={o.id} disabled={bloqueada} onClick={() => seleccionarOficina(o.id)}>
      <p>Oficina {o.numero}</p>
      {ocupacion ? (
        <p style={{ color: "#A32D2D" }}>
          Ocupada por {ocupacion.clienteNombre} · vigente hasta {ocupacion.fechaVencimiento}
        </p>
      ) : o.estado === "mantenimiento" ? (
        <p style={{ color: "#a3701f" }}>En mantenimiento</p>
      ) : (
        <p style={{ color: "#0F6E56" }}>Disponible</p>
      )}
      {!bloqueada && <span>{seleccionada ? "✓ Elegida" : "Elegir"}</span>}
    </button>
  );
})}
```

| Estado | Condición | Color | Seleccionable |
|---|---|---|---|
| Ocupada | existe entrada en `ocupacionPorOficina[o.id]` (contrato vigente asignado) | rojo `#A32D2D`, muestra cliente y fecha de vencimiento | No |
| En mantenimiento | `o.estado === "mantenimiento"` (y no ocupada) | ámbar `#a3701f` | No |
| Disponible | ninguna de las anteriores | verde `#0F6E56` | Sí |

Si no hay oficinas ni paquetes para el tipo elegido:

```tsx
{tipoEspacio && oficinasDelTipo.length === 0 && paquetesDelTipo.length === 0 && (
  <div className="empty-card">
    Sin oficinas ni paquetes de tipo "{tipoEspacio}" registrados en {centro}.
  </div>
)}
```

### 7.6 Selección de oficina y/o paquete (independientes entre sí)

```ts
function seleccionarOficina(id: string) {
  setOficinaId(id);
  actualizarDepositoSegunSeleccion(id, paqueteId);
}
function seleccionarPaquete(id: string) {
  if (id && paquetesYaRegistrados.has(id)) return; // no permite re-seleccionar paquete ya asignado al cliente
  setPaqueteId(id);
  const p = paquetes.find((x) => x.id === id) || null;
  const disponibles = MODALIDADES.filter((m) => tarifaPaquete(p, m) != null);
  const modalidadDefault = id ? (disponibles.includes("Mes") ? "Mes" : disponibles[0] || "") : "";
  setModalidadPaquete(modalidadDefault);
  actualizarDepositoSegunSeleccion(oficinaId, id);
}
```

- Elegir oficina **no** desmarca el paquete elegido, y viceversa — son
  selecciones independientes (una oficina física + una tarifa de paquete).
- El depósito de garantía se recalcula automáticamente: si hay paquete
  seleccionado, usa `paquete.precio_mes`; si no, usa `oficina.deposito_garantia`.
- `espacioListo = !!oficinaId || !!paqueteId` — el resto del formulario
  (datos comerciales, fechas, precio) solo aparece cuando hay al menos una
  oficina o un paquete elegido.

### 7.7 Validación al confirmar (relacionada con esta sección)

```ts
if (!tipoEspacio || !espacioListo) {
  setError("Selecciona un tipo de espacio y una oficina o paquete");
  return;
}
```

Al crear la cotización, si hay oficina elegida **y** hay cliente, la oficina se
marca como ocupada de inmediato (no espera a que se apruebe el contrato):

```ts
if (oficina && clienteIdEfectivo) {
  await supabase.from("oficinas").update({ cliente_id: clienteIdEfectivo, estado: "ocupada" }).eq("id", oficina.id);
}
```

> Nota: esto actualiza `oficinas.estado` directamente, en paralelo al cruce
> "en vivo" contra `contratos.estatus = vigente` descrito en 7.2. Ambos
> mecanismos coexisten — el cruce contra contratos es la fuente de verdad más
> confiable (por eso se usa para pintar "Ocupada por..."), y `oficinas.estado`
> se mantiene como respaldo/consistencia para otras pantallas que sí lo lean
> directamente.

### 7.8 Checklist para portar

- [ ] Confirmar que `oficinas` tiene columnas `tipo, estado, precio, deposito_garantia, cliente_id, centro`.
- [ ] Confirmar que `contratos` tiene `oficina_id, user_id, fecha_vencimiento, estatus, centro` para poder replicar el cruce de ocupación en vivo.
- [ ] No crear una tabla de "tipos de espacio" — seguir derivando el catálogo desde `DISTINCT oficinas.tipo` como hace el origen.
- [ ] Replicar el orden de prioridad de bloqueo: ocupada (por contrato vigente) > mantenimiento > disponible.
- [ ] Mantener oficina y paquete como selecciones independientes (no exclusivas entre sí).
- [ ] Reutilizar `actualizarDepositoSegunSeleccion` tal cual: paquete manda sobre oficina para el depósito cuando ambos están presentes.
- [ ] Al confirmar con oficina + cliente, marcar `oficinas.estado = "ocupada"` y `cliente_id` de inmediato (no esperar aprobación de contrato).

---

## 8. Dependencias externas (fuera de este repo)

- Supabase Edge Function `send-email`, invocada con `tipo` en:
  `"nueva_reservacion"`, `"reservacion_rechazada"` (y presumiblemente
  `"reservacion_confirmada"` para la rama de aceptar, no cubierta en este
  documento). El código de esta función vive en el proyecto Supabase remoto —
  debe replicarse/configurarse en el proyecto destino para que el envío de
  correos funcione igual.
