-- MULTAS-5: pago de multa (a la autoridad) + documentos del expediente.
-- MIGRACIÓN MANUAL, NO EJECUTADA.
--
-- Prerrequisitos YA CUMPLIDOS en producción: MULTAS-2
-- (migrate-2026-08-operaciones-multas.sql, crea ops_multas/
-- ops_multas_revisiones/ops_multa_documentos) y MULTAS-3.2
-- (migrate-2026-08-operaciones-multas-rrhh.sql, agrega
-- ops_multas.rrhh_descuento_id + FK a rrhh_descuentos_maestro) ya
-- aplicadas. Este archivo NO modifica esas migraciones ni sus tablas
-- más allá de lo descrito abajo — aditivo, no destructivo.
--
-- QUÉ AGREGA:
--   1) ops_multas: monto_pagado, referencia_pago, observaciones_pago.
--      estado_pago/pagada_en/pagada_por_usuario_id YA EXISTÍAN (MULTAS-2)
--      — auditado antes de escribir este archivo, no se duplican.
--   2) ops_multa_documentos.tipo_documento: se redefine el ENUM a
--      ('MULTA','COMPROBANTE_PAGO','FACTURA','OTRO') — los 4 tipos que
--      pide MULTAS-5. El ENUM anterior
--      ('BOLETA','FOTOGRAFIA','RECIBO_PAGO','CONSTANCIA','OTRO') nunca
--      se usó: ops_multa_documentos sigue vacía (documentos/evidencias
--      de Multas quedó explícitamente fuera de alcance en MULTAS-3/3.1/
--      3.2/4, confirmado en cada ticket anterior) — un MODIFY es seguro
--      solo bajo esa condición. VERIFICAR antes de aplicar:
--        SELECT COUNT(*) FROM ops_multa_documentos;  -- debe ser 0
--      Si ya hay filas, DETENERSE y mapear los valores existentes antes
--      de continuar — no ejecutar este bloque a ciegas.
--
-- ORDEN DE DESPLIEGUE OBLIGATORIO:
--   1. Respaldo de ops_multas y ops_multa_documentos.
--   2. Confirmar `SELECT COUNT(*) FROM ops_multa_documentos` = 0.
--   3. Aplicar este archivo COMPLETO, en una sola sesión/BD.
--   4. Verificar:
--        SHOW CREATE TABLE ops_multas;  -- debe incluir monto_pagado,
--          referencia_pago, observaciones_pago
--        SHOW CREATE TABLE ops_multa_documentos;  -- tipo_documento debe
--          ser ENUM('MULTA','COMPROBANTE_PAGO','FACTURA','OTRO')
--   5. Solo entonces desplegar el código de MULTAS-5 (este PR).
--
-- Si el código se despliega ANTES de aplicar esta migración: registrar
-- pago o subir/leer documentos falla con el error real de MySQL, sin
-- fallback silencioso (mismo criterio que MULTAS-3.2). El resto de
-- Multas sigue funcionando sin cambios.
--
-- DDL no es una transacción atómica (MySQL hace commits implícitos).
-- No deshabilitar FOREIGN_KEY_CHECKS. Ejecutar en una sola sesión/BD.
-- Reejecutable: cada bloque comprueba primero si ya está aplicado.

SET NAMES utf8mb4;

-- 1) Columnas de pago en ops_multas (cada una, solo si no existe ya).
SET @m5_ddl = IF(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'ops_multas' AND column_name = 'monto_pagado'
), 'SELECT 1',
  'ALTER TABLE ops_multas ADD COLUMN monto_pagado DECIMAL(12,2) NULL AFTER pagada_por_usuario_id');
PREPARE m5_stmt FROM @m5_ddl;
EXECUTE m5_stmt;
DEALLOCATE PREPARE m5_stmt;

SET @m5_ddl = IF(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'ops_multas' AND column_name = 'referencia_pago'
), 'SELECT 1',
  'ALTER TABLE ops_multas ADD COLUMN referencia_pago VARCHAR(120) NULL AFTER monto_pagado');
PREPARE m5_stmt FROM @m5_ddl;
EXECUTE m5_stmt;
DEALLOCATE PREPARE m5_stmt;

SET @m5_ddl = IF(EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'ops_multas' AND column_name = 'observaciones_pago'
), 'SELECT 1',
  'ALTER TABLE ops_multas ADD COLUMN observaciones_pago TEXT NULL AFTER referencia_pago');
PREPARE m5_stmt FROM @m5_ddl;
EXECUTE m5_stmt;
DEALLOCATE PREPARE m5_stmt;

-- 2) Redefinir tipo_documento — solo si el ENUM actual no es ya el
-- esperado (idempotente: reejecutar no falla ni repite el MODIFY).
-- Requiere ops_multa_documentos vacía (ver verificación obligatoria
-- arriba) — un MODIFY de ENUM con filas cuyo valor actual no exista en
-- la lista nueva las dejaría en '' (comportamiento de MySQL para ENUM
-- inválido), por eso la comprobación manual previa es obligatoria, no
-- solo una preferencia.
SET @m5_ddl = IF((
  SELECT COLUMN_TYPE FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'ops_multa_documentos' AND column_name = 'tipo_documento'
) = "enum('MULTA','COMPROBANTE_PAGO','FACTURA','OTRO')", 'SELECT 1',
  'ALTER TABLE ops_multa_documentos MODIFY COLUMN tipo_documento ENUM(''MULTA'',''COMPROBANTE_PAGO'',''FACTURA'',''OTRO'') NOT NULL');
PREPARE m5_stmt FROM @m5_ddl;
EXECUTE m5_stmt;
DEALLOCATE PREPARE m5_stmt;

-- No se agregan columnas para "comprobante" en ops_multas — se modela
-- como documento con tipo_documento='COMPROBANTE_PAGO' en
-- ops_multa_documentos (ya existente desde MULTAS-2), evitando duplicar
-- almacenamiento de archivos fuera de esa tabla.
