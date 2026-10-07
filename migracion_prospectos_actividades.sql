-- =====================================================================
-- Migración: seguimiento de prospectos (/prospectos → "📋 Seguimiento")
--
-- Cada prospecto tiene una lista de actividades de seguimiento (contactar
-- por correo, mensaje, llamada, tour u otro medio), con una fecha y una
-- casilla de completada. Las encargadas revisan esta lista en la junta
-- semanal con las admins.
--
-- fecha: cuándo se va a hacer la actividad. Al palomearla, completada_en
--   guarda cuándo se hizo de verdad y completada_por quién la palomeó.
-- tipo_otro: obligatorio cuando tipo = 'otro' (qué medio fue).
--
-- Quién: los mismos roles que ya pueden ver / escribir el prospecto (ver
-- prospectos_select_rol y prospectos_escribe_rol en migracion_rls_lote2.sql):
--   ver      → cualquiera que pueda ver el prospecto (la subconsulta a
--              prospectos ya aplica su política de lectura).
--   escribir → superadmin, o admin / gerente / sistemas / operaciones del
--              mismo centro que el prospecto.
-- Una actividad ya completada no se puede borrar (queda como historial);
-- sí se puede desmarcar por si se palomeó por error.
--
-- ultimo_recordatorio: día en que se mandó el último resumen por correo que
--   la incluía (/api/cron/recordatorio-seguimiento, 9:00 am). Evita repetirla
--   si la tarea se corre dos veces el mismo día; una atrasada se vuelve a
--   recordar cada día hasta que se palomee.
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de
-- Supabase, ANTES de usar la pantalla.
-- Rollback: drop table public.prospecto_actividades;
-- =====================================================================

create table if not exists public.prospecto_actividades (
  id uuid primary key default gen_random_uuid(),
  prospecto_id uuid not null references public.prospectos(id) on delete cascade,
  tipo text not null check (tipo in ('correo', 'mensaje', 'llamada', 'tour', 'otro')),
  tipo_otro text,
  descripcion text,
  fecha date not null,
  completada boolean not null default false,
  completada_en timestamptz,
  completada_por uuid references auth.users(id),
  creado_por uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint prospecto_actividades_tipo_otro_chk
    check (tipo <> 'otro' or length(trim(coalesce(tipo_otro, ''))) > 0)
);

-- Se agregó después de la primera versión de esta migración: volver a correr
-- el archivo completo la agrega sin tocar lo demás.
alter table public.prospecto_actividades
  add column if not exists ultimo_recordatorio date;

-- Tours (tipo = 'tour'): la actividad se agenda también en el módulo de Tours
-- (tabla tours) y queda ligada por tour_id. Editar la fecha/hora de la
-- actividad actualiza el tour; borrarla quita el tour. hora y
-- tipo_espacio_interes son los mismos datos que pide /tours.
alter table public.prospecto_actividades
  add column if not exists hora time,
  add column if not exists tipo_espacio_interes text,
  add column if not exists tour_id uuid references public.tours(id) on delete set null;

create index if not exists prospecto_actividades_prospecto_idx
  on public.prospecto_actividades (prospecto_id, fecha);

alter table public.prospecto_actividades enable row level security;

drop policy if exists "prospecto_actividades_select" on public.prospecto_actividades;
create policy "prospecto_actividades_select" on public.prospecto_actividades
  for select to authenticated
  using (
    exists (select 1 from public.prospectos pr where pr.id = prospecto_actividades.prospecto_id)
  );

-- mi_rol() / mi_centro() son SECURITY DEFINER (ver
-- migracion_fix_recursion_profiles.sql).
drop policy if exists "prospecto_actividades_insert" on public.prospecto_actividades;
create policy "prospecto_actividades_insert" on public.prospecto_actividades
  for insert to authenticated
  with check (
    exists (
      select 1 from public.prospectos pr
      where pr.id = prospecto_actividades.prospecto_id
        and (
          public.mi_rol()::text = 'superadmin'
          or (public.mi_rol()::text in ('admin', 'gerente', 'sistemas', 'operaciones') and pr.centro = public.mi_centro())
        )
    )
  );

drop policy if exists "prospecto_actividades_update" on public.prospecto_actividades;
create policy "prospecto_actividades_update" on public.prospecto_actividades
  for update to authenticated
  using (
    exists (
      select 1 from public.prospectos pr
      where pr.id = prospecto_actividades.prospecto_id
        and (
          public.mi_rol()::text = 'superadmin'
          or (public.mi_rol()::text in ('admin', 'gerente', 'sistemas', 'operaciones') and pr.centro = public.mi_centro())
        )
    )
  )
  with check (
    exists (
      select 1 from public.prospectos pr
      where pr.id = prospecto_actividades.prospecto_id
        and (
          public.mi_rol()::text = 'superadmin'
          or (public.mi_rol()::text in ('admin', 'gerente', 'sistemas', 'operaciones') and pr.centro = public.mi_centro())
        )
    )
  );

drop policy if exists "prospecto_actividades_delete" on public.prospecto_actividades;
create policy "prospecto_actividades_delete" on public.prospecto_actividades
  for delete to authenticated
  using (
    not completada
    and exists (
      select 1 from public.prospectos pr
      where pr.id = prospecto_actividades.prospecto_id
        and (
          public.mi_rol()::text = 'superadmin'
          or (public.mi_rol()::text in ('admin', 'gerente', 'sistemas', 'operaciones') and pr.centro = public.mi_centro())
        )
    )
  );
