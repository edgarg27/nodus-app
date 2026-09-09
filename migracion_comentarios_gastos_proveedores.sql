-- =====================================================================
-- Migración: comentarios de tickets con fotos + módulo de Proveedores
-- + adjuntos (factura/comprobante) y vínculo a proveedor en Gastos
--
-- Cómo correrlo: Supabase → tu proyecto → SQL Editor → pega todo esto →
-- Run. Es seguro volver a correrlo si algo falla a medias (usa
-- "if not exists" / "drop policy if exists" en todos lados).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Historial de comentarios de tickets (con hasta 5 fotos c/u)
-- ---------------------------------------------------------------------
create table if not exists public.ticket_comentarios (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  autor_id uuid references auth.users(id),
  autor_nombre text,
  autor_rol text,
  mensaje text,
  fotos_urls text[],
  created_at timestamptz not null default now()
);

create index if not exists ticket_comentarios_ticket_id_idx
  on public.ticket_comentarios (ticket_id);

alter table public.ticket_comentarios enable row level security;

-- El cliente dueño del ticket puede leer los comentarios; el staff que
-- resuelve tickets (sistemas/operaciones/superadmin/gerente) también.
drop policy if exists "ticket_comentarios_select" on public.ticket_comentarios;
create policy "ticket_comentarios_select" on public.ticket_comentarios
  for select using (
    exists (
      select 1
      from public.tickets t
      left join public.profiles p on p.id = auth.uid()
      where t.id = ticket_comentarios.ticket_id
        and (
          t.user_id = auth.uid()
          or (p.rol in ('sistemas', 'operaciones', 'superadmin', 'gerente'))
        )
    )
  );

-- Solo el staff que resuelve tickets puede comentar.
drop policy if exists "ticket_comentarios_insert_staff" on public.ticket_comentarios;
create policy "ticket_comentarios_insert_staff" on public.ticket_comentarios
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.rol in ('sistemas', 'operaciones', 'superadmin', 'gerente')
    )
  );

-- ---------------------------------------------------------------------
-- 2) Proveedores (registrados por centro)
-- ---------------------------------------------------------------------
create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  centro text not null,
  categoria text,
  contacto text,
  telefono text,
  email text,
  notas text,
  registrado_por uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists proveedores_centro_idx on public.proveedores (centro);

alter table public.proveedores enable row level security;

-- Cualquier cuenta de staff (no cliente) puede ver proveedores: los
-- roles globales ven todos los centros, el resto solo el suyo.
drop policy if exists "proveedores_select_staff" on public.proveedores;
create policy "proveedores_select_staff" on public.proveedores
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.rol <> 'cliente'
        and (
          p.rol in ('sistemas', 'superadmin', 'gerente', 'cobranza')
          or p.centro = proveedores.centro
        )
    )
  );

drop policy if exists "proveedores_insert_staff" on public.proveedores;
create policy "proveedores_insert_staff" on public.proveedores
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol <> 'cliente'
    )
  );

-- ---------------------------------------------------------------------
-- 3) Gastos: agrega adjuntos (factura / comprobante de pago), vínculo a
--    proveedor y quién lo registró. La tabla "gastos" ya existía —
--    esto solo le suma columnas nuevas, no toca lo que ya tenías.
-- ---------------------------------------------------------------------
alter table public.gastos add column if not exists proveedor_id uuid references public.proveedores(id);
alter table public.gastos add column if not exists factura_url text;
alter table public.gastos add column if not exists comprobante_pago_url text;
alter table public.gastos add column if not exists registrado_por uuid references auth.users(id);
alter table public.gastos add column if not exists registrado_por_nombre text;

alter table public.gastos enable row level security;

-- Permite a sistemas/operaciones (y a cobranza/superadmin/gerente)
-- registrar e insertar sus propios gastos. Si ya tenías políticas de
-- select en "gastos" para el panel de cobranza, esta política de
-- INSERT se suma sin quitarles nada.
drop policy if exists "gastos_insert_staff" on public.gastos;
create policy "gastos_insert_staff" on public.gastos
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.rol in ('sistemas', 'operaciones', 'cobranza', 'superadmin', 'gerente')
    )
  );

-- Deja leer gastos de su propio centro a sistemas/operaciones (por si
-- todavía no tenían ninguna política de SELECT en esta tabla). Si ya
-- existía una política de select más amplia, esta simplemente se suma.
drop policy if exists "gastos_select_staff" on public.gastos;
create policy "gastos_select_staff" on public.gastos
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.rol <> 'cliente'
        and (
          p.rol in ('sistemas', 'superadmin', 'gerente', 'cobranza')
          or p.centro = gastos.centro
        )
    )
  );

-- ---------------------------------------------------------------------
-- 4) Tickets: columna para fotos múltiples (si ya la corriste antes,
--    esta línea no hace nada, es segura de repetir).
-- ---------------------------------------------------------------------
alter table public.tickets add column if not exists foto_urls text[];

-- ---------------------------------------------------------------------
-- Nota sobre Storage: las fotos de comentarios usan el bucket "tickets"
-- (el mismo que ya usan los reportes de soporte). Las facturas y
-- comprobantes de pago de gastos usan el bucket "comprobantes" (el
-- mismo que ya usa "Subir comprobante" de los clientes). Si esos
-- buckets son privados, asegúrate de que su política de Storage
-- permita subir (INSERT) a cualquier usuario autenticado — igual que
-- ya deben estar configurados hoy para que funcionen los reportes y
-- comprobantes existentes.
-- =====================================================================
