-- =====================================================================
-- Migración: gastos con semáforo y control de pago + rol "Gastos" (contabilidad).
--
-- Las administradoras registran los gastos de su centro con su factura y un
-- semáforo de urgencia (verde / amarillo / rojo) y fecha límite de pago.
-- Contabilidad (rol "gastos") ve los gastos de TODOS los centros, abre y
-- descarga la factura y los marca como "pagado" (fecha y comprobante) o
-- "no se paga" (motivo). Eso lo hace /api/gastos/revisar con permisos de
-- servidor, así que el rol "gastos" solo necesita LEER (select).
--
-- 1) Columnas nuevas en gastos (urgencia, fecha límite, XML, estado de pago).
-- 2) Rol "gastos" y sus políticas de solo lectura en gastos y proveedores.
-- 3) Candado: un gasto ya pagado o rechazado no se puede cambiar ni borrar
--    desde la app (solo el servidor, superadmin o gerente).
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de Supabase.
-- Rollback: borrar las políticas "*_rol_gastos_select" (gastos, proveedores y
--   notificaciones), el trigger
--   "gastos_candado_revisado" y cambiar esas cuentas a otro rol. Las columnas
--   y el valor del enum pueden quedarse (no estorban).
-- =====================================================================

-- ---------------------------------------------------------------- PASO 1

-- 1) Columnas nuevas
alter table public.gastos add column if not exists urgencia text not null default 'verde';
alter table public.gastos add column if not exists fecha_limite_pago date;
alter table public.gastos add column if not exists xml_url text;
alter table public.gastos add column if not exists estado_pago text not null default 'pendiente';
alter table public.gastos add column if not exists fecha_pago date;
alter table public.gastos add column if not exists motivo_no_pago text;
alter table public.gastos add column if not exists revisado_por uuid references auth.users(id) on delete set null;
alter table public.gastos add column if not exists revisado_por_nombre text;
alter table public.gastos add column if not exists revisado_at timestamptz;

alter table public.gastos drop constraint if exists gastos_urgencia_check;
alter table public.gastos add constraint gastos_urgencia_check check (urgencia in ('verde', 'amarillo', 'rojo'));
alter table public.gastos drop constraint if exists gastos_estado_pago_check;
alter table public.gastos add constraint gastos_estado_pago_check check (estado_pago in ('pendiente', 'pagado', 'no_pagado'));

-- 2) Rol "gastos": solo lectura
alter type public.rol_nodus add value if not exists 'gastos';

drop policy if exists "gastos_rol_gastos_select" on public.gastos;
create policy "gastos_rol_gastos_select" on public.gastos
  for select to authenticated
  using (public.mi_rol()::text = 'gastos');

drop policy if exists "proveedores_rol_gastos_select" on public.proveedores;
create policy "proveedores_rol_gastos_select" on public.proveedores
  for select to authenticated
  using (public.mi_rol()::text = 'gastos');

-- Su campana: solo los avisos de gastos nuevos de todos los centros.
drop policy if exists "notificaciones_rol_gastos_select" on public.notificaciones;
create policy "notificaciones_rol_gastos_select" on public.notificaciones
  for select to authenticated
  using (public.mi_rol()::text = 'gastos' and tipo = 'nuevo_gasto');

-- 3) Candado de gastos ya revisados. El servidor (service role) no tiene
--    auth.uid(), así que /api/gastos/revisar sí puede marcarlos.
create or replace function public.gastos_candado_revisado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.estado_pago is distinct from 'pendiente'
     and auth.uid() is not null
     and coalesce(public.mi_rol()::text, '') not in ('superadmin', 'gerente') then
    raise exception 'Este gasto ya fue revisado por contabilidad y no se puede cambiar ni borrar.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists gastos_candado_revisado on public.gastos;
create trigger gastos_candado_revisado
  before update or delete on public.gastos
  for each row execute function public.gastos_candado_revisado();

-- ---------------------------------------------------------------- PASO 2
-- Córrelo APARTE, después del paso 1 (selecciona solo este bloque y dale Run):
-- el valor nuevo del enum no se puede usar en la misma corrida en que se crea.
-- Da el rol a la cuenta de contabilidad (creada en Supabase, todavía sin perfil).
--
-- insert into public.profiles (id, email, nombre, rol, centro, activo)
-- select u.id, u.email, 'Contabilidad', 'gastos', null, true
-- from auth.users u
-- where u.email = 'contabilidadit@nodusbc.mx'
-- on conflict (id) do update set rol = 'gastos', centro = null, activo = true;
--
-- Comprobación: debe salir con rol "gastos".
-- select email, nombre, rol, centro from public.profiles where email = 'contabilidadit@nodusbc.mx';
