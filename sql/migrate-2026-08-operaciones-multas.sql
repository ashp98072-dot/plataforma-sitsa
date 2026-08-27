-- MULTAS-2: Operaciones / Multas y sanciones. MIGRACIÓN MANUAL, NO EJECUTADA.
-- Orden OBLIGATORIO: respaldo + revisión del esquema real por el operador,
-- aplicar este archivo completo, verificar tablas/FK/índices y SOLO DESPUÉS
-- desplegar el guard de vehículos. No ejecutar desde la aplicación.
-- Si se despliega antes: DELETE físico falla cerrado (500 + rollback);
-- Dar de baja no depende de estas tablas y permanece disponible.
-- DDL no es una transacción atómica: MySQL hace commits implícitos.
-- Reejecutable para el esquema aquí definido; IF NOT EXISTS no corrige una
-- tabla preexistente con estructura distinta. Detenerse ante cualquier error.
-- No deshabilitar FOREIGN_KEY_CHECKS. Ejecutar en una sola sesión/BD elegida.
--
-- Padres del esquema del proyecto: InnoDB, id/empresa_id INT con signo.
-- Verificar que producción conserva esos tipos/motor antes de aplicar.
-- No se fija versión mínima de MySQL en el esquema revisado: sin CHECK.
-- El futuro backend DEBE validar mes 1..12, año válido, importes >= 0,
-- tamaño > 0, reparto económico, responsabilidad, estados y sus metadatos.
-- ENUM no sustituye esa validación (especialmente sin modo SQL estricto).
-- FKs garantizan pertenencia al propietario, no permisos de los usuarios.
-- No hay datos semilla, permisos, CRUD, ni integración con descuentos.
SET NAMES utf8mb4;

-- Claves candidatas compuestas requeridas por las nuevas FK.
-- Detectar una UNIQUE equivalente por columnas evita duplicarla si ya existe.
SET @multas_ddl = IF(EXISTS (
  SELECT 1 FROM (
    SELECT index_name FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'flota_vehiculos'
    GROUP BY index_name
    HAVING MIN(non_unique) = 0
      AND GROUP_CONCAT(column_name ORDER BY seq_in_index) = 'empresa_id,id'
  ) AS indices_vehiculo
), 'SELECT 1',
  'ALTER TABLE flota_vehiculos ADD UNIQUE KEY uq_multas_vehiculo_empresa_id (empresa_id, id)');
PREPARE multas_stmt FROM @multas_ddl;
EXECUTE multas_stmt;
DEALLOCATE PREPARE multas_stmt;

SET @multas_ddl = IF(EXISTS (
  SELECT 1 FROM (
    SELECT index_name FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'empleados'
    GROUP BY index_name
    HAVING MIN(non_unique) = 0
      AND GROUP_CONCAT(column_name ORDER BY seq_in_index) = 'empresa_id,id'
  ) AS indices_empleado
), 'SELECT 1',
  'ALTER TABLE empleados ADD UNIQUE KEY uq_multas_empleado_empresa_id (empresa_id, id)');
PREPARE multas_stmt FROM @multas_ddl;
EXECUTE multas_stmt;
DEALLOCATE PREPARE multas_stmt;

