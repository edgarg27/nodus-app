-- Depósito en garantía: a qué cuenta cayó (IT CREATIVE o Nova Holding).
-- Se elige al marcar el depósito como realizado en /deposito-garantia y se puede corregir después.
alter table public.pagos add column if not exists cuenta_destino text;

alter table public.pagos drop constraint if exists pagos_cuenta_destino_check;
alter table public.pagos
  add constraint pagos_cuenta_destino_check check (cuenta_destino is null or cuenta_destino in ('IT CREATIVE', 'Nova Holding'));
