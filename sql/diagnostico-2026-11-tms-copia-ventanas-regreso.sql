-- SOLO LECTURA (SELECT). Diagnóstico de «Copiar programación»: ¿los viajes de la fecha ORIGEN tienen hora de carga y regreso estimado?
-- Solo devuelve CONTEOS (sin nombres, placas, montos ni datos personales). No modifica nada.
-- Uso (phpMyAdmin, base de producción ya seleccionada): reemplazar 7 por el empresa_id y '2026-11-18' por la fecha ORIGEN en cada consulta.
-- Cómo leerlo: una fila sin hora o sin regreso RESERVA TODO EL DÍA para sus recursos y choca con cualquier otro viaje del mismo recurso ese día.
-- Si «sin_regreso_estimado» o «sin_hora_carga» es > 0 Y hay recursos repetidos (consulta 2), esa condición PUEDE explicar bloqueos en cadena al copiar;
-- si ambos son 0, el bloqueo NO se debe a ventanas ausentes y hay que mirar los otros motivos (identidad de unidad, tarifa, disponibilidad).

-- 1) Resumen de ventanas del origen (viajes no cancelados).
SELECT COUNT(*) AS viajes,
       SUM(p.hora_carga IS NULL) AS sin_hora_carga,
       SUM(p.regreso_estimado IS NULL) AS sin_regreso_estimado,
       SUM(p.hora_carga IS NOT NULL AND p.regreso_estimado IS NOT NULL) AS con_ventana_completa
FROM tms_planes_viaje p
WHERE p.empresa_id = 7 AND p.fecha_plan = '2026-11-18' AND p.estado <> 'Cancelado';

-- 2) Recursos que se repiten en varios viajes ese día y cuántos de esos viajes tienen la ventana incompleta (solo cantidades; el id es interno).
SELECT 'piloto' AS recurso, COUNT(*) AS recursos_repetidos, SUM(g.incompletos > 0) AS con_algun_viaje_sin_ventana, MAX(g.viajes) AS max_viajes_por_recurso
FROM (SELECT p.piloto_id AS rid, COUNT(*) AS viajes, SUM(p.hora_carga IS NULL OR p.regreso_estimado IS NULL) AS incompletos
      FROM tms_planes_viaje p
      WHERE p.empresa_id = 7 AND p.fecha_plan = '2026-11-18' AND p.estado <> 'Cancelado' AND p.piloto_id IS NOT NULL
      GROUP BY p.piloto_id HAVING COUNT(*) > 1) g
UNION ALL
SELECT 'unidad', COUNT(*), SUM(g.incompletos > 0), MAX(g.viajes)
FROM (SELECT p.unidad_id AS rid, COUNT(*) AS viajes, SUM(p.hora_carga IS NULL OR p.regreso_estimado IS NULL) AS incompletos
      FROM tms_planes_viaje p
      WHERE p.empresa_id = 7 AND p.fecha_plan = '2026-11-18' AND p.estado <> 'Cancelado' AND p.unidad_id IS NOT NULL
      GROUP BY p.unidad_id HAVING COUNT(*) > 1) g
UNION ALL
SELECT 'tc', COUNT(*), SUM(g.incompletos > 0), MAX(g.viajes)
FROM (SELECT p.tc_vehiculo_id AS rid, COUNT(*) AS viajes, SUM(p.hora_carga IS NULL OR p.regreso_estimado IS NULL) AS incompletos
      FROM tms_planes_viaje p
      WHERE p.empresa_id = 7 AND p.fecha_plan = '2026-11-18' AND p.estado <> 'Cancelado' AND p.tc_vehiculo_id IS NOT NULL
      GROUP BY p.tc_vehiculo_id HAVING COUNT(*) > 1) g;

-- 3) Tarifas del origen: cuántos viajes tienen tarifa, y cuántos con un monto distinto al vigente de catálogo (solo cantidades).
SELECT COUNT(*) AS viajes,
       SUM(p.tarifa_id IS NOT NULL) AS con_tarifa_de_catalogo,
       SUM(p.tarifa_id IS NULL) AS sin_tarifa,
       SUM(p.tarifa_id IS NOT NULL AND (rt.id IS NULL OR rt.activa = 0)) AS tarifa_de_catalogo_no_vigente,
       SUM(rt.id IS NOT NULL AND rt.activa = 1 AND COALESCE(p.tarifa_monto_historico, p.tarifa_comercial) <> rt.monto) AS monto_historico_distinto_al_vigente
FROM tms_planes_viaje p
LEFT JOIN tms_ruta_tarifas rt ON rt.id = p.tarifa_id AND rt.empresa_id = p.empresa_id
WHERE p.empresa_id = 7 AND p.fecha_plan = '2026-11-18' AND p.estado <> 'Cancelado';
