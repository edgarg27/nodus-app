-- =====================================================================
-- Asesora de Ventas (rol "ventas"): Prospectos, Cotizar y Cotizaciones (PR 236).
--
-- Ventas ya podía VER prospectos y las cotizaciones de su centro, pero no
-- guardar: registrar o cambiar de estatus un prospecto, agendar seguimientos,
-- ni crear una cotización. Estas políticas se lo permiten SOLO en su centro.
--
-- Igual que con la Ejecutiva de ventas: las políticas se AGREGAN (no se toca
-- ninguna de los demás roles) y usan public.mi_rol() / public.mi_centro(),
-- que son SECURITY DEFINER (no hay recursión). No toca la tabla profiles.
--
-- Es seguro volver a correrlo. Para revertir, ver el bloque al final.
-- =====================================================================

begin;

-- ------------------------------------------------------------ prospectos
-- (Ver ya puede: prospectos_select_rol incluye 'ventas'.)
drop policy if exists "prospectos_ventas_insert" on public.prospectos;
create policy "prospectos_ventas_insert" on public.prospectos
  for insert to authenticated
  with check (public.mi_rol()::text = 'ventas' and centro = public.mi_centro());

drop policy if exists "prospectos_ventas_update" on public.prospectos;
create policy "prospectos_ventas_update" on public.prospectos
  for update to authenticated
  using (public.mi_rol()::text = 'ventas' and centro = public.mi_centro())
  with check (public.mi_rol()::text = 'ventas' and centro = public.mi_centro());

drop policy if exists "prospectos_ventas_delete" on public.prospectos;
create policy "prospectos_ventas_delete" on public.prospectos
  for delete to authenticated
  using (public.mi_rol()::text = 'ventas' and centro = public.mi_centro());

-- ------------------------------------------------ prospecto_actividades
-- Seguimientos (correo, llamada, tour…) de prospectos de su centro.
drop policy if exists "prospecto_actividades_ventas" on public.prospecto_actividades;
create policy "prospecto_actividades_ventas" on public.prospecto_actividades
  for all to authenticated
  using (
    public.mi_rol()::text = 'ventas'
    and exists (select 1 from public.prospectos pr
                where pr.id = prospecto_actividades.prospecto_id and pr.centro = public.mi_centro())
  )
  with check (
    public.mi_rol()::text = 'ventas'
    and exists (select 1 from public.prospectos pr
                where pr.id = prospecto_actividades.prospecto_id and pr.centro = public.mi_centro())
  );

-- ------------------------------------------------------------------ tours
-- El seguimiento de tipo "Tour" crea, cambia o borra el tour ligado.
drop policy if exists "tours_ventas" on public.tours;
create policy "tours_ventas" on public.tours
  for all to authenticated
  using (public.mi_rol()::text = 'ventas' and centro = public.mi_centro())
  with check (public.mi_rol()::text = 'ventas' and centro = public.mi_centro());

-- ------------------------------------------------ cotizaciones_comerciales
-- (Ver ya puede las de su centro: cotizaciones_comerciales_select_rol.)
drop policy if exists "cotizaciones_comerciales_ventas_insert" on public.cotizaciones_comerciales;
create policy "cotizaciones_comerciales_ventas_insert" on public.cotizaciones_comerciales
  for insert to authenticated
  with check (public.mi_rol()::text = 'ventas' and centro = public.mi_centro());

drop policy if exists "cotizaciones_comerciales_ventas_update" on public.cotizaciones_comerciales;
create policy "cotizaciones_comerciales_ventas_update" on public.cotizaciones_comerciales
  for update to authenticated
  using (public.mi_rol()::text = 'ventas' and centro = public.mi_centro())
  with check (public.mi_rol()::text = 'ventas' and centro = public.mi_centro());

-- ---------------------------------------------------------- cotizaciones
-- La pantalla Cotizaciones también lee y actualiza esta tabla.
drop policy if exists "cotizaciones_ventas" on public.cotizaciones;
create policy "cotizaciones_ventas" on public.cotizaciones
  for all to authenticated
  using (public.mi_rol()::text = 'ventas' and centro = public.mi_centro())
  with check (public.mi_rol()::text = 'ventas' and centro = public.mi_centro());

-- -------------------------------------------- contrato_adicionales
-- Al cotizar con adicionales se guardan junto al contrato (Ventas ya edita
-- los contratos de su centro).
drop policy if exists "contrato_adicionales_ventas" on public.contrato_adicionales;
create policy "contrato_adicionales_ventas" on public.contrato_adicionales
  for all to authenticated
  using (
    public.mi_rol()::text = 'ventas'
    and exists (select 1 from public.contratos c
                where c.id = contrato_adicionales.contrato_id and c.centro = public.mi_centro())
  )
  with check (
    public.mi_rol()::text = 'ventas'
    and exists (select 1 from public.contratos c
                where c.id = contrato_adicionales.contrato_id and c.centro = public.mi_centro())
  );

-- ------------------------------------------- catálogos que lee Cotizar
drop policy if exists "paquetes_ventas_select" on public.paquetes;
create policy "paquetes_ventas_select" on public.paquetes
  for select to authenticated
  using (public.mi_rol()::text = 'ventas' and centro = public.mi_centro());

drop policy if exists "adicionales_catalogo_ventas_select" on public.adicionales_catalogo;
create policy "adicionales_catalogo_ventas_select" on public.adicionales_catalogo
  for select to authenticated
  using (public.mi_rol()::text = 'ventas' and centro = public.mi_centro());

drop policy if exists "precios_cotizacion_sala_ventas_select" on public.precios_cotizacion_sala_juntas;
create policy "precios_cotizacion_sala_ventas_select" on public.precios_cotizacion_sala_juntas
  for select to authenticated
  using (public.mi_rol()::text = 'ventas' and centro = public.mi_centro());

commit;

-- =====================================================================
-- Para REVERTIR (quitarle a Ventas lo que da esta migración):
--
-- drop policy if exists "prospectos_ventas_insert" on public.prospectos;
-- drop policy if exists "prospectos_ventas_update" on public.prospectos;
-- drop policy if exists "prospectos_ventas_delete" on public.prospectos;
-- drop policy if exists "prospecto_actividades_ventas" on public.prospecto_actividades;
-- drop policy if exists "tours_ventas" on public.tours;
-- drop policy if exists "cotizaciones_comerciales_ventas_insert" on public.cotizaciones_comerciales;
-- drop policy if exists "cotizaciones_comerciales_ventas_update" on public.cotizaciones_comerciales;
-- drop policy if exists "cotizaciones_ventas" on public.cotizaciones;
-- drop policy if exists "contrato_adicionales_ventas" on public.contrato_adicionales;
-- drop policy if exists "paquetes_ventas_select" on public.paquetes;
-- drop policy if exists "adicionales_catalogo_ventas_select" on public.adicionales_catalogo;
-- drop policy if exists "precios_cotizacion_sala_ventas_select" on public.precios_cotizacion_sala_juntas;
-- =====================================================================
