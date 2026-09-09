# Vínculo paquete↔oficina y Disponibilidad de oficinas — Documentación técnica

> Dos piezas nuevas, construidas en la misma sesión, ambas girando
> alrededor de `oficinas`: primero se agregó la posibilidad de que una
> oficina tenga un paquete por defecto (sección 1), y sobre esa base se
> construyó un flujo de disponibilidad real en `/mapa-oficinas` que
> termina mandando al staff a `/registrar-plan` ya con todo precargado
> (sección 2). Depende de lo que ya documenta `DOCUMENTACION_COTIZAR.md`
> (paquetes, oficinas, `CotizarForm.tsx`) — léelo primero si no conoces
> ese flujo.
>
> **Nota sobre migraciones:** las dos migraciones de este documento
> (`oficinas.paquete_default_id` en la sección 1.2, y
> `oficinas.mapa_x`/`mapa_y` + `reservaciones.oficina_id` en la sección
> 2.2) **ya se corrieron** en la base del proyecto origen. Si se porta a
> otro proyecto, sí hace falta correrlas ahí.

---

## 1. Vínculo paquete↔oficina por defecto

### 1.1 Resumen del flujo

En `/paquetes`, el admin puede marcar qué oficinas específicas usan un
paquete por defecto. Cuando el staff cotiza (`/registrar-plan` →
`CotizarForm.tsx`) y elige esa oficina puntual, el paquete se
auto-selecciona **y queda bloqueado** (no editable) — es una regla de
negocio dura, no una sugerencia: esa oficina siempre se cotiza con ese
paquete.

