-- =====================================================================
-- Migración: Inventario separado por área (Sistemas / Servicio al Cliente / Operaciones / General)
--
-- Hasta ahora /inventario era una sola lista por centro que veían igual
-- Sistemas, las admins, gerente y superadmin. Ahora cada área tiene el
-- suyo:
--   - Sistemas  → solo ve y registra el inventario "sistemas" (todos los
--                 centros, con su selector de centro).
--   - Admins    → solo ven y registran el inventario "general" de SU
--                 centro (las dos personas de un mismo centro ven lo mismo,
--                 aunque cambien de turno).
--   - Servicio al Cliente (rol atencion_cliente) → solo su inventario
--                 "atencion_cliente" (cuenta sin centro: todos los centros).
--   - Operaciones → solo su inventario "operaciones" (todos los centros;
--                 hoy no tiene la tarjeta, queda listo por si se ocupa).
--   - Gerente   → inventario "general" de todos los centros.
--   - Superadmin → ve y administra todos, para corroborar.
--
-- Lo que ya existe se reparte según el rol de quien lo registró
-- (registrado_por): cuentas de Sistemas, Servicio al Cliente u
-- Operaciones → su propia área; todo lo demás queda en "general".
--
-- Se reemplazan TODAS las políticas anteriores de la tabla (las 5 que
-- había: "acceso a inventario por centro" y roles_globales_*) porque en
-- RLS las políticas se suman: si se dejara una vieja más abierta, seguiría
-- dejando ver el inventario del otro área.
--
-- Es seguro volver a correr este archivo. Se corre a mano en el SQL
-- Editor de Supabase, ANTES de probar la pantalla nueva.
-- =====================================================================

begin;

-- 1) Columna del área
alter table public.inventario
  add column if not exists area text not null default 'general';

alter table public.inventario drop constraint if exists inventario_area_check;
alter table public.inventario
  add constraint inventario_area_check check (area in ('sistemas', 'atencion_cliente', 'operaciones', 'general'));

create index if not exists inventario_centro_area_idx on public.inventario (centro, area);

-- 2) Repartir lo que ya existe según quién lo registró
-- (profiles.rol es del tipo rol_nodus, no text: se convierte para
-- compararlo con area.)
update public.inventario i
set area = p.rol::text
from public.profiles p
where p.id = i.registrado_por
  and p.rol::text in ('sistemas', 'atencion_cliente', 'operaciones')
  and i.area <> p.rol::text;

-- 3) Permisos (RLS)
alter table public.inventario enable row level security;

drop policy if exists "acceso a inventario por centro" on public.inventario;
drop policy if exists "roles_globales_select_inventario" on public.inventario;
drop policy if exists "roles_globales_insert_inventario" on public.inventario;
drop policy if exists "roles_globales_update_inventario" on public.inventario;
drop policy if exists "roles_globales_delete_inventario" on public.inventario;
drop policy if exists "inventario_por_area" on public.inventario;

-- Una sola regla para ver, agregar, cambiar y borrar: cada quien solo
-- toca las filas de su área (y las admins, solo de su centro).
create policy "inventario_por_area" on public.inventario
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'
          or (p.rol = 'sistemas' and inventario.area = 'sistemas')
          or (p.rol = 'operaciones' and inventario.area = 'operaciones')
          or (p.rol = 'atencion_cliente' and inventario.area = 'atencion_cliente')
          or (p.rol = 'gerente' and inventario.area = 'general')
          or (p.rol = 'admin' and inventario.area = 'general' and inventario.centro = p.centro)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'
          or (p.rol = 'sistemas' and inventario.area = 'sistemas')
          or (p.rol = 'operaciones' and inventario.area = 'operaciones')
          or (p.rol = 'atencion_cliente' and inventario.area = 'atencion_cliente')
          or (p.rol = 'gerente' and inventario.area = 'general')
          or (p.rol = 'admin' and inventario.area = 'general' and inventario.centro = p.centro)
        )
    )
  );

commit;

-- Para revisar cómo quedó el reparto (opcional):
-- select centro, area, count(*) from public.inventario group by 1, 2 order by 1, 2;
