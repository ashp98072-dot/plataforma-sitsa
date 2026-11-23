-- REVERSIÓN de sql/migrate-2026-11-fondos-diarios.sql. Aplicación MANUAL. Idempotente (DROP … IF EXISTS).
-- ANTES de ejecutar, revisar estas cuentas (solo lectura): lo que existe se PIERDE como estructura al revertir.
--   · viajes con empresa requirente asignada, solicitudes diarias/complementarias y líneas automáticas.
-- Al quitar `origen` las líneas automáticas pasan a ser líneas manuales editables (monto/beneficiario dejan de estar protegidos) y se pierde su viático de origen.
-- Orden recomendado: 1) desplegar el código anterior (revert del merge en main) 2) ejecutar este script 3) volver a ejecutar la verificación de abajo.
SELECT (SELECT COUNT(*) FROM tms_planes_viaje WHERE entidad_requirente_id IS NOT NULL) AS viajes_con_empresa_requirente,
       (SELECT COUNT(*) FROM tms_solicitudes_fondo WHERE origen = 'DIARIA') AS solicitudes_diarias,
       (SELECT COUNT(*) FROM tms_solicitudes_fondo WHERE tipo = 'COMPLEMENTARIA') AS complementarias,
       (SELECT COUNT(*) FROM tms_solicitud_fondo_lineas WHERE origen IS NOT NULL) AS lineas_automaticas;

ALTER TABLE tms_solicitud_fondo_lineas DROP CONSTRAINT IF EXISTS ck_fondolin_origen;
ALTER TABLE tms_solicitud_fondo_lineas DROP INDEX IF EXISTS uq_fondolin_viatico;
ALTER TABLE tms_solicitud_fondo_lineas DROP INDEX IF EXISTS idx_fondolin_viatico;
ALTER TABLE tms_solicitud_fondo_lineas DROP COLUMN IF EXISTS viatico_id, DROP COLUMN IF EXISTS origen;

ALTER TABLE tms_solicitudes_fondo DROP CONSTRAINT IF EXISTS ck_fondo_diaria;
ALTER TABLE tms_solicitudes_fondo DROP FOREIGN KEY IF EXISTS fk_fondo_principal;
ALTER TABLE tms_solicitudes_fondo DROP INDEX IF EXISTS uq_fondo_clave_diaria;
ALTER TABLE tms_solicitudes_fondo DROP INDEX IF EXISTS idx_fondo_principal;
ALTER TABLE tms_solicitudes_fondo DROP COLUMN IF EXISTS clave_diaria, DROP COLUMN IF EXISTS solicitud_principal_id, DROP COLUMN IF EXISTS tipo, DROP COLUMN IF EXISTS origen;

ALTER TABLE tms_planes_viaje DROP FOREIGN KEY IF EXISTS fk_tmsplan_entidad_requirente;
ALTER TABLE tms_planes_viaje DROP INDEX IF EXISTS idx_tmsplan_req_dia;
ALTER TABLE tms_planes_viaje DROP COLUMN IF EXISTS entidad_requirente_id;

-- Verificación (solo lectura): debe devolver 0.
SELECT COUNT(*) AS columnas_que_quedan FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND (
  (TABLE_NAME = 'tms_planes_viaje' AND COLUMN_NAME = 'entidad_requirente_id')
  OR (TABLE_NAME = 'tms_solicitudes_fondo' AND COLUMN_NAME IN ('origen', 'tipo', 'solicitud_principal_id', 'clave_diaria'))
  OR (TABLE_NAME = 'tms_solicitud_fondo_lineas' AND COLUMN_NAME IN ('origen', 'viatico_id')));
