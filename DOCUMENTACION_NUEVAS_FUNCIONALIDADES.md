# Nuevas funcionalidades (sesión actual) — Documentación técnica

> Este archivo documenta tres piezas nuevas, independientes entre sí,
> construidas en esta sesión sobre el CRM. Se escribió para poder
> **portarlas a otro proyecto que ya existe** — por eso cada sección
> incluye el modelo de datos, los archivos tocados y el detalle suficiente
> para reimplementarlo sin depender de leer el código fuente completo.
> Ajusta nombres de tabla/columna/rutas si el proyecto destino difiere.
>
> **Nota sobre migraciones:** en el proyecto origen, **todas** las
> tablas/columnas que usan estas tres piezas ya existían de antes —
> `contratos.archivo_url`, `contratos.dia_pago`, `pagos.fecha_limite`,
> `pagos.factura_id`, `pagos.link_pago`, `pagos.fecha_pago` y la tabla
> `gastos` completa. No se corrió ninguna migración SQL en esta sesión. El
> DDL de `gastos` que aparece en la sección 3.2 se deja documentado tal
> cual quedó la tabla en el proyecto origen — solo hace falta correrlo en
> el proyecto destino si esa tabla no existe ahí todavía; si ya existe,
> basta con confirmar que las columnas coinciden.

Las tres piezas:

1. **Gate de firma en Contratos** — no se puede aprobar un contrato sin un
   PDF adjunto.
2. **Deuda del cliente consolidada en `pagos`** — dashboard del cliente,
   estado de cuenta, contrato seleccionado y pantalla de pago.
3. **Módulo nuevo "Ingresos por Centro"** — ingresos, gastos y ganancia
   neta por centro, con CRUD de gastos.

---

## 1. Gate de firma en Contratos

### 1.1 Resumen del flujo

Antes, "Aprobar" un contrato (`pre_aprobado` → `vigente`) no exigía que
hubiera ningún PDF cargado — el botón funcionaba igual con o sin
`archivo_url`. Ahora el botón se deshabilita si no hay archivo, en **todos
los lugares donde exista ese botón** (en el proyecto origen estaba
duplicado a propósito entre una vista de lista y un modal de detalle —
localiza todas las apariciones antes de tocar solo una). Sigue sin haber
firma electrónica real: es un requisito de "sube el PDF primero", el PDF
lo sigue subiendo el staff a mano con el flujo de Storage que ya exista.

### 1.2 Modelo de datos

No requiere columnas nuevas — usa `contratos.archivo_url` (URL del PDF ya
subido a Storage), que en el proyecto origen ya existía.

### 1.3 Cambios de código

**Botón "Aprobar"** (vista de lista):
```tsx
<button
  className="btn-aceptar"
  onClick={() => aprobarContrato(c.id)}
  disabled={procesandoAprobacion === c.id || !c.archivo_url}
>
  ✓ Aprobar
</button>
{!c.archivo_url && (
  <p style={{ fontSize: 12, color: "#a3701f", marginTop: 6 }}>
    ⚠️ Sube el contrato firmado antes de aprobar
  </p>
)}
```

**Defensa en profundidad** en la función que aprueba (por si se llega a
invocar programáticamente):
```ts
async function aprobarContrato(id: string) {
  const contratoAAprobar = contratos.find((c) => c.id === id);
  if (!contratoAAprobar?.archivo_url) return;

  setProcesandoAprobacion(id);
  await supabase.from("contratos").update({ estatus: "vigente" }).eq("id", id);
  // ...resto de la lógica de aprobación (generación de pagos, etc.) sin cambios
}
```

**Segundo lugar** (modal de detalle, si existe): mismo patrón —
`disabled={procesandoAprobacion || !contrato.archivo_url}` en el botón,
`if (!contrato.archivo_url) return;` al inicio de la función `aprobar()`,
y el mismo texto de advertencia, aclarando ahí que hay que darle "Guardar
cambios" primero si el PDF se acaba de seleccionar pero aún no se subió
(el modal típicamente sube el archivo en una acción de guardado separada
de la de aprobar).

### 1.4 Reglas de negocio no obvias

1. **El requisito es solo "que exista un archivo", no que esté validado
   como firmado.** El sistema no puede verificar el contenido del PDF —
   confía en que el staff no sube el PDF hasta tener la copia firmada.
