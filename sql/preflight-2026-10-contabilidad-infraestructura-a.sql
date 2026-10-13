-- PREFLIGHT SOLO LECTURA / PHPMyAdmin: consultas independientes; sin bloques ni cambios de sesión.
-- Ejecutar PASO 0 y luego UNA consulta gate, seleccionada según tablas existentes.
-- SQL estático no puede consultar datos de una tabla ausente aunque esté detrás de CASE.
-- No ejecutar las tres variantes como lote. Errores SQL/cliente NO equivalen a DETENER.
-- PASO 0: presencia de tablas (elige HISTORICO, ACTUAL o NUEVO).
SELECT DATABASE() AS esquema_objetivo, VERSION() AS version_servidor,
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol') AS roles_existe,
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos') AS eventos_existe;
-- PASO 1A: HISTORICO, roles existe / eventos ausente (producción previa a migración).
-- INICIO_GATE_HISTORICO
WITH
contexto AS (
  SELECT DATABASE() AS esquema_objetivo, VERSION() AS version_servidor,
    (VERSION() LIKE '%MariaDB%') AS mariadb_ok, (@@foreign_key_checks=1) AS fk_checks_ok,
    (@@check_constraint_checks=1) AS check_constraints_ok,
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol') AS n_roles,
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos') AS n_eventos
),
metadata AS (
  SELECT contexto.*,
    (SELECT COUNT(*) = 6 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('empresas','usuarios','cont_entidades','cont_cuentas','cont_asientos','fact_facturas') AND ENGINE = 'InnoDB')
    AND (SELECT COUNT(*) = 6 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('empresas','usuarios','cont_entidades','cont_cuentas','cont_asientos','fact_facturas')
        AND COLUMN_NAME='id' AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND COLUMN_KEY='PRI')
    AND (SELECT COUNT(*) = 3 FROM (
      SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE=0
        AND TABLE_NAME IN ('cont_entidades','cont_cuentas','cont_asientos')
      GROUP BY TABLE_NAME, INDEX_NAME
    ) p WHERE (TABLE_NAME='cont_entidades' AND cols='empresa_id,id')
       OR (TABLE_NAME IN ('cont_cuentas','cont_asientos') AND cols='empresa_id,entidad_id,id'))
    AND (SELECT COUNT(*)=7 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
      AND ((TABLE_NAME IN ('cont_cuentas','cont_asientos','fact_facturas') AND COLUMN_NAME IN ('empresa_id','entidad_id'))
        OR (TABLE_NAME='cont_entidades' AND COLUMN_NAME='empresa_id'))
      AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%') AS padres_ok,
    (EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol'
      AND ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_uca1400_ai_ci')
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol')=8
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol' AND IS_NULLABLE='NO'
      AND (COLUMN_NAME IN ('activa','creado_en','actualizado_en') OR COLUMN_DEFAULT IS NULL) AND (
      (COLUMN_NAME='id' AND ORDINAL_POSITION=1 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND EXTRA='auto_increment') OR
      (COLUMN_NAME='empresa_id' AND ORDINAL_POSITION=2 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND EXTRA='') OR
      (COLUMN_NAME='entidad_id' AND ORDINAL_POSITION=3 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND EXTRA='') OR
      (COLUMN_NAME='rol' AND ORDINAL_POSITION=4 AND COLUMN_TYPE='varchar(40)' AND COLLATION_NAME='utf8mb4_uca1400_ai_ci' AND EXTRA='') OR
      (COLUMN_NAME='cuenta_id' AND ORDINAL_POSITION=5 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND EXTRA='') OR
      (COLUMN_NAME='activa' AND ORDINAL_POSITION=6 AND COLUMN_TYPE='tinyint(1)' AND COLUMN_DEFAULT='1' AND EXTRA='') OR
      (COLUMN_NAME='creado_en' AND ORDINAL_POSITION=7 AND DATA_TYPE='datetime' AND LOWER(REPLACE(COLUMN_DEFAULT,'()',''))='current_timestamp' AND EXTRA='') OR
      (COLUMN_NAME='actualizado_en' AND ORDINAL_POSITION=8 AND DATA_TYPE='datetime' AND LOWER(REPLACE(COLUMN_DEFAULT,'()',''))='current_timestamp' AND LOWER(REPLACE(EXTRA,'()',''))='on update current_timestamp')
    ))=8
    AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol')=3
    AND (SELECT COUNT(*) FROM (
      SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols,
        SUM(SUB_PART IS NOT NULL) prefijos FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol'
      GROUP BY INDEX_NAME,NON_UNIQUE
    ) i WHERE prefijos=0 AND ((INDEX_NAME='PRIMARY' AND NON_UNIQUE=0 AND cols='id')
      OR (INDEX_NAME='uq_cont_cuentas_rol' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,rol')
      OR (INDEX_NAME='idx_cont_cuentas_rol_cuenta' AND NON_UNIQUE=1 AND cols='empresa_id,entidad_id,cuenta_id')))=3
    AND (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol')=2
    AND (SELECT COUNT(*) FROM (
      SELECT k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME,
        GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) cols,
        GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) destino
      FROM information_schema.KEY_COLUMN_USAGE k WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME='cont_cuentas_rol'
        AND k.REFERENCED_TABLE_SCHEMA=DATABASE() GROUP BY k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME
    ) f JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=DATABASE() AND r.TABLE_NAME='cont_cuentas_rol' AND r.CONSTRAINT_NAME=f.CONSTRAINT_NAME
    WHERE r.DELETE_RULE='RESTRICT' AND r.UPDATE_RULE='RESTRICT' AND r.MATCH_OPTION='NONE' AND
      ((f.CONSTRAINT_NAME='fk_cont_rol_entidad' AND f.REFERENCED_TABLE_NAME='cont_entidades' AND cols='empresa_id,entidad_id' AND destino='empresa_id,id')
       OR (f.CONSTRAINT_NAME='fk_cont_rol_cuenta' AND f.REFERENCED_TABLE_NAME='cont_cuentas' AND cols='empresa_id,entidad_id,cuenta_id' AND destino='empresa_id,entidad_id,id')))=2
    AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='cont_cuentas_rol' AND tc.CONSTRAINT_TYPE='CHECK')=1
    AND NOT EXISTS (SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='cont_cuentas_rol')) AS roles_tabla_ok,
    (EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos'
      AND ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_uca1400_ai_ci')
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos')=13
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos'
      AND (COLUMN_NAME='creado_en' OR COLUMN_DEFAULT IS NULL OR (COLUMN_NAME='evento_origen_id' AND COLUMN_DEFAULT='NULL')) AND (
      (COLUMN_NAME='id' AND ORDINAL_POSITION=1 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='auto_increment') OR
      (COLUMN_NAME='empresa_id' AND ORDINAL_POSITION=2 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='entidad_id' AND ORDINAL_POSITION=3 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='factura_id' AND ORDINAL_POSITION=4 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='tipo_evento' AND ORDINAL_POSITION=5 AND COLUMN_TYPE='varchar(40)' AND COLLATION_NAME='utf8mb4_uca1400_ai_ci' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='evento_origen_id' AND ORDINAL_POSITION=6 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='YES' AND EXTRA='') OR
      (COLUMN_NAME='asiento_id' AND ORDINAL_POSITION=7 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='clave_evento' AND ORDINAL_POSITION=8 AND COLUMN_TYPE='varchar(120)' AND COLLATION_NAME='ascii_bin' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='huella' AND ORDINAL_POSITION=9 AND COLUMN_TYPE='char(64)' AND COLLATION_NAME='ascii_bin' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='fecha_contable' AND ORDINAL_POSITION=10 AND DATA_TYPE='date' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='datos_snapshot' AND ORDINAL_POSITION=11 AND DATA_TYPE='longtext' AND COLLATION_NAME='utf8mb4_bin' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='creado_por' AND ORDINAL_POSITION=12 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='creado_en' AND ORDINAL_POSITION=13 AND DATA_TYPE='datetime' AND LOWER(REPLACE(COLUMN_DEFAULT,'()',''))='current_timestamp' AND IS_NULLABLE='NO' AND EXTRA='')
    ))=13
    AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos')=8
    AND (SELECT COUNT(*) FROM (
      SELECT INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols,SUM(SUB_PART IS NOT NULL) prefijos
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos' GROUP BY INDEX_NAME,NON_UNIQUE
    ) i WHERE prefijos=0 AND (
      (INDEX_NAME='PRIMARY' AND NON_UNIQUE=0 AND cols='id') OR
      (INDEX_NAME='uq_cont_evento_clave' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,clave_evento') OR
      (INDEX_NAME='uq_cont_evento_asiento' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,asiento_id') OR
      (INDEX_NAME='uq_cont_evento_ambito' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,factura_id,id') OR
      (INDEX_NAME='idx_cont_evento_factura' AND NON_UNIQUE=1 AND cols='empresa_id,entidad_id,factura_id,tipo_evento') OR
      (INDEX_NAME='idx_cont_evento_origen' AND NON_UNIQUE=1 AND cols='empresa_id,entidad_id,factura_id,evento_origen_id') OR
      (INDEX_NAME='fk_cont_evento_factura' AND NON_UNIQUE=1 AND cols='factura_id') OR
      (INDEX_NAME='fk_cont_evento_actor' AND NON_UNIQUE=1 AND cols='creado_por')
    ))=8
    AND (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos')=5
    AND (SELECT COUNT(*) FROM (
      SELECT k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME,GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) cols,
        GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) destino
      FROM information_schema.KEY_COLUMN_USAGE k WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME='cont_eventos'
        AND k.REFERENCED_TABLE_SCHEMA=DATABASE() GROUP BY k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME
    ) f JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=DATABASE() AND r.TABLE_NAME='cont_eventos' AND r.CONSTRAINT_NAME=f.CONSTRAINT_NAME
      WHERE r.DELETE_RULE='RESTRICT' AND r.UPDATE_RULE='RESTRICT' AND r.MATCH_OPTION='NONE' AND (
      (f.CONSTRAINT_NAME='fk_cont_evento_entidad' AND f.REFERENCED_TABLE_NAME='cont_entidades' AND cols='empresa_id,entidad_id' AND destino='empresa_id,id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_factura' AND f.REFERENCED_TABLE_NAME='fact_facturas' AND cols='factura_id' AND destino='id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_asiento' AND f.REFERENCED_TABLE_NAME='cont_asientos' AND cols='empresa_id,entidad_id,asiento_id' AND destino='empresa_id,entidad_id,id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_origen' AND f.REFERENCED_TABLE_NAME='cont_eventos' AND cols='empresa_id,entidad_id,factura_id,evento_origen_id' AND destino='empresa_id,entidad_id,factura_id,id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_actor' AND f.REFERENCED_TABLE_NAME='usuarios' AND cols='creado_por' AND destino='id')
    ))=5
    AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='cont_eventos' AND tc.CONSTRAINT_TYPE='CHECK')=5
    AND NOT EXISTS (SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='cont_eventos')) AND (SELECT COUNT(*)=5 FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='cont_eventos' AND tc.CONSTRAINT_TYPE='CHECK' AND (
        (cc.CONSTRAINT_NAME='datos_snapshot' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='json_valid(datos_snapshot)') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_tipo' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='tipo_eventoin(''factura_emitida'',''cobro_confirmado'',''retencion_no_emitida'')') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_origen' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='tipo_evento=''factura_emitida''andevento_origen_idisnullortipo_evento=''retencion_no_emitida''andevento_origen_idisnotnull') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_huella' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='huellaregexp''^[0-9a-f]{64}$''') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_snapshot' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='json_valid(datos_snapshot)andjson_value(datos_snapshot,''$.version'')isnotnullandjson_value(datos_snapshot,''$.version'')=1'))) AS eventos_tabla_ok,
    (EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND ((CONSTRAINT_NAME IN ('fk_cont_rol_entidad','fk_cont_rol_cuenta','ck_cont_rol_valido') AND TABLE_NAME<>'cont_cuentas_rol')
      OR (CONSTRAINT_NAME IN ('fk_cont_evento_entidad','fk_cont_evento_factura','fk_cont_evento_asiento','fk_cont_evento_origen','fk_cont_evento_actor','ck_cont_evento_tipo','ck_cont_evento_origen','ck_cont_evento_huella','ck_cont_evento_snapshot') AND TABLE_NAME<>'cont_eventos')))) AS colisiones,
    (SELECT LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),'')) FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc
        ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='cont_cuentas_rol'
        AND tc.CONSTRAINT_TYPE='CHECK' AND cc.CONSTRAINT_NAME='ck_cont_rol_valido' LIMIT 1) AS check_rol
  FROM contexto
),
variante AS (
  SELECT metadata.*,
    CASE WHEN n_roles=0 THEN 'AUSENTE'
      WHEN roles_tabla_ok AND check_rol='rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'')' THEN 'HISTORICO'
      WHEN roles_tabla_ok AND check_rol='rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'',''ventas_bienes'')' THEN 'ACTUAL'
      ELSE 'DESCONOCIDO' END AS variante_roles,
    (check_rol IN ('rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'')','rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'',''ventas_bienes'')')) AS roles_check_ok
  FROM metadata
),
datos AS (
  SELECT variante.*, (NOT EXISTS (SELECT 1 FROM cont_cuentas_rol r
    LEFT JOIN cont_cuentas c ON c.empresa_id=r.empresa_id AND c.entidad_id=r.entidad_id AND c.id=r.cuenta_id
    LEFT JOIN cont_entidades e ON e.empresa_id=r.empresa_id AND e.id=r.entidad_id
    WHERE c.id IS NULL OR e.id IS NULL OR r.activa NOT IN (0,1)
      OR r.rol NOT IN ('CLIENTES','IVA_POR_PAGAR','VENTAS_SERVICIOS','RETENCION_IVA','TRANSITO_BANCARIO','ANTICIPOS','DEVOLUCIONES_VENTAS','VENTAS_BIENES')
      OR (variante_roles='HISTORICO' AND r.rol='VENTAS_BIENES'))) AS roles_datos_ok, (TRUE) AS eventos_datos_ok FROM variante
)
SELECT CASE WHEN esquema_objetivo IS NOT NULL AND mariadb_ok AND fk_checks_ok AND check_constraints_ok
    AND padres_ok AND NOT colisiones AND roles_datos_ok AND eventos_datos_ok AND n_roles=1 AND n_eventos=0 AND variante_roles='HISTORICO'
    THEN 'APTO_COMPATIBILIDAD' ELSE 'DETENER' END AS resultado_preflight,
  variante_roles, mariadb_ok, fk_checks_ok, check_constraints_ok, padres_ok,
  roles_tabla_ok, roles_check_ok, roles_datos_ok, eventos_tabla_ok, eventos_datos_ok,
  CASE WHEN n_eventos=0 THEN 'AUSENTE' WHEN eventos_tabla_ok THEN 'ACTUAL' ELSE 'DESCONOCIDO' END AS eventos_estado,
  esquema_objetivo, version_servidor
FROM datos;
-- FIN_GATE_HISTORICO

-- PASO 1B: ACTUAL, ambas tablas existen. Copiar SOLO esta consulta fuera del comentario para ejecutar.
/* INICIO_GATE_ACTUAL
WITH
contexto AS (
  SELECT DATABASE() AS esquema_objetivo, VERSION() AS version_servidor,
    (VERSION() LIKE '%MariaDB%') AS mariadb_ok, (@@foreign_key_checks=1) AS fk_checks_ok,
    (@@check_constraint_checks=1) AS check_constraints_ok,
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol') AS n_roles,
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos') AS n_eventos
),
metadata AS (
  SELECT contexto.*,
    (SELECT COUNT(*) = 6 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('empresas','usuarios','cont_entidades','cont_cuentas','cont_asientos','fact_facturas') AND ENGINE = 'InnoDB')
    AND (SELECT COUNT(*) = 6 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('empresas','usuarios','cont_entidades','cont_cuentas','cont_asientos','fact_facturas')
        AND COLUMN_NAME='id' AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND COLUMN_KEY='PRI')
    AND (SELECT COUNT(*) = 3 FROM (
      SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE=0
        AND TABLE_NAME IN ('cont_entidades','cont_cuentas','cont_asientos')
      GROUP BY TABLE_NAME, INDEX_NAME
    ) p WHERE (TABLE_NAME='cont_entidades' AND cols='empresa_id,id')
       OR (TABLE_NAME IN ('cont_cuentas','cont_asientos') AND cols='empresa_id,entidad_id,id'))
    AND (SELECT COUNT(*)=7 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
      AND ((TABLE_NAME IN ('cont_cuentas','cont_asientos','fact_facturas') AND COLUMN_NAME IN ('empresa_id','entidad_id'))
        OR (TABLE_NAME='cont_entidades' AND COLUMN_NAME='empresa_id'))
      AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%') AS padres_ok,
    (EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol'
      AND ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_uca1400_ai_ci')
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol')=8
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol' AND IS_NULLABLE='NO'
      AND (COLUMN_NAME IN ('activa','creado_en','actualizado_en') OR COLUMN_DEFAULT IS NULL) AND (
      (COLUMN_NAME='id' AND ORDINAL_POSITION=1 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND EXTRA='auto_increment') OR
      (COLUMN_NAME='empresa_id' AND ORDINAL_POSITION=2 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND EXTRA='') OR
      (COLUMN_NAME='entidad_id' AND ORDINAL_POSITION=3 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND EXTRA='') OR
      (COLUMN_NAME='rol' AND ORDINAL_POSITION=4 AND COLUMN_TYPE='varchar(40)' AND COLLATION_NAME='utf8mb4_uca1400_ai_ci' AND EXTRA='') OR
      (COLUMN_NAME='cuenta_id' AND ORDINAL_POSITION=5 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND EXTRA='') OR
      (COLUMN_NAME='activa' AND ORDINAL_POSITION=6 AND COLUMN_TYPE='tinyint(1)' AND COLUMN_DEFAULT='1' AND EXTRA='') OR
      (COLUMN_NAME='creado_en' AND ORDINAL_POSITION=7 AND DATA_TYPE='datetime' AND LOWER(REPLACE(COLUMN_DEFAULT,'()',''))='current_timestamp' AND EXTRA='') OR
      (COLUMN_NAME='actualizado_en' AND ORDINAL_POSITION=8 AND DATA_TYPE='datetime' AND LOWER(REPLACE(COLUMN_DEFAULT,'()',''))='current_timestamp' AND LOWER(REPLACE(EXTRA,'()',''))='on update current_timestamp')
    ))=8
    AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol')=3
    AND (SELECT COUNT(*) FROM (
      SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols,
        SUM(SUB_PART IS NOT NULL) prefijos FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol'
      GROUP BY INDEX_NAME,NON_UNIQUE
    ) i WHERE prefijos=0 AND ((INDEX_NAME='PRIMARY' AND NON_UNIQUE=0 AND cols='id')
      OR (INDEX_NAME='uq_cont_cuentas_rol' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,rol')
      OR (INDEX_NAME='idx_cont_cuentas_rol_cuenta' AND NON_UNIQUE=1 AND cols='empresa_id,entidad_id,cuenta_id')))=3
    AND (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol')=2
    AND (SELECT COUNT(*) FROM (
      SELECT k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME,
        GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) cols,
        GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) destino
      FROM information_schema.KEY_COLUMN_USAGE k WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME='cont_cuentas_rol'
        AND k.REFERENCED_TABLE_SCHEMA=DATABASE() GROUP BY k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME
    ) f JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=DATABASE() AND r.TABLE_NAME='cont_cuentas_rol' AND r.CONSTRAINT_NAME=f.CONSTRAINT_NAME
    WHERE r.DELETE_RULE='RESTRICT' AND r.UPDATE_RULE='RESTRICT' AND r.MATCH_OPTION='NONE' AND
      ((f.CONSTRAINT_NAME='fk_cont_rol_entidad' AND f.REFERENCED_TABLE_NAME='cont_entidades' AND cols='empresa_id,entidad_id' AND destino='empresa_id,id')
       OR (f.CONSTRAINT_NAME='fk_cont_rol_cuenta' AND f.REFERENCED_TABLE_NAME='cont_cuentas' AND cols='empresa_id,entidad_id,cuenta_id' AND destino='empresa_id,entidad_id,id')))=2
    AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='cont_cuentas_rol' AND tc.CONSTRAINT_TYPE='CHECK')=1
    AND NOT EXISTS (SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='cont_cuentas_rol')) AS roles_tabla_ok,
    (EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos'
      AND ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_uca1400_ai_ci')
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos')=13
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos'
      AND (COLUMN_NAME='creado_en' OR COLUMN_DEFAULT IS NULL OR (COLUMN_NAME='evento_origen_id' AND COLUMN_DEFAULT='NULL')) AND (
      (COLUMN_NAME='id' AND ORDINAL_POSITION=1 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='auto_increment') OR
      (COLUMN_NAME='empresa_id' AND ORDINAL_POSITION=2 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='entidad_id' AND ORDINAL_POSITION=3 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='factura_id' AND ORDINAL_POSITION=4 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='tipo_evento' AND ORDINAL_POSITION=5 AND COLUMN_TYPE='varchar(40)' AND COLLATION_NAME='utf8mb4_uca1400_ai_ci' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='evento_origen_id' AND ORDINAL_POSITION=6 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='YES' AND EXTRA='') OR
      (COLUMN_NAME='asiento_id' AND ORDINAL_POSITION=7 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='clave_evento' AND ORDINAL_POSITION=8 AND COLUMN_TYPE='varchar(120)' AND COLLATION_NAME='ascii_bin' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='huella' AND ORDINAL_POSITION=9 AND COLUMN_TYPE='char(64)' AND COLLATION_NAME='ascii_bin' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='fecha_contable' AND ORDINAL_POSITION=10 AND DATA_TYPE='date' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='datos_snapshot' AND ORDINAL_POSITION=11 AND DATA_TYPE='longtext' AND COLLATION_NAME='utf8mb4_bin' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='creado_por' AND ORDINAL_POSITION=12 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='creado_en' AND ORDINAL_POSITION=13 AND DATA_TYPE='datetime' AND LOWER(REPLACE(COLUMN_DEFAULT,'()',''))='current_timestamp' AND IS_NULLABLE='NO' AND EXTRA='')
    ))=13
    AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos')=8
    AND (SELECT COUNT(*) FROM (
      SELECT INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols,SUM(SUB_PART IS NOT NULL) prefijos
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos' GROUP BY INDEX_NAME,NON_UNIQUE
    ) i WHERE prefijos=0 AND (
      (INDEX_NAME='PRIMARY' AND NON_UNIQUE=0 AND cols='id') OR
      (INDEX_NAME='uq_cont_evento_clave' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,clave_evento') OR
      (INDEX_NAME='uq_cont_evento_asiento' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,asiento_id') OR
      (INDEX_NAME='uq_cont_evento_ambito' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,factura_id,id') OR
      (INDEX_NAME='idx_cont_evento_factura' AND NON_UNIQUE=1 AND cols='empresa_id,entidad_id,factura_id,tipo_evento') OR
      (INDEX_NAME='idx_cont_evento_origen' AND NON_UNIQUE=1 AND cols='empresa_id,entidad_id,factura_id,evento_origen_id') OR
      (INDEX_NAME='fk_cont_evento_factura' AND NON_UNIQUE=1 AND cols='factura_id') OR
      (INDEX_NAME='fk_cont_evento_actor' AND NON_UNIQUE=1 AND cols='creado_por')
    ))=8
    AND (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos')=5
    AND (SELECT COUNT(*) FROM (
      SELECT k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME,GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) cols,
        GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) destino
      FROM information_schema.KEY_COLUMN_USAGE k WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME='cont_eventos'
        AND k.REFERENCED_TABLE_SCHEMA=DATABASE() GROUP BY k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME
    ) f JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=DATABASE() AND r.TABLE_NAME='cont_eventos' AND r.CONSTRAINT_NAME=f.CONSTRAINT_NAME
      WHERE r.DELETE_RULE='RESTRICT' AND r.UPDATE_RULE='RESTRICT' AND r.MATCH_OPTION='NONE' AND (
      (f.CONSTRAINT_NAME='fk_cont_evento_entidad' AND f.REFERENCED_TABLE_NAME='cont_entidades' AND cols='empresa_id,entidad_id' AND destino='empresa_id,id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_factura' AND f.REFERENCED_TABLE_NAME='fact_facturas' AND cols='factura_id' AND destino='id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_asiento' AND f.REFERENCED_TABLE_NAME='cont_asientos' AND cols='empresa_id,entidad_id,asiento_id' AND destino='empresa_id,entidad_id,id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_origen' AND f.REFERENCED_TABLE_NAME='cont_eventos' AND cols='empresa_id,entidad_id,factura_id,evento_origen_id' AND destino='empresa_id,entidad_id,factura_id,id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_actor' AND f.REFERENCED_TABLE_NAME='usuarios' AND cols='creado_por' AND destino='id')
    ))=5
    AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='cont_eventos' AND tc.CONSTRAINT_TYPE='CHECK')=5
    AND NOT EXISTS (SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='cont_eventos')) AND (SELECT COUNT(*)=5 FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='cont_eventos' AND tc.CONSTRAINT_TYPE='CHECK' AND (
        (cc.CONSTRAINT_NAME='datos_snapshot' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='json_valid(datos_snapshot)') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_tipo' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='tipo_eventoin(''factura_emitida'',''cobro_confirmado'',''retencion_no_emitida'')') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_origen' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='tipo_evento=''factura_emitida''andevento_origen_idisnullortipo_evento=''retencion_no_emitida''andevento_origen_idisnotnull') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_huella' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='huellaregexp''^[0-9a-f]{64}$''') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_snapshot' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='json_valid(datos_snapshot)andjson_value(datos_snapshot,''$.version'')isnotnullandjson_value(datos_snapshot,''$.version'')=1'))) AS eventos_tabla_ok,
    (EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND ((CONSTRAINT_NAME IN ('fk_cont_rol_entidad','fk_cont_rol_cuenta','ck_cont_rol_valido') AND TABLE_NAME<>'cont_cuentas_rol')
      OR (CONSTRAINT_NAME IN ('fk_cont_evento_entidad','fk_cont_evento_factura','fk_cont_evento_asiento','fk_cont_evento_origen','fk_cont_evento_actor','ck_cont_evento_tipo','ck_cont_evento_origen','ck_cont_evento_huella','ck_cont_evento_snapshot') AND TABLE_NAME<>'cont_eventos')))) AS colisiones,
    (SELECT LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),'')) FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc
        ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='cont_cuentas_rol'
        AND tc.CONSTRAINT_TYPE='CHECK' AND cc.CONSTRAINT_NAME='ck_cont_rol_valido' LIMIT 1) AS check_rol
  FROM contexto
),
variante AS (
  SELECT metadata.*,
    CASE WHEN n_roles=0 THEN 'AUSENTE'
      WHEN roles_tabla_ok AND check_rol='rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'')' THEN 'HISTORICO'
      WHEN roles_tabla_ok AND check_rol='rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'',''ventas_bienes'')' THEN 'ACTUAL'
      ELSE 'DESCONOCIDO' END AS variante_roles,
    (check_rol IN ('rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'')','rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'',''ventas_bienes'')')) AS roles_check_ok
  FROM metadata
),
datos AS (
  SELECT variante.*, (NOT EXISTS (SELECT 1 FROM cont_cuentas_rol r
    LEFT JOIN cont_cuentas c ON c.empresa_id=r.empresa_id AND c.entidad_id=r.entidad_id AND c.id=r.cuenta_id
    LEFT JOIN cont_entidades e ON e.empresa_id=r.empresa_id AND e.id=r.entidad_id
    WHERE c.id IS NULL OR e.id IS NULL OR r.activa NOT IN (0,1)
      OR r.rol NOT IN ('CLIENTES','IVA_POR_PAGAR','VENTAS_SERVICIOS','RETENCION_IVA','TRANSITO_BANCARIO','ANTICIPOS','DEVOLUCIONES_VENTAS','VENTAS_BIENES')
      OR (variante_roles='HISTORICO' AND r.rol='VENTAS_BIENES'))) AS roles_datos_ok, (NOT EXISTS (SELECT 1 FROM cont_eventos ev
    LEFT JOIN fact_facturas f ON f.id=ev.factura_id AND f.empresa_id=ev.empresa_id AND f.entidad_id=ev.entidad_id
    LEFT JOIN cont_asientos a ON a.id=ev.asiento_id AND a.empresa_id=ev.empresa_id AND a.entidad_id=ev.entidad_id
    WHERE f.id IS NULL OR a.id IS NULL)) AS eventos_datos_ok FROM variante
)
SELECT CASE WHEN esquema_objetivo IS NOT NULL AND mariadb_ok AND fk_checks_ok AND check_constraints_ok
    AND padres_ok AND NOT colisiones AND roles_datos_ok AND eventos_datos_ok AND n_roles=1 AND n_eventos=1 AND variante_roles='ACTUAL' AND eventos_tabla_ok
    THEN 'NOOP' ELSE 'DETENER' END AS resultado_preflight,
  variante_roles, mariadb_ok, fk_checks_ok, check_constraints_ok, padres_ok,
  roles_tabla_ok, roles_check_ok, roles_datos_ok, eventos_tabla_ok, eventos_datos_ok,
  CASE WHEN n_eventos=0 THEN 'AUSENTE' WHEN eventos_tabla_ok THEN 'ACTUAL' ELSE 'DESCONOCIDO' END AS eventos_estado,
  esquema_objetivo, version_servidor
FROM datos;
FIN_GATE_ACTUAL */

-- PASO 1C: NUEVO, ambas tablas ausentes. Copiar SOLO esta consulta fuera del comentario para ejecutar.
/* INICIO_GATE_NUEVO
WITH
contexto AS (
  SELECT DATABASE() AS esquema_objetivo, VERSION() AS version_servidor,
    (VERSION() LIKE '%MariaDB%') AS mariadb_ok, (@@foreign_key_checks=1) AS fk_checks_ok,
    (@@check_constraint_checks=1) AS check_constraints_ok,
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol') AS n_roles,
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos') AS n_eventos
),
metadata AS (
  SELECT contexto.*,
    (SELECT COUNT(*) = 6 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('empresas','usuarios','cont_entidades','cont_cuentas','cont_asientos','fact_facturas') AND ENGINE = 'InnoDB')
    AND (SELECT COUNT(*) = 6 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('empresas','usuarios','cont_entidades','cont_cuentas','cont_asientos','fact_facturas')
        AND COLUMN_NAME='id' AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND COLUMN_KEY='PRI')
    AND (SELECT COUNT(*) = 3 FROM (
      SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND NON_UNIQUE=0
        AND TABLE_NAME IN ('cont_entidades','cont_cuentas','cont_asientos')
      GROUP BY TABLE_NAME, INDEX_NAME
    ) p WHERE (TABLE_NAME='cont_entidades' AND cols='empresa_id,id')
       OR (TABLE_NAME IN ('cont_cuentas','cont_asientos') AND cols='empresa_id,entidad_id,id'))
    AND (SELECT COUNT(*)=7 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
      AND ((TABLE_NAME IN ('cont_cuentas','cont_asientos','fact_facturas') AND COLUMN_NAME IN ('empresa_id','entidad_id'))
        OR (TABLE_NAME='cont_entidades' AND COLUMN_NAME='empresa_id'))
      AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%') AS padres_ok,
    (EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol'
      AND ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_uca1400_ai_ci')
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol')=8
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol' AND IS_NULLABLE='NO'
      AND (COLUMN_NAME IN ('activa','creado_en','actualizado_en') OR COLUMN_DEFAULT IS NULL) AND (
      (COLUMN_NAME='id' AND ORDINAL_POSITION=1 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND EXTRA='auto_increment') OR
      (COLUMN_NAME='empresa_id' AND ORDINAL_POSITION=2 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND EXTRA='') OR
      (COLUMN_NAME='entidad_id' AND ORDINAL_POSITION=3 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND EXTRA='') OR
      (COLUMN_NAME='rol' AND ORDINAL_POSITION=4 AND COLUMN_TYPE='varchar(40)' AND COLLATION_NAME='utf8mb4_uca1400_ai_ci' AND EXTRA='') OR
      (COLUMN_NAME='cuenta_id' AND ORDINAL_POSITION=5 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND EXTRA='') OR
      (COLUMN_NAME='activa' AND ORDINAL_POSITION=6 AND COLUMN_TYPE='tinyint(1)' AND COLUMN_DEFAULT='1' AND EXTRA='') OR
      (COLUMN_NAME='creado_en' AND ORDINAL_POSITION=7 AND DATA_TYPE='datetime' AND LOWER(REPLACE(COLUMN_DEFAULT,'()',''))='current_timestamp' AND EXTRA='') OR
      (COLUMN_NAME='actualizado_en' AND ORDINAL_POSITION=8 AND DATA_TYPE='datetime' AND LOWER(REPLACE(COLUMN_DEFAULT,'()',''))='current_timestamp' AND LOWER(REPLACE(EXTRA,'()',''))='on update current_timestamp')
    ))=8
    AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol')=3
    AND (SELECT COUNT(*) FROM (
      SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols,
        SUM(SUB_PART IS NOT NULL) prefijos FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol'
      GROUP BY INDEX_NAME,NON_UNIQUE
    ) i WHERE prefijos=0 AND ((INDEX_NAME='PRIMARY' AND NON_UNIQUE=0 AND cols='id')
      OR (INDEX_NAME='uq_cont_cuentas_rol' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,rol')
      OR (INDEX_NAME='idx_cont_cuentas_rol_cuenta' AND NON_UNIQUE=1 AND cols='empresa_id,entidad_id,cuenta_id')))=3
    AND (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas_rol')=2
    AND (SELECT COUNT(*) FROM (
      SELECT k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME,
        GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) cols,
        GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) destino
      FROM information_schema.KEY_COLUMN_USAGE k WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME='cont_cuentas_rol'
        AND k.REFERENCED_TABLE_SCHEMA=DATABASE() GROUP BY k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME
    ) f JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=DATABASE() AND r.TABLE_NAME='cont_cuentas_rol' AND r.CONSTRAINT_NAME=f.CONSTRAINT_NAME
    WHERE r.DELETE_RULE='RESTRICT' AND r.UPDATE_RULE='RESTRICT' AND r.MATCH_OPTION='NONE' AND
      ((f.CONSTRAINT_NAME='fk_cont_rol_entidad' AND f.REFERENCED_TABLE_NAME='cont_entidades' AND cols='empresa_id,entidad_id' AND destino='empresa_id,id')
       OR (f.CONSTRAINT_NAME='fk_cont_rol_cuenta' AND f.REFERENCED_TABLE_NAME='cont_cuentas' AND cols='empresa_id,entidad_id,cuenta_id' AND destino='empresa_id,entidad_id,id')))=2
    AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='cont_cuentas_rol' AND tc.CONSTRAINT_TYPE='CHECK')=1
    AND NOT EXISTS (SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='cont_cuentas_rol')) AS roles_tabla_ok,
    (EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos'
      AND ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_uca1400_ai_ci')
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos')=13
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos'
      AND (COLUMN_NAME='creado_en' OR COLUMN_DEFAULT IS NULL OR (COLUMN_NAME='evento_origen_id' AND COLUMN_DEFAULT='NULL')) AND (
      (COLUMN_NAME='id' AND ORDINAL_POSITION=1 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='auto_increment') OR
      (COLUMN_NAME='empresa_id' AND ORDINAL_POSITION=2 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='entidad_id' AND ORDINAL_POSITION=3 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='factura_id' AND ORDINAL_POSITION=4 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='tipo_evento' AND ORDINAL_POSITION=5 AND COLUMN_TYPE='varchar(40)' AND COLLATION_NAME='utf8mb4_uca1400_ai_ci' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='evento_origen_id' AND ORDINAL_POSITION=6 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='YES' AND EXTRA='') OR
      (COLUMN_NAME='asiento_id' AND ORDINAL_POSITION=7 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='clave_evento' AND ORDINAL_POSITION=8 AND COLUMN_TYPE='varchar(120)' AND COLLATION_NAME='ascii_bin' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='huella' AND ORDINAL_POSITION=9 AND COLUMN_TYPE='char(64)' AND COLLATION_NAME='ascii_bin' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='fecha_contable' AND ORDINAL_POSITION=10 AND DATA_TYPE='date' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='datos_snapshot' AND ORDINAL_POSITION=11 AND DATA_TYPE='longtext' AND COLLATION_NAME='utf8mb4_bin' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='creado_por' AND ORDINAL_POSITION=12 AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND EXTRA='') OR
      (COLUMN_NAME='creado_en' AND ORDINAL_POSITION=13 AND DATA_TYPE='datetime' AND LOWER(REPLACE(COLUMN_DEFAULT,'()',''))='current_timestamp' AND IS_NULLABLE='NO' AND EXTRA='')
    ))=13
    AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos')=8
    AND (SELECT COUNT(*) FROM (
      SELECT INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols,SUM(SUB_PART IS NOT NULL) prefijos
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos' GROUP BY INDEX_NAME,NON_UNIQUE
    ) i WHERE prefijos=0 AND (
      (INDEX_NAME='PRIMARY' AND NON_UNIQUE=0 AND cols='id') OR
      (INDEX_NAME='uq_cont_evento_clave' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,clave_evento') OR
      (INDEX_NAME='uq_cont_evento_asiento' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,asiento_id') OR
      (INDEX_NAME='uq_cont_evento_ambito' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,factura_id,id') OR
      (INDEX_NAME='idx_cont_evento_factura' AND NON_UNIQUE=1 AND cols='empresa_id,entidad_id,factura_id,tipo_evento') OR
      (INDEX_NAME='idx_cont_evento_origen' AND NON_UNIQUE=1 AND cols='empresa_id,entidad_id,factura_id,evento_origen_id') OR
      (INDEX_NAME='fk_cont_evento_factura' AND NON_UNIQUE=1 AND cols='factura_id') OR
      (INDEX_NAME='fk_cont_evento_actor' AND NON_UNIQUE=1 AND cols='creado_por')
    ))=8
    AND (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='cont_eventos')=5
    AND (SELECT COUNT(*) FROM (
      SELECT k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME,GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) cols,
        GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) destino
      FROM information_schema.KEY_COLUMN_USAGE k WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME='cont_eventos'
        AND k.REFERENCED_TABLE_SCHEMA=DATABASE() GROUP BY k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME
    ) f JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=DATABASE() AND r.TABLE_NAME='cont_eventos' AND r.CONSTRAINT_NAME=f.CONSTRAINT_NAME
      WHERE r.DELETE_RULE='RESTRICT' AND r.UPDATE_RULE='RESTRICT' AND r.MATCH_OPTION='NONE' AND (
      (f.CONSTRAINT_NAME='fk_cont_evento_entidad' AND f.REFERENCED_TABLE_NAME='cont_entidades' AND cols='empresa_id,entidad_id' AND destino='empresa_id,id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_factura' AND f.REFERENCED_TABLE_NAME='fact_facturas' AND cols='factura_id' AND destino='id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_asiento' AND f.REFERENCED_TABLE_NAME='cont_asientos' AND cols='empresa_id,entidad_id,asiento_id' AND destino='empresa_id,entidad_id,id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_origen' AND f.REFERENCED_TABLE_NAME='cont_eventos' AND cols='empresa_id,entidad_id,factura_id,evento_origen_id' AND destino='empresa_id,entidad_id,factura_id,id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_actor' AND f.REFERENCED_TABLE_NAME='usuarios' AND cols='creado_por' AND destino='id')
    ))=5
    AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='cont_eventos' AND tc.CONSTRAINT_TYPE='CHECK')=5
    AND NOT EXISTS (SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='cont_eventos')) AND (SELECT COUNT(*)=5 FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='cont_eventos' AND tc.CONSTRAINT_TYPE='CHECK' AND (
        (cc.CONSTRAINT_NAME='datos_snapshot' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='json_valid(datos_snapshot)') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_tipo' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='tipo_eventoin(''factura_emitida'',''cobro_confirmado'',''retencion_no_emitida'')') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_origen' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='tipo_evento=''factura_emitida''andevento_origen_idisnullortipo_evento=''retencion_no_emitida''andevento_origen_idisnotnull') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_huella' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='huellaregexp''^[0-9a-f]{64}$''') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_snapshot' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='json_valid(datos_snapshot)andjson_value(datos_snapshot,''$.version'')isnotnullandjson_value(datos_snapshot,''$.version'')=1'))) AS eventos_tabla_ok,
    (EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
    AND ((CONSTRAINT_NAME IN ('fk_cont_rol_entidad','fk_cont_rol_cuenta','ck_cont_rol_valido') AND TABLE_NAME<>'cont_cuentas_rol')
      OR (CONSTRAINT_NAME IN ('fk_cont_evento_entidad','fk_cont_evento_factura','fk_cont_evento_asiento','fk_cont_evento_origen','fk_cont_evento_actor','ck_cont_evento_tipo','ck_cont_evento_origen','ck_cont_evento_huella','ck_cont_evento_snapshot') AND TABLE_NAME<>'cont_eventos')))) AS colisiones,
    (SELECT LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),'')) FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc
        ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME='cont_cuentas_rol'
        AND tc.CONSTRAINT_TYPE='CHECK' AND cc.CONSTRAINT_NAME='ck_cont_rol_valido' LIMIT 1) AS check_rol
  FROM contexto
),
variante AS (
  SELECT metadata.*,
    CASE WHEN n_roles=0 THEN 'AUSENTE'
      WHEN roles_tabla_ok AND check_rol='rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'')' THEN 'HISTORICO'
      WHEN roles_tabla_ok AND check_rol='rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'',''ventas_bienes'')' THEN 'ACTUAL'
      ELSE 'DESCONOCIDO' END AS variante_roles,
    (check_rol IN ('rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'')','rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'',''ventas_bienes'')')) AS roles_check_ok
  FROM metadata
),
datos AS (
  SELECT variante.*, (TRUE) AS roles_datos_ok, (TRUE) AS eventos_datos_ok FROM variante
)
SELECT CASE WHEN esquema_objetivo IS NOT NULL AND mariadb_ok AND fk_checks_ok AND check_constraints_ok
    AND padres_ok AND NOT colisiones AND roles_datos_ok AND eventos_datos_ok AND n_roles=0 AND n_eventos=0
    THEN 'APTO_NUEVO' ELSE 'DETENER' END AS resultado_preflight,
  variante_roles, mariadb_ok, fk_checks_ok, check_constraints_ok, padres_ok,
  roles_tabla_ok, roles_check_ok, roles_datos_ok, eventos_tabla_ok, eventos_datos_ok,
  CASE WHEN n_eventos=0 THEN 'AUSENTE' WHEN eventos_tabla_ok THEN 'ACTUAL' ELSE 'DESCONOCIDO' END AS eventos_estado,
  esquema_objetivo, version_servidor
FROM datos;
FIN_GATE_NUEVO */

-- PASO 2: evidencia estructura, ejecutar cada sentencia por separado; solo para tablas existentes.
SHOW CREATE TABLE cont_cuentas_rol;
SHOW FULL COLUMNS FROM cont_cuentas_rol;
SHOW INDEX FROM cont_cuentas_rol;
SHOW TABLE STATUS WHERE Name IN ('empresas','usuarios','cont_entidades','cont_cuentas','cont_asientos','fact_facturas','cont_cuentas_rol','cont_eventos');
-- Si cont_eventos existe: SHOW CREATE TABLE cont_eventos;
-- PASO 3: evidencia datos; solo si cont_cuentas_rol existe.
SELECT * FROM cont_cuentas_rol ORDER BY id;
SELECT rol, COUNT(*) AS cantidad FROM cont_cuentas_rol GROUP BY rol ORDER BY rol;
-- No ejecutar migrate hasta obtener resultado esperado, revisar DDL y conservar filas para comparar.
