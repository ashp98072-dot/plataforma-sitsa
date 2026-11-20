-- POSTCHECK DE SOLO LECTURA de `migrate-2026-11-cb2-vinculo-unidad.sql` (ejecutar después de aplicarla). Solo SELECT / SET de variables de sesión.
-- Lee EXCLUSIVAMENTE @db (= @esquema, o DATABASE() si @esquema es NULL).
-- Las 4 restricciones CHECK de la cadena se validan por FIRMA SHA-256 de su definición COMPLETA, no por palabras clave: se compara la definición normalizada
-- (minúsculas, sin espacios/saltos de línea ni acentos graves) con la esperada. Solo se tolera lo que MariaDB normaliza legítimamente (mayúsculas/minúsculas, espacios,
-- comillas de identificadores); cualquier cambio de operadores, valores, paréntesis o columnas altera la firma y el postcheck responde FALLA aunque el nombre y las palabras clave coincidan.
-- Las firmas esperadas son las que produce MariaDB 11.8.9 al instalar las migraciones del repositorio (probado en laboratorio); la salida muestra la firma observada para auditoría.
SET @esquema = NULL;
SET @db = COALESCE(@esquema, DATABASE());
SET @ok = IFNULL(@db REGEXP '^[A-Za-z0-9_]+$' AND EXISTS(SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = @db), 0);
SET @columna = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME='vinculo_unidad' AND IS_NULLABLE='YES' AND DATA_TYPE='varchar' AND COLUMN_TYPE='varchar(20)' AND (COLUMN_DEFAULT IS NULL OR COLUMN_DEFAULT='NULL'));
SET @fk_ext = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND REFERENCED_TABLE_NAME IS NOT NULL);
SET @con_vinculo = NULL, @filas = NULL;
SET @q = IF(@ok AND @columna = 1, CONCAT('SELECT COUNT(*), COALESCE(SUM(vinculo_unidad IS NOT NULL),0) INTO @filas, @con_vinculo FROM `', @db, '`.flota_cb2_consumos'), 'SELECT 1 INTO @x_nada');
PREPARE d1 FROM @q; EXECUTE d1; DEALLOCATE PREPARE d1;
-- Firmas esperadas (SHA-256 de la definición normalizada).
SET @esp = JSON_OBJECT(
  'ck_cb2_piloto_unico', 'eada5f2d494a3bc288ce5e68176d78110298d2c9e3443b8e68a2a48a8b7d6317',
  'ck_cb2_piloto_reportado', '05d71ae66380f62aace9333cee51acbeb4e980d0701aeca25a47ec0c4caf92a2',
  'ck_cb2c_unidad_tipo', '2461547fd9244843a4738d3913eef2014b19a8cbe83954b9bd93554351a20cc2',
  'ck_cb2c_vinculo', '0bd265de643ca4980de81549413a6bf5091ca5be1a3dd2005bc53291bfb5dc93');
-- Firma observada de cada CHECK (NULL si no existe).
SET @sig_unico = (SELECT SHA2(LOWER(REGEXP_REPLACE(REPLACE(CHECK_CLAUSE,'`',''),'[[:space:]]+','')),256) FROM information_schema.CHECK_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2_piloto_unico');
SET @sig_reportado = (SELECT SHA2(LOWER(REGEXP_REPLACE(REPLACE(CHECK_CLAUSE,'`',''),'[[:space:]]+','')),256) FROM information_schema.CHECK_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2_piloto_reportado');
SET @sig_tipo = (SELECT SHA2(LOWER(REGEXP_REPLACE(REPLACE(CHECK_CLAUSE,'`',''),'[[:space:]]+','')),256) FROM information_schema.CHECK_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2c_unidad_tipo');
SET @sig_vinculo = (SELECT SHA2(LOWER(REGEXP_REPLACE(REPLACE(CHECK_CLAUSE,'`',''),'[[:space:]]+','')),256) FROM information_schema.CHECK_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2c_vinculo');
SET @iguales = (@sig_unico <=> JSON_VALUE(@esp,'$.ck_cb2_piloto_unico')) + (@sig_reportado <=> JSON_VALUE(@esp,'$.ck_cb2_piloto_reportado')) + (@sig_tipo <=> JSON_VALUE(@esp,'$.ck_cb2c_unidad_tipo')) + (@sig_vinculo <=> JSON_VALUE(@esp,'$.ck_cb2c_vinculo'));
SET @distintas = CONCAT_WS(', ',
  IF(@sig_unico <=> JSON_VALUE(@esp,'$.ck_cb2_piloto_unico'), NULL, 'ck_cb2_piloto_unico'), IF(@sig_reportado <=> JSON_VALUE(@esp,'$.ck_cb2_piloto_reportado'), NULL, 'ck_cb2_piloto_reportado'),
  IF(@sig_tipo <=> JSON_VALUE(@esp,'$.ck_cb2c_unidad_tipo'), NULL, 'ck_cb2c_unidad_tipo'), IF(@sig_vinculo <=> JSON_VALUE(@esp,'$.ck_cb2c_vinculo'), NULL, 'ck_cb2c_vinculo'));
-- RESULTADO 1: veredicto.
SELECT CASE WHEN NOT @ok THEN 'ESQUEMA_INVALIDO'
  WHEN @columna = 1 AND @iguales = 4 THEN 'OK: VÍNCULO DE UNIDAD INSTALADO'
  ELSE CONCAT('FALLA: instalación incompleta o definiciones distintas a las esperadas (', IF(@columna = 1, '', 'columna vinculo_unidad; '), COALESCE(NULLIF(@distintas,''),'sin diferencias en CHECK'), '); no usar el guardado sin vincular') END AS veredicto,
  @db AS esquema, @columna AS columna_vinculo, @iguales AS checks_con_firma_esperada_de_4, @distintas AS checks_distintos, @fk_ext AS fk_de_consumos, @filas AS filas_consumos, @con_vinculo AS filas_con_vinculo;
-- RESULTADO 2: firma observada y esperada por restricción (para auditoría).
SELECT n.nombre, n.observada, JSON_VALUE(@esp, CONCAT('$.', n.nombre)) AS esperada, (n.observada <=> JSON_VALUE(@esp, CONCAT('$.', n.nombre))) AS coincide FROM (
  SELECT 'ck_cb2_piloto_unico' AS nombre, @sig_unico AS observada UNION ALL SELECT 'ck_cb2_piloto_reportado', @sig_reportado
  UNION ALL SELECT 'ck_cb2c_unidad_tipo', @sig_tipo UNION ALL SELECT 'ck_cb2c_vinculo', @sig_vinculo) n WHERE @ok;