2. **Si el botón de aprobar existe en más de un lugar, hay que tocar
   todos.** Es la misma razón por la que ya estaba duplicada la lógica de
   generación de pagos al aprobar en el proyecto origen — un gate a medias
   (deshabilitado en un lugar, habilitado en otro) es peor que no tener
   gate.

---

## 2. Deuda del cliente consolidada en `pagos`

### 2.1 Resumen del flujo — decisión de producto clave

El dashboard del cliente **dejó de mostrar facturas** para su resumen de
deuda. Todo lo que el cliente ve en su panel principal sale
**exclusivamente de la tabla `pagos`**. `facturas`/`/estado-cuenta` se
mantienen para el detalle completo (no se les quitó nada), pero el
**resumen del dashboard** no las consulta — un pago sin factura (renta,
depósito en garantía, adicionales, generados al aprobar un contrato) pesa
igual que uno con factura para efectos de "cuánto debo".

### 2.2 Modelo de datos usado (ya existente, no se crea nada)

| Tabla | Columnas que se leen | Para qué |
|---|---|---|
| `pagos` | `user_id`, `monto`, `concepto`, `estado`, `link_pago`, `factura_id` (nullable), `fecha_limite` (nullable — solo la traen los cargos SPEI), `fecha_pago` (nullable) | Fuente única de la deuda mostrada en el dashboard y en el detalle |
| `contratos` | `dia_pago` (día del mes en que paga el cliente) | Respaldo para calcular "días para pagar" cuando ningún pago trae `fecha_limite` |
| `facturas` | `user_id`, `estado`, `fecha_vencimiento`, `archivo_url` | Se sigue usando tal cual en `/estado-cuenta`, sin cambios en su lógica |

### 2.3 Dashboard del cliente — tarjeta de estado

**Server component** — trae solo lo necesario de `pagos`, ya no trae
`facturas`:
```ts
const { data: pagosPendientes } = await supabase
  .from("pagos")
  .select("estado, fecha_limite")
  .eq("user_id", session.user.id)
  .neq("estado", "pagado");
```

**Componente cliente** — cálculo del mensaje, en este orden de prioridad:

1. Algún pago con `fecha_limite` ya pasada → **vencido**.
2. Si no hay vencidos pero hay una `fecha_limite` futura (cargo SPEI ya
   generado) → cuenta regresiva de días hasta la más próxima.
3. Si hay deuda pero **ningún** pago trae `fecha_limite` (ej. renta recién
   generada al aprobar el contrato, sin cargo SPEI todavía) → se cae al
   **día de pago del contrato** (`contratos.dia_pago`) para seguir
   mostrando un conteo de días en vez de un mensaje genérico.
4. Solo si tampoco hay contrato con `dia_pago` → mensaje genérico
   "Tienes pagos pendientes".
5. Sin ningún pago pendiente → "🎉 ¡Estás al corriente!".

```ts
// Próxima ocurrencia del día de pago del contrato: si el día ya pasó
// este mes, se proyecta al mes siguiente.
function diasHastaProximoPago(diaPago: number): number {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  let proximo = new Date(hoy.getFullYear(), hoy.getMonth(), diaPago);
  if (proximo < hoy) proximo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, diaPago);
  return Math.round((proximo.getTime() - hoy.getTime()) / 86400000);
}

const hoyISO = new Date().toISOString().split("T")[0];
const hayVencida = pagosPendientes.some((p) => p.fecha_limite && p.fecha_limite < hoyISO);
const hayDeuda = pagosPendientes.length > 0;
const fechasLimite = pagosPendientes.map((p) => p.fecha_limite).filter((f): f is string => !!f);
const proximaFechaLimite = fechasLimite.length > 0 ? fechasLimite.sort()[0] : null;
const diaPagoContrato = (contratosCliente.find((ct) => ct.id === contratoId) || contratosCliente[0])?.dia_pago ?? null;
const diasParaPagar = proximaFechaLimite
  ? Math.ceil((new Date(proximaFechaLimite).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
  : diaPagoContrato != null
  ? diasHastaProximoPago(diaPagoContrato)
  : null;
```

