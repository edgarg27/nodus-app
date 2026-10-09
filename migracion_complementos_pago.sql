-- =====================================================================
-- Complementos de pago (CFDI tipo "P") — Facturapi.
--
-- Una factura emitida a pago diferido (PPD) se cubre, cuando el cliente
-- paga, con un complemento de pago. Un solo complemento puede cubrir varias
-- facturas del mismo cliente.
--
--   complementos_pago           el CFDI de pago (uno por pago recibido)
--   complemento_pago_facturas   qué facturas cubre y cuánto de cada una:
--                               parcialidad, saldo anterior, importe pagado
--                               y saldo insoluto
--
-- El saldo de una factura PPD = su monto - suma de lo cubierto por
-- complementos que no estén cancelados.
--
-- Solo el servidor (service role) escribe: no hay políticas de insert/update/
-- delete. Leer: el cliente ve los suyos; el personal ve los de su centro
-- (superadmin y gerente, todos).
--
-- Es seguro volver a correrlo. Hay que correrlo ANTES de desplegar.
-- Rollback: drop table complemento_pago_facturas, complementos_pago;
-- =====================================================================

create table if not exists public.complementos_pago (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  centro text,
  facturapi_id text,
  uuid_cfdi text,
  serie text,
  folio_fiscal text,
  forma_pago text not null,
  fecha_pago date not null,
  monto numeric(12, 2) not null check (monto > 0),
  pago_id uuid references public.pagos(id) on delete set null,
  xml_url text,
  archivo_url text,
  cancelacion_estatus text check (cancelacion_estatus is null or cancelacion_estatus in ('en_proceso', 'cancelada', 'rechazada')),
  cancelacion_motivo text check (cancelacion_motivo is null or cancelacion_motivo in ('01', '02', '03', '04')),
  cancelacion_solicitada_en timestamptz,
  cancelacion_solicitada_por uuid references auth.users(id) on delete set null,
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists complementos_pago_uuid_cfdi_unique
  on public.complementos_pago (uuid_cfdi) where uuid_cfdi is not null;
create index if not exists complementos_pago_centro_idx on public.complementos_pago (centro, created_at desc);
create index if not exists complementos_pago_user_idx on public.complementos_pago (user_id, created_at desc);

create table if not exists public.complemento_pago_facturas (
  id uuid primary key default gen_random_uuid(),
  complemento_id uuid not null references public.complementos_pago(id) on delete cascade,
  factura_id uuid not null references public.facturas(id) on delete restrict,
  uuid_factura text not null,
  parcialidad integer not null check (parcialidad >= 1),
  saldo_anterior numeric(12, 2) not null check (saldo_anterior >= 0),
  importe numeric(12, 2) not null check (importe > 0),
  saldo_insoluto numeric(12, 2) not null check (saldo_insoluto >= 0)
);

create index if not exists complemento_pago_facturas_factura_idx on public.complemento_pago_facturas (factura_id);
create index if not exists complemento_pago_facturas_complemento_idx on public.complemento_pago_facturas (complemento_id);

alter table public.complementos_pago enable row level security;
alter table public.complemento_pago_facturas enable row level security;

drop policy if exists "complementos_pago_select" on public.complementos_pago;
create policy "complementos_pago_select" on public.complementos_pago
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = any (array['superadmin'::rol_nodus, 'gerente'::rol_nodus])
          or (p.rol = any (array['admin'::rol_nodus, 'cobranza'::rol_nodus]) and p.centro = complementos_pago.centro)
        )
    )
  );

drop policy if exists "complemento_pago_facturas_select" on public.complemento_pago_facturas;
create policy "complemento_pago_facturas_select" on public.complemento_pago_facturas
  for select to authenticated
  using (
    exists (select 1 from public.complementos_pago c where c.id = complemento_pago_facturas.complemento_id)
  );

-- Revisión: deben aparecer las dos tablas con RLS activa y sus políticas.
select c.relname as tabla, c.relrowsecurity as rls_activa
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('complementos_pago', 'complemento_pago_facturas');

select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename in ('complementos_pago', 'complemento_pago_facturas');
