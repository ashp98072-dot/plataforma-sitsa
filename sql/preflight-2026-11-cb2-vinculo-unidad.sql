-- PREFLIGHT DE SOLO LECTURA de `migrate-2026-11-cb2-vinculo-unidad.sql`. Solo SELECT / SET de variables de sesión; no modifica datos ni esquema.
-- Lee EXCLUSIVAMENTE @db (= @esquema, o DATABASE() si @esquema es NULL), aunque la base activa sea otra (p. ej. information_schema en phpMyAdmin).
SET @esquema = NULL;                  -- NULL = base seleccionada; o p. ej. 'u611730801_Plataforma'
SET @db = COALESCE(@esquema, DATABASE());
SET @ok = IFNULL(@db REGEXP '^[A-Za-z0-9_]+$' AND EXISTS(SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = @db), 0);
SET @innodb = (SELECT COUNT(*) FROM information_schema.TABLES WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND ENGINE='InnoDB' AND TABLE_TYPE='BASE TABLE');
SET @nivel4 = (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2_piloto_reportado');
SET @tipo = (SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2c_unidad_tipo');
SET @v4 = IFNULL(@tipo LIKE '%REPORTADO_V1%', 0), @ya_tipo = IFNULL(@tipo LIKE '%SIN_VINCULO%', 0);
SET @columna = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME='vinculo_unidad');
SET @ya_check = (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2c_vinculo');
SET @filas = NULL;
SET @q = IF(@ok AND @innodb = 1, CONCAT('SELECT COUNT(*) INTO @filas FROM `', @db, '`.flota_cb2_consumos'), 'SELECT 1 INTO @x_nada');
PREPARE d1 FROM @q; EXECUTE d1; DEALLOCATE PREPARE d1;
SELECT CASE
  WHEN NOT @ok THEN 'ESQUEMA_INVALIDO'
  WHEN @innodb <> 1 THEN 'NO APTO: falta flota_cb2_consumos (InnoDB)'
  WHEN @columna = 1 AND @ya_check = 1 AND @ya_tipo = 1 THEN 'YA INSTALADO: no aplicar la migración'
  WHEN @columna + @ya_check + @ya_tipo > 0 THEN 'DETENER Y AUDITAR: instalación parcial del vínculo de unidad'
  WHEN @nivel4 <> 1 OR @v4 <> 1 THEN 'NO APTO: falta el nivel 4 (piloto-reportado); instala la cadena en orden'
  ELSE 'APTO PARA APLICAR: un solo ALTER (columna + CHECK ampliado); pausar importaciones durante la ventana' END AS veredicto,
  @db AS esquema, @filas AS filas_consumos, @nivel4 AS ck_piloto_reportado, @v4 AS tipo_con_reportado_v1, @columna AS columna_vinculo, @ya_check AS ck_vinculo, @ya_tipo AS tipo_con_sin_vinculo;
