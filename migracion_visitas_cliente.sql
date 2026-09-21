-- Visitas que un cliente registra para que recepción las espere (nombre del
-- visitante, fecha y hora). El staff las ve en la pestaña "Visitas" del Panel
-- de Centro y marca cuando la persona llegó. Es seguro correrlo más de una vez.

create table if not exists public.visitas_cliente (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  centro text,
  visitante_nombre text not null,
  visitante_empresa text,
  visitante_telefono text,
  fecha text not null,          -- 'YYYY-MM-DD'
  hora text not null,           -- 'HH:MM'
  motivo text,
  -- Copia de datos del cliente al momento de registrar, para que recepción
  -- sepa a quién avisar sin leer el perfil.
  cliente_nombre text,
  cliente_empresa text,
  numero_oficina text,
  estado text not null default 'esperada' check (estado in ('esperada', 'llego', 'cancelada')),
  llego_en timestamptz,
  atendido_por uuid references public.profiles(id) on delete set null
);

create index if not exists visitas_cliente_centro_fecha_idx
  on public.visitas_cliente (centro, fecha);
create index if not exists visitas_cliente_user_idx
  on public.visitas_cliente (user_id, fecha desc);

alter table public.visitas_cliente enable row level security;

-- El cliente solo ve las suyas. Crear y cancelar se hace desde
-- /api/visitas-cliente (servidor), por eso no hay política de escritura para él.
drop policy if exists "visitas_cliente_propias_select" on public.visitas_cliente;
create policy "visitas_cliente_propias_select"
  on public.visitas_cliente
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "visitas_cliente_staff_select" on public.visitas_cliente;
create policy "visitas_cliente_staff_select"
  on public.visitas_cliente
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );

drop policy if exists "visitas_cliente_staff_update" on public.visitas_cliente;
create policy "visitas_cliente_staff_update"
  on public.visitas_cliente
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );
