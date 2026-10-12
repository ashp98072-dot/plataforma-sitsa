-- =====================================================================
-- MIGRACIÓN — IDEMPOTENCIA DE CREACIÓN: Solicitudes de Fondo y Gastos operativos (PR A)
-- Archivo: sql/migrate-2026-10-operaciones-idempotencia-fondos-gastos.sql
--
-- PROPUESTA PARA REVISIÓN. NO se ejecuta desde la aplicación ni desde este PR. Correr MANUALMENTE y solo tras autorización
-- explícita, DESPUÉS de revisar el resultado de sql/preflight-2026-10-operaciones-idempotencia-fondos-gastos.sql.
--
-- QUÉ HACE (aditivo, sin tocar datos):
--   * tms_solicitudes_fondo  : + clave_idempotencia VARCHAR(64) NULL, + huella_idempotencia CHAR(64) NULL,
--                              + UNIQUE uq_fondo_empresa_clave (empresa_id, clave_idempotencia)
--   * tms_gastos_operativos  : + clave_idempotencia VARCHAR(64) NULL, + huella_idempotencia CHAR(64) NULL,
--                              + UNIQUE uq_gastos_empresa_clave (empresa_id, clave_idempotencia)
--
-- QUÉ NO HACE: no hay UPDATE/DELETE/DROP, no se inventan claves para filas existentes (quedan NULL: histórico), no se
-- deduplica ni se modifica ninguna fila (los duplicados históricos, p. ej. Fondos 77 y 78, NO se tocan aquí).
--
-- POR QUÉ UN UNIQUE CON NULL ES SEGURO: MariaDB/MySQL permiten VARIAS filas con NULL en un índice UNIQUE; solo las filas
-- que traen clave compiten. La unicidad es por (empresa_id, clave): la misma clave en otra empresa no choca.
--
-- QUÉ ES `clave_idempotencia`: un token aleatorio que genera el formulario por intento de creación (NO se deriva de
-- monto/fecha/solicitante/proveedor/concepto: dos registros legítimos iguales deben poder coexistir).
-- QUÉ ES `huella_idempotencia`: SHA-256 (hex) del contenido funcional enviado; sirve para distinguir un reintento idéntico
-- (mismo registro) de una reutilización de la clave con otro contenido (HTTP 409). Solo el hash; no duplica datos.
--
-- COMPATIBILIDAD DE DESPLIEGUE: la aplicación tolera que estas columnas todavía no existan (opera en modo legado sin
-- protección y sin fallar). Aplicar esta migración ANTES o DESPUÉS del código es seguro; la protección empieza cuando
-- ambas cosas están en producción.
--
-- ESQUEMA EXPLÍCITO: todas las sentencias califican `u611730801_Plataforma.<tabla>` (no dependen del esquema activo de la
-- sesión de phpMyAdmin/Hostinger). En otra base (pruebas), reemplazar el nombre del esquema en todo el archivo.
--
-- IDEMPOTENTE: IF NOT EXISTS en columnas e índices; reejecutarla no falla ni repite cambios.
-- =====================================================================

ALTER TABLE u611730801_Plataforma.tms_solicitudes_fondo
  ADD COLUMN IF NOT EXISTS clave_idempotencia VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS huella_idempotencia CHAR(64) NULL,
  ADD UNIQUE INDEX IF NOT EXISTS uq_fondo_empresa_clave (empresa_id, clave_idempotencia);

ALTER TABLE u611730801_Plataforma.tms_gastos_operativos
  ADD COLUMN IF NOT EXISTS clave_idempotencia VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS huella_idempotencia CHAR(64) NULL,
  ADD UNIQUE INDEX IF NOT EXISTS uq_gastos_empresa_clave (empresa_id, clave_idempotencia);

-- ---------------------------------------------------------------------
-- VERIFICACIÓN POSTERIOR (solo lectura): debe devolver 2 columnas y 1 índice por tabla, y 0 claves en filas históricas.
-- ---------------------------------------------------------------------
SELECT t.tabla,
       (SELECT COUNT(*) FROM information_schema.COLUMNS c
         WHERE c.TABLE_SCHEMA = 'u611730801_Plataforma' AND c.TABLE_NAME = t.tabla
           AND c.COLUMN_NAME IN ('clave_idempotencia', 'huella_idempotencia')) AS columnas_nuevas,
       (SELECT COUNT(DISTINCT s.INDEX_NAME) FROM information_schema.STATISTICS s
         WHERE s.TABLE_SCHEMA = 'u611730801_Plataforma' AND s.TABLE_NAME = t.tabla
           AND s.INDEX_NAME = t.indice AND s.NON_UNIQUE = 0) AS indices_unique_ok
FROM (SELECT 'tms_solicitudes_fondo' AS tabla, 'uq_fondo_empresa_clave' AS indice
      UNION ALL SELECT 'tms_gastos_operativos', 'uq_gastos_empresa_clave') t;

-- ---------------------------------------------------------------------
-- REVERSIÓN (NO ejecutar salvo decisión explícita; las filas con clave perderían la protección de reintentos):
--   ALTER TABLE u611730801_Plataforma.tms_solicitudes_fondo DROP INDEX uq_fondo_empresa_clave,
--     DROP COLUMN huella_idempotencia, DROP COLUMN clave_idempotencia;
--   ALTER TABLE u611730801_Plataforma.tms_gastos_operativos DROP INDEX uq_gastos_empresa_clave,
--     DROP COLUMN huella_idempotencia, DROP COLUMN clave_idempotencia;
-- ---------------------------------------------------------------------
