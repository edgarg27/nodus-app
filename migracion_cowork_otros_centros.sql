-- Horas Cowork en cualquier centro: un cliente de Bosques puede apartar sus horas en Punto 45 o San Telmo (se
-- descuentan de su mismo paquete). El personal del centro donde reservó necesita ver su nombre y el saldo de su
-- contrato aunque el cliente sea de otro centro. Solo LECTURA y solo de quien tiene una reservación en su centro.
--
-- ⚠️ La primera versión de este archivo consultaba "reservaciones" directo dentro de la política de "profiles" y
-- provocó recursión (ninguna cuenta pudo leer su perfil ni entrar, 4 nov 2026). Esta versión consulta con funciones
-- SECURITY DEFINER, como es_staff() y mi_centro(): leen sin pasar por RLS, así que no hay recursión.
--
-- Si algo falla, se quita así:
--   drop policy if exists "profiles_staff_reservo_en_mi_centro" on public.profiles;
--   drop policy if exists "contratos_staff_reservo_en_mi_centro" on public.contratos;
--
-- Es seguro volver a correrlo.

create or replace function public.cliente_reservo_en_mi_centro(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.reservaciones r where r.user_id = p_user and r.centro = public.mi_centro());
$$;
revoke all on function public.cliente_reservo_en_mi_centro(uuid) from public;
grant execute on function public.cliente_reservo_en_mi_centro(uuid) to authenticated;

create or replace function public.contrato_reservado_en_mi_centro(p_contrato uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.reservaciones r where r.contrato_id = p_contrato and r.centro = public.mi_centro());
$$;
revoke all on function public.contrato_reservado_en_mi_centro(uuid) from public;
grant execute on function public.contrato_reservado_en_mi_centro(uuid) to authenticated;

drop policy if exists "profiles_staff_reservo_en_mi_centro" on public.profiles;
create policy "profiles_staff_reservo_en_mi_centro" on public.profiles
  for select to authenticated
  using (public.es_staff() and public.cliente_reservo_en_mi_centro(profiles.id));

drop policy if exists "contratos_staff_reservo_en_mi_centro" on public.contratos;
create policy "contratos_staff_reservo_en_mi_centro" on public.contratos
  for select to authenticated
  using (public.es_staff() and public.contrato_reservado_en_mi_centro(contratos.id));

-- Comprobación: deben salir las dos políticas.
select tablename, policyname from pg_policies where policyname like '%reservo_en_mi_centro';