Render (toda la tarjeta es un link al detalle):
```tsx
{hayDeuda ? (
  <a className="cli-estado-card" href="/estado-cuenta" style={{ textDecoration: "none" }}>
    <div>
      <p className="cli-estado-label">Estado de cuenta</p>
      <p className="cli-estado-monto" style={{ color: hayVencida ? "#f07e3a" : undefined, fontSize: 20 }}>
        {hayVencida
          ? "⚠️ Tienes pagos vencidos"
          : diasParaPagar !== null
          ? diasParaPagar <= 0
            ? "Vence hoy"
            : `Te quedan ${diasParaPagar} día${diasParaPagar === 1 ? "" : "s"} para pagar`
          : "Tienes pagos pendientes"}
      </p>
      <p className="cli-estado-fecha">Ver estado de cuenta</p>
    </div>
  </a>
) : (
  <div className="cli-al-corriente">
    <p className="cli-al-corriente-icon">🎉</p>
    <p className="cli-al-corriente-text">¡Estás al corriente!</p>
    <p className="cli-al-corriente-sub">No tienes pagos pendientes</p>
  </div>
)}
```

Si ya existe una consulta de contratos del cliente para otra cosa (banco
de horas, selector de contrato), basta con agregarle `dia_pago` al
`select` — no hace falta una consulta aparte.

### 2.4 `/estado-cuenta` — sumar los pagos sin factura

Se agrega una fuente más a la pantalla de detalle que ya lista facturas
pendientes/vencidas/pagadas: los `pagos` **sin** `factura_id` (renta,
depósito, adicionales).

```ts
// Se excluyen los pagos CON factura_id porque esos ya están cubiertos
// por el estado de su factura — si no, se contaría el mismo dinero dos
// veces en los totales.
const { data: pagos } = await supabase
  .from("pagos")
  .select("id, monto, concepto, estado, link_pago, fecha_pago, created_at")
  .eq("user_id", user.id)
  .is("factura_id", null)
  .order("created_at", { ascending: false });
```

Con eso:
- Se suman a los totales "Por pagar" / "Pagado" junto con las facturas.
- Nueva sección "💳 Otros pagos pendientes" (mismo estilo de tarjeta que
  las facturas), botón por cada uno que enlaza a
  `p.link_pago || \`/pagar-simulado/${p.id}\`` (fallback si el link
  guardado quedó vacío por algún error histórico).
- Se agregan al historial de pagos confirmados (`estado === "pagado"`),
  mezclados con las facturas pagadas.
- El estado vacío "Estás al corriente" se condiciona a que **ninguna** de
  las tres listas tenga pendientes (facturas pendientes, vencidas, y
  pagos sin factura pendientes).

### 2.5 Pantalla de pago (`/pagar-simulado/[id]`) — redirigir si hay sesión

Esta pantalla se usa en dos contextos: (a) un link de correo sin sesión, y
(b) un cliente logueado que llegó desde su propio dashboard. Antes no
redirigía a ningún lado en ninguno de los dos casos.

```ts
const [tieneSesion, setTieneSesion] = useState(false);

useEffect(() => {
  cargar();
  supabase.auth.getUser().then(({ data: { user } }) => setTieneSesion(!!user));
}, [id]);

async function simularPago() {
  // ...POST al endpoint que marca el pago como "pagado"...
  if (res.ok) {
    await cargar();
    if (tieneSesion) {
      setTimeout(() => router.push("/dashboard-cliente"), 1500);
    }
  }
}
```

Y en la pantalla de "pago confirmado", un botón visible solo con sesión
(cubre recarga de página con el pago ya confirmado, o por si el redirect
automático no alcanza a dispararse):
```tsx
{tieneSesion && (
  <a className="reservar-btn" href="/dashboard-cliente">Volver a mi panel</a>
)}
```

Sin sesión (link de correo puro), el comportamiento no cambia.

### 2.6 Selector de contrato → página de detalle de contrato

Si el cliente puede tener más de un contrato vigente y el dashboard ya
tiene un selector (`contratoId` en estado) pero la página de "Mi
contrato" siempre traía el más reciente por `created_at` sin importar
cuál estuviera seleccionado:

```tsx
// tile del dashboard
<a href={`/contrato${contratoId ? `?contratoId=${contratoId}` : ""}`}>Contrato</a>
```

```ts
// página de detalle de contrato
const searchParams = useSearchParams();
const contratoId = searchParams.get("contratoId");
let query = supabase.from("contratos").select("*").eq("user_id", user.id);
query = contratoId ? query.eq("id", contratoId) : query.order("created_at", { ascending: false });
const { data } = await query.limit(1).maybeSingle();
```