El vínculo es **de la oficina hacia el paquete**, no al revés — una
oficina tiene un único paquete por defecto (o ninguno), pero varias
oficinas pueden compartir el mismo paquete (ej. todas las "oficinas
ejecutivas" usan el mismo paquete). Por eso el FK vive en `oficinas`, no
en `paquetes`, y no hay restricción de unicidad.

### 1.2 Modelo de datos

```sql
alter table public.oficinas
  add column if not exists paquete_default_id uuid references public.paquetes(id);
```

Nullable, sin unique — cualquier número de oficinas puede apuntar al
mismo paquete; cada oficina solo puede apuntar a uno (o a ninguno).

### 1.3 Admin — `/paquetes`

En el formulario de alta/edición de un paquete, un checklist múltiple
(no un `<select>` único) de las oficinas del mismo `tipo_espacio` que el
paquete:

```tsx
{oficinasDelTipoForm.map((o) => {
  const vinculadaAOtro =
    o.paquete_default_id && o.paquete_default_id !== editandoId ? paquetePorId[o.paquete_default_id] : null;
  return (
    <label key={o.id}>
      <input
        type="checkbox"
        checked={form.oficinasVinculadas.includes(o.id)}
        onChange={() =>
          setForm((f) => ({
            ...f,
            oficinasVinculadas: f.oficinasVinculadas.includes(o.id)
              ? f.oficinasVinculadas.filter((id) => id !== o.id)
              : [...f.oficinasVinculadas, o.id],
          }))
        }
      />
      {o.numero}
      {vinculadaAOtro && <span>· actualmente en "{vinculadaAOtro.nombre}"</span>}
    </label>
  );
})}
```

Una oficina puede aparecer en la lista aunque ya esté vinculada a **otro**
paquete — marcarla aquí se la "roba" (no hay conflicto de unicidad que lo
impida, es una reasignación válida). Al guardar el paquete, se sincroniza
`oficinas.paquete_default_id` con dos updates en lote:

```ts
const idsAntes = new Set(oficinas.filter((o) => o.paquete_default_id === paqueteGuardado.id).map((o) => o.id));
const idsAhora = new Set(form.oficinasVinculadas);
const paraSoltar = Array.from(idsAntes).filter((id) => !idsAhora.has(id));
const paraVincular = Array.from(idsAhora).filter((id) => !idsAntes.has(id));

if (paraSoltar.length > 0) await supabase.from("oficinas").update({ paquete_default_id: null }).in("id", paraSoltar);
if (paraVincular.length > 0) await supabase.from("oficinas").update({ paquete_default_id: paqueteGuardado.id }).in("id", paraVincular);
```

La tarjeta de cada paquete en la lista muestra todas sus oficinas
vinculadas: `🔗 Oficinas por defecto: 3, 5, 7`.

### 1.4 `CotizarForm.tsx` — auto-selección y bloqueo

Al elegir una oficina (`seleccionarOficina`), se busca si algún paquete
del mismo `tipo_espacio` tiene esa oficina como default:

```ts
function seleccionarOficina(id: string) {
  setOficinaId(id);
  const oficinaElegida = oficinas.find((o) => o.id === id) || null;
  const paqueteVinculado = oficinaElegida?.paquete_default_id
    ? paquetesDelTipo.find((p) => p.id === oficinaElegida.paquete_default_id) || null
    : null;

  if (paqueteVinculado && !paquetesYaRegistrados.has(paqueteVinculado.id)) {
    seleccionarPaquete(paqueteVinculado.id, id);
    setPaqueteBloqueado(true);
  } else {
    setPaqueteBloqueado(false);
    actualizarDepositoSegunSeleccion(id, paqueteId);
    // Caso borde: la oficina SÍ tiene vínculo, pero ese paquete ya está
    // registrado para este cliente (bloqueado por bloquea_reasignacion)
    // — no se puede forzar, se avisa y se deja el selector libre.
    setAvisoPaqueteVinculado(
      paqueteVinculado ? `Esta oficina está vinculada al paquete "${paqueteVinculado.nombre}", pero este cliente ya lo tiene registrado...` : ""
    );
  }
}

function seleccionarPaquete(id: string, ofcIdOverride?: string) {
  if (paqueteBloqueado) return; // defensa en profundidad, el <select> ya está disabled
  // ...resto sin cambios
}
```

El `<select>` de Paquete se deshabilita cuando `paqueteBloqueado` es
`true`, con una nota "🔒 Este paquete se asignó automáticamente por la
oficina elegida y no se puede cambiar."

### 1.5 Reglas de negocio no obvias

1. **El bloqueo es incondicional, incluso si el staff ya había elegido
   otro paquete a mano.** Elegir una oficina con vínculo siempre
   sobreescribe la selección manual previa — es una regla dura, no una
   sugerencia (decisión explícita del usuario al construir esto).
2. **Excepción al bloqueo: si el paquete vinculado ya está registrado
   para el cliente actual** (`paquetesYaRegistrados`, la misma
   protección de "no reasignar" que ya existía), no se puede forzar —
   se libera el selector y se avisa, en vez de dejar el formulario
   atascado con un paquete inutilizable.
3. **La consistencia tipo_espacio se garantiza en el admin, no en
   tiempo de cotización.** El checklist de `/paquetes` solo ofrece
   oficinas del mismo `tipo_espacio` que el paquete — si se salta esa
   regla insertando directo en la base, `CotizarForm.tsx` no encontraría
   el paquete en `paquetesDelTipo` y el auto-select simplemente no
   pasaría nada (no rompe, pero tampoco vincula).

---

## 2. Disponibilidad de oficinas en `/mapa-oficinas`

### 2.1 Resumen del flujo

Antes, `/mapa-oficinas` era solo un visor/subidor de una imagen de layout
por centro, sin ningún dato de `oficinas` conectado. Ahora:

1. La imagen tiene **pines de colores** por oficina (verde=disponible,
   azul=ocupada, gris=cualquier otro estado, ej. mantenimiento),
   posicionados en porcentaje sobre la imagen.
2. Modo **"Colocar pines"**: elegir una oficina de una lista, clic en la
   imagen, se guarda su posición.
3. Clic en un pin (fuera de modo edición) o un botón "🔍 Verificar
   disponibilidad" abre un **modal** con un formulario: oficina, paquete
   (auto-bloqueado si la oficina tiene uno por defecto — reutiliza la
   sección 1), un calendario compacto para la fecha de inicio, modalidad
   (Hora/Día/Semana/Mes) y cantidad.
4. Botón "Verificar disponibilidad": cruza de verdad `contratos` y
   `reservaciones` contra esa oficina y ese rango (no confía solo en
   `oficinas.estado`, que no tiene noción de fechas).
5. Si sale disponible, botón "Continuar a Registrar Plan →" que abre
   `/registrar-plan` con todo ya precargado.

### 2.2 Modelo de datos

```sql
-- Posición del pin de cada oficina sobre la imagen de su centro, en
-- porcentaje (0-100) del ancho/alto — así escala sin importar el tamaño
-- real en pantalla. Null = todavía sin pin.
alter table public.oficinas
  add column if not exists mapa_x numeric null,
  add column if not exists mapa_y numeric null;

-- Para cruzar reservaciones (modalidad Hora/Día) contra una oficina
-- específica en vez de solo el texto libre "espacio" que ya tenía la
-- tabla. Nullable: las reservaciones existentes quedan sin este dato,
-- no se migran retroactivamente — simplemente no entran en el choque
-- por oficina puntual.
alter table public.reservaciones
  add column if not exists oficina_id uuid references public.oficinas(id);
```

### 2.3 `lib/disponibilidadOficina.ts` — la lógica de choque

```ts
export async function verificarDisponibilidadOficina(supabase, params: {
  oficinaId: string;
  fechaInicio: string; // YYYY-MM-DD
  fechaFin: string;
  modalidad: "Hora" | "Día" | "Semana" | "Mes";
  horaInicio?: number;
  horaFin?: number;
}): Promise<{ disponible: boolean; motivo?: string }>
```

1. **Siempre** revisa `contratos` — choque de rango de fechas clásico
   (`a.inicio <= b.fin AND a.fin >= b.inicio`), **solo `estatus =
   'vigente'`** (un `pre_aprobado` todavía puede rechazarse, no cuenta
   como compromiso real):
   ```ts
   const { data } = await supabase.from("contratos")
     .select("id, fecha_inicio, fecha_vencimiento")
     .eq("oficina_id", oficinaId).eq("estatus", "vigente")
     .lte("fecha_inicio", fechaFin).gte("fecha_vencimiento", fechaInicio);
   ```
   Si hay alguno → no disponible, aplica para cualquier modalidad (una
   oficina con contrato vigente no se presta ni por hora).
2. Si la modalidad es **Hora/Día**, además revisa `reservaciones`
   (`estado` en `pendiente`/`confirmada`, choque de `fecha`/`fecha_fin` —
   son columnas `text` con formato ISO en el esquema real, la
   comparación lexicográfica funciona igual que con `date`). Si es
   "Hora", además filtra por traslape de `hora_inicio`/`hora_fin`.
3. Si nada choca → disponible.

### 2.4 `MapaConPines.tsx` — pines de colores + modo edición

```ts
const COLOR_POR_ESTADO: Record<string, string> = {
  disponible: "#0F6E56", // verde
  ocupada: "#185FA5",    // azul
  mantenimiento: "#8A8A8A", // gris
};
const COLOR_DEFAULT = "#8A8A8A"; // gris — cualquier otro valor de estado
```

El pin **no es un emoji** — un emoji no se puede colorear vía CSS. Es un
`<button>` circular con `background: colorPorEstado(o.estado)`,
posicionado con `left: ${mapa_x}%; top: ${mapa_y}%` dentro de un
contenedor `position: relative` envolviendo la `<img>` directamente (sin
padding entre ambos, si no los porcentajes quedan desalineados).

Modo "Colocar pines": clic en la imagen calcula el porcentaje con
`getBoundingClientRect()`:
```ts
const rect = imgRef.current.getBoundingClientRect();
const x = ((e.clientX - rect.left) / rect.width) * 100;
const y = ((e.clientY - rect.top) / rect.height) * 100;
await supabase.from("oficinas").update({ mapa_x: x, mapa_y: y }).eq("id", oficinaId);
```
Repetible para reposicionar — no hay distinción de "ya tiene pin" más
allá de mostrarlo en la lista con "(reposicionar)".

### 2.5 `ModalDisponibilidad.tsx` — el formulario

Se abre como modal (`.modal-overlay`/`.modal-card`, mismo patrón que
cualquier otro modal de la app — no como sidebar fijo, para no competir
por espacio con la imagen). Contiene:
- `<select>` de oficina (respaldo por si no se hizo clic en un pin).
- Paquete: mismo mecanismo de auto-bloqueo por `paquete_default_id` que
  `CotizarForm.tsx` (sección 1.4), reimplementado aquí porque es un
  componente independiente — si se detecta que se duplica demasiado al
  portar, vale la pena extraerlo a un hook compartido.
- Un mini-calendario (grid de 42 celdas, mismo patrón que cualquier
  calendario mensual del proyecto) solo para elegir la fecha de inicio.
- Modalidad + cantidad — **si no hay paquete elegido, la modalidad queda
  fija en "Mes"** (tarifa directa de la oficina), igual que en
  `CotizarForm.tsx`: la elección de Hora/Día/Semana solo tiene sentido
  cuando hay un paquete con esas tarifas definidas.
- Botón "Verificar disponibilidad" → llama a
  `verificarDisponibilidadOficina`. El resultado se invalida solo
  (vuelve a pedir verificación) si cualquier campo cambia después,
  comparando una "clave" de todos los campos contra la que se verificó:
  ```ts
  const clave = `${oficinaId}|${paqueteId}|${fechaInicio}|${modalidadEfectiva}|${cantidad}|${horaInicio}`;
  const verificado = resultado !== null && clave === claveVerificada;
  ```
- Botón "Continuar a Registrar Plan →", **deshabilitado hasta que
  `verificado && resultado.disponible`** — no deja mandar a cotizar algo
  que ya se sabe que choca.

### 2.6 Handoff a `/registrar-plan`

Arma la URL con querystring y navega:
```ts
const params = new URLSearchParams({ centro, tipoEspacio: oficina.tipo, oficinaId, fechaInicio, modalidad, cantidad });
if (paqueteId) params.set("paqueteId", paqueteId);
router.push(`/registrar-plan?${params.toString()}`);
```

`/registrar-plan/page.tsx` ya leía `clienteId`/`centro` por
`useSearchParams()` — se le agregan las lecturas de `tipoEspacio`,
`oficinaId`, `paqueteId`, `fechaInicio`, `modalidad`, `cantidad`, pasadas
como props nuevas y opcionales a `CotizarForm`.

`CotizarForm.tsx` las hidrata **reutilizando las funciones de selección
que ya existen** (`seleccionarTipoEspacio`, `seleccionarOficina` —que ya
trae el auto-bloqueo de paquete de la sección 1—, `seleccionarPaquete`),
no duplica la lógica de negocio:
```ts
const hidratadoDesdeUrl = useRef(false);
useEffect(() => {
  if (hidratadoDesdeUrl.current || loading) return;
  if (!tipoEspacioPreseleccionado && !oficinaPreseleccionadaId && !paquetePreseleccionadoId && !fechaInicioPreseleccionada) return;

  if (tipoEspacioPreseleccionado && tipoEspacio !== tipoEspacioPreseleccionado) {
    setTipoEspacio(tipoEspacioPreseleccionado);
    return; // espera al siguiente render: oficinasDelTipo/paquetesDelTipo ya reflejan el tipo nuevo
  }

  hidratadoDesdeUrl.current = true;
  if (oficinaPreseleccionadaId) seleccionarOficina(oficinaPreseleccionadaId);
  else if (paquetePreseleccionadoId) seleccionarPaquete(paquetePreseleccionadoId);
  if (fechaInicioPreseleccionada) setFechaInicio(fechaInicioPreseleccionada);
  if (cantidadPreseleccionada) setCantidadPeriodo(cantidadPreseleccionada);
  if (modalidadPreseleccionada) setModalidadPaquete(modalidadPreseleccionada as Modalidad);
}, [loading, tipoEspacio]);
```
El detalle importante: si hay que fijar `tipoEspacio` primero, el efecto
se **corta y espera al siguiente render** antes de elegir oficina/paquete
— si no, `oficinasDelTipo`/`paquetesDelTipo` (derivados por `useMemo` del
`tipoEspacio` todavía viejo) no habrían recalculado a tiempo y la
selección fallaría en silencio.

### 2.7 Reglas de negocio no obvias

1. **La disponibilidad nunca usa `oficinas.estado` para decidir.** Ese
   campo es un flag sin fecha — "ocupada hoy" no dice nada sobre si se
   libera antes del rango que se está cotizando, ni "disponible hoy"
   descarta un contrato que arranca la próxima semana. El cálculo real
   sale de cruzar fechas contra `contratos`/`reservaciones`.
2. **Solo contratos `vigente` cuentan como ocupación real** — uno
   `pre_aprobado` todavía puede rechazarse, no debe bloquear la
   disponibilidad de otro prospecto.
3. **El "Continuar a Registrar Plan" se bloquea si no se verificó (o si
   se verificó y salió ocupado).** Cualquier cambio en el formulario
   invalida la verificación anterior — nunca se deja pasar un resultado
   desactualizado.

### 2.8 Gaps conocidos / cosas a vigilar

- No se probó en navegador real en la sesión origen (sin credenciales de
  Supabase en ese entorno). Antes de dar por bueno: colocar pines,
  verificar una oficina con contrato vigente superpuesto (debe salir
  "Ocupado" con el motivo correcto), verificar una libre y confirmar que
  el handoff llega completo a `/registrar-plan` (incluido el bloqueo de
  paquete si aplica).
- **`reservaciones.oficina_id` es nullable y no se migró
  retroactivamente** — reservaciones creadas antes de este cambio no
  entran en el choque por oficina específica en modalidad Hora/Día. Si
  el proyecto destino tiene un volumen alto de reservaciones históricas
  y necesita que también cuenten, hay que decidir cómo backfillear ese
  campo (probablemente cruzando por `espacio` + `centro` + fecha contra
  `oficinas.numero`, con el riesgo de ambigüedad que ya tenía el texto
  libre).
- El estado `"mantenimiento"` de oficinas está contemplado en el color
  del pin, pero **no existe hoy ninguna pantalla que lo escriba** — solo
  se usan `"disponible"`/`"ocupada"` en el resto del código. Si se quiere
  usar de verdad, falta un lugar donde el staff pueda marcar una oficina
  en mantenimiento.
- No hay forma de "despejar" un pin ya colocado (quitarle `mapa_x`/
  `mapa_y`) desde la UI — solo reposicionarlo. Si una oficina deja de
  existir en el mapa pero sigue activa, habría que hacerlo a mano en la
  base.

---

## Checklist de replicación en otro proyecto

1. Confirmar que `DOCUMENTACION_COTIZAR.md` (o el equivalente del
   proyecto destino) ya describe `paquetes`/`oficinas`/`CotizarForm.tsx`
   — estas dos piezas asumen ese flujo como base.
2. Correr las dos migraciones (secciones 1.2 y 2.2).
3. Implementar la sección 1 completa (admin de `/paquetes` +
   `CotizarForm.tsx`) antes que la sección 2 — la sección 2 reutiliza su
   lógica de auto-bloqueo.
4. Implementar la sección 2 — puede dividirse en: (a) pines + modo
   edición, (b) lógica de disponibilidad, (c) modal, (d) handoff a
   `/registrar-plan`, probando cada una por separado.
5. `npx tsc --noEmit` (o equivalente) limpio después de cada pieza.
6. Probar en vivo cada punto de los "Gaps conocidos" de ambas secciones.
