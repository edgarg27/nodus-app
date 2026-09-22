-- Bug encontrado el 22/sep: ningún endpoint que marca un pago como "pagado"
-- (simular, marcar-pagado, verificar-spei, webhook de Openpay) guardaba
-- pagos.fecha_pago — se quedaba en null para siempre. "Ingresos por Centro"
-- filtra por fecha_pago, así que nunca mostraba nada ya cobrado. Ya se
-- corrigió el código (ver lib/fechaMexico.ts); esto rellena lo histórico.
-- Usa la fecha de created_at como mejor aproximación, en horario de México.
-- Idempotente: solo toca los que de verdad quedaron sin fecha.

update pagos
set fecha_pago = (created_at at time zone 'America/Mexico_City')::date
where estado = 'pagado' and fecha_pago is null;