El `eq("user_id", user.id)` es lo que evita que alguien vea el contrato de
otro cliente cambiando el parámetro a mano.

### 2.7 Reglas de negocio no obvias

1. **`pagos.fecha_limite` solo existe para cargos SPEI ya generados** —
   no todo pago pendiente la trae. Nunca se debe inventar una fecha para
   los que no la tienen; por eso el fallback es `contratos.dia_pago`, un
   dato que sí está siempre disponible para un contrato vigente, y no un
   valor calculado a ciegas.
2. **Los pagos con `factura_id` no nulo no se vuelven a sumar en
   `/estado-cuenta`** — ya están representados por el estado de su
   factura. Sumarlos aparte duplicaría el monto adeudado/pagado.
3. **El redirect tras pagar solo aplica si hay sesión.** El mismo
   endpoint/pantalla de pago se usa para el link público de correo sin
   sesión — ahí no debe redirigir a ningún panel protegido.

### 2.8 Gaps conocidos / cosas a vigilar

- No se probó en navegador real en la sesión origen (sin credenciales de
  Supabase en ese entorno). Antes de dar por bueno: un cliente con pagos
  con y sin `fecha_limite`, con y sin `dia_pago` en su contrato, revisar
  que el mensaje de la tarjeta sea el correcto en cada combinación.
- Si el proyecto destino tiene un cron de cobranza que ya calcula "días
  desde/hasta el día de pago" por su cuenta, reutiliza esa función en vez
  de duplicar `diasHastaProximoPago` — deben coincidir en el criterio de
  "si ya pasó este mes, proyecta al siguiente".

---

## 3. Módulo nuevo "Ingresos por Centro"

### 3.1 Resumen del flujo

Hub nuevo de staff (no cliente) con dos tabs en un solo archivo: mismo
patrón de "tabs arriba, contenido condicional abajo, selector de centro
para roles globales" que ya use cualquier otro hub del proyecto.

1. **Resumen** — ingresos, gastos y ganancia neta del centro seleccionado,
   en un rango de fechas elegible (default: mes en curso).
2. **Gastos** — CRUD de gastos (alta/edición/borrado), con filtro opcional
   por categoría.

### 3.2 Modelo de datos

`gastos` — tabla nueva si no existe ya en el proyecto destino:
```sql
create table if not exists public.gastos (
  id uuid not null default gen_random_uuid(),
  centro text not null,
  concepto text not null,
  categoria text null,
  monto numeric not null,
  fecha date not null default current_date,
  notas text null,
  registrado_por uuid null references public.profiles(id),
  created_at timestamptz null default now(),
  tipo text null default 'operativo',
  constraint gastos_pkey primary key (id)
);
alter table public.gastos enable row level security;
create policy "Autenticados administran gastos" on public.gastos
  for all to authenticated using (true) with check (true);
```

Mismo nivel de rigor de RLS que el resto de las tablas de la app — el
filtrado real por centro lo hace cada página con `.eq("centro", c)`, no
RLS fino por rol. Endurece esto si el proyecto destino ya usa RLS por rol.

`pagos` — no se agrega nada, se reutiliza tal cual (ver sección 2.2).

### 3.3 Qué mide cada cifra (decisión de producto)

- **Ingresos** = `sum(pagos.monto)` con `pagos.estado = 'pagado'`,
  agrupado por `pagos.centro`, filtrado por `pagos.fecha_pago` dentro del
  rango elegido. Cubre cualquier origen de pago (SPEI, comprobante manual,
  simulado) sin lógica adicional — todos son filas de `pagos` con
  `estado = 'pagado'`.
- **Gastos** = `sum(gastos.monto)` agrupado por `gastos.centro`, mismo
  rango pero sobre `gastos.fecha`.
- **Ganancia neta** = ingresos − gastos.
- **Desglose por "departamento" dentro del centro: deliberadamente fuera
  de alcance.** Ninguna tabla financiera del proyecto origen tenía ese eje
  modelado, y se decidió no inventarlo — la UI debe dejarlo explícito
  ("Desglose por departamento: próximamente") en vez de omitirlo en
  silencio.

### 3.4 Componentes/página

Un solo componente cliente (`"use client"`) con:
- Estado: `miRol`, `centro`, `centrosDisponibles`, `tab`
  (`"resumen" | "gastos"`), `fechaDesde`/`fechaHasta` (default: primer y
  último día del mes en curso).
