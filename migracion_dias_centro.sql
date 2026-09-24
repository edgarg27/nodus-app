-- =====================================================================
-- Migración: días sin servicio por centro (Experiencia de Cliente)
--
-- Los festivos oficiales de México ya se calculan solos en el código
-- (lib/festivosMx.ts) y por defecto todos los centros cierran esos días.
-- Esta tabla guarda solo lo que se sale de eso, por centro:
--   tipo = 'cierre' → día extra en que ese centro no abre
--                     (Semana Santa, 24 de diciembre, mantenimiento…)
--   tipo = 'abre'   → festivo oficial en que ESE centro sí abre
--
-- La captura se hace en Experiencia de Cliente → Eventos → "Días sin
-- servicio", y el cliente lo ve en su calendario (solo el de su centro).
--
-- Es seguro volver a correr este archivo. Se corre a mano en el SQL Editor
-- de Supabase.
-- =====================================================================

create table if not exists public.dias_centro (
  id uuid primary key default gen_random_uuid(),
  centro text not null,
  fecha date not null,
  tipo text not null check (tipo in ('cierre', 'abre')),
  motivo text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (centro, fecha)
);

create index if not exists dias_centro_centro_fecha_idx on public.dias_centro (centro, fecha);

alter table public.dias_centro enable row level security;

-- Cualquier cuenta con sesión puede LEER (el cliente necesita ver los días
-- sin servicio de su centro; no hay nada sensible aquí).
drop policy if exists "dias_centro_select" on public.dias_centro;
create policy "dias_centro_select" on public.dias_centro
  for select using (auth.uid() is not null);

-- Solo el staff que usa Experiencia de Cliente puede crear/editar/borrar.
drop policy if exists "dias_centro_staff_write" on public.dias_centro;
create policy "dias_centro_staff_write" on public.dias_centro
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'gerente')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'gerente')
    )
  );
