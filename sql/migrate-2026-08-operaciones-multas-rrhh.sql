-- MULTAS-3.2: vínculo Multa → RRHH (descuento real de planilla).
-- MIGRACIÓN MANUAL, NO EJECUTADA.
--
-- Prerrequisito YA CUMPLIDO en producción:
--   - MULTAS-2 (migrate-2026-08-operaciones-multas.sql) ya aplicada:
--     ops_multas_revisiones / ops_multas / ops_multa_documentos existen y
--     están actualmente VACÍAS. NO volver a ejecutar ese archivo.
--   - RRHH D1 (migrate-2026-08-rrhh-descuentos-d1.sql) ya aplicada, CON
--     datos reales: rrhh_descuentos_maestro / rrhh_descuento_cuotas /
--     rrhh_descuento_abonos. Este archivo NO modifica ni una fila de esas
--     tablas — solo agrega una UNIQUE KEY nueva (ver punto 1) y, por
--     separado, una columna+FK nueva en ops_multas (vacía).
--
-- Este archivo es aditivo y no destructivo, mismo criterio que el resto de
-- SITSA. No se crea un motor paralelo de descuentos — ops_multas solo
-- guarda el vínculo (rrhh_descuento_id); cuotas/saldo/periodicidad/estado
-- real se siguen consultando desde las tablas de RRHH (nunca se duplican).
--
-- ORDEN DE DESPLIEGUE OBLIGATORIO:
--   1. Respaldo de rrhh_descuentos_maestro y ops_multas (esta última está
--      vacía hoy, pero respaldar igual antes de cualquier ALTER en prod).
--   2. Aplicar este archivo COMPLETO, en una sola sesión/BD.
--   3. Verificar:
--        SHOW CREATE TABLE rrhh_descuentos_maestro;  -- debe incluir
--          uq_descm_empresa_id (empresa_id, id)
--        SHOW CREATE TABLE ops_multas;  -- debe incluir la columna
--          rrhh_descuento_id, el índice idx_om_rrhh_descuento y la FK
--          fk_om_rrhh_descuento
--   4. Solo entonces desplegar el código de MULTAS-3.2 (este PR).
--
-- SI EL CÓDIGO SE DESPLIEGA ANTES DE APLICAR ESTA MIGRACIÓN: todo lo que
-- lee/escribe `rrhh_descuento_id` (bandeja RRHH, GET enriquecido de
-- Multas, endpoint de vínculo) falla con el error real de MySQL ("Unknown
-- column 'rrhh_descuento_id'") — sin fallback silencioso, por diseño
-- (mismo criterio que el resto de Multas: nunca ocultar un fallo de
-- esquema con datos vacíos/falsos). El resto de Multas (alta, revisión,
-- pagar, anular estándar, UI de Operaciones sin la parte de RRHH) sigue
-- funcionando sin cambios porque no toca esa columna.
--
-- DDL no es una transacción atómica: MySQL hace commits implícitos por
-- cada ALTER/CREATE. No deshabilitar FOREIGN_KEY_CHECKS. Ejecutar en una
-- sola sesión/BD elegida. Reejecutable: cada bloque comprueba primero si
-- ya existe antes de aplicar (mismo patrón idempotente que
-- migrate-2026-08-operaciones-multas.sql para las UNIQUE de
-- flota_vehiculos/empleados). Detenerse ante cualquier error.

SET NAMES utf8mb4;

-- 1) UNIQUE candidata que HOY NO EXISTE en rrhh_descuentos_maestro. Es
-- imprescindible para la FK compuesta del punto 4 (mismo requisito de
-- MySQL que ya obligó a agregar uq_multas_vehiculo_empresa_id /
-- uq_multas_empleado_empresa_id en MULTAS-2). Nunca puede fallar por datos
-- duplicados: `id` ya es PRIMARY KEY (único de por sí), así que
-- (empresa_id, id) es única automáticamente para cualquier dato existente.
SET @m32_ddl = IF(EXISTS (
  SELECT 1 FROM (
    SELECT index_name FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'rrhh_descuentos_maestro'
    GROUP BY index_name
    HAVING MIN(non_unique) = 0
      AND GROUP_CONCAT(column_name ORDER BY seq_in_index) = 'empresa_id,id'
  ) AS indices_descm
), 'SELECT 1',
  'ALTER TABLE rrhh_descuentos_maestro ADD UNIQUE KEY uq_descm_empresa_id (empresa_id, id)');
PREPARE m32_stmt FROM @m32_ddl;
EXECUTE m32_stmt;
DEALLOCATE PREPARE m32_stmt;

-- 2) Columna de vínculo en ops_multas (vacía hoy — sin riesgo de datos
-- huérfanos). Solo el id de rrhh_descuentos_maestro; NO se agregan
-- cuota_id / planilla_id / saldo / numero_cuotas / periodicidad /
-- estado_rrhh / fecha_aplicacion — todos derivables, se consultan.
SET @m32_ddl = IF(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'ops_multas' AND column_name = 'rrhh_descuento_id'
), 'SELECT 1',
  'ALTER TABLE ops_multas ADD COLUMN rrhh_descuento_id INT NULL AFTER descontada_por_usuario_id');
PREPARE m32_stmt FROM @m32_ddl;
EXECUTE m32_stmt;
DEALLOCATE PREPARE m32_stmt;

-- 3) Índice de apoyo: bandeja RRHH filtra por rrhh_descuento_id IS NULL
-- (con resolución/monto_colaborador), y el GET enriquecido resuelve el
-- vínculo hacia adelante.
SET @m32_ddl = IF(EXISTS (
  SELECT 1 FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'ops_multas' AND index_name = 'idx_om_rrhh_descuento'
), 'SELECT 1',
  'ALTER TABLE ops_multas ADD INDEX idx_om_rrhh_descuento (empresa_id, rrhh_descuento_id)');
PREPARE m32_stmt FROM @m32_ddl;
EXECUTE m32_stmt;
DEALLOCATE PREPARE m32_stmt;

-- 4) FK compuesta — mismo patrón RESTRICT/RESTRICT que el resto de
-- MULTAS-2 (fk_om_revision, fk_om_responsable, etc.). ops_multas está
-- vacía hoy en producción, así que esta FK no puede fallar por huérfanos
-- existentes.
SET @m32_ddl = IF(EXISTS (
  SELECT 1 FROM information_schema.table_constraints
  WHERE table_schema = DATABASE() AND table_name = 'ops_multas' AND constraint_name = 'fk_om_rrhh_descuento'
), 'SELECT 1',
  'ALTER TABLE ops_multas ADD CONSTRAINT fk_om_rrhh_descuento FOREIGN KEY (empresa_id, rrhh_descuento_id)
     REFERENCES rrhh_descuentos_maestro(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT');
PREPARE m32_stmt FROM @m32_ddl;
EXECUTE m32_stmt;
DEALLOCATE PREPARE m32_stmt;

-- No se fija versión mínima de MySQL (sin CHECK, mismo criterio que
-- MULTAS-2). El backend sigue siendo la única autoridad de validación
-- (periodicidad, cuotas, montos, estados) — el esquema no la sustituye.
