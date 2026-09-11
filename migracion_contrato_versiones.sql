-- =====================================================================
-- Versiones del contrato PDF: no se reemplaza el machote
--
-- Qué agrega:
--   1) Columna `archivo_machote_url` en `contratos` — guarda el .docx
--      generado automáticamente al aceptar la cotización (lo que hoy
--      vive en `archivo_url`), para que quede preservado y visible aparte
--      aunque el staff suba versiones corregidas después. Se rellena con
--      el `archivo_url` actual de los contratos que ya existen.
--   2) Tabla `contrato_versiones` — cada archivo que el staff sube desde
--      ContratoModal.tsx ("Subir contrato modificado") ya NO sobreescribe
--      `archivo_url` directo: se guarda como una versión más en esta
--      tabla, y el staff elige cuál marcar como "final" (eso sí actualiza
--      `contratos.archivo_url`, que sigue siendo el documento operativo
--      que usan /firmar-contrato y el botón "Aprobar").
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.contratos add column if not exists archivo_machote_url text;
update public.contratos set archivo_machote_url = archivo_url where archivo_machote_url is null and archivo_url is not null;

create table if not exists public.contrato_versiones (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id),
  archivo_url text not null,
  nombre_archivo text,
  subido_por uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists contrato_versiones_contrato_id_idx on public.contrato_versiones (contrato_id);

alter table public.contrato_versiones enable row level security;

drop policy if exists "contrato_versiones_staff_all" on public.contrato_versiones;
create policy "contrato_versiones_staff_all"
  on public.contrato_versiones
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
