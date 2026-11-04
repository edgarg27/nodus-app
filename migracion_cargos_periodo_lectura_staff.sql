-- Ingresos por centro (Por cliente) lee qué renta del mes ya está en un estado de cuenta (cargos_periodo) para decir si
-- está pendiente o cubierta. La tabla solo la escribía el servidor; aquí el personal la puede LEER (no escribir).
-- Es seguro volver a correrlo.
drop policy if exists "cargos_periodo_staff_select" on public.cargos_periodo;
create policy "cargos_periodo_staff_select" on public.cargos_periodo
  for select to authenticated
  using (public.mi_rol()::text <> 'cliente');

-- Comprobación: debe salir la política.
select policyname, cmd from pg_policies where tablename = 'cargos_periodo';
