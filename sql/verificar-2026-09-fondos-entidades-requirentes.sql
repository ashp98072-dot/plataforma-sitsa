-- VERIFICACIÓN SOLO LECTURA. Ejecutar manualmente antes de la migración.
-- Reemplazar el código del tenant si corresponde.

SET @codigo_empresa_objetivo := 'KT';

SELECT id, codigo, nombre, slug, activa
FROM empresas
WHERE codigo = @codigo_empresa_objetivo;

DESCRIBE cont_entidades;
SHOW INDEX FROM cont_entidades;
SHOW CREATE TABLE cont_entidades;

SELECT ce.id, ce.empresa_id, ce.codigo, ce.nombre, ce.activa
FROM cont_entidades ce
INNER JOIN empresas e ON e.id = ce.empresa_id
WHERE e.codigo = @codigo_empresa_objetivo
  AND ce.codigo IN ('KT', 'MONACO')
ORDER BY ce.codigo;

SELECT
  COUNT(*) AS entidades_encontradas,
  SUM(ce.codigo = 'KT' AND ce.activa = 1) AS kt_activa,
  SUM(ce.codigo = 'MONACO' AND ce.activa = 1) AS monaco_activa,
  IF(
    COUNT(*) = 2
    AND SUM(ce.codigo = 'KT' AND ce.activa = 1) = 1
    AND SUM(ce.codigo = 'MONACO' AND ce.activa = 1) = 1,
    'OK: KT y MONACO existen una vez y están activas',
    'DETENER: falta una entidad, está inactiva o existe duplicada'
  ) AS verificacion
FROM cont_entidades ce
INNER JOIN empresas e ON e.id = ce.empresa_id
WHERE e.codigo = @codigo_empresa_objetivo
  AND ce.codigo IN ('KT', 'MONACO');
