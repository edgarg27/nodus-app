-- =====================================================================
-- Módulo "No soy cliente aún" (página pública /agendar-invitado) + Day Pass
--
-- Qué agrega:
--   1) Tabla `solicitudes_invitados` — guarda lo que pide alguien SIN
--      cuenta desde la página pública: agendar sala de juntas, coworking
--      u oficina privada, o solicitar un Day Pass. Queda "pendiente"
--      hasta que un admin del centro la revise (no crea una reservación
--      real todavía — eso lo hace el admin manualmente desde su propio
--      calendario, que ya está protegido contra traslapes).
--   2) Tabla `day_passes` — el registro de cada Day Pass que el STAFF
--      emite (folio consecutivo, centro, nombre de quien lo usa, fecha,
--      quién lo emitió). El folio es el que se imprime en el pase.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

-- 1) SOLICITUDES DE INVITADOS (público, sin cuenta) ---------------------
create table if not exists public.solicitudes_invitados (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tipo text not null check (tipo in (
    'sala_juntas', 'coworking', 'oficina_privada',
    'day_pass_coworking', 'day_pass_oficina_privada'
  )),
  centro text not null,
  nombre text not null,
  telefono text,
  email text,
  empresa text,
  fecha_deseada text,       -- 'YYYY-MM-DD', igual formato que reservaciones.fecha
  hora_inicio_deseada text, -- 'HH:00', solo aplica a sala_juntas/coworking/oficina_privada
  hora_fin_deseada text,
  notas text,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'contactado', 'agendada', 'rechazada')),
  reservacion_id uuid references public.reservaciones(id) on delete set null,
  day_pass_id uuid,
  atendido_por uuid references public.profiles(id) on delete set null,
  motivo_rechazo text
);

create index if not exists solicitudes_invitados_centro_estado_idx
  on public.solicitudes_invitados (centro, estado);

alter table public.solicitudes_invitados enable row level security;

-- Cualquiera (incluso sin sesión) puede CREAR una solicitud — es el punto
-- de la página pública. No puede leer, editar ni borrar nada.
drop policy if exists "solicitudes_invitados_insert_publico" on public.solicitudes_invitados;
create policy "solicitudes_invitados_insert_publico"
  on public.solicitudes_invitados
  for insert
  to anon, authenticated
  with check (true);

-- Solo staff (cualquier rol que no sea "cliente") puede ver y actualizar
-- las solicitudes — se filtra por centro dentro de la app (CentroPanel),
-- pero aquí se protege a nivel de base de datos que un cliente cualquiera
-- no pueda leer estos datos de contacto.
drop policy if exists "solicitudes_invitados_staff_select" on public.solicitudes_invitados;
create policy "solicitudes_invitados_staff_select"
  on public.solicitudes_invitados
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );

drop policy if exists "solicitudes_invitados_staff_update" on public.solicitudes_invitados;
create policy "solicitudes_invitados_staff_update"
  on public.solicitudes_invitados
  for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid() and profiles.rol <> 'cliente'
    )
  );

-- 2) DAY PASSES (solo staff, no público) ---------------------------------
create table if not exists public.day_passes (
  id uuid primary key default gen_random_uuid(),
  folio integer generated always as identity,
  created_at timestamptz not null default now(),
  tipo text not null check (tipo in ('coworking', 'oficina_privada')),
  centro text not null,
  nombre text not null,
  fecha text not null, -- 'YYYY-MM-DD', el día que es válido el pase
  emitido_por uuid references public.profiles(id) on delete set null,
  emitido_por_nombre text, -- copia del nombre de quien lo emitió (para el pase impreso)
  solicitud_id uuid references public.solicitudes_invitados(id) on delete set null
);

alter table public.day_passes enable row level security;

drop policy if exists "day_passes_staff_all" on public.day_passes;
create policy "day_passes_staff_all"
  on public.day_passes
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

-- Enlaza la referencia circular ahora que la tabla day_passes ya existe.
alter table public.solicitudes_invitados
  drop constraint if exists solicitudes_invitados_day_pass_id_fkey;
alter table public.solicitudes_invitados
  add constraint solicitudes_invitados_day_pass_id_fkey
  foreign key (day_pass_id) references public.day_passes(id) on delete set null;

-- =====================================================================
-- ⚠️ Nota sobre roles: las políticas de arriba usan "cualquier rol que no
-- sea cliente" para decidir quién es "staff". Si tu tabla `profiles` usa
-- otro criterio (ej. una columna `es_staff`), avísame y lo ajustamos.
-- =====================================================================
