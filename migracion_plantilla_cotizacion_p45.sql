-- Plantilla de cotización de Oficina Privada / Working Desk de Punto 45
-- (public/plantillas-cotizacion/P45OficinaPrivada.pptx). Solo la registra en
-- "plantillas_documentos" para que aparezca en /diseno/plantillas y Diseño pueda
-- subir una versión nueva; la cotización funciona aunque no se corra.
-- Es seguro volver a correrlo.
insert into public.plantillas_documentos (nombre_archivo, tipo)
values ('P45OficinaPrivada.pptx', 'cotizacion')
on conflict (nombre_archivo) do nothing;
