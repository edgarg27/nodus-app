-- Tipo de servicio de cada contrato (lib/tipoServicio.ts): Oficina privada, Coworking, Working desk u Oficina virtual.
-- Sirve para el reporte de Facturación "Facturado por servicio" (cuánto se facturó en el mes de cada cosa).
--
-- - Si el contrato tiene oficina, sale solo del tipo de esa oficina (al crearlo o al cambiarle la oficina).
-- - Sin oficina (p. ej. oficina virtual) se elige a mano al editar el contrato o al anexarlo.
-- - Rellena los contratos que ya existen con oficina. Es seguro volver a correrlo.

alter table public.contratos add column if not exists tipo_servicio text;
alter table public.contratos drop constraint if exists contratos_tipo_servicio_check;
alter table public.contratos add constraint contratos_tipo_servicio_check
  check (tipo_servicio is null or tipo_servicio in ('oficina_privada', 'coworking', 'working_desk', 'oficina_virtual'));

create or replace function public.tipo_servicio_de_oficina(p_oficina uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case lower(trim(o.tipo))
    when 'oficina privada' then 'oficina_privada'
    when 'coworking' then 'coworking'
    when 'working desk' then 'working_desk'
    else null
  end
  from public.oficinas o
  where o.id = p_oficina
$$;

create or replace function public.contratos_tipo_servicio()
returns trigger
language plpgsql
as $$
begin
  -- Sin tipo elegido, o le cambiaron la oficina sin cambiar el tipo: sale de la oficina.
  if new.oficina_id is not null and (
    new.tipo_servicio is null
    or (tg_op = 'UPDATE' and new.oficina_id is distinct from old.oficina_id and new.tipo_servicio is not distinct from old.tipo_servicio)
  ) then
    new.tipo_servicio := coalesce(public.tipo_servicio_de_oficina(new.oficina_id), new.tipo_servicio);
  end if;
  return new;
end;
$$;

drop trigger if exists contratos_tipo_servicio on public.contratos;
create trigger contratos_tipo_servicio
  before insert or update of oficina_id, tipo_servicio on public.contratos
  for each row execute function public.contratos_tipo_servicio();

update public.contratos c
set tipo_servicio = public.tipo_servicio_de_oficina(c.oficina_id)
where c.tipo_servicio is null and c.oficina_id is not null;

-- Comprobación: contratos vigentes por tipo (los "sin tipo" hay que elegirlos al editar el contrato).
select coalesce(tipo_servicio, 'sin tipo') as tipo_servicio, count(*) as contratos
from public.contratos
where estatus = 'vigente'
group by 1
order by 1;
