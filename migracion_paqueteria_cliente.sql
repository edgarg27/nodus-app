-- Paquetes y correspondencia que recepción recibe para un cliente. El cliente
-- recibe un aviso (panel y correo) y lo ve en "Mis paquetes"; recepción lo
-- marca como entregado cuando lo recoge. Es seguro correrlo más de una vez.

create table if not exists public.paqueteria_cliente (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  centro text,
  tipo text not null default 'paquete' check (tipo in ('paquete', 'correspondencia', 'otro')),
  remitente text,
  descripcion text,
  -- Copia de datos del cliente al momento de registrar, para que recepción
  -- lo ubique rápido sin leer el perfil.
  cliente_nombre text,
  cliente_empresa text,
  numero_oficina text,
  estado text not null default 'por_recoger' check (estado in ('por_recoger', 'entregado')),
  recibido_por uuid references public.profiles(id) on delete set null,
  entregado_en timestamptz,
  entregado_por uuid references public.profiles(id) on delete set null
);

create index if not exists paqueteria_cliente_centro_estado_idx
  on public.paqueteria_cliente (centro, estado);
create index if not exists paqueteria_cliente_user_idx
  on public.paqueteria_cliente (user_id, created_at desc);

alter table public.paqueteria_cliente enable row level security;

-- El cliente solo ve lo suyo. Registrar se hace desde /api/paqueteria
-- (servidor, solo staff), por eso no hay política de insert.
drop policy if exists "paqueteria_cliente_propias_select" on public.paqueteria_cliente;
create policy "paqueteria_cliente_propias_select"
  on public.paqueteria_cliente
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "paqueteria_cliente_staff_select" on public.paqueteria_cliente;
create policy "paqueteria_cliente_staff_select"
  on public.paqueteria_cliente
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );

drop policy if exists "paqueteria_cliente_staff_update" on public.paqueteria_cliente;
create policy "paqueteria_cliente_staff_update"
  on public.paqueteria_cliente
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );
