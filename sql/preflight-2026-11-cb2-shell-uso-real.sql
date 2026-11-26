-- PREFLIGHT DE SOLO LECTURA — ¿está la base lista para usar CB2 Shell con unidades externas e identidades de piloto? (MariaDB 11.8.9)
-- Solo SELECT / SET de variables de sesión / PREPARE de SELECT. No crea tablas (ni temporales), no modifica datos ni esquema, no instala migraciones.
-- COMPLEMENTA (no reemplaza) a sql/preflight-2026-11-cb2-nivel-instalacion.sql, que compara la estructura exacta de la cadena por firma SHA-256.
-- Aquí se comprueba PRESENCIA y las condiciones que la aplicación exige en tiempo de ejecución (si faltan, el catálogo CB2 responde 503 o desactiva funciones).
-- Los FLAGS (variables de entorno) NO se pueden leer desde SQL: se verifican con el endpoint de catálogos (ver informe).
--
-- ESQUEMA: se lee EXCLUSIVAMENTE @db (= @esquema, o DATABASE() si @esquema es NULL), aunque la base activa sea otra (p. ej. information_schema en phpMyAdmin).
-- Un esquema inexistente o con nombre no válido devuelve ESQUEMA_INVALIDO y ningún dato.

SET @esquema = NULL;                  -- NULL = base seleccionada; o p. ej. 'u611730801_Plataforma'
SET @db = COALESCE(@esquema, DATABASE());
SET @ok = IFNULL(@db REGEXP '^[A-Za-z0-9_]+$' AND EXISTS(SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = @db), 0);

-- ===== A. Base CB2 =====
SET @consumos_innodb = (SELECT COUNT(*) FROM information_schema.TABLES WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND ENGINE='InnoDB' AND TABLE_TYPE='BASE TABLE');
SET @uq_ambito = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND INDEX_NAME='uq_cb2c_ambito' AND NON_UNIQUE=0 AND SEQ_IN_INDEX=1);
SET @auditoria = (SELECT COUNT(*) FROM information_schema.TABLES WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='auditoria' AND ENGINE='InnoDB');

-- ===== B. Cadena de identidades externas (presencia) =====
SET @tablas_ext = (SELECT COUNT(*) FROM information_schema.TABLES WHERE @ok AND TABLE_SCHEMA=@db AND ENGINE='InnoDB' AND TABLE_NAME IN ('flota_cb2_externos_pilotos','flota_cb2_externos_unidades','flota_cb2_externos_asociaciones'));
SET @cols_ext = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME IN ('asociacion_externa_id','identidad_externa','piloto_externo_id','unidad_externa_id'));
SET @veh_nullable = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME='vehiculo_id' AND IS_NULLABLE='YES');
SET @ck_tipo = (SELECT GROUP_CONCAT(CHECK_CLAUSE SEPARATOR ' ') FROM information_schema.CHECK_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2c_unidad_tipo');
SET @ck_unico = (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2_piloto_unico');
SET @ck_reportado = (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME='ck_cb2_piloto_reportado');
SET @v_independiente = IFNULL(@ck_tipo LIKE '%INDEPENDIENTE_V1%', 0), @v_reportado = IFNULL(@ck_tipo LIKE '%REPORTADO_V1%', 0);
SET @fk_ext = (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME IN ('piloto_externo_id','unidad_externa_id') AND REFERENCED_TABLE_NAME IN ('flota_cb2_externos_pilotos','flota_cb2_externos_unidades'));
-- nivel: 0 = sin cadena; 1/2 = incompleta (insuficiente para Shell con piloto interno/reportado en unidad externa); 3 = independientes; 4 = piloto reportado; -1 = inconsistente
SET @nivel = CASE WHEN NOT @ok THEN NULL
  WHEN @tablas_ext = 0 AND @cols_ext = 0 AND @ck_unico = 0 AND @ck_reportado = 0 THEN 0
  WHEN @tablas_ext = 3 AND @cols_ext = 4 AND @fk_ext = 2 AND @veh_nullable = 1 AND @ck_unico = 1 AND @v_independiente = 1 AND @ck_reportado = 0 THEN 3
  WHEN @tablas_ext = 3 AND @cols_ext = 4 AND @fk_ext = 2 AND @veh_nullable = 1 AND @ck_unico = 1 AND @v_reportado = 1 AND @ck_reportado = 1 THEN 4
  WHEN @tablas_ext = 3 AND @cols_ext >= 2 AND @ck_unico = 0 AND @ck_reportado = 0 THEN 2
  ELSE -1 END;

-- ===== C. Tablas Shell de pilotos reportados / equivalencias (misma comprobación estricta que la aplicación) =====
SET @shell_tablas = (SELECT COUNT(*) FROM information_schema.TABLES WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME IN ('flota_cb2_pilotos_reportados','flota_cb2_consumo_piloto_reportado','flota_cb2_pilotos_equivalencias'));
SET @shell_innodb = (SELECT COUNT(*) FROM information_schema.TABLES WHERE @ok AND TABLE_SCHEMA=@db AND ENGINE='InnoDB' AND TABLE_NAME IN ('flota_cb2_pilotos_reportados','flota_cb2_consumo_piloto_reportado','flota_cb2_pilotos_equivalencias'));
SET @shell_guardas = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE @ok AND CONSTRAINT_SCHEMA=@db AND TABLE_NAME IN ('flota_cb2_pilotos_reportados','flota_cb2_consumo_piloto_reportado','flota_cb2_pilotos_equivalencias')
  AND CONSTRAINT_NAME IN ('fk_cb2pr_empresa','fk_cb2pr_actor','ck_cb2pr_version','ck_cb2pr_estado','ck_cb2pr_nombre','fk_cb2cpr_consumo','fk_cb2cpr_piloto','fk_cb2pe_empresa','fk_cb2pe_empleado','fk_cb2pe_reportado','fk_cb2pe_actor','ck_cb2pe_version','ck_cb2pe_destino','ck_cb2pe_nombre','ck_cb2pe_revision'));
SET @shell_indices = (SELECT COUNT(*) FROM (SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columnas, MAX(NON_UNIQUE) nu, SUM(SUB_PART IS NOT NULL) prefijos
  FROM information_schema.STATISTICS WHERE @ok AND TABLE_SCHEMA=@db AND ((TABLE_NAME='flota_cb2_pilotos_reportados' AND INDEX_NAME IN ('uq_cb2pr_nombre','uq_cb2pr_ambito')) OR (TABLE_NAME='flota_cb2_consumo_piloto_reportado' AND INDEX_NAME='PRIMARY') OR (TABLE_NAME='flota_cb2_pilotos_equivalencias' AND INDEX_NAME='PRIMARY')) GROUP BY TABLE_NAME, INDEX_NAME) i
  WHERE i.nu = 0 AND i.prefijos = 0 AND i.columnas = CASE WHEN i.TABLE_NAME='flota_cb2_pilotos_equivalencias' THEN 'empresa_id,normalizacion_version,nombre_hash' WHEN i.INDEX_NAME='uq_cb2pr_nombre' THEN 'empresa_id,normalizacion_version,nombre_hash' WHEN i.INDEX_NAME='uq_cb2pr_ambito' THEN 'empresa_id,id' ELSE 'empresa_id,proveedor_id,consumo_id' END);
SET @shell = CASE WHEN NOT @ok THEN NULL WHEN @shell_tablas = 0 THEN 'AUSENTE' WHEN @shell_tablas = 3 AND @shell_innodb = 3 AND @shell_guardas = 15 AND @shell_indices = 4 THEN 'COMPLETO' ELSE 'PARCIAL' END;

-- ===== D. Datos de apoyo (solo conteos; las tablas pueden no existir) =====
SET @empleados_ok = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='empleados' AND COLUMN_NAME IN ('id','empresa_id','nombre','estado'));
SET @col_egreso = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='empleados' AND COLUMN_NAME='fecha_egreso');
SET @col_alta = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE @ok AND TABLE_SCHEMA=@db AND TABLE_NAME='empleados' AND COLUMN_NAME='fecha_alta');
SET @emp_activos = NULL, @emp_baja = NULL, @emp_baja_sin_fecha = NULL, @emp_otros = NULL, @ext_unidades = NULL, @ext_pilotos = NULL, @reportados = NULL, @consumos = NULL, @consumos_externos = NULL;
SET @q = IF(@ok AND @empleados_ok = 4, CONCAT('SELECT COALESCE(SUM(estado=''Activo''),0), COALESCE(SUM(estado=''Baja''),0), COALESCE(SUM(estado NOT IN (''Activo'',''Baja'')),0) INTO @emp_activos, @emp_baja, @emp_otros FROM `', @db, '`.empleados'), 'SELECT 1 INTO @x_nada');
PREPARE d1 FROM @q; EXECUTE d1; DEALLOCATE PREPARE d1;
SET @q = IF(@ok AND @empleados_ok = 4 AND @col_egreso = 1, CONCAT('SELECT COUNT(*) INTO @emp_baja_sin_fecha FROM `', @db, '`.empleados WHERE estado=''Baja'' AND fecha_egreso IS NULL'), 'SELECT 1 INTO @x_nada');
PREPARE d2 FROM @q; EXECUTE d2; DEALLOCATE PREPARE d2;
SET @q = IF(@ok AND @tablas_ext = 3, CONCAT('SELECT (SELECT COUNT(*) FROM `', @db, '`.flota_cb2_externos_unidades), (SELECT COUNT(*) FROM `', @db, '`.flota_cb2_externos_pilotos) INTO @ext_unidades, @ext_pilotos'), 'SELECT 1 INTO @x_nada');
PREPARE d3 FROM @q; EXECUTE d3; DEALLOCATE PREPARE d3;
SET @q = IF(@ok AND @shell = 'COMPLETO', CONCAT('SELECT COUNT(*) INTO @reportados FROM `', @db, '`.flota_cb2_pilotos_reportados'), 'SELECT 1 INTO @x_nada');
PREPARE d4 FROM @q; EXECUTE d4; DEALLOCATE PREPARE d4;
SET @q = IF(@ok AND @consumos_innodb = 1, CONCAT('SELECT COUNT(*), COALESCE(SUM(vehiculo_id IS NULL),0) INTO @consumos, @consumos_externos FROM `', @db, '`.flota_cb2_consumos'), 'SELECT 1 INTO @x_nada');
PREPARE d5 FROM @q; EXECUTE d5; DEALLOCATE PREPARE d5;

-- ===== RESULTADO 1: veredicto =====
SELECT CASE
  WHEN NOT @ok THEN 'ESQUEMA_INVALIDO'
  WHEN @consumos_innodb <> 1 OR @uq_ambito < 1 THEN 'NO APTO: falta la base CB2 (flota_cb2_consumos InnoDB con uq_cb2c_ambito)'
  WHEN @nivel = -1 OR @shell = 'PARCIAL' THEN 'DETENER Y AUDITAR: instalación parcial o inconsistente (la aplicación responde 503 con el registro de pilotos parcial)'
  WHEN @nivel < 3 THEN 'NO APTO: falta la cadena de identidades independientes (nivel >= 3)'
  WHEN @shell <> 'COMPLETO' THEN 'NO APTO: faltan las 3 tablas Shell de pilotos reportados/equivalencias'
  WHEN @auditoria <> 1 THEN 'NO APTO: falta la tabla de auditoría'
  WHEN @nivel = 3 THEN 'APTO PARA PREFLIGHT con limitación: nivel 3 (sin nivel 4, un piloto reportado sobre unidad externa sigue bloqueado)'
  ELSE 'APTO PARA PREFLIGHT: esquema listo (nivel 4 + tablas Shell); faltan por verificar flags y despliegue' END AS veredicto,
  @db AS esquema, @nivel AS nivel_cadena, @shell AS tablas_shell,
  'Pendiente fuera de SQL: CB2_TERCEROS_DIRECTOS_APROBADA=1 (catálogo: tercerosDirectos), identidadesIndependientes, pilotoReportadoExterno, pilotosReportados = true, y que el despliegue incluya #642.' AS pendiente;

-- ===== RESULTADO 2: hechos por objeto =====
SELECT * FROM (
  SELECT 10 AS orden, 'base' AS seccion, 'flota_cb2_consumos InnoDB' AS objeto, '1' AS esperado, CAST(@consumos_innodb AS CHAR) AS actual UNION ALL
  SELECT 11, 'base', 'uq_cb2c_ambito único', '1', CAST(@uq_ambito AS CHAR) UNION ALL
  SELECT 12, 'base', 'tabla auditoria InnoDB', '1', CAST(@auditoria AS CHAR) UNION ALL
  SELECT 20, 'cadena', 'tablas externas (pilotos, unidades, asociaciones)', '3', CAST(@tablas_ext AS CHAR) UNION ALL
  SELECT 21, 'cadena', 'columnas de identidad externa en consumos', '4', CAST(@cols_ext AS CHAR) UNION ALL
  SELECT 22, 'cadena', 'FK de piloto/unidad externa', '2', CAST(@fk_ext AS CHAR) UNION ALL
  SELECT 23, 'cadena', 'vehiculo_id admite NULL (unidad externa)', '1', CAST(@veh_nullable AS CHAR) UNION ALL
  SELECT 24, 'cadena', 'ck_cb2_piloto_unico (nivel 3)', '1', CAST(@ck_unico AS CHAR) UNION ALL
  SELECT 25, 'cadena', 'ck_cb2c_unidad_tipo contiene INDEPENDIENTE_V1 / REPORTADO_V1', '1 / 1 (nivel 4)', CONCAT(@v_independiente, ' / ', @v_reportado) UNION ALL
  SELECT 26, 'cadena', 'ck_cb2_piloto_reportado (nivel 4)', '1', CAST(@ck_reportado AS CHAR) UNION ALL
  SELECT 27, 'cadena', 'nivel detectado (por presencia; firma exacta: preflight-nivel-instalacion)', '4', CAST(@nivel AS CHAR) UNION ALL
  SELECT 30, 'shell', 'tablas Shell presentes / InnoDB', '3 / 3', CONCAT(@shell_tablas, ' / ', @shell_innodb) UNION ALL
  SELECT 31, 'shell', 'guardas (FK/CHECK) del registro de pilotos', '15', CAST(@shell_guardas AS CHAR) UNION ALL
  SELECT 32, 'shell', 'índices únicos exactos', '4', CAST(@shell_indices AS CHAR) UNION ALL
  SELECT 33, 'shell', 'estado del registro', 'COMPLETO', IFNULL(@shell, 'n/d') UNION ALL
  SELECT 40, 'empleados', 'columnas id/empresa_id/nombre/estado', '4', CAST(@empleados_ok AS CHAR) UNION ALL
  SELECT 41, 'empleados', 'columna fecha_egreso (fecha de baja)', '1 (si falta: sin fecha de baja, solo avisos)', CAST(@col_egreso AS CHAR) UNION ALL
  SELECT 42, 'empleados', 'columna fecha_alta', '1 (opcional)', CAST(@col_alta AS CHAR) UNION ALL
  SELECT 43, 'empleados', 'Activo / Baja / otros estados (otros no se reconocen)', 'informativo', CONCAT(IFNULL(@emp_activos,'n/d'), ' / ', IFNULL(@emp_baja,'n/d'), ' / ', IFNULL(@emp_otros,'n/d')) UNION ALL
  SELECT 44, 'empleados', 'empleados de Baja sin fecha_egreso', 'informativo', IFNULL(CAST(@emp_baja_sin_fecha AS CHAR), 'n/d') UNION ALL
  SELECT 50, 'datos', 'unidades externas / pilotos externos registrados', 'informativo', CONCAT(IFNULL(@ext_unidades,'n/d'), ' / ', IFNULL(@ext_pilotos,'n/d')) UNION ALL
  SELECT 51, 'datos', 'pilotos reportados registrados', 'informativo', IFNULL(CAST(@reportados AS CHAR), 'n/d') UNION ALL
  SELECT 52, 'datos', 'consumos CB2 (total / en unidad externa)', 'informativo', CONCAT(IFNULL(@consumos,'n/d'), ' / ', IFNULL(@consumos_externos,'n/d'))
) h WHERE @ok ORDER BY orden;
