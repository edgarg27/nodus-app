-- =====================================================================
-- El rol "gerente" queda con EXACTAMENTE los mismos privilegios que
-- "superadmin" (solo cambia el nombre que se muestra). En el código esto lo
-- hace esSuperadmin() de lib/roles.ts; aquí se hace lo mismo en la base.
--
-- Paso 1 recorre TODAS las políticas RLS (public y storage) que mencionan
-- 'superadmin' y les agrega 'gerente' junto a él:
--   p.rol in ('admin', 'superadmin')  ->  ... 'superadmin', 'gerente')
--   mi_rol() = 'superadmin'           ->  mi_rol() = any (array['superadmin', 'gerente'])
-- No toca las que ya traen 'gerente' junto a 'superadmin'.
--
-- Al final muestra una tabla con lo que hizo cada política:
--   actualizada · sin cambio · REVISAR (no se pudo, o excluye a superadmin)
-- y las funciones que mencionan 'superadmin' (esas no se cambian solas;
-- si sale alguna, revisarla a mano).
--
-- Es seguro volver a correrlo.
-- =====================================================================

create temp table if not exists _resultado_gerente (
  tipo text, objeto text, estado text, detalle text
) on commit preserve rows;
truncate _resultado_gerente;

do $$
declare
  pol record;
  nuevo_using text;
  nuevo_check text;
  -- 'superadmin'::tipo dentro de un array, si no le sigue ya 'gerente'.
  re_array constant text := '''superadmin''::([A-Za-z_."]+)(?=\s*[,\]])(?!\s*,\s*''gerente'')';
  -- columna = 'superadmin'::tipo (comparación suelta, fuera de un array).
  re_igual constant text := '= ''superadmin''::([A-Za-z_."]+)(?!\s*[,\]])';
begin
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') like '%''superadmin''%' or coalesce(with_check, '') like '%''superadmin''%')
  loop
    -- Una política que EXCLUYE a superadmin (<> / not in) no se puede
    -- convertir sola: se reporta para revisarla a mano.
    if coalesce(pol.qual, '') ~ '<>\s*''superadmin''|<>\s*ALL' or coalesce(pol.with_check, '') ~ '<>\s*''superadmin''|<>\s*ALL' then
      insert into _resultado_gerente values ('política', pol.schemaname || '.' || pol.tablename || ' · ' || pol.policyname,
        'REVISAR', 'excluye a superadmin; no se tocó');
      continue;
    end if;

    nuevo_using := pol.qual;
    nuevo_check := pol.with_check;
    if nuevo_using is not null then
      nuevo_using := regexp_replace(nuevo_using, re_array, '''superadmin''::\1, ''gerente''::\1', 'g');
      nuevo_using := regexp_replace(nuevo_using, re_igual, '= ANY (ARRAY[''superadmin''::\1, ''gerente''::\1])', 'g');
    end if;
    if nuevo_check is not null then
      nuevo_check := regexp_replace(nuevo_check, re_array, '''superadmin''::\1, ''gerente''::\1', 'g');
      nuevo_check := regexp_replace(nuevo_check, re_igual, '= ANY (ARRAY[''superadmin''::\1, ''gerente''::\1])', 'g');
    end if;

    if nuevo_using is not distinct from pol.qual and nuevo_check is not distinct from pol.with_check then
      insert into _resultado_gerente values ('política', pol.schemaname || '.' || pol.tablename || ' · ' || pol.policyname,
        'sin cambio', 'ya incluía a gerente');
      continue;
    end if;

    begin
      execute format('alter policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename)
        || case when nuevo_using is not null then ' using (' || nuevo_using || ')' else '' end
        || case when nuevo_check is not null then ' with check (' || nuevo_check || ')' else '' end;
      insert into _resultado_gerente values ('política', pol.schemaname || '.' || pol.tablename || ' · ' || pol.policyname,
        'actualizada', null);
    exception when others then
      insert into _resultado_gerente values ('política', pol.schemaname || '.' || pol.tablename || ' · ' || pol.policyname,
        'REVISAR', sqlerrm);
    end;
  end loop;

  insert into _resultado_gerente
  select 'función', n.nspname || '.' || p.proname, 'REVISAR',
         case when p.prosrc like '%''gerente''%' then 'menciona superadmin y gerente' else 'menciona superadmin, no gerente' end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc like '%''superadmin''%';
end $$;

select * from _resultado_gerente order by (estado = 'actualizada'), tipo, objeto;

-- =====================================================================
-- Paso 2 (correr SOLO cuando el código con esSuperadmin() ya esté
-- publicado en el servidor; antes de eso Maribel perdería Encuestas,
-- edición de Paquetes, etc. en la app vieja):
--
-- update public.profiles
--    set rol = 'gerente'
--  where id = (select id from auth.users where email = 'mflores@nodusbc.mx');
-- =====================================================================
