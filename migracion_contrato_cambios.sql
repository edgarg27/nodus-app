-- Historial de cambios de un contrato (renta, horas de sala, día de pago,
-- depósito, fechas y adicionales): quién lo cambió, qué valor tenía antes,
-- cuál puso y cuándo. Solo lo ve y lo escribe el staff; nadie puede editar
-- ni borrar un renglón ya guardado. Es seguro correrlo más de una vez.

create table if not exists public.contrato_cambios (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  created_at timestamptz not null default now(),
  campo text not null,
  valor_anterior text,
  valor_nuevo text,
  cambiado_por uuid references public.profiles(id) on delete set null,
  cambiado_por_nombre text
);

create index if not exists contrato_cambios_contrato_idx
  on public.contrato_cambios (contrato_id, created_at desc);

alter table public.contrato_cambios enable row level security;

drop policy if exists "contrato_cambios_staff_select" on public.contrato_cambios;
create policy "contrato_cambios_staff_select"
  on public.contrato_cambios
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );

drop policy if exists "contrato_cambios_staff_insert" on public.contrato_cambios;
create policy "contrato_cambios_staff_insert"
  on public.contrato_cambios
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );
