-- PR #447: nueva instalación o compatibilidad con variante física confirmada MariaDB 11.8.9.
-- NO ejecutar producción sin preflight/verificación/autorización. Sin seeds/backfill ni cambios de datos.
-- Bloque anónimo: SIGNAL detiene TODO el bloque antes del DDL ante drift. No crea procedimientos.
-- Requiere lectura information_schema; si no hay permisos, DETENER (no retirar la compuerta).
-- DDL no es transacción de negocio: ventana sin cambios concurrentes de esquema/configuración.
DELIMITER //
BEGIN NOT ATOMIC

  DECLARE esquema VARCHAR(64) DEFAULT DATABASE();
  DECLARE rol_estado VARCHAR(20) DEFAULT 'DESCONOCIDO';
  DECLARE eventos_ok BOOLEAN DEFAULT FALSE;
  DECLARE n_roles INT DEFAULT 0;
  DECLARE n_eventos INT DEFAULT 0;
  DECLARE padres_ok BOOLEAN DEFAULT FALSE;
  DECLARE estado VARCHAR(30) DEFAULT 'DETENER';
  DECLARE ck TEXT;
  IF esquema IS NULL OR VERSION() NOT LIKE '%MariaDB%' OR @@foreign_key_checks <> 1 OR @@check_constraint_checks <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DETENER: BD/MariaDB/FK/CHECK no verificados';
  END IF;
  SELECT COUNT(*) = 6 INTO padres_ok FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = esquema AND TABLE_NAME IN ('empresas','usuarios','cont_entidades','cont_cuentas','cont_asientos','fact_facturas') AND ENGINE = 'InnoDB';
  IF padres_ok THEN
    SELECT COUNT(*) = 6 INTO padres_ok FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = esquema AND TABLE_NAME IN ('empresas','usuarios','cont_entidades','cont_cuentas','cont_asientos','fact_facturas')
        AND COLUMN_NAME='id' AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%' AND IS_NULLABLE='NO' AND COLUMN_KEY='PRI';
  END IF;
  IF padres_ok THEN
    SELECT COUNT(*) = 3 INTO padres_ok FROM (
      SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = esquema AND NON_UNIQUE=0
        AND TABLE_NAME IN ('cont_entidades','cont_cuentas','cont_asientos')
      GROUP BY TABLE_NAME, INDEX_NAME
    ) p WHERE (TABLE_NAME='cont_entidades' AND cols='empresa_id,id')
       OR (TABLE_NAME IN ('cont_cuentas','cont_asientos') AND cols='empresa_id,entidad_id,id');
  END IF;
  SELECT COUNT(*) INTO n_roles FROM information_schema.TABLES WHERE TABLE_SCHEMA=esquema AND TABLE_NAME='cont_cuentas_rol';
  IF padres_ok THEN
    SELECT COUNT(*)=7 INTO padres_ok FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=esquema
      AND ((TABLE_NAME IN ('cont_cuentas','cont_asientos','fact_facturas') AND COLUMN_NAME IN ('empresa_id','entidad_id'))
        OR (TABLE_NAME='cont_entidades' AND COLUMN_NAME='empresa_id'))
      AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%';
  END IF;
  SELECT COUNT(*) INTO n_eventos FROM information_schema.TABLES WHERE TABLE_SCHEMA=esquema AND TABLE_NAME='cont_eventos';
  IF n_roles = 0 THEN SET rol_estado='AUSENTE';
  ELSE
    IF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=esquema AND TABLE_NAME='cont_cuentas_rol'
      AND ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_uca1400_ai_ci')
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=esquema AND TABLE_NAME='cont_cuentas_rol')=8
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=esquema AND TABLE_NAME='cont_cuentas_rol' AND IS_NULLABLE='NO'
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
    AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=esquema AND TABLE_NAME='cont_cuentas_rol')=3
    AND (SELECT COUNT(*) FROM (
      SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols,
        SUM(SUB_PART IS NOT NULL) prefijos FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=esquema AND TABLE_NAME='cont_cuentas_rol'
      GROUP BY INDEX_NAME,NON_UNIQUE
    ) i WHERE prefijos=0 AND ((INDEX_NAME='PRIMARY' AND NON_UNIQUE=0 AND cols='id')
      OR (INDEX_NAME='uq_cont_cuentas_rol' AND NON_UNIQUE=0 AND cols='empresa_id,entidad_id,rol')
      OR (INDEX_NAME='idx_cont_cuentas_rol_cuenta' AND NON_UNIQUE=1 AND cols='empresa_id,entidad_id,cuenta_id')))=3
    AND (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=esquema AND TABLE_NAME='cont_cuentas_rol')=2
    AND (SELECT COUNT(*) FROM (
      SELECT k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME,
        GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) cols,
        GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) destino
      FROM information_schema.KEY_COLUMN_USAGE k WHERE k.CONSTRAINT_SCHEMA=esquema AND k.TABLE_NAME='cont_cuentas_rol'
        AND k.REFERENCED_TABLE_SCHEMA=esquema GROUP BY k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME
    ) f JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=esquema AND r.TABLE_NAME='cont_cuentas_rol' AND r.CONSTRAINT_NAME=f.CONSTRAINT_NAME
    WHERE r.DELETE_RULE='RESTRICT' AND r.UPDATE_RULE='RESTRICT' AND r.MATCH_OPTION='NONE' AND
      ((f.CONSTRAINT_NAME='fk_cont_rol_entidad' AND f.REFERENCED_TABLE_NAME='cont_entidades' AND cols='empresa_id,entidad_id' AND destino='empresa_id,id')
       OR (f.CONSTRAINT_NAME='fk_cont_rol_cuenta' AND f.REFERENCED_TABLE_NAME='cont_cuentas' AND cols='empresa_id,entidad_id,cuenta_id' AND destino='empresa_id,entidad_id,id')))=2
    AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=esquema AND tc.TABLE_NAME='cont_cuentas_rol' AND tc.CONSTRAINT_TYPE='CHECK')=1
    AND NOT EXISTS (SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=esquema AND EVENT_OBJECT_TABLE='cont_cuentas_rol')
    THEN
      SELECT LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),'')) INTO ck FROM information_schema.TABLE_CONSTRAINTS tc
        JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
        WHERE tc.CONSTRAINT_SCHEMA=esquema AND tc.TABLE_NAME='cont_cuentas_rol' AND tc.CONSTRAINT_TYPE='CHECK' AND cc.CONSTRAINT_NAME='ck_cont_rol_valido';
      IF ck='rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'')' THEN SET rol_estado='HISTORICO';
      ELSEIF ck='rolin(''clientes'',''iva_por_pagar'',''ventas_servicios'',''retencion_iva'',''transito_bancario'',''anticipos'',''devoluciones_ventas'',''ventas_bienes'')' THEN SET rol_estado='ACTUAL'; END IF;
    END IF;
    IF rol_estado='HISTORICO' AND EXISTS (SELECT 1 FROM cont_cuentas_rol WHERE rol='VENTAS_BIENES') THEN SET rol_estado='DESCONOCIDO'; END IF;
    IF rol_estado IN ('HISTORICO','ACTUAL') THEN
      IF EXISTS (SELECT 1 FROM cont_cuentas_rol r
        LEFT JOIN cont_cuentas c ON c.empresa_id=r.empresa_id AND c.entidad_id=r.entidad_id AND c.id=r.cuenta_id
        LEFT JOIN cont_entidades e ON e.empresa_id=r.empresa_id AND e.id=r.entidad_id
        WHERE c.id IS NULL OR e.id IS NULL OR r.activa NOT IN (0,1)
          OR r.rol NOT IN ('CLIENTES','IVA_POR_PAGAR','VENTAS_SERVICIOS','RETENCION_IVA','TRANSITO_BANCARIO','ANTICIPOS','DEVOLUCIONES_VENTAS','VENTAS_BIENES')) THEN SET rol_estado='DESCONOCIDO'; END IF;
    END IF;
  END IF;

  IF n_eventos=1 THEN
    SELECT EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=esquema AND TABLE_NAME='cont_eventos'
      AND ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_uca1400_ai_ci')
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=esquema AND TABLE_NAME='cont_eventos')=13
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=esquema AND TABLE_NAME='cont_eventos'
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
    AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=esquema AND TABLE_NAME='cont_eventos')=8
    AND (SELECT COUNT(*) FROM (
      SELECT INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols,SUM(SUB_PART IS NOT NULL) prefijos
        FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=esquema AND TABLE_NAME='cont_eventos' GROUP BY INDEX_NAME,NON_UNIQUE
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
    AND (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=esquema AND TABLE_NAME='cont_eventos')=5
    AND (SELECT COUNT(*) FROM (
      SELECT k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME,GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) cols,
        GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) destino
      FROM information_schema.KEY_COLUMN_USAGE k WHERE k.CONSTRAINT_SCHEMA=esquema AND k.TABLE_NAME='cont_eventos'
        AND k.REFERENCED_TABLE_SCHEMA=esquema GROUP BY k.CONSTRAINT_NAME,k.REFERENCED_TABLE_NAME
    ) f JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=esquema AND r.TABLE_NAME='cont_eventos' AND r.CONSTRAINT_NAME=f.CONSTRAINT_NAME
      WHERE r.DELETE_RULE='RESTRICT' AND r.UPDATE_RULE='RESTRICT' AND r.MATCH_OPTION='NONE' AND (
      (f.CONSTRAINT_NAME='fk_cont_evento_entidad' AND f.REFERENCED_TABLE_NAME='cont_entidades' AND cols='empresa_id,entidad_id' AND destino='empresa_id,id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_factura' AND f.REFERENCED_TABLE_NAME='fact_facturas' AND cols='factura_id' AND destino='id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_asiento' AND f.REFERENCED_TABLE_NAME='cont_asientos' AND cols='empresa_id,entidad_id,asiento_id' AND destino='empresa_id,entidad_id,id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_origen' AND f.REFERENCED_TABLE_NAME='cont_eventos' AND cols='empresa_id,entidad_id,factura_id,evento_origen_id' AND destino='empresa_id,entidad_id,factura_id,id') OR
      (f.CONSTRAINT_NAME='fk_cont_evento_actor' AND f.REFERENCED_TABLE_NAME='usuarios' AND cols='creado_por' AND destino='id')
    ))=5
    AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=esquema AND tc.TABLE_NAME='cont_eventos' AND tc.CONSTRAINT_TYPE='CHECK')=5
    AND NOT EXISTS (SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=esquema AND EVENT_OBJECT_TABLE='cont_eventos')
    INTO eventos_ok;
  END IF;

  IF n_eventos=1 AND eventos_ok THEN
    SELECT COUNT(*)=5 INTO eventos_ok FROM information_schema.TABLE_CONSTRAINTS tc
      JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
      WHERE tc.CONSTRAINT_SCHEMA=esquema AND tc.TABLE_NAME='cont_eventos' AND tc.CONSTRAINT_TYPE='CHECK' AND (
        (cc.CONSTRAINT_NAME='datos_snapshot' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='json_valid(datos_snapshot)') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_tipo' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='tipo_eventoin(''factura_emitida'',''cobro_confirmado'',''retencion_no_emitida'')') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_origen' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='tipo_evento=''factura_emitida''andevento_origen_idisnullortipo_evento=''retencion_no_emitida''andevento_origen_idisnotnull') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_huella' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='huellaregexp''^[0-9a-f]{64}$''') OR
        (cc.CONSTRAINT_NAME='ck_cont_evento_snapshot' AND LOWER(REPLACE(REPLACE(REPLACE(REPLACE(cc.CHECK_CLAUSE,'`',''),' ',''),CHAR(10),''),CHAR(13),''))='json_valid(datos_snapshot)andjson_value(datos_snapshot,''$.version'')isnotnullandjson_value(datos_snapshot,''$.version'')=1'));
  END IF;
  IF n_eventos=1 AND eventos_ok THEN
    IF EXISTS (SELECT 1 FROM cont_eventos ev
      LEFT JOIN fact_facturas f ON f.id=ev.factura_id AND f.empresa_id=ev.empresa_id AND f.entidad_id=ev.entidad_id
      LEFT JOIN cont_asientos a ON a.id=ev.asiento_id AND a.empresa_id=ev.empresa_id AND a.entidad_id=ev.entidad_id
      WHERE f.id IS NULL OR a.id IS NULL) THEN SET eventos_ok=FALSE; END IF;
  END IF;
  IF padres_ok AND rol_estado='AUSENTE' AND n_eventos=0 THEN SET estado='APTO_NUEVO';
  ELSEIF padres_ok AND rol_estado='HISTORICO' AND n_eventos=0 THEN SET estado='APTO_COMPATIBILIDAD';
  ELSEIF padres_ok AND rol_estado='ACTUAL' AND eventos_ok THEN SET estado='NOOP'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=esquema
    AND ((CONSTRAINT_NAME IN ('fk_cont_rol_entidad','fk_cont_rol_cuenta','ck_cont_rol_valido') AND TABLE_NAME<>'cont_cuentas_rol')
      OR (CONSTRAINT_NAME IN ('fk_cont_evento_entidad','fk_cont_evento_factura','fk_cont_evento_asiento','fk_cont_evento_origen','fk_cont_evento_actor','ck_cont_evento_tipo','ck_cont_evento_origen','ck_cont_evento_huella','ck_cont_evento_snapshot') AND TABLE_NAME<>'cont_eventos')))
    THEN SET estado='DETENER'; END IF;

  IF estado='DETENER' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: estructura/datos no coinciden con variante confirmada'; END IF;
  IF estado='APTO_NUEVO' THEN
CREATE TABLE IF NOT EXISTS cont_cuentas_rol (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  rol VARCHAR(40) NOT NULL,
  cuenta_id INT NOT NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cont_cuentas_rol (empresa_id, entidad_id, rol),
  KEY idx_cont_cuentas_rol_cuenta (empresa_id, entidad_id, cuenta_id),
  CONSTRAINT fk_cont_rol_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cont_rol_cuenta FOREIGN KEY (empresa_id, entidad_id, cuenta_id) REFERENCES cont_cuentas(empresa_id, entidad_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_cont_rol_valido CHECK (rol IN ('CLIENTES','IVA_POR_PAGAR','VENTAS_SERVICIOS','RETENCION_IVA','TRANSITO_BANCARIO','ANTICIPOS','DEVOLUCIONES_VENTAS','VENTAS_BIENES'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
  ELSEIF estado='APTO_COMPATIBILIDAD' THEN
    ALTER TABLE cont_cuentas_rol
      DROP CONSTRAINT ck_cont_rol_valido,
      ADD CONSTRAINT ck_cont_rol_valido CHECK (rol IN ('CLIENTES','IVA_POR_PAGAR','VENTAS_SERVICIOS','RETENCION_IVA','TRANSITO_BANCARIO','ANTICIPOS','DEVOLUCIONES_VENTAS','VENTAS_BIENES'));
  END IF;
  IF estado IN ('APTO_NUEVO','APTO_COMPATIBILIDAD') THEN
CREATE TABLE IF NOT EXISTS cont_eventos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  factura_id INT NOT NULL,
  tipo_evento VARCHAR(40) NOT NULL,
  evento_origen_id INT NULL,
  asiento_id INT NOT NULL,
  clave_evento VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fecha_contable DATE NOT NULL,
  datos_snapshot JSON NOT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cont_evento_clave (empresa_id, entidad_id, clave_evento),
  UNIQUE KEY uq_cont_evento_asiento (empresa_id, entidad_id, asiento_id),
  UNIQUE KEY uq_cont_evento_ambito (empresa_id, entidad_id, factura_id, id),
  KEY idx_cont_evento_factura (empresa_id, entidad_id, factura_id, tipo_evento),
  KEY idx_cont_evento_origen (empresa_id, entidad_id, factura_id, evento_origen_id),
  CONSTRAINT fk_cont_evento_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- No modifica fact_facturas: FK física simple + comprobación empresa/entidad bajo lock en el helper.
  CONSTRAINT fk_cont_evento_factura FOREIGN KEY (factura_id) REFERENCES fact_facturas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cont_evento_asiento FOREIGN KEY (empresa_id, entidad_id, asiento_id) REFERENCES cont_asientos(empresa_id, entidad_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cont_evento_origen FOREIGN KEY (empresa_id, entidad_id, factura_id, evento_origen_id) REFERENCES cont_eventos(empresa_id, entidad_id, factura_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cont_evento_actor FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_cont_evento_tipo CHECK (tipo_evento IN ('FACTURA_EMITIDA','COBRO_CONFIRMADO','RETENCION_NO_EMITIDA')),
  -- COBRO reservado, imposible insertar hasta añadir confirmación + FK en PR B/D.
  CONSTRAINT ck_cont_evento_origen CHECK (
    (tipo_evento = 'FACTURA_EMITIDA' AND evento_origen_id IS NULL) OR
    (tipo_evento = 'RETENCION_NO_EMITIDA' AND evento_origen_id IS NOT NULL)),
  CONSTRAINT ck_cont_evento_huella CHECK (huella REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_cont_evento_snapshot CHECK (JSON_VALID(datos_snapshot) AND JSON_VALUE(datos_snapshot, '$.version') IS NOT NULL AND JSON_VALUE(datos_snapshot, '$.version') = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
  END IF;
  SELECT estado AS resultado_migracion;
END//
DELIMITER ;
