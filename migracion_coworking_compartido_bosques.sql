-- =====================================================================
-- Coworking de Bosques como lo registran las administradoras: en lugar de
-- los 50 lugares por letra (A, B… MB) quedan C3, C4… C11, y en cada uno
-- caben TODAS las empresas que se quiera (lugar compartido, sin límite).
--
-- 1) oficinas.compartida: un lugar compartido nunca se marca "ocupado" ni
--    se bloquea al cotizar; la app cuenta cuántas empresas tiene por sus
--    contratos vigentes. Los demás centros no cambian (queda en false).
-- 2) Crea C3 a C11 en Bosques (Coworking, compartidos, disponibles).
-- 3) Pasa todo lo que apuntaba al lugar "C" (el contrato del cliente que
--    ya está en coworking y lo ligado a él) al C3, y el pin del coworking en el plano al C3.
-- 4) Borra los lugares de letra que ya no tienen nada ligado. Si alguno
--    sigue ligado a algo (otro contrato, cotización…), NO se borra y sale
--    en la comprobación del final para revisarlo.
--
-- Todo va junto: si algo falla, no se cambia nada. Es seguro volver a correrlo.
-- =====================================================================

begin;

alter table public.oficinas add column if not exists compartida boolean not null default false;

-- 2) C3 a C11
insert into public.oficinas (numero, tipo, estado, ciudad, centro, precio, notas, paquete_default_id, compartida)
select n.numero, 'Coworking', 'disponible', 'Aguascalientes', 'Bosques', 0, null, null, true
from (values ('C3'), ('C4'), ('C5'), ('C6'), ('C7'), ('C8'), ('C9'), ('C10'), ('C11')) as n(numero)
where not exists (
  select 1 from public.oficinas ya
  where ya.centro = 'Bosques' and ya.tipo = 'Coworking' and ya.numero = n.numero
);
update public.oficinas set compartida = true
where centro = 'Bosques' and tipo = 'Coworking' and numero in ('C3','C4','C5','C6','C7','C8','C9','C10','C11');

-- 3) y 4)
do $$
declare
  c3 uuid;
  viejo_c uuid;
  r record;
  letras uuid[];
  libre boolean;
  lugar uuid;
begin
  select id into c3 from public.oficinas
  where centro = 'Bosques' and tipo = 'Coworking' and numero = 'C3';
  select id into viejo_c from public.oficinas
  where centro = 'Bosques' and tipo = 'Coworking' and numero = 'C';

  -- Lo del lugar "C" pasa al C3 (contratos, cotizaciones, reservaciones…).
  if viejo_c is not null then
    for r in
      select c.conrelid::regclass as tabla, a.attname as columna
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.confrelid = 'public.oficinas'::regclass
    loop
      execute format('update %s set %I = $1 where %I = $2', r.tabla, r.columna, r.columna) using c3, viejo_c;
    end loop;
  end if;

  -- El pin del coworking (estaba en el lugar "A") pasa al C3.
  update public.oficinas d
  set mapa_x = s.mapa_x, mapa_y = s.mapa_y
  from public.oficinas s
  where d.id = c3 and d.mapa_x is null
    and s.centro = 'Bosques' and s.tipo = 'Coworking' and s.numero = 'A' and s.mapa_x is not null;

  -- Borra los lugares de letra que ya no tienen nada ligado.
  select array_agg(id) into letras from public.oficinas
  where centro = 'Bosques' and tipo = 'Coworking' and numero !~ '^C[0-9]+$';
  if letras is null then return; end if;
  foreach lugar in array letras loop
    libre := true;
    for r in
      select c.conrelid::regclass as tabla, a.attname as columna
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.confrelid = 'public.oficinas'::regclass
    loop
      execute format('select not exists (select 1 from %s where %I = $1)', r.tabla, r.columna) into libre using lugar;
      exit when not libre;
    end loop;
    if libre then
      delete from public.oficinas where id = lugar;
    end if;
  end loop;
end $$;

commit;

-- Comprobación: deben salir C3 a C11 (compartida = true) y, si queda alguna
-- letra, es porque algo sigue ligado a ella. El cliente que estaba en "C" debe salir en C3.
select o.numero, o.compartida, o.estado,
       (select string_agg(coalesce(p.nombre, c.cliente_nombre_historico, 'sin nombre') || ' (' || c.estatus || ')', ', ')
          from public.contratos c left join public.profiles p on p.id = c.user_id
         where c.oficina_id = o.id) as contratos
from public.oficinas o
where o.centro = 'Bosques' and o.tipo = 'Coworking'
order by o.numero;
