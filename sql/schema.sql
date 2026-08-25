-- Plataforma corporativa multiempresa SITSA / KT-Mónaco
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS empresas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  codigo VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(200) NOT NULL,
  slug VARCHAR(80) NOT NULL UNIQUE,
  logo_url VARCHAR(500) NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  modulos_json JSON NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
  password_hash VARCHAR(128) NOT NULL,
  salt VARCHAR(64) NOT NULL,
  nombre VARCHAR(200) NULL,
  email VARCHAR(200) NULL,
  rol_global VARCHAR(40) NOT NULL DEFAULT 'Operaciones',
  -- Admin | RRHH | Marcaje | Contabilidad | Operaciones | CoordinadorPredios | Piloto | Visualizador
  activo TINYINT(1) NOT NULL DEFAULT 1,
  acceso_todas_empresas TINYINT(1) NOT NULL DEFAULT 0,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS usuario_empresa (
  usuario_id INT NOT NULL,
  empresa_id INT NOT NULL,
  PRIMARY KEY (usuario_id, empresa_id),
  CONSTRAINT fk_ue_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_ue_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS usuario_modulo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  empresa_id INT NULL,
  modulo VARCHAR(40) NOT NULL,
  puede_ver TINYINT(1) NOT NULL DEFAULT 1,
  puede_crear TINYINT(1) NOT NULL DEFAULT 0,
  puede_editar TINYINT(1) NOT NULL DEFAULT 0,
  puede_eliminar TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_um_usuario_modulo (usuario_id, modulo),
  CONSTRAINT fk_um_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_um_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- RRHH / Asistencias (tenant)
CREATE TABLE IF NOT EXISTS empleados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(80) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  puesto VARCHAR(120) NULL,
  categoria_ops VARCHAR(40) NULL,
  -- Piloto | Auxiliar | Bodega | Administrativo | Otro
  tipo_horario VARCHAR(40) NOT NULL DEFAULT 'Fijo',
  fecha_alta DATE NULL,
  fecha_inicio_laboral DATE NULL,
  hora_entrada_teorica VARCHAR(20) NOT NULL DEFAULT '08:00:00',
  hora_salida_teorica VARCHAR(20) NOT NULL DEFAULT '17:00:00',
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo',
  -- Fase H1: elegibilidad individual para pago de horas extra. Por defecto
  -- NO elegible — solo RRHH/admin la activa por colaborador, nunca se
  -- deriva de puesto/categoria_ops/rol.
  horas_extra_habilitado TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_emp_empresa_codigo (empresa_id, codigo),
  CONSTRAINT fk_emp_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_descuentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  concepto VARCHAR(200) NOT NULL,
  monto DECIMAL(12,2) NOT NULL DEFAULT 0,
  fecha DATE NOT NULL,
  notas TEXT NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_desc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_desc_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_prestaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  monto DECIMAL(12,2) NOT NULL DEFAULT 0,
  fecha DATE NOT NULL,
  notas TEXT NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prest_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_prest_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_planilla_periodos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Borrador',
  -- Fase P0 (integridad de periodos): identidad de quincena, opcional y
  -- aditiva. NULL en periodos históricos — no se reinterpretan. Sirve para
  -- que la UI sugiera fechas (vía ciclo_quincenal de rrhh_configuracion,
  -- ver src/lib/rrhh/periodos.ts) y para el índice único de identidad de
  -- abajo. QUINCENA_1 | QUINCENA_2 | MENSUAL | ESPECIAL.
  tipo_periodo VARCHAR(20) NULL,
  numero_quincena TINYINT NULL,
  mes TINYINT NULL,
  anio SMALLINT NULL,
  notas TEXT NULL,
  -- Fase P0: obligatorio en la aplicación (no en el schema) cuando
  -- estado = 'Cancelado'.
  motivo_cancelacion VARCHAR(300) NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_planilla (empresa_id, codigo),
  -- Fase P0: evita crear dos veces la misma quincena/mes "estándar" para la
  -- misma empresa. No aplica a ESPECIAL (mes/numero_quincena quedan NULL
  -- ahí, y MySQL no considera iguales dos NULL en un índice único).
  UNIQUE KEY uq_planilla_identidad (empresa_id, anio, mes, numero_quincena, tipo_periodo),
  INDEX idx_periodos_fechas (empresa_id, fecha_inicio, fecha_fin),
  CONSTRAINT fk_plan_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_planilla_lineas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  periodo_id INT NOT NULL,
  id_empleado INT NOT NULL,
  codigo_empleado VARCHAR(40) NOT NULL,
  nombre_empleado VARCHAR(200) NOT NULL,
  dpi VARCHAR(20) NULL,
  tipo_contrato VARCHAR(40) NULL,
  forma_pago VARCHAR(40) NOT NULL DEFAULT 'transferencia',
  sueldo_base DECIMAL(12,2) NOT NULL DEFAULT 0,
  bono_incentivo DECIMAL(12,2) NOT NULL DEFAULT 0,
  bono_herramientas DECIMAL(12,2) NOT NULL DEFAULT 0,
  otros_ingresos DECIMAL(12,2) NOT NULL DEFAULT 0,
  igss_laboral DECIMAL(12,2) NOT NULL DEFAULT 0,
  igss_patronal DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuentos DECIMAL(12,2) NOT NULL DEFAULT 0,
  isr DECIMAL(12,2) NOT NULL DEFAULT 0,
  neto DECIMAL(12,2) NOT NULL DEFAULT 0,
  estado_pago VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
  ref_pago VARCHAR(120) NULL,
  notas TEXT NULL,
  UNIQUE KEY uq_plan_linea (periodo_id, id_empleado),
  INDEX idx_plan_lineas_periodo (empresa_id, periodo_id),
  INDEX idx_plan_lineas_pago (empresa_id, forma_pago, estado_pago)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Horas extra — registro (supervisor) separado de autorización (RRHH).
-- Fase H1: agrega estado/autorizado_por/autorizado_en/motivo_rechazo y
-- planilla_periodo_id (sin usar todavía — lo conecta H2, igual que
-- rrhh_descuento_cuotas.planilla_periodo_id en D1/D2). Registros históricos
-- (previos a H1) quedan con estado NULL — no se reinterpretan como
-- PENDIENTE ni se marcan automáticamente APLICADA_EN_PLANILLA: ya fueron
-- procesados bajo el modelo anterior (prestacion_id) y no hay forma segura
-- de confirmar cuáles llegaron a pagarse en una planilla real.
CREATE TABLE IF NOT EXISTS horas_extra_registros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  fecha DATE NOT NULL,
  horas DECIMAL(5,2) NOT NULL,
  tarifa_hora DECIMAL(10,4) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  motivo TEXT NULL,
  registrado_por_id INT NOT NULL,
  registrado_por_nombre VARCHAR(150) NOT NULL,
  prestacion_id INT NULL,
  -- Fase H1:
  estado VARCHAR(30) NULL, -- PENDIENTE | APROBADA | RECHAZADA | APLICADA_EN_PLANILLA | NULL (legado, previo a H1)
  autorizado_por VARCHAR(100) NULL,
  autorizado_en DATETIME NULL,
  motivo_rechazo VARCHAR(300) NULL,
  planilla_periodo_id INT NULL, -- Fase H1/H2: periodo de planilla donde se aplicó
  aplicado_en DATETIME NULL, -- Fase H2: fecha/hora de aplicación a planilla
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_horext_empresa_emp (empresa_id, id_empleado),
  INDEX idx_horext_supervisor (empresa_id, registrado_por_id),
  INDEX idx_horext_estado (empresa_id, estado),
  CONSTRAINT fk_horext_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_horext_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE,
  CONSTRAINT fk_horext_supervisor FOREIGN KEY (registrado_por_id) REFERENCES empleados(id) ON DELETE CASCADE,
  CONSTRAINT fk_horext_prestacion FOREIGN KEY (prestacion_id) REFERENCES rrhh_prestaciones(id) ON DELETE SET NULL,
  CONSTRAINT fk_horext_periodo FOREIGN KEY (planilla_periodo_id) REFERENCES rrhh_planilla_periodos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Múltiples supervisores por empleado (tabla puente). empleados.supervisor_id
-- se mantiene en paralelo como compatibilidad legado (= primer supervisor).
CREATE TABLE IF NOT EXISTS empleado_supervisores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  empleado_id INT NOT NULL,
  supervisor_id INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_empsup_relacion (empresa_id, empleado_id, supervisor_id),
  INDEX idx_empsup_empleado (empresa_id, empleado_id),
  INDEX idx_empsup_supervisor (empresa_id, supervisor_id),
  CONSTRAINT fk_empsup_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_empsup_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE,
  CONSTRAINT fk_empsup_supervisor FOREIGN KEY (supervisor_id) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS configuracion (
  empresa_id INT NOT NULL,
  parametro VARCHAR(100) NOT NULL,
  valor TEXT NOT NULL,
  PRIMARY KEY (empresa_id, parametro),
  CONSTRAINT fk_cfg_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feriados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  descripcion VARCHAR(200) NOT NULL,
  fecha DATE NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_feriado (empresa_id, fecha),
  CONSTRAINT fk_fer_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sesiones_trabajo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  fecha_jornada DATE NOT NULL,
  entrada_at DATETIME NULL,
  salida_at DATETIME NULL,
  estado VARCHAR(40) NULL,
  viaje_largo TINYINT(1) NOT NULL DEFAULT 0,
  comentarios_rrhh TEXT NULL,
  KEY idx_sesion_emp_fecha (empresa_id, id_empleado, fecha_jornada),
  CONSTRAINT fk_ses_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_ses_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marcaje_evidencias (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sesion_id INT NOT NULL,
  tipo VARCHAR(10) NOT NULL,
  ruta_relativa VARCHAR(500) NOT NULL,
  nombre_original VARCHAR(255) NOT NULL,
  mime VARCHAR(100) NULL,
  tamano INT NOT NULL,
  latitud DECIMAL(10,7) NOT NULL,
  longitud DECIMAL(10,7) NOT NULL,
  ubicacion_id INT NULL,
  capturado_en DATETIME NOT NULL,
  registrado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_marcaje_evidencia_tipo (sesion_id, tipo),
  KEY idx_marcaje_evidencia_empresa (empresa_id, capturado_en),
  CONSTRAINT fk_marcaje_ev_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_marcaje_ev_sesion FOREIGN KEY (sesion_id) REFERENCES sesiones_trabajo(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS incidencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  subtipo VARCHAR(80) NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  dias_habiles DECIMAL(8,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_inc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_inc_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS saldos_vacaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  anio_laboral INT NULL,
  periodo_inicio DATE NOT NULL,
  periodo_fin DATE NOT NULL,
  dias_otorgados DECIMAL(8,2) NOT NULL DEFAULT 0,
  dias_disponibles DECIMAL(8,2) NOT NULL DEFAULT 0,
  estado VARCHAR(30) NOT NULL DEFAULT 'Vigente',
  UNIQUE KEY uq_saldo_periodo (id_empleado, periodo_inicio, periodo_fin),
  CONSTRAINT fk_saldo_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_saldo_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS detalle_consumo_vacaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  incidencia_id INT NOT NULL,
  saldo_id INT NOT NULL,
  dias_tomados DECIMAL(8,2) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_det_inc FOREIGN KEY (incidencia_id) REFERENCES incidencias(id) ON DELETE CASCADE,
  CONSTRAINT fk_det_saldo FOREIGN KEY (saldo_id) REFERENCES saldos_vacaciones(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marcajes_en_ruta (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  comentario TEXT NULL,
  registrado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ruta_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_ruta_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS documentos_empleados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  tipo_documento VARCHAR(100) NULL,
  ruta_archivo VARCHAR(500) NOT NULL,
  nombre_original VARCHAR(255) NULL,
  subido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subido_por VARCHAR(100) NULL,
  CONSTRAINT fk_doc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_doc_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fase D1 (RRHH): motor de descuentos y cuotas. rrhh_descuentos (arriba)
-- queda como histórico/legado — NO se toca, NO se migra automáticamente.
-- Este motor nuevo aplica solo a descuentos creados de aquí en adelante.
-- IGSS/ISR siguen con sus propios motores (contratos-pago.ts / isr.ts) —
-- estas tablas son exclusivamente para descuentos adicionales/manuales
-- (LEGAL/AUTORIZADO/JUDICIAL/SISTEMA).
CREATE TABLE IF NOT EXISTS rrhh_descuentos_maestro (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  empleado_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  concepto VARCHAR(200) NOT NULL,
  clasificacion VARCHAR(20) NOT NULL, -- LEGAL | AUTORIZADO | JUDICIAL | SISTEMA
  motivo TEXT NULL,
  monto_original DECIMAL(12,2) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR', -- BORRADOR | ACTIVO | PAUSADO | FINALIZADO | CANCELADO
  periodicidad VARCHAR(20) NOT NULL, -- UNA_VEZ | CADA_QUINCENA | SOLO_QUINCENA_1 | SOLO_QUINCENA_2 | CADA_N_QUINCENAS | MENSUAL | MANUAL
  numero_cuotas INT NOT NULL DEFAULT 1,
  monto_cuota DECIMAL(12,2) NOT NULL,
  cada_n_quincenas INT NULL,
  tipo_quincena_inicio VARCHAR(20) NULL, -- QUINCENA_1 | QUINCENA_2 | MENSUAL (informativo; fecha_inicio manda)
  quincena_inicio TINYINT NULL, -- 1 | 2 (informativo)
  fecha_inicio DATE NOT NULL,
  documento_id INT NULL,
  autorizado_por VARCHAR(100) NULL,
  autorizado_en DATETIME NULL,
  motivo_pausa VARCHAR(300) NULL,
  motivo_cancelacion VARCHAR(300) NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_descm_codigo (empresa_id, codigo),
  INDEX idx_descm_emp (empresa_id, empleado_id),
  INDEX idx_descm_estado (empresa_id, estado),
  CONSTRAINT fk_descm_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_descm_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE,
  CONSTRAINT fk_descm_documento FOREIGN KEY (documento_id) REFERENCES documentos_empleados(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_descuento_cuotas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  descuento_id INT NOT NULL,
  numero_cuota INT NOT NULL,
  fecha_programada DATE NOT NULL,
  monto_programado DECIMAL(12,2) NOT NULL,
  monto_aplicado DECIMAL(12,2) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE', -- PENDIENTE | APLICADA | OMITIDA | CANCELADA
  -- Fase D1: la columna existe y queda vinculable, pero D1 NO la conecta a
  -- generarLineasPeriodo — nadie la escribe todavía. Eso es D2.
  planilla_periodo_id INT NULL,
  aplicado_en DATETIME NULL,
  aplicado_por VARCHAR(100) NULL,
  motivo_ajuste VARCHAR(300) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Prevención estructural de cuotas duplicadas dentro del mismo descuento.
  UNIQUE KEY uq_cuota_numero (descuento_id, numero_cuota),
  INDEX idx_cuota_desc (descuento_id),
  INDEX idx_cuota_estado (empresa_id, estado),
  INDEX idx_cuota_fecha (empresa_id, fecha_programada),
  CONSTRAINT fk_cuota_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_cuota_descuento FOREIGN KEY (descuento_id) REFERENCES rrhh_descuentos_maestro(id) ON DELETE CASCADE,
  CONSTRAINT fk_cuota_periodo FOREIGN KEY (planilla_periodo_id) REFERENCES rrhh_planilla_periodos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_descuento_abonos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  descuento_id INT NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  fecha DATE NOT NULL,
  motivo VARCHAR(300) NOT NULL,
  registrado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_abono_desc (descuento_id),
  CONSTRAINT fk_abono_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_abono_descuento FOREIGN KEY (descuento_id) REFERENCES rrhh_descuentos_maestro(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS evidencias_incidencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  incidencia_id INT NOT NULL,
  ruta_archivo VARCHAR(500) NOT NULL,
  nombre_original VARCHAR(255) NULL,
  subido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subido_por VARCHAR(100) NULL,
  INDEX idx_ev_empresa (empresa_id),
  INDEX idx_ev_incidencia (incidencia_id),
  CONSTRAINT fk_ev_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_ev_inc FOREIGN KEY (incidencia_id) REFERENCES incidencias(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventario_rrhh (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(80) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  categoria VARCHAR(80) NULL,
  stock INT NOT NULL DEFAULT 0,
  unidad VARCHAR(40) NOT NULL DEFAULT 'Unidad',
  costo_unitario DECIMAL(12,2) NULL, -- Fase INV-0
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo',
  UNIQUE KEY uq_inv_rrhh (empresa_id, codigo),
  CONSTRAINT fk_invrh_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fase INV-0: historial de movimientos de stock (append-only). Solo
-- 'ENTRADA' y 'AJUSTE' por ahora; entrega/devolución/pérdida son fases
-- futuras (columna VARCHAR sin lista cerrada, no requieren migración
-- nueva para agregarse).
CREATE TABLE IF NOT EXISTS inventario_rrhh_movimientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  articulo_id INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  cantidad INT NOT NULL, -- delta con signo: + entrada/incremento, - ajuste a la baja
  stock_resultante INT NOT NULL, -- stock del artículo justo después de este movimiento
  motivo VARCHAR(300) NULL,
  registrado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_invmov_articulo (empresa_id, articulo_id),
  INDEX idx_invmov_empresa (empresa_id, creado_en),
  CONSTRAINT fk_invmov_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_invmov_articulo FOREIGN KEY (articulo_id) REFERENCES inventario_rrhh(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fase INV-1: entrega de un artículo a un empleado, con o sin cobro.
-- descuento_id apunta HACIA rrhh_descuentos_maestro (no al revés) — D1/D2
-- no requieren ningún cambio de schema. costo_unitario_entrega es el precio
-- histórico al momento de la entrega (no cambia si luego cambia
-- inventario_rrhh.costo_unitario). Sin hard delete desde la aplicación —
-- registro histórico/contable (por eso articulo_id/empleado_id usan
-- ON DELETE RESTRICT, no CASCADE).
CREATE TABLE IF NOT EXISTS inventario_rrhh_entregas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  articulo_id INT NOT NULL,
  empleado_id INT NOT NULL,
  cantidad INT NOT NULL,
  costo_unitario_entrega DECIMAL(12,2) NOT NULL,
  costo_total DECIMAL(12,2) NOT NULL,
  monto_cobrado DECIMAL(12,2) NOT NULL DEFAULT 0,
  descuento_id INT NULL,
  movimiento_id INT NULL,
  motivo VARCHAR(300) NULL,
  entregado_por VARCHAR(100) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ENTREGADO',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_entregas_articulo (empresa_id, articulo_id),
  INDEX idx_entregas_empleado (empresa_id, empleado_id),
  INDEX idx_entregas_descuento (descuento_id),
  CONSTRAINT fk_entregas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_entregas_articulo FOREIGN KEY (articulo_id) REFERENCES inventario_rrhh(id) ON DELETE RESTRICT,
  CONSTRAINT fk_entregas_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE RESTRICT,
  CONSTRAINT fk_entregas_descuento FOREIGN KEY (descuento_id) REFERENCES rrhh_descuentos_maestro(id) ON DELETE SET NULL,
  CONSTRAINT fk_entregas_movimiento FOREIGN KEY (movimiento_id) REFERENCES inventario_rrhh_movimientos(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vacaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  dias_habiles DECIMAL(8,2) NOT NULL DEFAULT 0,
  observaciones TEXT NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Aprobado',
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_vac_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_vac_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NULL,
  usuario VARCHAR(100) NULL,
  accion VARCHAR(80) NOT NULL,
  modulo VARCHAR(40) NULL,
  detalle TEXT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_aud_empresa (empresa_id),
  KEY idx_aud_cuando (creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- TMS
CREATE TABLE IF NOT EXISTS tms_clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  nit VARCHAR(40) NULL,
  telefono VARCHAR(80) NULL,
  direccion VARCHAR(300) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo',
  CONSTRAINT fk_tmscli_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_lugares (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'Carga',
  direccion VARCHAR(300) NULL,
  CONSTRAINT fk_tmslug_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_unidades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  placa VARCHAR(40) NOT NULL,
  -- Fase A del plan Programación SITSA: vínculo estructural hacia
  -- flota_vehiculos.id. Nullable a propósito (backfill progresivo, ver
  -- migrate-2026-08-fase-a1-tms-unidades-flota-vinculo.sql). La FK se
  -- declara más abajo, DESPUÉS de flota_vehiculos, porque esa tabla
  -- todavía no existe en este punto del archivo (orden de creación).
  flota_vehiculo_id INT NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'Camion',
  marca VARCHAR(80) NULL,
  modelo VARCHAR(80) NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Disponible',
  UNIQUE KEY uq_unidad (empresa_id, placa),
  INDEX idx_tmsuni_flota (flota_vehiculo_id),
  CONSTRAINT fk_tmsuni_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_personal (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(80) NULL,
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'Piloto',
  telefono VARCHAR(80) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo',
  CONSTRAINT fk_tmspers_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_planes_viaje (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(80) NOT NULL,
  cliente_id INT NULL,
  lugar_carga_id INT NULL,
  lugar_descarga_id INT NULL,
  unidad_id INT NULL,
  piloto_id INT NULL,
  auxiliar_id INT NULL,
  fecha_plan DATE NOT NULL,
  hora_carga VARCHAR(20) NULL,
  tipo_traslado VARCHAR(80) NULL,
  regreso_estimado DATETIME NULL,
  tarifa_comercial DECIMAL(12,2) NULL,
  referencia_cliente VARCHAR(160) NULL,
  -- VIAT-4: fotografía histórica de qué ruta maestra (tms_cliente_rutas)
  -- se usó para armar este viaje. ruta_id es solo informativo (sin FK,
  -- mismo criterio que tms_plan_paradas.cliente_ubicacion_id) —
  -- ruta_codigo_historico es el código YA COPIADO en el momento, el que
  -- debe salir en el reporte tradicional (nunca se recalcula desde la
  -- ruta viva, que puede cambiar o desactivarse después).
  ruta_id INT NULL,
  ruta_codigo_historico VARCHAR(40) NULL,
  -- VIAT-4b: fotografía histórica adicional (destino + contacto) — ver
  -- sql/migrate-2026-08-viat-4b-rutas-correcciones.sql. El reporte
  -- tradicional usa lugar_descarga_historico, NUNCA "primera parada".
  -- Los contacto_*_historico son la copia de nombre/cargo/teléfono en el
  -- momento; si el contacto del cliente cambia después, este viaje ya
  -- creado no se ve afectado.
  lugar_descarga_historico VARCHAR(300) NULL,
  contacto_nombre_historico VARCHAR(160) NULL,
  contacto_cargo_historico VARCHAR(120) NULL,
  contacto_telefono_historico VARCHAR(80) NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Programado',
  notas TEXT NULL,
  UNIQUE KEY uq_plan (empresa_id, codigo),
  CONSTRAINT fk_tmsplan_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsplan_cli FOREIGN KEY (cliente_id) REFERENCES tms_clientes(id) ON DELETE SET NULL,
  CONSTRAINT fk_tmsplan_lc FOREIGN KEY (lugar_carga_id) REFERENCES tms_lugares(id) ON DELETE SET NULL,
  CONSTRAINT fk_tmsplan_ld FOREIGN KEY (lugar_descarga_id) REFERENCES tms_lugares(id) ON DELETE SET NULL,
  CONSTRAINT fk_tmsplan_uni FOREIGN KEY (unidad_id) REFERENCES tms_unidades(id) ON DELETE SET NULL,
  CONSTRAINT fk_tmsplan_pil FOREIGN KEY (piloto_id) REFERENCES tms_personal(id) ON DELETE SET NULL,
  CONSTRAINT fk_tmsplan_aux FOREIGN KEY (auxiliar_id) REFERENCES tms_personal(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_evidencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'Carga',
  ruta_archivo VARCHAR(500) NOT NULL,
  nombre_original VARCHAR(255) NULL,
  latitud DECIMAL(10,7) NULL,
  longitud DECIMAL(10,7) NULL,
  capturado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subido_por VARCHAR(100) NULL,
  CONSTRAINT fk_tmsev_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsev_plan FOREIGN KEY (plan_id) REFERENCES tms_planes_viaje(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- VIAT-0: viáticos operativos asociados a una programación/viaje. Flujo
-- puramente OPERATIVO de TMS/viaje — NUNCA se pagan por planilla/nómina;
-- sin relación con rrhh_planilla_lineas. Ver
-- sql/migrate-2026-08-viat-0-viaticos.sql para el detalle de diseño.
CREATE TABLE IF NOT EXISTS tms_viaticos_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  puesto VARCHAR(60) NOT NULL,
  -- Reutiliza el mismo vocabulario que empleados.categoria_ops /
  -- tms_personal.tipo (Piloto | Auxiliar | ...) — no es un catálogo nuevo.
  monto_defecto DECIMAL(12,2) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  actualizado_por VARCHAR(100) NULL,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_viaticos_cfg (empresa_id, puesto),
  CONSTRAINT fk_viacfg_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_viaticos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  -- tms_personal.id del piloto/auxiliar REALMENTE asignado al viaje (nunca
  -- empleados.id directo; el empleado real, cuando existe, se deriva vía
  -- tms_personal.id_empleado).
  personal_id INT NOT NULL,
  rol VARCHAR(20) NOT NULL, -- 'Piloto' | 'Auxiliar'
  monto_sugerido DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_asignado DECIMAL(12,2) NOT NULL DEFAULT 0,
  motivo_cambio VARCHAR(300) NULL,
  modificado_por VARCHAR(100) NULL,
  -- Fase operativa posterior VIAT-1 (no usado todavía): PENDIENTE/
  -- PROGRAMADO -> AUTORIZADO -> ENTREGADO -> LIQUIDADO. Nunca depende de
  -- una planilla ni de rrhh_planilla_lineas.
  estado VARCHAR(30) NOT NULL DEFAULT 'PROGRAMADO',
  -- Fase VIAT-1: medio de entrega del efectivo — EFECTIVO | TRANSFERENCIA |
  -- CHEQUE. NUNCA 'Planilla'.
  metodo_pago VARCHAR(20) NULL,
  -- VIAT-1: trazabilidad de las 3 transiciones (PROGRAMADO -> AUTORIZADO ->
  -- ENTREGADO -> LIQUIDADO). Ver sql/migrate-2026-08-viat-1-ciclo-viaticos.sql.
  autorizado_por VARCHAR(100) NULL,
  autorizado_en DATETIME NULL,
  entregado_por VARCHAR(100) NULL,
  entregado_en DATETIME NULL,
  referencia_pago VARCHAR(100) NULL,
  observaciones_entrega VARCHAR(300) NULL,
  liquidado_por VARCHAR(100) NULL,
  liquidado_en DATETIME NULL,
  observaciones_liquidacion VARCHAR(300) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_viatico_plan_personal (plan_id, personal_id),
  INDEX idx_viatico_empresa_plan (empresa_id, plan_id),
  CONSTRAINT fk_via_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_via_plan FOREIGN KEY (plan_id) REFERENCES tms_planes_viaje(id) ON DELETE CASCADE,
  CONSTRAINT fk_via_personal FOREIGN KEY (personal_id) REFERENCES tms_personal(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- VIAT-1: ubicaciones guardadas por cliente (paradas frecuentes), para
-- acelerar Programación. Ver sql/migrate-2026-08-viat-1-cliente-ubicaciones.sql
-- para el detalle. (tms_plan_paradas.cliente_ubicacion_id no se declara
-- aquí: esa tabla se crea vía código en tiempo de ejecución, no en este
-- archivo — ver src/lib/flota/schema.ts).
CREATE TABLE IF NOT EXISTS tms_cliente_ubicaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  direccion VARCHAR(300) NULL,
  municipio VARCHAR(120) NULL,
  departamento VARCHAR(120) NULL,
  referencia VARCHAR(300) NULL,
  tipo VARCHAR(20) NOT NULL DEFAULT 'AMBOS',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tmscliub_cliente (empresa_id, cliente_id, activo),
  CONSTRAINT fk_tmscliub_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmscliub_cliente FOREIGN KEY (cliente_id) REFERENCES tms_clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- VIAT-4: contactos operativos por cliente (modelo reutilizable, no un
-- campo suelto) + catálogo maestro de rutas/servicios (Operaciones >
-- Rutas) + sus paradas. Ver
-- sql/migrate-2026-08-viat-4-contactos-rutas.sql para el detalle de
-- diseño (por qué UNIQUE por cliente y no global, por qué ruta_id en
-- tms_planes_viaje va sin FK, etc.).
CREATE TABLE IF NOT EXISTS tms_cliente_contactos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  cargo VARCHAR(120) NULL,
  telefono VARCHAR(80) NULL,
  email VARCHAR(160) NULL,
  observaciones VARCHAR(300) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tmsclicont_cliente (empresa_id, cliente_id, activo),
  CONSTRAINT fk_tmsclicont_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsclicont_cliente FOREIGN KEY (cliente_id) REFERENCES tms_clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_cliente_rutas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(200) NULL,
  ubicacion_carga_id INT NULL,
  lugar_carga_texto VARCHAR(300) NULL,
  -- VIAT-4b: descripción operativa completa del destino (texto libre,
  -- formato tipo "RUTA-X - punto1-punto2-punto3"), confirmada contra el
  -- Excel real de Operaciones — DISTINTA de tms_cliente_ruta_paradas (paradas
  -- estructuradas con orden, que se mantienen en paralelo).
  destino_descripcion VARCHAR(300) NULL,
  hora_habitual VARCHAR(20) NULL,
  contacto_cliente_id INT NULL,
  observaciones VARCHAR(300) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- VIAT-4b: único POR EMPRESA (no por cliente) — confirmado contra el
  -- Excel real: 147 códigos, 147 únicos, funciona como identificador
  -- global del catálogo.
  UNIQUE KEY uq_tmsclirutas_codigo (empresa_id, codigo),
  INDEX idx_tmsclirutas_cliente (empresa_id, cliente_id, activo),
  INDEX idx_tmsclirutas_codigo (empresa_id, codigo),
  CONSTRAINT fk_tmsclirutas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsclirutas_cliente FOREIGN KEY (cliente_id) REFERENCES tms_clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_cliente_ruta_paradas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  ruta_id INT NOT NULL,
  cliente_ubicacion_id INT NULL,
  orden TINYINT NOT NULL DEFAULT 1,
  tipo VARCHAR(40) NOT NULL DEFAULT 'Entrega',
  lugar_nombre VARCHAR(200) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_tmscliparadas_ruta (ruta_id, activo, orden),
  CONSTRAINT fk_tmscliparadas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmscliparadas_ruta FOREIGN KEY (ruta_id) REFERENCES tms_cliente_rutas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Flota / Predios
CREATE TABLE IF NOT EXISTS flota_vehiculos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  placa VARCHAR(40) NOT NULL,
  marca VARCHAR(80) NULL,
  modelo VARCHAR(80) NULL,
  descripcion VARCHAR(200) NULL,
  color VARCHAR(80) NULL,
  tipo_combustible VARCHAR(40) NULL DEFAULT 'diesel',
  chasis VARCHAR(80) NULL,
  capacidad VARCHAR(80) NULL,
  credito VARCHAR(80) NULL,
  empresa_activo VARCHAR(120) NULL,
  nit VARCHAR(40) NULL,
  condicion_propiedad VARCHAR(120) NULL,
  seguros VARCHAR(120) NULL,
  km_actual INT NULL,
  km_intervalo_servicio INT NOT NULL DEFAULT 5000,
  km_ultimo_servicio INT NULL,
  fecha_ultimo_servicio DATE NULL,
  odometro_funcional TINYINT(1) NOT NULL DEFAULT 1,
  mantenimiento_intervalo_meses SMALLINT NULL,
  en_taller TINYINT(1) NOT NULL DEFAULT 0,
  fecha_entrada_taller DATE NULL,
  motivo_taller VARCHAR(300) NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Activo',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  notas TEXT NULL,
  UNIQUE KEY uq_flota_placa (empresa_id, placa),
  CONSTRAINT fk_flota_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fase A del plan Programación SITSA: la FK de tms_unidades.flota_vehiculo_id
-- se declara aquí (no inline arriba en tms_unidades) porque flota_vehiculos
-- recién queda definida en este punto del archivo.
ALTER TABLE tms_unidades
  ADD CONSTRAINT fk_tmsuni_flota
  FOREIGN KEY (flota_vehiculo_id) REFERENCES flota_vehiculos(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS flota_lecturas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  vehiculo_id INT NOT NULL,
  km INT NOT NULL,
  fecha_lectura DATE NOT NULL,
  nota VARCHAR(300) NULL,
  conductor VARCHAR(120) NULL,
  registrado_por VARCHAR(100) NULL,
  CONSTRAINT fk_flotal_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_flotal_veh FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flota_servicios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  vehiculo_id INT NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  tipo_trabajo VARCHAR(120) NULL,
  km_servicio INT NULL,
  fecha_servicio DATE NOT NULL,
  costo DECIMAL(12,2) NOT NULL DEFAULT 0,
  descripcion TEXT NULL,
  dias_en_taller INT NULL,
  motivo_taller VARCHAR(300) NULL,
  CONSTRAINT fk_flotas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_flotas_veh FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flota_viajes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  vehiculo_id INT NOT NULL,
  piloto_nombre VARCHAR(120) NOT NULL,
  piloto_usuario_id INT NULL,
  km_salida INT NULL,
  km_llegada INT NULL,
  hora_salida DATETIME NOT NULL,
  hora_llegada DATETIME NULL,
  destino VARCHAR(200) NULL,
  observaciones TEXT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'abierto',
  INDEX idx_fv_emp (empresa_id),
  INDEX idx_fv_estado (empresa_id, estado),
  CONSTRAINT fk_fv_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_fv_veh FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Inventario de equipo / herramientas (Flota)
CREATE TABLE IF NOT EXISTS flota_inv_categorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  descripcion VARCHAR(255) NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_fic_nombre (empresa_id, nombre),
  INDEX idx_fic_emp (empresa_id),
  CONSTRAINT fk_fic_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flota_inv_areas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(255) NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_fia_nombre (empresa_id, nombre),
  INDEX idx_fia_emp (empresa_id),
  CONSTRAINT fk_fia_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flota_inv_equipo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(80) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  categoria_id INT NULL,
  propiedad VARCHAR(20) NOT NULL DEFAULT 'empresa',
  area_id INT NULL,
  empleado_id INT NULL,
  empleado_nombre VARCHAR(200) NULL,
  cantidad INT NOT NULL DEFAULT 1,
  unidad VARCHAR(40) NOT NULL DEFAULT 'Unidad',
  marca VARCHAR(80) NULL,
  serie VARCHAR(120) NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Activo',
  notas TEXT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fie_codigo (empresa_id, codigo),
  INDEX idx_fie_emp (empresa_id),
  INDEX idx_fie_prop (empresa_id, propiedad),
  INDEX idx_fie_cat (categoria_id),
  INDEX idx_fie_area (area_id),
  INDEX idx_fie_empleado (empleado_id),
  CONSTRAINT fk_fie_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Contabilidad (esqueleto)
CREATE TABLE IF NOT EXISTS cont_cuentas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  nivel INT NOT NULL DEFAULT 1,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_cuenta (empresa_id, codigo),
  CONSTRAINT fk_cuenta_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cont_asientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  fecha DATE NOT NULL,
  numero VARCHAR(40) NOT NULL,
  glosa VARCHAR(500) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'Borrador',
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_asiento (empresa_id, numero),
  CONSTRAINT fk_asiento_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cont_asiento_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  asiento_id INT NOT NULL,
  cuenta_id INT NOT NULL,
  debe DECIMAL(14,2) NOT NULL DEFAULT 0,
  haber DECIMAL(14,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_adet_asiento FOREIGN KEY (asiento_id) REFERENCES cont_asientos(id) ON DELETE CASCADE,
  CONSTRAINT fk_adet_cuenta FOREIGN KEY (cuenta_id) REFERENCES cont_cuentas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cont_cxc (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente VARCHAR(200) NOT NULL,
  documento VARCHAR(80) NULL,
  fecha DATE NOT NULL,
  vencimiento DATE NULL,
  monto DECIMAL(14,2) NOT NULL DEFAULT 0,
  saldo DECIMAL(14,2) NOT NULL DEFAULT 0,
  estado VARCHAR(40) NOT NULL DEFAULT 'Pendiente',
  CONSTRAINT fk_cxc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cont_cxp (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  proveedor VARCHAR(200) NOT NULL,
  documento VARCHAR(80) NULL,
  fecha DATE NOT NULL,
  vencimiento DATE NULL,
  monto DECIMAL(14,2) NOT NULL DEFAULT 0,
  saldo DECIMAL(14,2) NOT NULL DEFAULT 0,
  estado VARCHAR(40) NOT NULL DEFAULT 'Pendiente',
  CONSTRAINT fk_cxp_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Catálogo compartido de clientes (Operaciones + Facturación + Contabilidad)
CREATE TABLE IF NOT EXISTS clientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NULL,
  nombre VARCHAR(200) NOT NULL,
  razon_social VARCHAR(250) NULL,
  nit VARCHAR(40) NULL,
  telefono VARCHAR(80) NULL,
  email VARCHAR(160) NULL,
  direccion VARCHAR(300) NULL,
  contacto_nombre VARCHAR(160) NULL,
  contacto_telefono VARCHAR(80) NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'comercial',
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo',
  notas TEXT NULL,
  tms_cliente_id INT NULL,
  creado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_clientes_tms (empresa_id, tms_cliente_id),
  KEY idx_clientes_empresa_nombre (empresa_id, nombre),
  KEY idx_clientes_empresa_estado (empresa_id, estado),
  CONSTRAINT fk_clientes_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Perfil de facturación por empresa (cuestionario)
CREATE TABLE IF NOT EXISTS fact_empresa_perfil (
  empresa_id INT NOT NULL PRIMARY KEY,
  respuestas_json LONGTEXT NOT NULL,
  completado_pct TINYINT UNSIGNED NOT NULL DEFAULT 0,
  actualizado_por INT NULL,
  actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_fact_emp_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Perfil de facturación por cliente (cada cliente factura distinto)
CREATE TABLE IF NOT EXISTS fact_cliente_perfil (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  respuestas_json LONGTEXT NOT NULL,
  completado_pct TINYINT UNSIGNED NOT NULL DEFAULT 0,
  actualizado_por INT NULL,
  actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fact_cli (empresa_id, cliente_id),
  KEY idx_fact_cli_empresa (empresa_id),
  CONSTRAINT fk_fact_cli_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_fact_cli_cliente FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- CMS por empresa
CREATE TABLE IF NOT EXISTS cms_secciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  clave VARCHAR(80) NOT NULL,
  titulo VARCHAR(200) NULL,
  contenido TEXT NULL,
  imagen_url VARCHAR(500) NULL,
  orden INT NOT NULL DEFAULT 0,
  publicada TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_cms (empresa_id, clave),
  CONSTRAINT fk_cms_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Módulos específicos otras empresas (esqueleto)
CREATE TABLE IF NOT EXISTS mod_reciclaje_lotes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(80) NOT NULL,
  material VARCHAR(120) NOT NULL,
  peso_kg DECIMAL(12,2) NOT NULL DEFAULT 0,
  proveedor VARCHAR(200) NULL,
  fecha DATE NOT NULL,
  CONSTRAINT fk_rec_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mod_tarimas_ordenes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(80) NOT NULL,
  cliente VARCHAR(200) NULL,
  cantidad INT NOT NULL DEFAULT 0,
  estado VARCHAR(40) NOT NULL DEFAULT 'Pendiente',
  fecha DATE NOT NULL,
  CONSTRAINT fk_tar_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