- `fetchTodo(centro)`: en paralelo, `pagos` (`.eq("centro", c).eq("estado", "pagado").gte("fecha_pago", fechaDesde).lte("fecha_pago", fechaHasta)`) y `gastos` (`.eq("centro", c).gte("fecha", fechaDesde).lte("fecha", fechaHasta)`).
- `totalIngresos`/`totalGastos`/`gananciaNeta` derivados por `useMemo`.

**Tab Resumen**: tres tarjetas de estadística (Ingresos / Gastos /
Ganancia neta), color condicional en la última (verde si ≥ 0, rojo si
negativa), y la nota de "desglose por departamento: próximamente".

**Tab Gastos**: mismo patrón de CRUD-en-tarjetas que use el resto del
proyecto — formulario con `concepto`, `categoria` (texto libre opcional),
`monto`, `fecha`, `notas` opcional, `tipo` (select con valores fijos:
`operativo`/`nómina`/`mantenimiento`/`otro`); botones ✎ Editar / 🗑
Eliminar por tarjeta; filtro opcional de `categoria` construido a partir
de los valores distintos ya presentes en los gastos cargados (no un
catálogo aparte). Al insertar un gasto nuevo, incluir
`registrado_por: user.id` del usuario autenticado.

### 3.5 Ruteo y navegación

- Middleware/guard de rutas: agregar la ruta nueva al bloque de "solo
  staff, cliente se redirige a su dashboard" y al matcher de rutas
  protegidas — copiar la entrada de cualquier otra ruta de staff ya
  existente y solo cambiar el prefijo.
- Tile nuevo en el panel de administración, junto al de "Reportes" si
  existe, mismo wrapper condicional de rol (staff, no "sistemas" si el
  proyecto tiene ese rol especial).

### 3.6 Reglas de negocio no obvias

1. **Ingresos y gastos miden lo mismo tipo de evento — dinero que
   efectivamente se movió, no lo facturado.** Por eso ingresos sale de
   `pagos` (dinero que ya entró) y no de `facturas` (que puede incluir
   pendientes/vencidas). Mezclar ambas fuentes en la misma cifra
   produciría un número que no cuadra con caja real.
2. **El rango de fechas por defecto es el mes en curso.** Un gasto o pago
   fuera de ese rango simplemente no aparece — no es un error de datos,
   es el filtro. Vale la pena dejarlo visualmente claro en la UI (los
   inputs de fecha siempre visibles, no escondidos) para que el staff no
   piense que faltan registros.

### 3.7 Gaps conocidos / cosas a vigilar

- No se probó en navegador real en la sesión origen. Antes de dar por
  bueno: dar de alta un par de `gastos`, cambiar el rango de fechas, y
  confirmar que el resumen recalcula bien para el centro y rango
  elegidos.
- Verificar en vivo si la tabla `gastos` en el proyecto destino ya tiene
  RLS/policy que permita `select`/`insert`/`update`/`delete` a usuarios
  autenticados — si no la tiene y el CRUD falla por permisos, resolverlo
  en ese momento con la policy de la sección 3.2, no antes.
- Desglose por departamento: pendiente a propósito (ver 3.3) — si se
  retoma, es el punto de extensión natural de este módulo.

---

## Checklist de replicación en otro proyecto

1. Confirmar/crear las columnas de la sección 2.2 (`contratos.dia_pago`,
   `pagos.fecha_limite`, `pagos.factura_id`, `pagos.link_pago`,
   `pagos.fecha_pago`) si no existen ya.
2. Correr el DDL de `gastos` (sección 3.2) si la tabla no existe.
3. Implementar la sección 1 (gate de firma) en **todos** los lugares donde
   exista el botón de aprobar contrato.
4. Implementar la sección 2 completa (dashboard, estado de cuenta,
   pantalla de pago, selector de contrato) — son cambios chicos pero
   repartidos en varios archivos, conviene hacerlos en el orden 2.3 → 2.4
   → 2.5 → 2.6 para poder probar cada uno antes de seguir.
5. Implementar la sección 3 (módulo nuevo) — puede ir en paralelo con las
   otras dos, no depende de ellas salvo por reutilizar `pagos`.
6. Correr el chequeo de tipos del proyecto (`tsc --noEmit` o equivalente)
   después de cada pieza.
7. Probar en vivo cada punto listado en los "Gaps conocidos" de cada
   sección — nada de esto se probó en navegador real en la sesión origen.
