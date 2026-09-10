-- PERSONAL-OPERATIVO-COMPARTIDO-EXTERNO-1
--
-- Aplicación MANUAL (MariaDB 11.8). NO se ejecuta automáticamente.
-- Aditiva y reejecutable (ADD COLUMN IF NOT EXISTS, constraint detectada
-- por nombre, backfill idempotente). Sin DROP, sin borrar datos.
--
-- Contexto (esquema real revisado antes de diseñar):
--
--   * `tms_personal` YA ES la entidad "persona operativa" de TMS,
--     desacoplada de `empleados`/planilla: todo TMS
--     (tms_planes_viaje.piloto_id, tms_plan_auxiliares.personal_id,
--     tms_viaticos.personal_id, disponibilidad, reportes) referencia
--     tms_personal.id — NUNCA empleados. Planilla/RRHH
--     (rrhh_planilla_lineas, descuentos, prestaciones, vacaciones, IGSS,
--     boletas) referencia empleados.id y NUNCA lee tms_personal.
--     -> Un piloto/auxiliar prestado o externo se representa como una
--        fila tms_personal en la empresa operativa; el empleado NO se
--        duplica y NO entra a la planilla de esa empresa.
--
--   * `tms_personal.id_empleado` ya es nullable con FK
--     `REFERENCES empleados(id) ON DELETE SET NULL` NO compuesta — ya
--     admite apuntar a un empleado de OTRA empresa (compartido) o quedar
--     NULL (externo). Solo faltaba distinguir el tipo y guardar el origen.
--
-- Lo que agrega este ticket:
--
--   1. tms_personal + tipo_vinculo (propio | compartido | externo) +
--      empresa_origen_id (FK empresas, para compartido) +
--      empresa_origen_texto (origen libre para externo) + licencia
--      (licencia de piloto, externo). `estado` (Activo/Inactivo) ya existe.
--
--   2. Snapshot histórico de quién participó en cada viaje, para que los
--      viajes/viáticos anteriores sigan mostrando correctamente al
--      piloto/auxiliar aunque después se desactive o cambie de empresa de
--      origen:
--        - tms_planes_viaje  + piloto_nombre_historico / _tipo_historico / _origen_historico
--        - tms_plan_auxiliares + nombre_historico / tipo_historico / origen_historico
--        - tms_viaticos      + personal_nombre_historico / _tipo_historico / _origen_historico
--
--   3. Backfill: filas tms_personal cuyo id_empleado apunta a un empleado
--      de OTRA empresa -> tipo_vinculo = 'compartido' + empresa_origen_id.
--      El resto queda 'propio' (default). Nada se reclasifica a 'externo'
--      automáticamente (se hace desde la UI si aplica).

-- 1. tms_personal — tipo de vínculo + origen.
ALTER TABLE tms_personal
  ADD COLUMN IF NOT EXISTS tipo_vinculo VARCHAR(20) NOT NULL DEFAULT 'propio' AFTER tipo,
  ADD COLUMN IF NOT EXISTS empresa_origen_id INT NULL DEFAULT NULL AFTER tipo_vinculo,
  ADD COLUMN IF NOT EXISTS empresa_origen_texto VARCHAR(200) NULL DEFAULT NULL AFTER empresa_origen_id,
  ADD COLUMN IF NOT EXISTS licencia VARCHAR(80) NULL DEFAULT NULL AFTER empresa_origen_texto;

-- FK simple a empresas(id) — igual criterio que fk_tmspers_empleado
-- (columna sola, ON DELETE SET NULL). Reejecutable por nombre.
SET @tp_origen_fk = IF(EXISTS (
  SELECT 1 FROM information_schema.table_constraints
  WHERE table_schema = DATABASE() AND table_name = 'tms_personal'
    AND constraint_name = 'fk_tmspers_empresa_origen'
), 'SELECT 1',
  'ALTER TABLE tms_personal
     ADD CONSTRAINT fk_tmspers_empresa_origen
     FOREIGN KEY (empresa_origen_id) REFERENCES empresas(id) ON DELETE SET NULL');
PREPARE tp_origen_stmt FROM @tp_origen_fk;
EXECUTE tp_origen_stmt;
DEALLOCATE PREPARE tp_origen_stmt;

-- 2. Snapshots de personal en los viajes.
ALTER TABLE tms_planes_viaje
  ADD COLUMN IF NOT EXISTS piloto_nombre_historico VARCHAR(200) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS piloto_tipo_historico VARCHAR(20) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS piloto_origen_historico VARCHAR(200) NULL DEFAULT NULL;

ALTER TABLE tms_plan_auxiliares
  ADD COLUMN IF NOT EXISTS nombre_historico VARCHAR(200) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tipo_historico VARCHAR(20) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS origen_historico VARCHAR(200) NULL DEFAULT NULL;

ALTER TABLE tms_viaticos
  ADD COLUMN IF NOT EXISTS personal_nombre_historico VARCHAR(200) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS personal_tipo_historico VARCHAR(20) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS personal_origen_historico VARCHAR(200) NULL DEFAULT NULL;

-- 3. Backfill de tipo_vinculo / empresa_origen_id para filas ya existentes.
--    Idempotente: solo toca filas que siguen en 'propio'.
UPDATE tms_personal tp
JOIN empleados e ON e.id = tp.id_empleado
SET tp.tipo_vinculo = 'compartido',
    tp.empresa_origen_id = e.empresa_id
WHERE tp.id_empleado IS NOT NULL
  AND e.empresa_id <> tp.empresa_id
  AND tp.tipo_vinculo = 'propio';
