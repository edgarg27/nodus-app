-- Cobranza unificada (Pagos entra en Cobranza):
--   1) Forma de pago con la que se registró cada pago (efectivo, transferencia, tarjeta…).
--   2) Promesas de pago: lo que el cliente dijo que iba a pagar, cuándo lo dijo y por qué medio.
-- Es seguro correrlo más de una vez. Se corre a mano en el SQL Editor de Supabase ANTES de desplegar.

alter table public.pagos add column if not exists forma_pago text;

create table if not exists public.promesas_pago (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  centro text,
  monto numeric(12, 2),
  fecha_promesa date not null,
  fecha_contacto date not null default current_date,
  medio text not null default 'whatsapp' check (medio in ('whatsapp', 'llamada', 'correo', 'en_persona', 'otro')),
  nota text,
  estado text not null default 'activa' check (estado in ('activa', 'cumplida', 'incumplida', 'cancelada')),
  creado_por uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists promesas_pago_usuario_idx on public.promesas_pago (user_id, created_at desc);
create index if not exists promesas_pago_centro_idx on public.promesas_pago (centro, estado);

-- Solo se usa desde el servidor (API de Cobranza con la llave de servicio): sin políticas de lectura directa.
alter table public.promesas_pago enable row level security;