CREATE TABLE IF NOT EXISTS ops_multas_revisiones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  vehiculo_id INT NOT NULL,
  periodo_anio SMALLINT NOT NULL,
  periodo_mes TINYINT NOT NULL,
  verificada_en DATETIME NOT NULL,
  verificada_por_usuario_id INT NOT NULL,
  observaciones TEXT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_omr_mensual (empresa_id, vehiculo_id, periodo_anio, periodo_mes),
  INDEX idx_omr_periodo (empresa_id, periodo_anio, periodo_mes),
  UNIQUE KEY uq_omr_empresa_id_vehiculo (empresa_id, id, vehiculo_id),
  CONSTRAINT fk_omr_vehiculo FOREIGN KEY (empresa_id, vehiculo_id)
    REFERENCES flota_vehiculos(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_omr_verificada_por FOREIGN KEY (verificada_por_usuario_id)
    REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ops_multas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  revision_id INT NOT NULL,
  vehiculo_id INT NOT NULL,
  -- Snapshot al registrar la multa; NO catálogo alterno de placas/unidades.
  placa_historica VARCHAR(40) NOT NULL,
  fecha_infraccion DATE NOT NULL,
  referencia_boleta VARCHAR(120) NULL,
  tipo_multa VARCHAR(120) NOT NULL,
  descripcion TEXT NOT NULL,
  lugar VARCHAR(300) NULL,
  monto_total DECIMAL(12,2) NOT NULL,
  moneda CHAR(3) NOT NULL DEFAULT 'GTQ',
  tipo_responsabilidad ENUM('PILOTO','LOGISTICA','OTRO_COLABORADOR','EMPRESA','POR_DEFINIR') NOT NULL DEFAULT 'POR_DEFINIR',
  empleado_responsable_id INT NULL,
  responsable_texto VARCHAR(200) NULL,
  resolucion_economica ENUM('PENDIENTE','EMPRESA','COLABORADOR','COMPARTIDO','NO_APLICA') NOT NULL DEFAULT 'PENDIENTE',
  monto_empresa DECIMAL(12,2) NULL DEFAULT NULL,
  monto_colaborador DECIMAL(12,2) NULL DEFAULT NULL,
  estado ENUM('PENDIENTE','EN_REVISION','RESUELTA','ANULADA') NOT NULL DEFAULT 'PENDIENTE',
  estado_pago ENUM('PENDIENTE','PAGADA','NO_APLICA') NOT NULL DEFAULT 'PENDIENTE',
  pagada_en DATETIME NULL,
  pagada_por_usuario_id INT NULL,
  estado_descuento ENUM('NO_APLICA','PENDIENTE','DESCONTADO') NOT NULL DEFAULT 'NO_APLICA',
  descontada_en DATETIME NULL,
  descontada_por_usuario_id INT NULL,
  observaciones TEXT NULL,
  motivo_anulacion TEXT NULL,
  anulada_por_usuario_id INT NULL,
  anulada_en DATETIME NULL,
  creado_por_usuario_id INT NOT NULL,
  actualizado_por_usuario_id INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_om_revision (empresa_id, revision_id, vehiculo_id),
  INDEX idx_om_vehiculo_fecha (empresa_id, vehiculo_id, fecha_infraccion),
  INDEX idx_om_responsable_estado (empresa_id, empleado_responsable_id, estado),
  INDEX idx_om_estado (empresa_id, estado),
  INDEX idx_om_pago (empresa_id, estado_pago),
  INDEX idx_om_descuento (empresa_id, estado_descuento),
  UNIQUE KEY uq_om_empresa_id (empresa_id, id),
  CONSTRAINT fk_om_revision FOREIGN KEY (empresa_id, revision_id, vehiculo_id)
    REFERENCES ops_multas_revisiones(empresa_id, id, vehiculo_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_om_responsable FOREIGN KEY (empresa_id, empleado_responsable_id)
    REFERENCES empleados(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_om_pagada_por FOREIGN KEY (pagada_por_usuario_id)
    REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_om_descontada_por FOREIGN KEY (descontada_por_usuario_id)
    REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_om_anulada_por FOREIGN KEY (anulada_por_usuario_id)
    REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_om_creada_por FOREIGN KEY (creado_por_usuario_id)
    REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_om_actualizada_por FOREIGN KEY (actualizado_por_usuario_id)
    REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ops_multa_documentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  multa_id INT NOT NULL,
  ruta_relativa VARCHAR(1000) NOT NULL,
  nombre_original VARCHAR(255) NOT NULL,
  mime_type VARCHAR(150) NOT NULL,
  tamano BIGINT NOT NULL,
  tipo_documento ENUM('BOLETA','FOTOGRAFIA','RECIBO_PAGO','CONSTANCIA','OTRO') NOT NULL,
  subido_por_usuario_id INT NOT NULL,
  subido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  eliminado_en DATETIME NULL,
  eliminado_por_usuario_id INT NULL,
  motivo_eliminacion TEXT NULL,
  INDEX idx_omd_multa_eliminado (empresa_id, multa_id, eliminado_en),
  CONSTRAINT fk_omd_multa FOREIGN KEY (empresa_id, multa_id)
    REFERENCES ops_multas(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_omd_subido_por FOREIGN KEY (subido_por_usuario_id)
    REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_omd_eliminado_por FOREIGN KEY (eliminado_por_usuario_id)
    REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- InnoDB agrega índices auxiliares para las FK simples de usuarios.
-- No se agregan índices de negocio adicionales a los aprobados.
-- La cadena de FK compuestas conserva empresa/vehículo/revisión/multa.
-- Cambiar propietario con historial queda restringido: requiere una decisión
-- de negocio futura, nunca reescribir automáticamente el expediente histórico.
-- Compartir una unidad mediante flota_vehiculo_acceso NO comparte este historial.
-- El futuro CRUD usará ANULADA y eliminación lógica de documentos, no DELETE.
