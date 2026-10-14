-- Folio de contrato (como en ZORA): cada contrato lleva su propio folio, así un cliente con varios contratos
-- (por ejemplo uno en Bosques y otro en San Telmo) los distingue. Formato: C-{serie del centro}-{consecutivo}, p. ej.
-- C-A-0001 (Bosques), C-SNT-0001 (San Telmo). Las series son las mismas de las facturas (lib/centros.ts).
-- Los contratos nuevos reciben su folio solos (disparador) y los que ya existen se numeran por orden de creación.
-- Es seguro correrlo más de una vez.

alter table public.contratos add column if not exists folio text;

-- Contador por serie. Solo lo usa la función de abajo (sin políticas: nadie más lo lee ni lo escribe).
create table if not exists public.contratos_folio_contador (
  serie text primary key,
  ultimo integer not null default 0
);
alter table public.contratos_folio_contador enable row level security;

create or replace function public.serie_de_centro(p_centro text)
returns text
language sql
immutable
as $$
  select case p_centro
    when 'Bosques' then 'A'
    when 'Punto 45' then 'P45'
    when 'San Telmo' then 'SNT'
    when 'Puerta Bajío Piso 2' then 'PB2'
    when 'Puerta Bajío Piso 8' then 'PB8'
    when 'Stadium' then 'STA'
    when 'ILEVA' then 'ILE'
    else 'GEN'
  end
$$;

create or replace function public.siguiente_folio_contrato(p_centro text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_serie text := public.serie_de_centro(p_centro);
  v_n integer;
begin
  insert into public.contratos_folio_contador (serie, ultimo)
  values (v_serie, 1)
  on conflict (serie) do update set ultimo = public.contratos_folio_contador.ultimo + 1
  returning ultimo into v_n;
  return 'C-' || v_serie || '-' || lpad(v_n::text, 4, '0');
end
$$;

create or replace function public.asignar_folio_contrato()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.folio is null then
    new.folio := public.siguiente_folio_contrato(
      coalesce(new.centro, (select p.centro from public.profiles p where p.id = new.user_id))
    );
  end if;
  return new;
end
$$;

drop trigger if exists trg_asignar_folio_contrato on public.contratos;
create trigger trg_asignar_folio_contrato
  before insert on public.contratos
  for each row execute function public.asignar_folio_contrato();

-- Contratos que ya existen: se numeran en orden de creación.
do $$
declare
  r record;
begin
  for r in select id, centro, user_id from public.contratos where folio is null order by created_at, id loop
    update public.contratos
       set folio = public.siguiente_folio_contrato(coalesce(r.centro, (select p.centro from public.profiles p where p.id = r.user_id)))
     where id = r.id;
  end loop;
end
$$;

create unique index if not exists contratos_folio_unico on public.contratos (folio) where folio is not null;
