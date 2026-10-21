-- Avisos push de la app móvil (Android e iPhone). Cada celular con la app instalada registra aquí su "token":
-- Android el de Firebase Cloud Messaging, iPhone el de Apple (APNs). La tarea de avisos (cron push-avisos) manda
-- cada aviso de la campana a la web (push_suscripciones) y a estos dispositivos.
-- Es seguro correrlo más de una vez. Se corre a mano en el SQL Editor de Supabase ANTES de desplegar.

create table if not exists public.push_dispositivos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  plataforma text not null check (plataforma in ('android', 'ios')),
  created_at timestamptz not null default now(),
  ultimo_envio_at timestamptz
);

create index if not exists push_dispositivos_usuario_idx on public.push_dispositivos (user_id);

-- Solo se usa desde el servidor (llave de servicio): sin políticas de lectura directa.
alter table public.push_dispositivos enable row level security;
