-- =====================================================================
-- Tarjetas guardadas y cobro automático (Openpay)
--
-- El cliente guarda su tarjeta en Openpay (Nodus nunca ve el número: aquí solo
-- queda la marca, los últimos 4 dígitos y los ids de Openpay). Si además
-- autoriza el cobro automático, el cobro diario de facturación intenta cobrar
-- esa tarjeta cuando genera la renta del mes; si falla, sigue el SPEI de
-- respaldo y se le avisa.
--
--   consentimiento_*   cuándo, con qué texto (versión) y desde qué IP aceptó
--                      el cobro automático
--   fallos_consecutivos  cobros automáticos fallidos seguidos; con 3 se apaga
--                      solo el cobro automático
--
-- Solo el servidor (service role) crea, cambia o borra tarjetas: el cliente
-- únicamente las LEE (las suyas) y el staff puede verlas para dar soporte.
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de Supabase,
-- ANTES de usar "Mis tarjetas".
-- =====================================================================

create table if not exists public.tarjetas_guardadas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  openpay_customer_id text not null,
  openpay_card_id text not null unique,
  marca text,
  ultimos4 text,
  vence_mes text,
  vence_anio text,
  titular text,
  banco text,
  cobro_automatico boolean not null default false,
  consentimiento_at timestamptz,
  consentimiento_version text,
  consentimiento_ip text,
  fallos_consecutivos integer not null default 0,
  activa boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists tarjetas_guardadas_user_idx on public.tarjetas_guardadas (user_id);

-- A lo más una tarjeta con cobro automático por cliente.
create unique index if not exists tarjetas_guardadas_un_autopago_por_cliente
  on public.tarjetas_guardadas (user_id)
  where cobro_automatico and activa;

alter table public.tarjetas_guardadas enable row level security;

drop policy if exists "tarjetas_guardadas_select" on public.tarjetas_guardadas;
create policy "tarjetas_guardadas_select" on public.tarjetas_guardadas
  for select to authenticated
  using (user_id = auth.uid() or public.es_staff());
