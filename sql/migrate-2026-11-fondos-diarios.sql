-- FONDOS DIARIOS (Fase 2): empresa requirente por viaje, solicitudes diarias consolidadas por (fecha, empresa requirente), líneas automáticas y complementarias.
-- Aplicación MANUAL (MariaDB 11.8, el mismo motor del proyecto). NO la ejecuta la aplicación. Aditiva e IDEMPOTENTE: ADD COLUMN/INDEX/CONSTRAINT IF NOT EXISTS; repetirla no falla ni duplica nada.
-- No borra datos ni modifica filas existentes: las solicitudes actuales quedan como origen 'MANUAL' / tipo 'PRINCIPAL' y las líneas actuales con origen NULL (manuales).
-- El código funciona ANTES de aplicarla (la función queda apagada, detectada por sonda de columnas) y se activa sola al aplicarla; no hay banderas.
-- Reversión: sql/rollback-2026-11-fondos-diarios.sql (con comprobaciones previas).
--
-- 1) tms_planes_viaje.entidad_requirente_id → cont_entidades (FK compuesta por empresa, RESTRICT). NULL = viaje sin empresa requirente (no genera fondos).
ALTER TABLE tms_planes_viaje ADD COLUMN IF NOT EXISTS entidad_requirente_id INT NULL DEFAULT NULL;
ALTER TABLE tms_planes_viaje ADD INDEX IF NOT EXISTS idx_tmsplan_req_dia (empresa_id, fecha_plan, entidad_requirente_id);
ALTER TABLE tms_planes_viaje ADD CONSTRAINT fk_tmsplan_entidad_requirente FOREIGN KEY IF NOT EXISTS (empresa_id, entidad_requirente_id) REFERENCES cont_entidades (empresa_id, id) ON DELETE RESTRICT;

-- 2) tms_solicitudes_fondo: origen (MANUAL | DIARIA), tipo (PRINCIPAL | COMPLEMENTARIA), vínculo a la principal y CLAVE ÚNICA de la solicitud principal diaria vigente.
--    `clave_diaria` solo tiene valor en la principal DIARIA con empresa requirente que NO está Rechazada: así el UNIQUE impide DOS principales vigentes para el mismo (empresa, fecha, empresa requirente)
--    y una principal rechazada libera la clave. Varias complementarias son válidas (su clave es NULL).
ALTER TABLE tms_solicitudes_fondo
  ADD COLUMN IF NOT EXISTS origen VARCHAR(10) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(15) NOT NULL DEFAULT 'PRINCIPAL',
  ADD COLUMN IF NOT EXISTS solicitud_principal_id INT NULL DEFAULT NULL;
ALTER TABLE tms_solicitudes_fondo
  ADD COLUMN IF NOT EXISTS clave_diaria VARCHAR(40) GENERATED ALWAYS AS (
    IF(origen = 'DIARIA' AND tipo = 'PRINCIPAL' AND estado <> 'Rechazada' AND entidad_requirente_id IS NOT NULL,
       CONCAT(CAST(fecha_requerimiento AS CHAR), '|', entidad_requirente_id), NULL)) PERSISTENT;
ALTER TABLE tms_solicitudes_fondo ADD UNIQUE INDEX IF NOT EXISTS uq_fondo_clave_diaria (empresa_id, clave_diaria);
ALTER TABLE tms_solicitudes_fondo ADD INDEX IF NOT EXISTS idx_fondo_principal (empresa_id, solicitud_principal_id);
ALTER TABLE tms_solicitudes_fondo ADD CONSTRAINT fk_fondo_principal FOREIGN KEY IF NOT EXISTS (empresa_id, solicitud_principal_id) REFERENCES tms_solicitudes_fondo (empresa_id, id) ON DELETE RESTRICT;
ALTER TABLE tms_solicitudes_fondo ADD CONSTRAINT IF NOT EXISTS ck_fondo_diaria CHECK (
  origen IN ('MANUAL', 'DIARIA') AND tipo IN ('PRINCIPAL', 'COMPLEMENTARIA')
  AND ((tipo = 'COMPLEMENTARIA') = (solicitud_principal_id IS NOT NULL)) AND (tipo = 'PRINCIPAL' OR origen = 'DIARIA'));

-- 3) tms_solicitud_fondo_lineas: origen automático y viático de origen (trazabilidad). SIN FK al viático a propósito: la programación borra viáticos PROGRAMADO al cambiar el
--    personal y esa operación no debe quedar bloqueada; el servicio retira la línea correspondiente (o la conserva si la solicitud ya fue autorizada).
--    UNIQUE (empresa, solicitud, viático): un viático no puede aparecer dos veces en la MISMA solicitud.
ALTER TABLE tms_solicitud_fondo_lineas
  ADD COLUMN IF NOT EXISTS origen VARCHAR(20) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS viatico_id INT NULL DEFAULT NULL;
ALTER TABLE tms_solicitud_fondo_lineas ADD UNIQUE INDEX IF NOT EXISTS uq_fondolin_viatico (empresa_id, solicitud_id, viatico_id);
ALTER TABLE tms_solicitud_fondo_lineas ADD INDEX IF NOT EXISTS idx_fondolin_viatico (empresa_id, viatico_id);
ALTER TABLE tms_solicitud_fondo_lineas ADD CONSTRAINT IF NOT EXISTS ck_fondolin_origen CHECK (origen IS NULL OR (origen = 'AUTO_VIATICO' AND viatico_id IS NOT NULL));

-- 4) Verificación (solo lectura): debe devolver 7 columnas, 3 índices únicos/índices clave y 3 restricciones.
SELECT (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND (
          (TABLE_NAME = 'tms_planes_viaje' AND COLUMN_NAME = 'entidad_requirente_id')
       OR (TABLE_NAME = 'tms_solicitudes_fondo' AND COLUMN_NAME IN ('origen', 'tipo', 'solicitud_principal_id', 'clave_diaria'))
       OR (TABLE_NAME = 'tms_solicitud_fondo_lineas' AND COLUMN_NAME IN ('origen', 'viatico_id')))) AS columnas_esperadas_8,
       (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME IN ('uq_fondo_clave_diaria', 'uq_fondolin_viatico') AND NON_UNIQUE = 0) AS indices_unicos_esperados_4,
       (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME IN ('fk_tmsplan_entidad_requirente', 'fk_fondo_principal', 'ck_fondo_diaria', 'ck_fondolin_origen')) AS restricciones_esperadas_4;
