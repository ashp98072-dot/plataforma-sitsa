-- =====================================================================
-- VERIFICACIÓN POSTERIOR (SOLO LECTURA) — Control de entrega de documentos (PR 1: base común)
-- Archivo: sql/verificar-2026-10-documento-entregas.sql
--
-- NO modifica nada: solo SELECT/SHOW. Ejecutar DESPUÉS de sql/migrate-2026-10-documento-entregas.sql.
-- ESQUEMA EXPLÍCITO `u611730801_Plataforma`; sin DATABASE() ni ROW_COUNT().
--
-- La compuerta (consulta 5) compara DEFINICIONES, no solo conteos: tipo/longitud/nulabilidad de las 33 columnas, columna generada
-- persistente, columnas e índices UNIQUE en su orden, destino de cada FK (y ON DELETE RESTRICT), nombres de las 11 CHECK y
-- el contenido de las críticas. Esto detecta, p. ej., una tabla creada antes con una definición anterior (CREATE TABLE IF NOT
-- EXISTS no la actualiza) aunque conserve los mismos conteos.
-- =====================================================================

-- 1) Estructura completa (revisión visual).
SHOW CREATE TABLE u611730801_Plataforma.documento_entregas;

-- 2) Columnas reales (33). `pendiente_documento` debe ser generada y persistente (EXTRA = 'STORED GENERATED' / 'PERSISTENT').
SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, GENERATION_EXPRESSION
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'documento_entregas'
ORDER BY ORDINAL_POSITION;

-- 3) Índices (orden de columnas real).
SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'documento_entregas'
GROUP BY INDEX_NAME, NON_UNIQUE
ORDER BY NON_UNIQUE, INDEX_NAME;

-- 4) Restricciones y FK reales.
SELECT tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE
FROM information_schema.TABLE_CONSTRAINTS tc
LEFT JOIN information_schema.KEY_COLUMN_USAGE k
       ON k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND k.TABLE_NAME = tc.TABLE_NAME AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
      AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY'
LEFT JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND r.TABLE_NAME = tc.TABLE_NAME AND r.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
WHERE tc.CONSTRAINT_SCHEMA = 'u611730801_Plataforma' AND tc.TABLE_NAME = 'documento_entregas'
ORDER BY tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME;

-- 5) COMPUERTA. 'ESTRUCTURA OK' solo si TODA columna de abajo vale 1 (columnas_con_diferencias, constraints_extra y
--    columnas_sobrantes valen 0). Si no, revisar las consultas 1-4 contra sql/migrate-2026-10-documento-entregas.sql.
SELECT c.*,
       IF(c.tabla_innodb = 1 AND c.columnas_total = 33 AND c.columnas_con_diferencias = 0
          AND c.pendiente_generada_persistente = 1
          AND c.uq_empresa_id_ok = 1 AND c.uq_empresa_clave_ok = 1 AND c.uq_pendiente_ok = 1
          AND c.idx_documento_ok = 1 AND c.idx_bandeja_ok = 1
          AND c.constraints_esperadas = 21 AND c.constraints_totales = 22
          AND c.fk_destinos_ok = 7 AND c.fk_totales = 7 AND c.fk_delete_restrict = 7
          AND c.check_recepcion_ok = 1 AND c.check_cierre_ok = 1 AND c.check_rechazo_ok = 1 AND c.check_receptor_ok = 1,
          'ESTRUCTURA OK', 'REVISAR ESTRUCTURA') AS estructura
FROM (
  SELECT
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas' AND ENGINE = 'InnoDB') AS tabla_innodb,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas') AS columnas_total,
    -- Tipo, longitud y nulabilidad esperados de CADA columna (faltantes o distintas cuentan como diferencia).
    (SELECT COUNT(*) FROM (
       SELECT 'id' AS col, 'int' AS tipo, NULL AS largo, 'NO' AS nulo
       UNION ALL SELECT 'empresa_id', 'int', NULL, 'NO'
       UNION ALL SELECT 'modulo', 'varchar', 20, 'NO'
       UNION ALL SELECT 'entidad_tipo', 'varchar', 40, 'NO'
       UNION ALL SELECT 'entidad_id', 'int', NULL, 'NO'
       UNION ALL SELECT 'documento_codigo', 'varchar', 40, 'YES'
       UNION ALL SELECT 'etapa_origen', 'varchar', 20, 'NO'
       UNION ALL SELECT 'etapa_destino', 'varchar', 20, 'NO'
       UNION ALL SELECT 'modo', 'varchar', 12, 'NO'
       UNION ALL SELECT 'estado', 'varchar', 12, 'NO'
       UNION ALL SELECT 'emitido_por_usuario_id', 'int', NULL, 'NO'
       UNION ALL SELECT 'emitido_por_nombre', 'varchar', 200, 'NO'
       UNION ALL SELECT 'emitido_por_rol', 'varchar', 40, 'NO'
       UNION ALL SELECT 'emitido_en', 'datetime', NULL, 'NO'
       UNION ALL SELECT 'firma_emision_id', 'int', NULL, 'NO'
       UNION ALL SELECT 'observaciones_emision', 'varchar', 1000, 'YES'
       UNION ALL SELECT 'recibido_por_usuario_id', 'int', NULL, 'YES'
       UNION ALL SELECT 'recibido_por_nombre', 'varchar', 200, 'YES'
       UNION ALL SELECT 'recibido_por_rol', 'varchar', 40, 'YES'
       UNION ALL SELECT 'recibido_en', 'datetime', NULL, 'YES'
       UNION ALL SELECT 'firma_recepcion_id', 'int', NULL, 'YES'
       UNION ALL SELECT 'observaciones_recepcion', 'varchar', 1000, 'YES'
       UNION ALL SELECT 'recepcion_operada_por_usuario_id', 'int', NULL, 'YES'
       UNION ALL SELECT 'recepcion_operada_por_nombre', 'varchar', 200, 'YES'
       UNION ALL SELECT 'cerrado_por_usuario_id', 'int', NULL, 'YES'
       UNION ALL SELECT 'cerrado_por_nombre', 'varchar', 200, 'YES'
       UNION ALL SELECT 'cerrado_en', 'datetime', NULL, 'YES'
       UNION ALL SELECT 'motivo_cierre', 'varchar', 1000, 'YES'
       UNION ALL SELECT 'clave_idempotencia', 'varchar', 64, 'NO'
       UNION ALL SELECT 'huella_idempotencia', 'char', 64, 'NO'
       UNION ALL SELECT 'pendiente_documento', 'varchar', 40, 'YES'
       UNION ALL SELECT 'creado_en', 'datetime', NULL, 'NO'
       UNION ALL SELECT 'actualizado_en', 'datetime', NULL, 'NO'
     ) e
     LEFT JOIN information_schema.COLUMNS k
            ON k.TABLE_SCHEMA = 'u611730801_Plataforma' AND k.TABLE_NAME = 'documento_entregas' AND k.COLUMN_NAME = e.col
     WHERE k.COLUMN_NAME IS NULL OR k.DATA_TYPE <> e.tipo OR NOT (k.CHARACTER_MAXIMUM_LENGTH <=> e.largo) OR k.IS_NULLABLE <> e.nulo
    ) AS columnas_con_diferencias,
    -- Columna generada, almacenada (no VIRTUAL) y con la expresión esperada (solo EMITIDA, por modulo + entidad_id).
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas' AND COLUMN_NAME = 'pendiente_documento'
      AND (EXTRA LIKE '%STORED%' OR EXTRA LIKE '%PERSISTENT%') AND EXTRA NOT LIKE '%VIRTUAL%'
      AND GENERATION_EXPRESSION LIKE '%EMITIDA%' AND GENERATION_EXPRESSION LIKE '%estado%'
      AND GENERATION_EXPRESSION LIKE '%modulo%' AND GENERATION_EXPRESSION LIKE '%entidad_id%') AS pendiente_generada_persistente,
    -- UNIQUE / índices: NON_UNIQUE y columnas en su orden exacto.
    COALESCE((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'empresa_id,id'
                FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'documento_entregas'
                 AND INDEX_NAME = 'uq_de_empresa_id' AND NON_UNIQUE = 0), 0) AS uq_empresa_id_ok,
    COALESCE((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'empresa_id,clave_idempotencia'
                FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'documento_entregas'
                 AND INDEX_NAME = 'uq_de_empresa_clave' AND NON_UNIQUE = 0), 0) AS uq_empresa_clave_ok,
    COALESCE((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'empresa_id,pendiente_documento'
                FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'documento_entregas'
                 AND INDEX_NAME = 'uq_de_pendiente' AND NON_UNIQUE = 0), 0) AS uq_pendiente_ok,
    COALESCE((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'empresa_id,modulo,entidad_id,id'
                FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'documento_entregas'
                 AND INDEX_NAME = 'idx_de_documento' AND NON_UNIQUE = 1), 0) AS idx_documento_ok,
    COALESCE((SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) = 'empresa_id,estado,modo,modulo,etapa_destino'
                FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'documento_entregas'
                 AND INDEX_NAME = 'idx_de_bandeja' AND NON_UNIQUE = 1), 0) AS idx_bandeja_ok,
    -- Restricciones por nombre: 3 UNIQUE + 7 FK + 11 CHECK = 21 esperadas; con la PRIMARY, 22 en total (ninguna de más).
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas'
      AND CONSTRAINT_NAME IN ('uq_de_empresa_id', 'uq_de_empresa_clave', 'uq_de_pendiente',
                              'fk_de_empresa', 'fk_de_emisor', 'fk_de_receptor', 'fk_de_operador', 'fk_de_cerrado_por',
                              'fk_de_firma_emision', 'fk_de_firma_recepcion',
                              'chk_de_modulo', 'chk_de_entidad_tipo', 'chk_de_etapas', 'chk_de_modo', 'chk_de_estado',
                              'chk_de_recepcion', 'chk_de_cierre', 'chk_de_rechazo_sistema', 'chk_de_receptor_no_emisor',
                              'chk_de_firmas_distintas', 'chk_de_huella')) AS constraints_esperadas,
    (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas') AS constraints_totales,
    -- FK: columna local -> tabla.columna referenciada, y ON DELETE RESTRICT en las 7.
    (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas' AND REFERENCED_TABLE_NAME IS NOT NULL
      AND ((CONSTRAINT_NAME = 'fk_de_empresa' AND COLUMN_NAME = 'empresa_id' AND REFERENCED_TABLE_NAME = 'empresas' AND REFERENCED_COLUMN_NAME = 'id')
        OR (CONSTRAINT_NAME = 'fk_de_emisor' AND COLUMN_NAME = 'emitido_por_usuario_id' AND REFERENCED_TABLE_NAME = 'usuarios' AND REFERENCED_COLUMN_NAME = 'id')
        OR (CONSTRAINT_NAME = 'fk_de_receptor' AND COLUMN_NAME = 'recibido_por_usuario_id' AND REFERENCED_TABLE_NAME = 'usuarios' AND REFERENCED_COLUMN_NAME = 'id')
        OR (CONSTRAINT_NAME = 'fk_de_operador' AND COLUMN_NAME = 'recepcion_operada_por_usuario_id' AND REFERENCED_TABLE_NAME = 'usuarios' AND REFERENCED_COLUMN_NAME = 'id')
        OR (CONSTRAINT_NAME = 'fk_de_cerrado_por' AND COLUMN_NAME = 'cerrado_por_usuario_id' AND REFERENCED_TABLE_NAME = 'usuarios' AND REFERENCED_COLUMN_NAME = 'id')
        OR (CONSTRAINT_NAME = 'fk_de_firma_emision' AND COLUMN_NAME = 'firma_emision_id' AND REFERENCED_TABLE_NAME = 'firmas_electronicas' AND REFERENCED_COLUMN_NAME = 'id')
        OR (CONSTRAINT_NAME = 'fk_de_firma_recepcion' AND COLUMN_NAME = 'firma_recepcion_id' AND REFERENCED_TABLE_NAME = 'firmas_electronicas' AND REFERENCED_COLUMN_NAME = 'id'))) AS fk_destinos_ok,
    (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas' AND REFERENCED_TABLE_NAME IS NOT NULL) AS fk_totales,
    (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas' AND DELETE_RULE = 'RESTRICT') AS fk_delete_restrict,
    -- CHECK críticos: que el contenido sea el vigente (una tabla creada con la definición anterior no los incluiría).
    (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas' AND CONSTRAINT_NAME = 'chk_de_recepcion'
      AND CHECK_CLAUSE LIKE '%recepcion_operada_por_nombre%' AND CHECK_CLAUSE LIKE '%recibido_por_rol%'
      AND CHECK_CLAUSE LIKE '%observaciones_recepcion%' AND CHECK_CLAUSE LIKE '%recibido_por_nombre%'
      AND CHECK_CLAUSE LIKE '%recibido_por_usuario_id%' AND CHECK_CLAUSE LIKE '%firma_recepcion_id%') AS check_recepcion_ok,
    (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas' AND CONSTRAINT_NAME = 'chk_de_cierre'
      AND CHECK_CLAUSE LIKE '%cerrado_por_nombre%' AND CHECK_CLAUSE LIKE '%cerrado_por_usuario_id%'
      AND CHECK_CLAUSE LIKE '%motivo_cierre%' AND CHECK_CLAUSE LIKE '%cerrado_en%') AS check_cierre_ok,
    (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas' AND CONSTRAINT_NAME = 'chk_de_rechazo_sistema'
      AND CHECK_CLAUSE LIKE '%RECHAZADA%' AND CHECK_CLAUSE LIKE '%SISTEMA%') AS check_rechazo_ok,
    (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
      AND TABLE_NAME = 'documento_entregas' AND CONSTRAINT_NAME = 'chk_de_receptor_no_emisor'
      AND CHECK_CLAUSE LIKE '%recibido_por_usuario_id%' AND CHECK_CLAUSE LIKE '%emitido_por_usuario_id%') AS check_receptor_ok
) c;

-- 6) Datos: recién migrada la tabla está VACÍA (la migración no crea filas; esperado 0 hasta que se conecten los módulos).
SELECT COUNT(*) AS entregas FROM u611730801_Plataforma.documento_entregas;

-- 7) Integridad (para reejecutar más adelante; cada consulta debe devolver 0 filas).
--    7a) Más de una entrega pendiente por documento (el UNIQUE lo impide; se comprueba igual).
SELECT empresa_id, modulo, entidad_id, COUNT(*) AS pendientes
FROM u611730801_Plataforma.documento_entregas
WHERE estado = 'EMITIDA'
GROUP BY empresa_id, modulo, entidad_id
HAVING COUNT(*) > 1;
--    7b) Firma de otra empresa, de otro documento o con otra acción (la firma debe ser de la misma empresa y del mismo documento).
--        entidad_tipo se compara como BINARY: firmas_electronicas y documento_entregas pueden tener colaciones distintas.
SELECT de.id, de.empresa_id, fe.empresa_id AS firma_empresa, 'emision' AS firma
FROM u611730801_Plataforma.documento_entregas de
JOIN u611730801_Plataforma.firmas_electronicas fe ON fe.id = de.firma_emision_id
WHERE fe.empresa_id <> de.empresa_id OR fe.entidad_id <> de.entidad_id OR BINARY fe.entidad_tipo <> BINARY de.entidad_tipo OR fe.accion <> 'ENTREGAR_DOCUMENTO'
UNION ALL
SELECT de.id, de.empresa_id, fe.empresa_id, 'recepcion'
FROM u611730801_Plataforma.documento_entregas de
JOIN u611730801_Plataforma.firmas_electronicas fe ON fe.id = de.firma_recepcion_id
WHERE fe.empresa_id <> de.empresa_id OR fe.entidad_id <> de.entidad_id OR BINARY fe.entidad_tipo <> BINARY de.entidad_tipo OR fe.accion <> 'RECIBIR_DOCUMENTO';
--    7c) Documento inexistente en SU empresa (referencia polimórfica: la base no tiene FK al documento).
SELECT de.id, de.empresa_id, de.modulo, de.entidad_id
FROM u611730801_Plataforma.documento_entregas de
WHERE (de.modulo = 'FONDOS' AND NOT EXISTS (SELECT 1 FROM u611730801_Plataforma.tms_solicitudes_fondo d WHERE d.id = de.entidad_id AND d.empresa_id = de.empresa_id))
   OR (de.modulo = 'GASTOS' AND NOT EXISTS (SELECT 1 FROM u611730801_Plataforma.tms_gastos_operativos d WHERE d.id = de.entidad_id AND d.empresa_id = de.empresa_id))
   OR (de.modulo = 'COMPRAS' AND NOT EXISTS (SELECT 1 FROM u611730801_Plataforma.compras_requerimientos d WHERE d.id = de.entidad_id AND d.empresa_id = de.empresa_id));
