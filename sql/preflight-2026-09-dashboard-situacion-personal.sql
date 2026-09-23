-- RRHH-DASHBOARD-SITUACION-1 — PREFLIGHT (SOLO LECTURA; NO ejecutado por este PR).
-- Objetivo: identificar por qué la consulta ANTERIOR de "Situación del personal" fallaba en producción
-- y comprobar que las 3 lecturas NUEVAS funcionan. Solo SELECT / SET de variables de sesión / DESCRIBE.
-- Ejecutar bloque por bloque (phpMyAdmin) y anotar cuál da error (código y mensaje).

-- 0) Parámetros: ajustar SOLO el slug de la empresa a revisar. "Hoy" en hora de Guatemala (UTC-6).
SET @slug = 'kt-monaco';
SET @empresa_id = (SELECT id FROM empresas WHERE slug = @slug LIMIT 1);
SET @hoy = DATE(UTC_TIMESTAMP() - INTERVAL 6 HOUR);
SELECT @slug AS slug, @empresa_id AS empresa_id, @hoy AS hoy_guatemala;

-- 1) Entorno.
SELECT VERSION() AS version_servidor;
SELECT @@sql_mode AS sql_mode;
SELECT @@group_concat_max_len AS group_concat_max_len;

-- 2) Estructura real (comparar con sql/schema.sql: columnas usadas = id, codigo, nombre, estado, empresa_id,
--    id_empleado, fecha_jornada, tipo, fecha_inicio, fecha_fin).
DESCRIBE empleados;
DESCRIBE sesiones_trabajo;
DESCRIBE incidencias;

-- 3A) CONSULTA ANTERIOR COMPLETA (la que hoy falla). Si da error, anotar código/mensaje.
SELECT e.id, e.codigo, e.nombre,
       MAX(CASE WHEN i.tipo LIKE '%Vacaciones%' THEN 1 ELSE 0 END) AS en_vacaciones,
       GROUP_CONCAT(DISTINCT CASE
         WHEN i.tipo NOT LIKE '%Vacaciones%' THEN i.tipo
         ELSE NULL
       END ORDER BY i.tipo SEPARATOR ', ') AS otras_incidencias,
       COUNT(DISTINCT s.id) AS total_sesiones
FROM empleados e
LEFT JOIN sesiones_trabajo s
  ON s.empresa_id = e.empresa_id AND s.id_empleado = e.id AND s.fecha_jornada = @hoy
LEFT JOIN incidencias i
  ON i.empresa_id = e.empresa_id AND i.id_empleado = e.id AND @hoy BETWEEN i.fecha_inicio AND i.fecha_fin
WHERE e.empresa_id = @empresa_id AND e.estado = 'Activo'
GROUP BY e.id, e.codigo, e.nombre
HAVING total_sesiones = 0 OR en_vacaciones = 1 OR otras_incidencias IS NOT NULL
ORDER BY en_vacaciones DESC, otras_incidencias IS NOT NULL DESC, e.nombre;

-- 3B) Aislar sospechosos de la consulta anterior (ejecutar cada uno por separado).
-- 3B-1) GROUP_CONCAT(DISTINCT CASE ... ORDER BY otra_columna) sin el resto.
SELECT e.id,
       GROUP_CONCAT(DISTINCT CASE WHEN i.tipo NOT LIKE '%Vacaciones%' THEN i.tipo ELSE NULL END ORDER BY i.tipo SEPARATOR ', ') AS otras
FROM empleados e
LEFT JOIN incidencias i ON i.empresa_id = e.empresa_id AND i.id_empleado = e.id AND @hoy BETWEEN i.fecha_inicio AND i.fecha_fin
WHERE e.empresa_id = @empresa_id AND e.estado = 'Activo'
GROUP BY e.id LIMIT 5;
-- 3B-2) HAVING / ORDER BY sobre alias (sin GROUP_CONCAT).
SELECT e.id, MAX(CASE WHEN i.tipo LIKE '%Vacaciones%' THEN 1 ELSE 0 END) AS en_vacaciones, COUNT(DISTINCT s.id) AS total_sesiones
FROM empleados e
LEFT JOIN sesiones_trabajo s ON s.empresa_id = e.empresa_id AND s.id_empleado = e.id AND s.fecha_jornada = @hoy
LEFT JOIN incidencias i ON i.empresa_id = e.empresa_id AND i.id_empleado = e.id AND @hoy BETWEEN i.fecha_inicio AND i.fecha_fin
WHERE e.empresa_id = @empresa_id AND e.estado = 'Activo'
GROUP BY e.id
HAVING total_sesiones = 0 OR en_vacaciones = 1
ORDER BY en_vacaciones DESC, e.id;

-- 4) CONSULTAS NUEVAS (las 3 lecturas planas que usa obtenerSituacionEmpleadosHoy). Deben ejecutar sin error.
SELECT id, codigo, nombre FROM empleados WHERE empresa_id = @empresa_id AND estado = 'Activo' ORDER BY nombre;
SELECT DISTINCT id_empleado FROM sesiones_trabajo WHERE empresa_id = @empresa_id AND fecha_jornada = @hoy;
SELECT id_empleado, tipo FROM incidencias WHERE empresa_id = @empresa_id AND @hoy BETWEEN fecha_inicio AND fecha_fin;

-- 5) Control cruzado (informativo): activos, con jornada hoy, con incidencia vigente hoy.
SELECT
  (SELECT COUNT(*) FROM empleados WHERE empresa_id = @empresa_id AND estado = 'Activo') AS activos,
  (SELECT COUNT(DISTINCT id_empleado) FROM sesiones_trabajo WHERE empresa_id = @empresa_id AND fecha_jornada = @hoy) AS con_jornada_hoy,
  (SELECT COUNT(DISTINCT id_empleado) FROM incidencias WHERE empresa_id = @empresa_id AND @hoy BETWEEN fecha_inicio AND fecha_fin) AS con_incidencia_hoy;
