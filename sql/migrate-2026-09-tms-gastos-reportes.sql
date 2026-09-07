-- TMS-GASTOS-REPORTES-1 (fase 1) — gastos operativos, solicitudes de
-- fondo y reportes/rentabilidad por viaje.
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
-- empleados.categoria_ops / tms_personal.tipo (comentario en cada columna).

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
  CONSTRAINT fk_gasto_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE SET NULL,
  CONSTRAINT fk_gasto_vehiculo FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE SET NULL,
  CONSTRAINT fk_gasto_cliente FOREIGN KEY (cliente_id) REFERENCES tms_clientes(id) ON DELETE SET NULL,
  CONSTRAINT fk_gasto_plan FOREIGN KEY (plan_id) REFERENCES tms_planes_viaje(id) ON DELETE SET NULL
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
  INDEX idx_fondo_estado (empresa_id, estado),
  INDEX idx_fondo_fecha (empresa_id, fecha_requerimiento),
  CONSTRAINT fk_fondo_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_fondo_requirente FOREIGN KEY (requirente_empleado_id) REFERENCES empleados(id) ON DELETE SET NULL,
  CONSTRAINT fk_fondo_autorizante FOREIGN KEY (autorizante_empleado_id) REFERENCES empleados(id) ON DELETE SET NULL
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
  CONSTRAINT fk_fondolin_solicitud FOREIGN KEY (solicitud_id) REFERENCES tms_solicitudes_fondo(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
