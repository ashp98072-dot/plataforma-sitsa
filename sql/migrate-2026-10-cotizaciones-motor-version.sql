-- YA APLICADA MANUALMENTE EN PRODUCCIÓN y verificada (u611730801_Plataforma, MariaDB 11.8.9). NO volver a ejecutar. Se conserva como registro de la migración.
-- Amplía tms_cotizacion_costeos.motor_version de VARCHAR(20) a VARCHAR(40): el nombre COSTEO_COTIZADOR_2026 (21 caracteres) no cabía en VARCHAR(20)
-- y COSTEO_COTIZADOR_2026_V2 (24) tampoco. Diagnóstico posterior a la aplicación: columna = VARCHAR(40) NOT NULL; único valor existente = COSTEO_V1;
-- no había filas truncadas (COSTEO_COTIZADOR_202), por lo que no hubo datos que reparar. Ampliar la columna no cambia datos, importes ni snapshots.
-- schema.sql ya refleja VARCHAR(40). Las migraciones anteriores (sql/migrate-2026-09-cotizaciones-costeo.sql) conservan VARCHAR(20) como registro histórico.
ALTER TABLE tms_cotizacion_costeos MODIFY COLUMN motor_version VARCHAR(40) NOT NULL;
