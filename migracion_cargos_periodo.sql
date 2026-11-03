-- =====================================================================
-- Migración: qué renta (y qué recargo) ya se cobró por contrato y por mes
--
-- Hasta ahora el cobro diario adivinaba si la renta ya existía: por el texto
-- del concepto ("Renta mensual - noviembre de 2026") o por "cualquier factura
-- del cliente en el mes". Con Integrar por cliente eso ya no sirve: el concepto
-- es libre, un cliente puede tener varias facturas en el mes y una sola factura
-- puede llevar la renta de dos contratos.
--
-- cargos_periodo guarda el dato directo: una fila por contrato + mes + tipo.
--   periodo   primer día del mes que cubre (no la fecha de la factura, que se
--             puede editar)
--   tipo      renta | recargo
--   factura_id  la factura que lo lleva. Null solo por unos segundos, mientras
--             el cobro diario la crea.
--   pago_id   la línea (pago) que es la renta dentro de esa factura
--   origen    cron (la generó el cobro diario) | integrada (finanzas, a mano)
-- La llave única es lo que impide duplicar, aunque corran a la vez el cobro
-- diario, el botón "Ejecutar ahora" y alguien integrando.
--
-- Solo la usan rutas de servidor con la llave de servicio: RLS activo sin
-- políticas, nadie más la lee ni la escribe.
--
-- Se corre a mano en el SQL Editor de Supabase, ANTES de subir el código: sin
-- esta tabla el cobro diario no genera nada y lo reporta como error (nunca
-- factura a ciegas). Es seguro volver a correrlo.
-- Rollback: drop table public.cargos_periodo;
-- =====================================================================

create table if not exists public.cargos_periodo (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  user_id uuid not null,
  periodo date not null check (extract(day from periodo) = 1),
  tipo text not null check (tipo in ('renta', 'recargo')),
  factura_id uuid references public.facturas(id) on delete cascade,
  pago_id uuid references public.pagos(id) on delete set null,
  origen text not null check (origen in ('cron', 'integrada')),
  created_at timestamptz not null default now(),
  unique (contrato_id, periodo, tipo)
);

create index if not exists cargos_periodo_cliente_idx on public.cargos_periodo (user_id, periodo, tipo);
create index if not exists cargos_periodo_factura_idx on public.cargos_periodo (factura_id);

alter table public.cargos_periodo enable row level security;

-- ---------------------------------------------------------------------
-- Lo que ya existe. Las rentas y recargos del cobro diario se reconocen por su
-- folio (FAC-AAAAMM-… / REC-AAAAMM-…, que editar no cambia) o por su concepto
-- original. Las integradas, por su línea "Renta mensual <mes> de <año>". El
-- contrato no estaba guardado: se usa el mismo que elegiría el cobro diario (el
-- vigente más reciente), y entre varios, el que tenga esa misma renta.
-- ---------------------------------------------------------------------

-- 1) Renta y recargo generados por el cobro diario.
insert into public.cargos_periodo (contrato_id, user_id, periodo, tipo, factura_id, origen)
select c.id, f.user_id, v.periodo, v.tipo, f.id, 'cron'
from public.facturas f
cross join lateral (
  select
    case when f.folio ~ '^FAC-20[0-9]{2}(0[1-9]|1[0-2])-' or f.concepto like 'Renta mensual - %' then 'renta' else 'recargo' end as tipo,
    case
      when f.folio ~ '^(FAC|REC)-20[0-9]{2}(0[1-9]|1[0-2])-' then to_date(substring(f.folio from 5 for 6), 'YYYYMM')
      else date_trunc('month', f.fecha_emision)::date
    end as periodo
) v
cross join lateral (
  select id from public.contratos
  where user_id = f.user_id
  order by (estatus = 'vigente') desc, fecha_inicio desc nulls last, created_at desc
  limit 1
) c
where f.user_id is not null
  and v.periodo is not null
  and (f.folio ~ '^(FAC|REC)-20[0-9]{2}(0[1-9]|1[0-2])-' or f.concepto like 'Renta mensual - %' or f.concepto like 'Recargo 3% por pago tardío - %')
