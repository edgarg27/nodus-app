-- Permite que un cliente vea los adicionales de SU propio contrato
-- (pantalla "Mi Contrato", app/contrato/page.tsx). Solo lectura, y solo de
-- contratos cuyo user_id es el suyo. Es seguro correrlo más de una vez.

alter table public.contrato_adicionales enable row level security;

drop policy if exists "contrato_adicionales_cliente_select" on public.contrato_adicionales;
create policy "contrato_adicionales_cliente_select"
  on public.contrato_adicionales
  for select
  to authenticated
  using (
    exists (
      select 1 from public.contratos c
      where c.id = contrato_adicionales.contrato_id
        and c.user_id = auth.uid()
    )
  );
