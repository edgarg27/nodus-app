-- =====================================================================
-- Bitácora de movimientos de pagos y facturas.
--
-- Deja constancia de QUIÉN del personal hizo CADA acción sobre un pago o
-- una factura, SOBRE QUÉ cliente y CUÁNDO (fecha y hora exactas): registrar
-- un cargo, marcar pagado, integrar un estado de cuenta, timbrar (CFDI),
-- cancelar ante el SAT y borrar un estado de cuenta sin timbrar.
--
-- La escribe SIEMPRE el servidor con el service role (que salta RLS), nunca
-- el navegador; por eso no hay política de INSERT. La consulta solo el
-- personal de administración/cobranza/finanzas (política de SELECT con las
-- funciones SECURITY DEFINER mi_rol()/mi_centro(), para no recursar sobre
-- profiles). El nombre del actor y del cliente se guardan como copia (snapshot)
-- para que la bitácora siga siendo legible aunque luego cambien o se borren.
--
-- Es seguro volver a correrlo.
-- =====================================================================

begin;

create table if not exists public.bitacora_movimientos (
  id uuid primary key default gen_random_uuid(),
  creado_en timestamptz not null default now(),
  -- Quién lo hizo (personal). Snapshot del nombre y rol al momento de la acción.
  actor_id uuid references auth.users (id) on delete set null,
  actor_nombre text,
  actor_rol text,
  -- Qué hizo y sobre qué.
  accion text not null,                 -- pago_registrado | pago_marcado_pagado | factura_integrada | factura_timbrada | factura_cancelada | factura_borrada | factura_pagada
  entidad text not null,                -- 'pago' | 'factura'
  entidad_id uuid,                      -- sin FK a propósito: la factura/pago puede borrarse y la bitácora debe quedar
  folio text,
  -- Sobre qué cliente. Snapshot del nombre.
  cliente_id uuid references auth.users (id) on delete set null,
  cliente_nombre text,
  centro text,
  monto numeric,
  detalle text
);

create index if not exists bitacora_cliente_idx on public.bitacora_movimientos (cliente_id, creado_en desc);
create index if not exists bitacora_centro_idx on public.bitacora_movimientos (centro, creado_en desc);
create index if not exists bitacora_entidad_idx on public.bitacora_movimientos (entidad, entidad_id);
create index if not exists bitacora_fecha_idx on public.bitacora_movimientos (creado_en desc);

alter table public.bitacora_movimientos enable row level security;

-- Solo la consulta el personal de administración y cobranza (mismos roles que Facturas/Cobranza);
-- la escribe el servidor (service role, que salta RLS).
drop policy if exists "bitacora_select_staff" on public.bitacora_movimientos;
create policy "bitacora_select_staff" on public.bitacora_movimientos
  for select to authenticated
  using (
    public.mi_rol() = any (array['admin', 'superadmin', 'gerente', 'gerente_ventas', 'cobranza'])
  );

-- Para mostrar "registrado por" directo en cada pago y en cada factura (quién hizo el último registro).
alter table public.pagos add column if not exists registrado_por uuid references auth.users (id) on delete set null;
alter table public.facturas add column if not exists registrado_por uuid references auth.users (id) on delete set null;

commit;

-- =====================================================================
-- Para revertir:
-- begin;
--   drop policy if exists "bitacora_select_staff" on public.bitacora_movimientos;
--   drop table if exists public.bitacora_movimientos;
--   alter table public.pagos drop column if exists registrado_por;
--   alter table public.facturas drop column if exists registrado_por;
-- commit;
-- =====================================================================
