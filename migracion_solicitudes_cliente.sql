-- Solicitudes que un cliente le manda al staff desde "Mi Contrato": renovar,
-- pedir más horas de sala, cambiar/ampliar espacio u otra cosa. El staff las
-- ve en su panel (pestaña "Solicitudes") y las marca como atendidas.
-- Es seguro correrlo más de una vez.

create table if not exists public.solicitudes_cliente (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  contrato_id uuid references public.contratos(id) on delete set null,
  centro text,
  tipo text not null check (tipo in ('renovar', 'mas_horas', 'cambiar_espacio', 'otro')),
  mensaje text,
  -- Copia de los datos de contacto al momento de la solicitud, para que el
  -- staff los vea sin depender de leer el perfil del cliente.
  cliente_nombre text,
  cliente_email text,
  cliente_telefono text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'atendida')),
  atendido_por uuid references public.profiles(id) on delete set null,
  atendido_en timestamptz
);

create index if not exists solicitudes_cliente_centro_estado_idx
  on public.solicitudes_cliente (centro, estado);
create index if not exists solicitudes_cliente_user_idx
  on public.solicitudes_cliente (user_id, created_at desc);

alter table public.solicitudes_cliente enable row level security;

-- El cliente solo ve las suyas. Crearlas se hace desde /api/solicitudes-cliente
-- (servidor), por eso no hay política de insert para el cliente.
drop policy if exists "solicitudes_cliente_propias_select" on public.solicitudes_cliente;
create policy "solicitudes_cliente_propias_select"
  on public.solicitudes_cliente
  for select
  to authenticated
  using (user_id = auth.uid());

-- El staff (cualquier rol que no sea cliente) las ve y las marca atendidas.
drop policy if exists "solicitudes_cliente_staff_select" on public.solicitudes_cliente;
create policy "solicitudes_cliente_staff_select"
  on public.solicitudes_cliente
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );

drop policy if exists "solicitudes_cliente_staff_update" on public.solicitudes_cliente;
create policy "solicitudes_cliente_staff_update"
  on public.solicitudes_cliente
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );
