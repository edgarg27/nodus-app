-- Encontrado el 22/sep en Reportes: "Ocupación por centro" decía 9 oficinas
-- ocupadas en Bosques, pero solo hay 2 clientes reales. Las otras 7 son
-- contratos de pruebas/cotizaciones que nunca se concluyeron (user_id nunca
-- se llenó) y se quedaron como "vigente" (o "pre_aprobado") para siempre,
-- bloqueando esas oficinas. Nada en el código libera una oficina cuando su
-- contrato se rechaza o el cliente se da de baja — por eso también se
-- corrigió app/api/dar-baja-cliente/route.ts.
--
-- 1) Los contratos "vigente"/"pre_aprobado" sin cliente real pasan a
--    "rechazado" (el mismo estatus que ya se usa para un intento que no se
--    concluyó — no se inventa un estatus nuevo).
update contratos
set estatus = 'rechazado'
where user_id is null and estatus in ('vigente', 'pre_aprobado');

-- 2) Las oficinas que quedaron "ocupada" solo por esos contratos (sin
--    cliente_id y sin ningún contrato vigente real que las respalde ya)
--    vuelven a "disponible".
update oficinas
set estado = 'disponible'
where estado = 'ocupada'
  and cliente_id is null
  and id not in (select oficina_id from contratos where estatus = 'vigente' and oficina_id is not null);
