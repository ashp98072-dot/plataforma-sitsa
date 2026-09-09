-- SOLICITUD-FONDOS-REPORTE-1
-- Aplicación MANUAL (MariaDB 11.8, mismo motor que el resto del
-- proyecto). NO se ejecuta automáticamente. Aditiva y reejecutable:
-- ADD COLUMN/ADD INDEX usan IF NOT EXISTS, y las FOREIGN KEY nuevas se
-- agregan solo si todavía no existen (comprobado por nombre en
-- information_schema.TABLE_CONSTRAINTS) — correr este script más de una
-- vez es seguro, no duplica nada ni falla la segunda vez.
--
-- NO hace DROP de columnas, NO borra datos, NO modifica en masa filas
-- existentes: las solicitudes de fondo ya guardadas quedan intactas,
-- simplemente con las columnas nuevas en NULL (compatible con el estado
-- "antes" del código, tal como pide el ticket).
--
-- Qué agrega y por qué (Reutiliza el MISMO patrón ya usado y probado en
-- tms_gastos_operativos — ver sql/migrate-2026-09-tms-gastos-reportes.sql
-- — para fecha_viaje/empleado_id/vehiculo_id/cliente_id/plan_id; NO se
-- crea un módulo paralelo, es la misma forma de relacionar un renglón
-- con viaje/persona/unidad/cliente que ya existe en Gastos):
--   fecha_viaje  DATE NULL        -- por línea: una solicitud puede cubrir varios viajes/fechas distintas
--   empleado_id  INT NULL         -- relación real (RRHH), FK compuesta (empresa_id, id)
--   empleado_nombre VARCHAR(200)  -- SNAPSHOT del nombre al momento de crear la línea
--   cargo        VARCHAR(100)     -- SNAPSHOT de empleados.puesto al momento de crear la línea
--   vehiculo_id  INT NULL         -- relación real (Flota), FK compuesta (empresa_id, id)
--   placa        VARCHAR(20)      -- SNAPSHOT de flota_vehiculos.placa
--   cliente_id   INT NULL         -- relación real (mismo maestro que tms_planes_viaje), FK compuesta
--   cliente_nombre VARCHAR(200)   -- SNAPSHOT de tms_clientes.nombre
--   plan_id      INT NULL         -- relación real al viaje (tms_planes_viaje), FK compuesta
--
-- "Fecha solicitud" (pedida por el ticket como dato de línea) NO se
-- duplica aquí como columna nueva: tms_solicitudes_fondo.fecha_requerimiento
-- YA es esa fecha a nivel de la solicitud completa — el reporte la
-- muestra por línea vía JOIN al encabezado (ver src/lib/tms/fondos.ts),
-- nunca copiándola a cada línea (evitaría que dos líneas de la MISMA
-- solicitud pudieran mostrar fechas de solicitud distintas, algo que no
-- tiene sentido de negocio: una solicitud tiene UNA sola fecha de
-- requerimiento).
--
-- Por qué SNAPSHOT de texto (empleado_nombre/cargo/placa/cliente_nombre)
-- y no solo el _id con JOIN en vivo (que es como ya funciona
-- tms_gastos_operativos): pedido EXPLÍCITO del ticket — "el reporte
-- histórico [no debe depender] únicamente del valor actual del
-- catálogo". Si un empleado cambia de nombre, una unidad cambia de placa,
-- o un cliente se renombra, las solicitudes YA emitidas deben seguir
-- mostrando el dato tal como era cuando se generó la solicitud.

ALTER TABLE tms_solicitud_fondo_lineas
  ADD COLUMN IF NOT EXISTS fecha_viaje DATE NULL DEFAULT NULL AFTER monto,
  ADD COLUMN IF NOT EXISTS empleado_id INT NULL DEFAULT NULL AFTER fecha_viaje,
  ADD COLUMN IF NOT EXISTS empleado_nombre VARCHAR(200) NULL DEFAULT NULL AFTER empleado_id,
  ADD COLUMN IF NOT EXISTS cargo VARCHAR(100) NULL DEFAULT NULL AFTER empleado_nombre,
  ADD COLUMN IF NOT EXISTS vehiculo_id INT NULL DEFAULT NULL AFTER cargo,
  ADD COLUMN IF NOT EXISTS placa VARCHAR(20) NULL DEFAULT NULL AFTER vehiculo_id,
  ADD COLUMN IF NOT EXISTS cliente_id INT NULL DEFAULT NULL AFTER placa,
  ADD COLUMN IF NOT EXISTS cliente_nombre VARCHAR(200) NULL DEFAULT NULL AFTER cliente_id,
  ADD COLUMN IF NOT EXISTS plan_id INT NULL DEFAULT NULL AFTER cliente_nombre;

ALTER TABLE tms_solicitud_fondo_lineas
  ADD INDEX IF NOT EXISTS idx_fondolin_fviaje (empresa_id, fecha_viaje),
  ADD INDEX IF NOT EXISTS idx_fondolin_empleado (empresa_id, empleado_id),
  ADD INDEX IF NOT EXISTS idx_fondolin_vehiculo (empresa_id, vehiculo_id),
  ADD INDEX IF NOT EXISTS idx_fondolin_cliente (empresa_id, cliente_id),
  ADD INDEX IF NOT EXISTS idx_fondolin_plan (empresa_id, plan_id);

-- FKs compuestas (empresa_id, xxx_id) -> mismo criterio de aislamiento
-- multiempresa ya usado por tms_gastos_operativos (ON DELETE RESTRICT:
-- ningún catálogo maestro se borra físicamente en este proyecto, solo
-- cambia de estado — igual razonamiento documentado ahí y en
-- tms-portal-clientes-hardening.sql).
SET @db := DATABASE();

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'tms_solicitud_fondo_lineas'
    AND CONSTRAINT_NAME = 'fk_fondolin_empleado_ambito' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE tms_solicitud_fondo_lineas
     ADD CONSTRAINT fk_fondolin_empleado_ambito
     FOREIGN KEY (empresa_id, empleado_id)
     REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'tms_solicitud_fondo_lineas'
    AND CONSTRAINT_NAME = 'fk_fondolin_vehiculo_ambito' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE tms_solicitud_fondo_lineas
     ADD CONSTRAINT fk_fondolin_vehiculo_ambito
     FOREIGN KEY (empresa_id, vehiculo_id)
     REFERENCES flota_vehiculos (empresa_id, id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'tms_solicitud_fondo_lineas'
    AND CONSTRAINT_NAME = 'fk_fondolin_cliente_ambito' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE tms_solicitud_fondo_lineas
     ADD CONSTRAINT fk_fondolin_cliente_ambito
     FOREIGN KEY (empresa_id, cliente_id)
     REFERENCES tms_clientes (empresa_id, id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'tms_solicitud_fondo_lineas'
    AND CONSTRAINT_NAME = 'fk_fondolin_plan_ambito' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE tms_solicitud_fondo_lineas
     ADD CONSTRAINT fk_fondolin_plan_ambito
     FOREIGN KEY (empresa_id, plan_id)
     REFERENCES tms_planes_viaje (empresa_id, id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
