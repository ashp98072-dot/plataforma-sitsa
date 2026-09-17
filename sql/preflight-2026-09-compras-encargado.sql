-- SOLO LECTURA de metadatos; no ejecutado por este PR.
-- Ajustar exclusivamente este literal para otra instalación. Ejecutar completo,
-- incluso si la vista activa de phpMyAdmin es information_schema.
SET @compras_encargado_schema = 'u611730801_Plataforma';
SELECT VERSION() AS version_servidor, @compras_encargado_schema AS base_destino, DATABASE() AS contexto_activo;
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @compras_encargado_schema AND TABLE_NAME IN ('compras_requerimientos', 'usuarios');
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLLATION_NAME
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @compras_encargado_schema
AND ((TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'id') OR (TABLE_NAME = 'compras_requerimientos'
AND COLUMN_NAME IN ('id', 'empresa_id', 'encargado_compras_usuario_id', 'encargado_compras_nombre')));

-- NULL para históricos; sin backfill. No agregar FK nueva en esta expansión mínima:
-- usuarios es global y pertenencia/acceso al tenant se valida en aplicación.
-- APLICAR incluye instalación parcial compatible; NOOP = ambas columnas compatibles.
-- DETENER = dependencia o columna divergente; nunca corregir tipos con MODIFY/ALTER.
WITH esperadas AS (
  SELECT 'encargado_compras_usuario_id' columna, 'int' tipo, NULL longitud
  UNION ALL SELECT 'encargado_compras_nombre', 'varchar', 200
), resultados AS (
  SELECT e.columna, CASE
    WHEN c.COLUMN_NAME IS NULL THEN 'APLICAR'
    WHEN c.DATA_TYPE = e.tipo AND c.IS_NULLABLE = 'YES' AND COALESCE(c.EXTRA, '') = ''
      AND NULLIF(LOWER(REPLACE(c.COLUMN_DEFAULT, CHAR(39), '')), 'null') IS NULL
      AND ((e.tipo = 'int' AND c.COLUMN_TYPE NOT LIKE '%unsigned%' AND c.COLUMN_TYPE NOT LIKE '%zerofill%')
        OR (e.tipo = 'varchar' AND c.CHARACTER_MAXIMUM_LENGTH = e.longitud
          AND c.CHARACTER_SET_NAME = 'utf8mb4' AND c.COLLATION_NAME = 'utf8mb4_unicode_ci'))
      THEN 'NOOP' ELSE 'DETENER' END decision
  FROM esperadas e LEFT JOIN information_schema.COLUMNS c
    ON c.TABLE_SCHEMA = @compras_encargado_schema AND c.TABLE_NAME = 'compras_requerimientos' AND c.COLUMN_NAME = e.columna
), dependencias AS (
  SELECT CASE WHEN VERSION() LIKE '11.8.%MariaDB%'
    AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = @compras_encargado_schema
      AND TABLE_NAME IN ('compras_requerimientos', 'usuarios') AND ENGINE = 'InnoDB') = 2
    AND EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = @compras_encargado_schema
      AND TABLE_NAME = 'compras_requerimientos' AND TABLE_COLLATION = 'utf8mb4_unicode_ci')
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @compras_encargado_schema
      AND ((TABLE_NAME = 'compras_requerimientos' AND COLUMN_NAME IN ('id', 'empresa_id')) OR (TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'id'))
      AND DATA_TYPE = 'int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND COLUMN_TYPE NOT LIKE '%zerofill%' AND IS_NULLABLE = 'NO') = 3
    THEN 'OK' ELSE 'DETENER' END decision
)
SELECT 'compras_requerimientos' tabla, CASE WHEN d.decision = 'DETENER' OR EXISTS (SELECT 1 FROM resultados WHERE decision = 'DETENER')
  THEN 'DETENER' WHEN EXISTS (SELECT 1 FROM resultados WHERE decision = 'APLICAR') THEN 'APLICAR' ELSE 'NOOP' END decision
FROM dependencias d;

-- Descubrimiento opcional de métodos reales (solo lectura, ejecutar manualmente
-- desde la base objetivo; no contiene cuentas, contactos ni secretos):
-- SELECT DISTINCT metodo_pago_habitual FROM compras_proveedores ORDER BY metodo_pago_habitual;
