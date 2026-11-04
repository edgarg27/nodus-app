-- Regla de cobro: se paga del 1 al día de pago del contrato (hoy el 10); desde el día siguiente se cobra mora.
--
-- 1) Las rentas ya integradas que siguen sin pagar vencían a 10 días de integrarse (p. ej. 13 nov): pasan a vencer el
--    día de pago de su mes (10 nov). Solo las integradas a mano, sin pagar ni cancelar. No cambia el CFDI timbrado.
-- 2) Borrar integraciones: los recargos (mora) sin timbrar ni cobrar también se pueden borrar (antes los bloqueaba
--    por venir del cobro diario; las rentas del cobro diario siguen sin poderse borrar).
--
-- Es seguro volver a correrlo.

update public.facturas f
set fecha_vencimiento = greatest(
  f.fecha_emision,
  make_date(
    extract(year from cp.periodo)::int,
    extract(month from cp.periodo)::int,
    least(c.dia_pago, extract(day from (date_trunc('month', cp.periodo) + interval '1 month - 1 day'))::int)
  )
)
from public.cargos_periodo cp
join public.contratos c on c.id = cp.contrato_id
where cp.factura_id = f.id
  and cp.tipo = 'renta'
  and cp.origen = 'integrada'
  and c.dia_pago is not null
  and f.estado not in ('pagada', 'cancelada');

create or replace function public.borrar_estado_de_cuenta(p_factura uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
begin
  select id, folio, estado, uuid_cfdi, facturapi_id, created_at into f
  from public.facturas where id = p_factura for update;
  if not found then return 'no_existe'; end if;
  if f.uuid_cfdi is not null or f.facturapi_id is not null then return 'timbrada'; end if;
  if f.estado in ('pagada', 'cancelada') then return 'pagada'; end if;
  if f.folio ~ '^FAC-[0-9]{6}-' or exists (select 1 from public.cargos_periodo where factura_id = p_factura and origen = 'cron' and tipo = 'renta') then
    return 'cobro_diario';
  end if;
  if exists (select 1 from public.pagos where factura_id = p_factura and (estado = 'pagado' or openpay_charge_id is not null)) then
    return 'con_pago';
  end if;

  delete from public.cargos_periodo where factura_id = p_factura;
  update public.pagos set factura_id = null where factura_id = p_factura and created_at < f.created_at;
  delete from public.pagos where factura_id = p_factura;
  delete from public.facturas where id = p_factura;
  return 'ok';
end;
$$;

revoke all on function public.borrar_estado_de_cuenta(uuid) from public, anon, authenticated;
grant execute on function public.borrar_estado_de_cuenta(uuid) to service_role;

-- Comprobación: rentas integradas sin pagar y su nueva fecha límite.
select f.folio, f.fecha_emision, f.fecha_vencimiento, f.estado
from public.facturas f
join public.cargos_periodo cp on cp.factura_id = f.id and cp.tipo = 'renta' and cp.origen = 'integrada'
where f.estado not in ('pagada', 'cancelada')
order by f.fecha_vencimiento, f.folio;
