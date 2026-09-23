-- =====================================================================
-- Migración: Banners promocionales editables por Diseño
--
-- Hasta ahora los banners fijos de arriba del dashboard del cliente
-- (Nodus Flex Center, capacitación, San Telmo) estaban quemados en el
-- código (BANNERS_DESTACADOS en app/components/CarruselBanners.tsx).
-- Esta tabla los vuelve editables: Diseño los sube/reemplaza desde
-- /diseno/banners y el cambio se refleja solo en el carrusel de todos
-- los clientes y del propio Panel de Diseño (misma tabla, un solo
-- lugar). Los banners de "Logros" (tabla "logros") no cambian, siguen
-- su propio flujo.
--
-- Es seguro volver a correr este archivo. Se corre a mano en el SQL
-- Editor de Supabase.
-- =====================================================================

create table if not exists public.banners_promocionales (
  id uuid primary key default gen_random_uuid(),
  src text not null,
  -- Ruta dentro del bucket "banners-promocionales", solo para los que se
  -- subieron desde /diseno/banners (null en los 3 banners semilla, que
  -- viven en /public/images y no en Storage) — sirve para borrar el
  -- archivo del bucket cuando se reemplaza o se borra el banner.
  storage_path text,
  alt text not null default '',
  orden int not null default 0,
  activo boolean not null default true,
  actualizado_por uuid references auth.users(id),
  actualizado_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists banners_promocionales_orden_idx on public.banners_promocionales (activo, orden);

alter table public.banners_promocionales enable row level security;

-- Cualquier cuenta con sesión (staff o cliente) puede ver los banners
-- activos — es lo que alimenta el carrusel de todos los dashboards.
drop policy if exists "banners_promo_select_activos" on public.banners_promocionales;
create policy "banners_promo_select_activos" on public.banners_promocionales
  for select using (activo = true);

-- Diseño (y superadmin/gerente) los ve y administra todos, activos o no.
drop policy if exists "banners_promo_staff_all" on public.banners_promocionales;
create policy "banners_promo_staff_all" on public.banners_promocionales
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  );

-- Semilla: los 3 banners que ya se veían (quedan igual para todos hasta
-- que Diseño los reemplace). No se duplican si ya existen.
insert into public.banners_promocionales (src, alt, orden)
select v.src, v.alt, v.orden
from (values
  ('/images/nodus-flex-center-banner.jpg', 'Nodus Flex Center · Aguascalientes, León, San Luis Potosí y Querétaro', 0),
  ('/images/nodus-flex-center-capacitacion.jpg', 'Capacitación en vivo en las salas de Nodus Flex Center', 1),
  ('/images/nodus-san-telmo.jpg', 'Nodus Flex Center · Sucursal San Telmo', 2)
) as v(src, alt, orden)
where not exists (select 1 from public.banners_promocionales);

-- ---------------------------------------------------------------------
-- Storage: bucket "banners-promocionales" para lo que suba Diseño.
-- Público (el carrusel se ve en todos los dashboards por URL pública,
-- igual que "logros").
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('banners-promocionales', 'banners-promocionales', true)
on conflict (id) do nothing;

drop policy if exists "banners_promo_storage_insert" on storage.objects;
create policy "banners_promo_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'banners-promocionales'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  );

drop policy if exists "banners_promo_storage_update" on storage.objects;
create policy "banners_promo_storage_update" on storage.objects
  for update using (
    bucket_id = 'banners-promocionales'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  );

drop policy if exists "banners_promo_storage_delete" on storage.objects;
create policy "banners_promo_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'banners-promocionales'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  );
-- El bucket es público, así que cualquiera puede LEER las imágenes por
-- su URL pública sin necesitar una política de select aparte.
