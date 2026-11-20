-- POSTCHECK DE SOLO LECTURA de `migrate-2026-11-cb2-vinculo-unidad.sql` (ejecutar después de aplicarla). Solo SELECT / SET de variables de sesión.
-- Lee EXCLUSIVAMENTE @db (= @esquema, o DATABASE() si @esquema es NULL).
SET @esquema = NULL;
SET @db = COALESCE(@esquema, DATABASE());
SET @ok = IFNULL(@db REGEXP '^[A-Za-z0-9_]+$' AND EXISTS(SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = @db), 0);
SET @columna = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME='vinculo_unidad' AND IS_NULLABLE='YES' AND DATA_TYPE='varchar');
SET @tipo = (SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2c_unidad_tipo');
SET @checks = (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME IN ('ck_cb2c_unidad_tipo','ck_cb2c_vinculo','ck_cb2_piloto_reportado','ck_cb2_piloto_unico'));
SET @conserva = IFNULL(@tipo LIKE '%REPORTADO_V1%' AND @tipo LIKE '%INDEPENDIENTE_V1%' AND @tipo LIKE '%SIN_VINCULO%', 0);
SET @fk_ext = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND REFERENCED_TABLE_NAME IS NOT NULL);
SET @con_vinculo = NULL, @filas = NULL;
SET @q = IF(@ok AND @columna = 1, CONCAT('SELECT COUNT(*), COALESCE(SUM(vinculo_unidad IS NOT NULL),0) INTO @filas, @con_vinculo FROM `', @db, '`.flota_cb2_consumos'), 'SELECT 1 INTO @x_nada');
PREPARE d1 FROM @q; EXECUTE d1; DEALLOCATE PREPARE d1;
SELECT CASE WHEN NOT @ok THEN 'ESQUEMA_INVALIDO'
  WHEN @columna = 1 AND @checks = 4 AND @conserva = 1 THEN 'OK: VÍNCULO DE UNIDAD INSTALADO'
  ELSE 'FALLA: instalación incompleta o inconsistente; no usar el guardado sin vincular' END AS veredicto,
  @db AS esquema, @columna AS columna_vinculo, @checks AS checks_de_4, @conserva AS tipo_conserva_politicas, @fk_ext AS fk_de_consumos, @filas AS filas_consumos, @con_vinculo AS filas_con_vinculo;
