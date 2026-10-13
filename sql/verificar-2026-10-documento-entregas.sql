-- =====================================================================
-- VERIFICACIÓN POSTERIOR (SOLO LECTURA) — Control de entrega de documentos (PR 1: base común)
-- Archivo: sql/verificar-2026-10-documento-entregas.sql
--
-- NO modifica nada: solo SELECT. Ejecutar DESPUÉS de sql/migrate-2026-10-documento-entregas.sql.
-- ESQUEMA EXPLÍCITO `u611730801_Plataforma`; sin DATABASE() ni ROW_COUNT().
-- =====================================================================

-- 1) Estructura completa (revisión visual).
SHOW CREATE TABLE u611730801_Plataforma.documento_entregas;

-- 2) Columnas: 33 en total; las obligatorias NOT NULL; `pendiente_documento` generada PERSISTENT (EXTRA = 'STORED GENERATED').
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'documento_entregas'
ORDER BY ORDINAL_POSITION;

-- 3) Índices: 3 UNIQUE (uq_de_empresa_id, uq_de_empresa_clave, uq_de_pendiente) + PRIMARY + 2 índices + los de FK.
SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'documento_entregas'
GROUP BY INDEX_NAME, NON_UNIQUE
ORDER BY NON_UNIQUE, INDEX_NAME;

-- 4) Restricciones: 7 FOREIGN KEY y 11 CHECK con prefijo fk_de_/chk_de_.
SELECT CONSTRAINT_TYPE, COUNT(*) AS n, GROUP_CONCAT(CONSTRAINT_NAME ORDER BY CONSTRAINT_NAME) AS nombres
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'documento_entregas'
GROUP BY CONSTRAINT_TYPE;

-- 5) Resumen con compuerta.
SELECT
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
    AND TABLE_NAME = 'documento_entregas' AND ENGINE = 'InnoDB') AS tabla_innodb,
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
    AND TABLE_NAME = 'documento_entregas') AS columnas,
  (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
    AND TABLE_NAME = 'documento_entregas' AND NON_UNIQUE = 0
    AND INDEX_NAME IN ('uq_de_empresa_id', 'uq_de_empresa_clave', 'uq_de_pendiente')) AS unique_nuevos,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
    AND TABLE_NAME = 'documento_entregas' AND CONSTRAINT_TYPE = 'FOREIGN KEY') AS fks,
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
    AND TABLE_NAME = 'documento_entregas' AND CONSTRAINT_TYPE = 'CHECK') AS checks,
  IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
       AND TABLE_NAME = 'documento_entregas' AND ENGINE = 'InnoDB') = 1
     AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
           AND TABLE_NAME = 'documento_entregas') = 33
     AND (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
           AND TABLE_NAME = 'documento_entregas' AND NON_UNIQUE = 0
           AND INDEX_NAME IN ('uq_de_empresa_id', 'uq_de_empresa_clave', 'uq_de_pendiente')) = 3
     AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
           AND TABLE_NAME = 'documento_entregas' AND CONSTRAINT_TYPE = 'FOREIGN KEY') = 7
     AND (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma'
           AND TABLE_NAME = 'documento_entregas' AND CONSTRAINT_TYPE = 'CHECK') = 11,
     'ESTRUCTURA OK', 'REVISAR ESTRUCTURA') AS estructura;

-- 6) Datos: recién migrada la tabla está VACÍA (la migración no crea filas; esperado 0 hasta que se conecten los módulos).
SELECT COUNT(*) AS entregas FROM u611730801_Plataforma.documento_entregas;

-- 7) Integridad (para reejecutar más adelante; cada consulta debe devolver 0 filas).
--    7a) Más de una entrega pendiente por documento (el UNIQUE lo impide; se comprueba igual).
SELECT empresa_id, modulo, entidad_id, COUNT(*) AS pendientes
FROM u611730801_Plataforma.documento_entregas
WHERE estado = 'EMITIDA'
GROUP BY empresa_id, modulo, entidad_id
HAVING COUNT(*) > 1;
--    7b) Firma de otra empresa o de otra entidad (aislamiento: la firma debe ser de la misma empresa y del mismo documento).
SELECT de.id, de.empresa_id, fe.empresa_id AS firma_empresa, 'emision' AS firma
FROM u611730801_Plataforma.documento_entregas de
JOIN u611730801_Plataforma.firmas_electronicas fe ON fe.id = de.firma_emision_id
WHERE fe.empresa_id <> de.empresa_id OR fe.entidad_id <> de.entidad_id OR fe.entidad_tipo <> de.entidad_tipo OR fe.accion <> 'ENTREGAR_DOCUMENTO'
UNION ALL
SELECT de.id, de.empresa_id, fe.empresa_id, 'recepcion'
FROM u611730801_Plataforma.documento_entregas de
JOIN u611730801_Plataforma.firmas_electronicas fe ON fe.id = de.firma_recepcion_id
WHERE fe.empresa_id <> de.empresa_id OR fe.entidad_id <> de.entidad_id OR fe.entidad_tipo <> de.entidad_tipo OR fe.accion <> 'RECIBIR_DOCUMENTO';
--    7c) Documento inexistente en SU empresa (referencia polimórfica: la base no tiene FK al documento).
SELECT de.id, de.empresa_id, de.modulo, de.entidad_id
FROM u611730801_Plataforma.documento_entregas de
WHERE (de.modulo = 'FONDOS' AND NOT EXISTS (SELECT 1 FROM u611730801_Plataforma.tms_solicitudes_fondo d WHERE d.id = de.entidad_id AND d.empresa_id = de.empresa_id))
   OR (de.modulo = 'GASTOS' AND NOT EXISTS (SELECT 1 FROM u611730801_Plataforma.tms_gastos_operativos d WHERE d.id = de.entidad_id AND d.empresa_id = de.empresa_id))
   OR (de.modulo = 'COMPRAS' AND NOT EXISTS (SELECT 1 FROM u611730801_Plataforma.compras_requerimientos d WHERE d.id = de.entidad_id AND d.empresa_id = de.empresa_id));
