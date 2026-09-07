-- TMS-GASTOS-REPORTES-1 (fase 1, corregida tras revisión de PR #204) —
-- gastos operativos, solicitudes de fondo y reportes/rentabilidad por
-- viaje.
--
-- NO se ejecuta automáticamente — revisar y correr manualmente contra la
-- base real (mismo criterio que sql/migrate-2026-09-rutas-personal-tarifario.sql).
--
-- Reutiliza catálogos existentes, no duplica nada:
--   - empleados          -> tms_gastos_operativos.empleado_id / requirente / autorizante
--   - flota_vehiculos    -> tms_gastos_operativos.vehiculo_id (placa/unidad)
--   - tms_clientes       -> tms_gastos_operativos.cliente_id (mismo maestro que
--                            tms_planes_viaje.cliente_id y tms_cliente_rutas.cliente_id)
--   - tms_planes_viaje   -> tms_gastos_operativos.plan_id (el "viaje")
--   - tms_viaticos       -> NO se duplica aquí; los reportes de "viáticos por
--                            viaje/empleado" y "rentabilidad por viaje" LEEN de
--                            tms_viaticos, nunca copian sus montos a esta tabla.
--   - auditoria          -> se reutiliza vía registrarAuditoria/registrarAuditoriaTx
--                            (src/lib/auditoria.ts); no se crea una bitácora paralela.
--
-- Categoría de gasto es un catálogo FIJO en código (src/lib/tms/gastos.ts,
-- CATEGORIAS_GASTO), no una tabla nueva — mismo criterio que
-- empleados.categoria_ops / tms_personal.tipo.
--
-- AISLAMIENTO MULTIEMPRESA (corrección post-revisión PR #204): todas las
-- referencias opcionales de tms_gastos_operativos (empleado/vehículo/
-- cliente/plan) usan FK COMPUESTAS (empresa_id, xxx_id) contra
-- (empresa_id, id) de la tabla padre — mismo patrón ya usado por
-- tms_cliente_ruta_personal en sql/migrate-2026-09-rutas-personal-tarifario.sql
-- (fk_ruta_personal_empleado_ambito). Esto hace IMPOSIBLE a nivel de base
-- de datos que un empleado/vehículo/cliente/plan de OTRA empresa quede
-- referenciado, aunque el id exista — no basta con que el id sea
-- correcto, empresa_id debe coincidir también. La app (gastos.ts/
-- fondos.ts) valida lo mismo ANTES de escribir, para dar un mensaje claro
-- en vez de un error crudo de FK.
--
-- ON DELETE RESTRICT (no SET NULL): una FK compuesta con SET NULL
-- intentaría poner NULL también en empresa_id, que es NOT NULL — MySQL
-- rechaza esa definición. RESTRICT es además más seguro para registros
-- financieros: nunca se debe poder borrar un empleado/vehículo/cliente/
-- plan que ya tiene gastos asociados sin antes desvincularlo a propósito.

-- empleados y tms_clientes/tms_planes_viaje YA tienen su índice único
-- (empresa_id, id) (uq_ruta_personal_empresa_id / uq_tmsclientes_empresa_id /
-- uq_tmsplanes_empresa_id, de migraciones previas). flota_vehiculos NO lo
-- tiene todavía — se agrega aquí de forma idempotente (detectado por
-- composición de columnas, mismo criterio que la migración de rutas, para
-- no duplicar el índice si otra migración ya lo creó con otro nombre).
SET @flota_ambito_ddl = IF(EXISTS (
  SELECT 1 FROM (
    SELECT index_name
    FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'flota_vehiculos'
    GROUP BY index_name
    HAVING MIN(non_unique) = 0
       AND GROUP_CONCAT(column_name ORDER BY seq_in_index) = 'empresa_id,id'
  ) AS indices_flota
), 'SELECT 1',
  'ALTER TABLE flota_vehiculos ADD UNIQUE KEY uq_flota_vehiculos_empresa_id (empresa_id, id)');
PREPARE flota_ambito_stmt FROM @flota_ambito_ddl;
EXECUTE flota_ambito_stmt;
DEALLOCATE PREPARE flota_ambito_stmt;

CREATE TABLE IF NOT EXISTS tms_gastos_operativos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  fecha_solicitud DATE NOT NULL,
  fecha_viaje DATE NULL,
  empleado_id INT NULL,
  vehiculo_id INT NULL,
  cliente_id INT NULL,
  plan_id INT NULL,
  -- Combustible | Hospedaje | Parqueo | Cuadrilla | Auxiliar extra |
  -- Mantenimiento | Arbitrios | Transporte | Otros (ver CATEGORIAS_GASTO
  -- en src/lib/tms/gastos.ts — catálogo fijo, no una tabla).
  categoria VARCHAR(40) NOT NULL,
  descripcion VARCHAR(300) NULL,
  cantidad DECIMAL(10,2) NOT NULL DEFAULT 1,
  monto DECIMAL(12,2) NOT NULL,
  -- Efectivo | Transferencia | Tarjeta | Cheque | Otro.
  metodo_pago VARCHAR(40) NULL,
  numero_cuenta_pago VARCHAR(80) NULL,
  tiene_factura TINYINT(1) NOT NULL DEFAULT 0,
  observaciones VARCHAR(300) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_gastos_empresa_fviaje (empresa_id, fecha_viaje),
  INDEX idx_gastos_plan (empresa_id, plan_id),
  INDEX idx_gastos_cliente (empresa_id, cliente_id),
  INDEX idx_gastos_vehiculo (empresa_id, vehiculo_id),
  INDEX idx_gastos_categoria (empresa_id, categoria),
  INDEX idx_gastos_empleado (empresa_id, empleado_id),
  CONSTRAINT fk_gasto_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_gasto_empleado_ambito FOREIGN KEY (empresa_id, empleado_id) REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_gasto_vehiculo_ambito FOREIGN KEY (empresa_id, vehiculo_id) REFERENCES flota_vehiculos (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_gasto_cliente_ambito FOREIGN KEY (empresa_id, cliente_id) REFERENCES tms_clientes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_gasto_plan_ambito FOREIGN KEY (empresa_id, plan_id) REFERENCES tms_planes_viaje (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_solicitudes_fondo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  requirente_empleado_id INT NULL,
  requirente_nombre VARCHAR(200) NULL,
  fecha_requerimiento DATE NOT NULL,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  autorizante_empleado_id INT NULL,
  autorizante_nombre VARCHAR(200) NULL,
  -- Pendiente -> Autorizada -> Liquidada, o Rechazada en cualquier punto
  -- antes de Liquidada. Ver src/lib/tms/fondos.ts (TRANSICIONES_FONDO).
  estado VARCHAR(30) NOT NULL DEFAULT 'Pendiente',
  autorizado_en DATETIME NULL,
  rechazado_en DATETIME NULL,
  motivo_rechazo VARCHAR(300) NULL,
  liquidado_en DATETIME NULL,
  observaciones VARCHAR(300) NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fondo_codigo (empresa_id, codigo),
  -- Tabla NUEVA (nunca existió antes de esta migración): se declara el
  -- índice compuesto directo en el CREATE, sin necesidad del chequeo
  -- dinámico que sí hace falta para tablas ya existentes (empleados/
  -- flota_vehiculos arriba). Es el destino de la FK compuesta de
  -- tms_solicitud_fondo_lineas.solicitud_id más abajo.
  UNIQUE KEY uq_fondo_empresa_id (empresa_id, id),
  INDEX idx_fondo_estado (empresa_id, estado),
  INDEX idx_fondo_fecha (empresa_id, fecha_requerimiento),
  CONSTRAINT fk_fondo_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_fondo_requirente_ambito FOREIGN KEY (empresa_id, requirente_empleado_id) REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fondo_autorizante_ambito FOREIGN KEY (empresa_id, autorizante_empleado_id) REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_solicitud_fondo_lineas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  solicitud_id INT NOT NULL,
  categoria VARCHAR(40) NOT NULL,
  descripcion VARCHAR(300) NULL,
  cantidad DECIMAL(10,2) NOT NULL DEFAULT 1,
  monto DECIMAL(12,2) NOT NULL,
  orden INT NOT NULL DEFAULT 0,
  INDEX idx_fondolin_solicitud (empresa_id, solicitud_id),
  CONSTRAINT fk_fondolin_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_fondolin_solicitud_ambito FOREIGN KEY (empresa_id, solicitud_id) REFERENCES tms_solicitudes_fondo (empresa_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TMS-GASTOS-REPORTES-1 (bloqueo 2, rentabilidad histórica) — fotografía
-- histórica del costo operativo de referencia, mismo criterio que
-- tarifa_comercial (columna ya existente en esta misma tabla): se
-- sugiere/copia de tms_cliente_rutas.costo_operativo al elegir la ruta en
-- Programación, queda editable para ESE viaje, y cambios futuros del
-- costo operativo de la ruta maestra NUNCA alteran este valor ya
-- guardado. La rentabilidad por viaje (reportes-gastos.ts) usa este
-- snapshot, nunca el valor actual de tms_cliente_rutas.
ALTER TABLE tms_planes_viaje
  ADD COLUMN IF NOT EXISTS costo_operativo_referencia DECIMAL(12,2) NULL DEFAULT NULL AFTER tarifa_comercial;
