-- =====================================================================
-- Notificaciones push (avisos al celular).
--
--   push_suscripciones   los dispositivos de cada persona que activó los avisos
--                        (cada celular o navegador es una suscripción).
--   notificaciones.push_enviado   marca los avisos ya mandados al celular, para
--                        no repetirlos. Los avisos que ya existían se marcan como
--                        enviados: solo se mandan los NUEVOS.
--
-- Solo el servidor (service role) crea o cambia suscripciones. Cada persona
-- puede ver y borrar las suyas.
--
-- Es seguro volver a correrlo. Hay que correrlo ANTES de desplegar.
-- Rollback: drop table push_suscripciones; alter table notificaciones drop column push_enviado;
-- =====================================================================

create table if not exists public.push_suscripciones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  ultimo_envio_at timestamptz
);

create index if not exists push_suscripciones_user_idx on public.push_suscripciones (user_id);

alter table public.push_suscripciones enable row level security;

drop policy if exists "push_suscripciones_ver_propias" on public.push_suscripciones;
create policy "push_suscripciones_ver_propias" on public.push_suscripciones
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "push_suscripciones_borrar_propias" on public.push_suscripciones;
create policy "push_suscripciones_borrar_propias" on public.push_suscripciones
  for delete to authenticated
  using (user_id = auth.uid());

-- Avisos ya enviados al celular. Lo anterior a hoy se marca como enviado.
alter table public.notificaciones
  add column if not exists push_enviado boolean not null default false;

update public.notificaciones set push_enviado = true where push_enviado = false;

create index if not exists notificaciones_push_pendiente_idx
  on public.notificaciones (created_at)
  where push_enviado = false;

-- Revisión: la tabla con RLS activa, sus dos políticas y la columna nueva.
select c.relname as tabla, c.relrowsecurity as rls_activa
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'push_suscripciones';

select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'push_suscripciones';

select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'notificaciones' and column_name = 'push_enviado';
