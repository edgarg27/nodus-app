-- =====================================================================
-- Comentarios en la Propuesta de layout (/propuestas-layout).
--
-- En lugar de marcar "le gustó / no le gustó", la admin deja un comentario
-- con lo que dijo el cliente y con eso la arquitecta decide si manda la
-- cotización. Los dos (y gerencia) pueden comentar:
--   * Operaciones, Gerente y Superadmin: en todas las propuestas.
--   * Admin: solo en las de su centro.
-- Cada quien escribe a su nombre (autor_id = su usuario).
-- Requiere haber corrido antes migracion_propuestas_layout.sql.
-- Es seguro volver a correrlo.
-- Rollback: drop table public.propuestas_layout_comentarios;
-- =====================================================================

begin;

create table if not exists public.propuestas_layout_comentarios (
  id uuid primary key default gen_random_uuid(),
  propuesta_id uuid not null references public.propuestas_layout(id) on delete cascade,
  autor_id uuid references auth.users(id),
  autor_nombre text,
  autor_rol text,
  mensaje text not null,
  created_at timestamptz not null default now()
);

create index if not exists propuestas_layout_comentarios_propuesta_idx
  on public.propuestas_layout_comentarios (propuesta_id, created_at);

alter table public.propuestas_layout_comentarios enable row level security;

drop policy if exists "propuestas_layout_comentarios_select" on public.propuestas_layout_comentarios;
create policy "propuestas_layout_comentarios_select" on public.propuestas_layout_comentarios
  for select to authenticated
  using (
    public.mi_rol()::text in ('operaciones', 'superadmin', 'gerente')
    or (
      public.mi_rol()::text = 'admin'
      and exists (
        select 1 from public.propuestas_layout p
        where p.id = propuesta_id and p.centro = public.mi_centro()
      )
    )
  );

drop policy if exists "propuestas_layout_comentarios_insert" on public.propuestas_layout_comentarios;
create policy "propuestas_layout_comentarios_insert" on public.propuestas_layout_comentarios
  for insert to authenticated
  with check (
    autor_id = auth.uid()
    and (
      public.mi_rol()::text in ('operaciones', 'superadmin', 'gerente')
      or (
        public.mi_rol()::text = 'admin'
        and exists (
          select 1 from public.propuestas_layout p
          where p.id = propuesta_id and p.centro = public.mi_centro()
        )
      )
    )
  );

commit;

-- Comprobación: deben salir las 2 políticas.
select policyname, cmd from pg_policies where tablename = 'propuestas_layout_comentarios' order by policyname;