order by (f.estado = 'cancelada'), f.fecha_emision, f.id
on conflict (contrato_id, periodo, tipo) do nothing;

-- 2) Rentas integradas a mano (la línea trae el mes aunque el concepto de la factura sea libre).
insert into public.cargos_periodo (contrato_id, user_id, periodo, tipo, factura_id, pago_id, origen)
select c.id, f.user_id, v.periodo, 'renta', f.id, p.id, 'integrada'
from public.pagos p
join public.facturas f on f.id = p.factura_id
cross join lateral (
  select make_date(
    substring(p.concepto from '([0-9]{4})$')::int,
    array_position(
      array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],
      lower(substring(p.concepto from '^Renta mensual ([[:alpha:]]+) de'))
    ),
    1
  ) as periodo
) v
cross join lateral (
  select id from public.contratos
  where user_id = f.user_id
  order by (renta_mensual = p.monto) desc nulls last, (estatus = 'vigente') desc, fecha_inicio desc nulls last, created_at desc
  limit 1
) c
where f.user_id is not null
  and p.concepto ~ '^Renta mensual (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de [0-9]{4}$'
order by (f.estado = 'cancelada'), f.fecha_emision, f.id
on conflict (contrato_id, periodo, tipo) do nothing;

-- ---------------------------------------------------------------------
-- Revisión (solo lectura). Conviene correr las dos al terminar.
-- ---------------------------------------------------------------------

-- A) Facturas de este mes sin marca, de clientes con contrato vigente: si alguna ES la renta
--    (por ejemplo, capturada a mano con otro texto), hay que registrarla o el cobro diario
--    generaría otra. Para registrarla, con los datos de la fila:
--      insert into public.cargos_periodo (contrato_id, user_id, periodo, tipo, factura_id, origen)
--      values ('<contrato_id>', '<user_id>', date_trunc('month', current_date)::date, 'renta', '<factura_id>', 'integrada');
select f.id as factura_id, f.folio, f.concepto, f.monto, f.estado, f.fecha_emision, f.user_id, c.id as contrato_id, c.renta_mensual
from public.facturas f
join public.contratos c on c.user_id = f.user_id and c.estatus = 'vigente'
where f.fecha_emision >= date_trunc('month', current_date)
  and f.estado <> 'cancelada'
  and not exists (select 1 from public.cargos_periodo m where m.factura_id = f.id)
order by f.user_id, f.fecha_emision;

-- B) Posibles rentas ya duplicadas: una factura con renta que perdió contra otra por la llave única
--    (mismo contrato y mes). Las que salgan aquí hay que revisarlas y, si sobran, cancelarlas.
select f.id as factura_id, f.folio, f.concepto, f.monto, f.estado, f.fecha_emision, m.contrato_id, m.periodo,
       g.folio as factura_marcada
from public.facturas f
join public.cargos_periodo m on m.user_id = f.user_id and m.tipo = 'renta'
join public.facturas g on g.id = m.factura_id
where f.id <> m.factura_id
  and f.estado <> 'cancelada'
  and not exists (select 1 from public.cargos_periodo o where o.factura_id = f.id)
  and (
    (f.folio ~ '^FAC-20[0-9]{2}(0[1-9]|1[0-2])-' and to_date(substring(f.folio from 5 for 6), 'YYYYMM') = m.periodo)
    or (f.concepto like 'Renta mensual - %' and date_trunc('month', f.fecha_emision)::date = m.periodo)
    or exists (
      select 1 from public.pagos p
      where p.factura_id = f.id
        and p.concepto ~ '^Renta mensual [[:alpha:]]+ de [0-9]{4}$'
        and date_trunc('month', f.fecha_emision)::date = m.periodo
    )
  )
order by m.periodo desc, f.user_id;
