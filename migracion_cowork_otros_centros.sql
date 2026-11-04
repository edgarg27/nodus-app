-- Horas Cowork en cualquier centro: un cliente de Bosques puede apartar sus horas en Punto 45 o San Telmo (se
-- descuentan de su mismo paquete). El personal del centro donde reservó necesita ver su nombre y el saldo de su
-- contrato aunque el cliente sea de otro centro. Solo LECTURA y solo de quien tiene una reservación en su centro.
-- Es seguro volver a correrlo.

drop policy if exists "profiles_staff_reservo_en_mi_centro" on public.profiles;
create policy "profiles_staff_reservo_en_mi_centro" on public.profiles
  for select to authenticated
  using (
    public.es_staff()
    and exists (select 1 from public.reservaciones r where r.user_id = profiles.id and r.centro = public.mi_centro())
  );

drop policy if exists "contratos_staff_reservo_en_mi_centro" on public.contratos;
create policy "contratos_staff_reservo_en_mi_centro" on public.contratos
  for select to authenticated
  using (
    public.es_staff()
    and exists (select 1 from public.reservaciones r where r.contrato_id = contratos.id and r.centro = public.mi_centro())
  );

-- Comprobación: deben salir las dos políticas.
select tablename, policyname from pg_policies where policyname like '%reservo_en_mi_centro';
