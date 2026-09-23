-- =====================================================================
-- Migración: Plantillas de contrato y cotización editables por Diseño
--
-- Los machotes de contrato (.docx, lib/contratoDocx.ts) y las
-- presentaciones de cotización (.pptx, lib/cotizacionEspacioPptx.ts y
-- lib/cotizacionSalaPptx.ts) vivían quemados en el código, en
-- public/plantillas-contrato y public/plantillas-cotizacion. Esta tabla
-- + bucket dejan que Diseño (o superadmin/gerente) suba una versión
-- nueva desde /diseno/plantillas sin tocar código ni volver a
-- desplegar: en cuanto sube un archivo, lib/plantillasStorage.ts lo usa
-- en la siguiente cotización/contrato que se genere. Si nadie ha subido
-- nada para un archivo (storage_path null), se sigue usando el default
-- del repo — nada cambia hasta que Diseño reemplace algo.
--
-- Es seguro volver a correr este archivo. Se corre a mano en el SQL
-- Editor de Supabase.
-- =====================================================================

create table if not exists public.plantillas_documentos (
  id uuid primary key default gen_random_uuid(),
  nombre_archivo text not null unique,
  tipo text not null check (tipo in ('contrato', 'cotizacion')),
  -- Ruta dentro del bucket "plantillas-documentos" — null = todavía usa
  -- el archivo original del repo (public/plantillas-contrato o
  -- public/plantillas-cotizacion), nadie lo ha reemplazado.
  storage_path text,
  actualizado_por uuid references auth.users(id),
  actualizado_por_nombre text,
  updated_at timestamptz not null default now()
);

alter table public.plantillas_documentos enable row level security;

-- Solo Diseño (y superadmin/gerente) ve y administra esto — nadie más lo
-- necesita, ni siquiera el cliente.
drop policy if exists "plantillas_docs_staff_all" on public.plantillas_documentos;
create policy "plantillas_docs_staff_all" on public.plantillas_documentos
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

-- Semilla: el catálogo de plantillas que ya existen en el repo hoy
-- (centro Bosques, el único con plantillas reales por ahora). No se
-- duplican si ya existen.
insert into public.plantillas_documentos (nombre_archivo, tipo)
values
  ('BosquesCoworking30hrsFisica.docx', 'contrato'),
  ('BosquesCoworking30hrsMoral.docx', 'contrato'),
  ('BosquesCoworkingFisicaConDeposito.docx', 'contrato'),
  ('BosquesCoworkingFisicaSinDeposito.docx', 'contrato'),
  ('BosquesCoworkingMoralConDeposito.docx', 'contrato'),
  ('BosquesCoworkingMoralSinDeposito.docx', 'contrato'),
  ('BosquesOficinaPrivadaFisica.docx', 'contrato'),
  ('BosquesOficinaPrivadaMoral.docx', 'contrato'),
  ('Bosques.pptx', 'cotizacion'),
  ('BosquesCoworking.pptx', 'cotizacion'),
  ('BosquesOficinaPrivada.pptx', 'cotizacion')
on conflict (nombre_archivo) do nothing;

-- ---------------------------------------------------------------------
-- Storage: bucket "plantillas-documentos" para lo que suba Diseño.
-- Privado — son machotes internos, no algo que deba verse por URL suelta.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('plantillas-documentos', 'plantillas-documentos', false)
on conflict (id) do nothing;

drop policy if exists "plantillas_docs_storage_select" on storage.objects;
create policy "plantillas_docs_storage_select" on storage.objects
  for select using (
    bucket_id = 'plantillas-documentos'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  );

drop policy if exists "plantillas_docs_storage_insert" on storage.objects;
create policy "plantillas_docs_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'plantillas-documentos'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  );

drop policy if exists "plantillas_docs_storage_update" on storage.objects;
create policy "plantillas_docs_storage_update" on storage.objects
  for update using (
    bucket_id = 'plantillas-documentos'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  );

drop policy if exists "plantillas_docs_storage_delete" on storage.objects;
create policy "plantillas_docs_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'plantillas-documentos'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  );
-- La app de servidor (lib/plantillasStorage.ts) descarga el archivo con
-- la Service Role Key, que bypassa RLS — la política de select de arriba
-- es para cuando Diseño quiere bajar/ver el archivo actual desde la
-- pantalla /diseno/plantillas.
