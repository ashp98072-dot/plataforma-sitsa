-- NO ejecutado por este PR. MariaDB 11.8.x, producción verificada 11.8.9.
-- Ejecutar primero preflight-2026-09-compras-encargado.sql y continuar solo con
-- APLICAR/NOOP. Ajustar USE para otra instalación; nunca depender de DATABASE().
-- Ejecutar completo en phpMyAdmin/cliente compatible con DELIMITER.
-- Bloque anónimo: no crea procedimientos persistentes. Revalida antes del ALTER.
-- Dos columnas nullable al final; históricos quedan NULL, sin backfill/seeds.
-- Sin nuevas FKs ni cambios de estado/índices existentes; validación tenant en app.
USE u611730801_Plataforma;
-- DATABASE() es seguro aquí: USE acaba de fijar explícitamente la base objetivo.
SET @compras_encargado_schema = DATABASE();
DELIMITER //
BEGIN NOT ATOMIC
  IF VERSION() NOT LIKE '11.8.%MariaDB%'
    OR (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = @compras_encargado_schema
      AND TABLE_NAME IN ('compras_requerimientos', 'usuarios') AND ENGINE = 'InnoDB') <> 2
    OR NOT EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = @compras_encargado_schema
      AND TABLE_NAME = 'compras_requerimientos' AND TABLE_COLLATION = 'utf8mb4_unicode_ci')
    OR (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @compras_encargado_schema
      AND ((TABLE_NAME = 'compras_requerimientos' AND COLUMN_NAME IN ('id', 'empresa_id')) OR (TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'id'))
      AND DATA_TYPE = 'int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND COLUMN_TYPE NOT LIKE '%zerofill%' AND IS_NULLABLE = 'NO') <> 3
    OR EXISTS (SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @compras_encargado_schema
      AND TABLE_NAME = 'compras_requerimientos' AND COLUMN_NAME IN ('encargado_compras_usuario_id', 'encargado_compras_nombre')
      AND NOT (IS_NULLABLE = 'YES' AND COALESCE(EXTRA, '') = ''
        AND NULLIF(LOWER(REPLACE(COLUMN_DEFAULT, CHAR(39), '')), 'null') IS NULL
        AND ((COLUMN_NAME = 'encargado_compras_usuario_id' AND DATA_TYPE = 'int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND COLUMN_TYPE NOT LIKE '%zerofill%')
          OR (COLUMN_NAME = 'encargado_compras_nombre' AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 200
            AND CHARACTER_SET_NAME = 'utf8mb4' AND COLLATION_NAME = 'utf8mb4_unicode_ci'))))
  THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DETENER: esquema incompatible; revisar preflight de encargado de compras.';
  END IF;
  IF (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @compras_encargado_schema
    AND TABLE_NAME = 'compras_requerimientos' AND COLUMN_NAME IN ('encargado_compras_usuario_id', 'encargado_compras_nombre')) < 2 THEN
    ALTER TABLE compras_requerimientos
      ADD COLUMN IF NOT EXISTS encargado_compras_usuario_id INT NULL DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS encargado_compras_nombre VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL DEFAULT NULL;
  END IF;
END//
DELIMITER ;
