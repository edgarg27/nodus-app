-- =====================================================================
-- Cotizador con PowerPoint (Sala de Juntas, Coworking, Oficina Privada)
--
-- Qué agrega:
--   1) Tabla `precios_cotizacion_sala_juntas` — precios por tamaño de
--      sala que usa el admin/superadmin para cotizar sala de juntas a un
--      cliente nuevo desde "Cotizar" (3 tarifas fijas por tamaño: hora,
--      medio día, día). Es independiente de `precios_sala_juntas`, la
--      tarifa plana de horas extra de contratos existentes.
--   2) Columna `archivo_pdf_url` en `cotizaciones` — la nueva ruta de
--      generación por PowerPoint también sube un PDF (cuando el servidor
--      tiene LibreOffice instalado); esta columna guarda esa liga.
--   3) Columnas de Coffee Break en `cotizaciones_comerciales` — el
--      CotizarForm.tsx actualizado permite agregar Coffee Break opcional
--      al cotizar Sala de Juntas (mismos paquetes que ya usa el cliente
--      en /reservaciones, donde estas columnas viven en `reservaciones`;
--      aquí hacía falta la misma info pero en `cotizaciones_comerciales`).
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

-- 1) PRECIOS DE COTIZACIÓN DE SALA DE JUNTAS -----------------------------
create table if not exists public.precios_cotizacion_sala_juntas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  centro text not null,
  tamano text not null,
  precio_hora numeric not null default 0,
  precio_medio_dia numeric not null default 0,
  precio_dia numeric not null default 0
);

create index if not exists precios_cotizacion_sala_juntas_centro_idx
  on public.precios_cotizacion_sala_juntas (centro);

alter table public.precios_cotizacion_sala_juntas enable row level security;

-- Mismo criterio que el resto del proyecto: cualquier rol que no sea
-- "cliente" puede ver y administrar estos precios (se filtra por centro
-- dentro de la app).
drop policy if exists "precios_cotizacion_sala_juntas_staff_all" on public.precios_cotizacion_sala_juntas;
create policy "precios_cotizacion_sala_juntas_staff_all"
  on public.precios_cotizacion_sala_juntas
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

-- 2) COLUMNA NUEVA EN `cotizaciones` -------------------------------------
alter table public.cotizaciones add column if not exists archivo_pdf_url text;

-- 3) COLUMNAS DE COFFEE BREAK EN `cotizaciones_comerciales` --------------
alter table public.cotizaciones_comerciales add column if not exists coffee_break_paquete_id uuid;
alter table public.cotizaciones_comerciales add column if not exists coffee_break_personas integer;
alter table public.cotizaciones_comerciales add column if not exists coffee_break_total numeric;
