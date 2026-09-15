-- =====================================================================
-- Tarjeta de fidelidad (cliente frecuente sin contrato)
--
-- Qué agrega:
--   1) Tabla `tarjetas_fidelidad` — una por cliente frecuente. Folio
--      autoincremental que el cliente guarda para identificarse en
--      futuras visitas (sin necesidad de cuenta). Cualquiera puede pedir
--      la suya desde /tarjeta-fidelidad (autoservicio, igual patrón que
--      /agendar-invitado).
--   2) Tabla `tarjetas_fidelidad_sellos` — un renglón por cada uso que el
--      STAFF registra manualmente contra el folio del cliente (1 a 8).
--      Al llegar a 8, la tarjeta pasa a 'completada' y el regalo de la
--      casilla 9 se calcula en vivo (el tipo de espacio más rentado de
--      esos 8) — no se guarda una copia fija.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

create table if not exists public.tarjetas_fidelidad (
  id uuid primary key default gen_random_uuid(),
  folio integer generated always as identity,
  created_at timestamptz not null default now(),
  centro text not null,
  nombre text not null,
  telefono text,
  email text,
  estado text not null default 'activa' check (estado in ('activa', 'completada', 'canjeada')),
  regalo_canjeado_en timestamptz,
  regalo_canjeado_por uuid references public.profiles(id) on delete set null
);

create index if not exists tarjetas_fidelidad_centro_idx on public.tarjetas_fidelidad (centro);

alter table public.tarjetas_fidelidad enable row level security;

-- Cualquiera (incluso sin sesión) puede pedir su propia tarjeta — es el
-- punto de la página pública /tarjeta-fidelidad. No puede leer ni editar.
drop policy if exists "tarjetas_fidelidad_insert_publico" on public.tarjetas_fidelidad;
create policy "tarjetas_fidelidad_insert_publico"
  on public.tarjetas_fidelidad
  for insert
  to anon, authenticated
  with check (true);

-- Solo staff (cualquier rol que no sea "cliente") puede ver/editar
-- tarjetas — la consulta pública por folio se resuelve aparte, vía un
-- API route de solo lectura con la service role key (el folio es
-- fácil de adivinar/enumerar, así que no se expone por RLS directo).
drop policy if exists "tarjetas_fidelidad_staff_select" on public.tarjetas_fidelidad;
create policy "tarjetas_fidelidad_staff_select"
  on public.tarjetas_fidelidad
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );

drop policy if exists "tarjetas_fidelidad_staff_update" on public.tarjetas_fidelidad;
create policy "tarjetas_fidelidad_staff_update"
  on public.tarjetas_fidelidad
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );

create table if not exists public.tarjetas_fidelidad_sellos (
  id uuid primary key default gen_random_uuid(),
  tarjeta_id uuid not null references public.tarjetas_fidelidad(id) on delete cascade,
  numero integer not null check (numero between 1 and 8),
  created_at timestamptz not null default now(),
  tipo_espacio text not null check (tipo_espacio in ('sala_juntas', 'coworking', 'oficina_privada', 'working_desk')),
  detalle text, -- ej. "8 personas" (opcional, para desempatar el regalo con más precisión)
  capturado_por uuid references public.profiles(id) on delete set null,
  unique (tarjeta_id, numero)
);

alter table public.tarjetas_fidelidad_sellos enable row level security;

-- Los sellos SIEMPRE los captura el staff, nunca el cliente directamente.
drop policy if exists "tarjetas_fidelidad_sellos_staff_all" on public.tarjetas_fidelidad_sellos;
create policy "tarjetas_fidelidad_sellos_staff_all"
  on public.tarjetas_fidelidad_sellos
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  )
  with check (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );
