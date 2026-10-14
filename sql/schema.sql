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
  -- Admin | RRHH | Marcaje | Contabilidad | Operaciones (legado) |
  -- GerenteOperaciones | JefeOperaciones | AuxiliarOperaciones |
  -- Facturador | CoordinadorPredios | CoordinadorCompras | Piloto |
  -- Visualizador — VARCHAR simple (no ENUM), agregar un rol nuevo NUNCA
  -- requiere ALTER TABLE aquí, ver sql/migrate-2026-08-ops-1-roles-cierre.sql
  -- para el detalle de OPS-1 (roles nuevos + cierre administrativo).
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

CREATE TABLE IF NOT EXISTS proveedor_portales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  proveedor VARCHAR(160) NOT NULL,
  nombre_portal VARCHAR(160) NOT NULL,
  url VARCHAR(1000) NOT NULL,
  usuario_portal VARCHAR(255) NOT NULL,
  password_cifrado TEXT NOT NULL,
  asignado_usuario_id INT NOT NULL,
  notas VARCHAR(1000) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pp_empresa_asignado (empresa_id, asignado_usuario_id, activo),
  CONSTRAINT fk_pp_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_pp_asignado FOREIGN KEY (asignado_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pp_creado_por FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
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
  UNIQUE KEY uq_ruta_personal_empresa_id (empresa_id, id),
  CONSTRAINT fk_emp_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_vacaciones_sync_estado (
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  ultima_sync_fecha DATE NULL,
  dirty TINYINT(1) NOT NULL DEFAULT 1,
  generacion BIGINT UNSIGNED NOT NULL DEFAULT 0,
  politica_fingerprint VARCHAR(100) NULL,
  fecha_alta_sync DATE NULL,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id, id_empleado),
  CONSTRAINT chk_vsync_dirty CHECK (dirty IN (0, 1)),
  CONSTRAINT fk_vsync_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_vsync_empleado FOREIGN KEY (empresa_id, id_empleado) REFERENCES empleados(empresa_id, id) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

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
  -- Identificador fiscal ESTABLE, separado del label libre `tipo` (ver
  -- sql/migrate-2026-09-rrhh-prestaciones-codigo-concepto.sql). NULL en todo
  -- histórico — nunca inferido desde `tipo` por texto. Catálogo previsto
  -- (documental, sin ENUM/CHECK en SQL): AGUINALDO, BONO_14,
  -- VIATICO_COMPROBABLE, VIATICO_NO_COMPROBABLE, COMISION, BONO_VARIABLE,
  -- OTRO — validación estricta en aplicación/Zod en un PR de integración
  -- futuro, no usado todavía por Planillas.
  codigo_concepto VARCHAR(40) NULL,
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
  autorizado_por VARCHAR(100) NULL,
  autorizado_en DATETIME NULL,
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
  conceptos_snapshot JSON NULL,
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

-- RRHH-INVENTARIO-CAMBIOS-1: devolución/cambio de artículo sobre una entrega
-- ya realizada. Append-only — nunca se actualiza inventario_rrhh_entregas.
-- Ver sql/discovery-2026-09-rrhh-inventario-cambios.sql para el análisis
-- completo (por qué no hace falta ALTER TABLE en ninguna tabla existente).
CREATE TABLE IF NOT EXISTS inventario_rrhh_ajustes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entrega_id INT NOT NULL,
  tipo VARCHAR(20) NOT NULL, -- DEVOLUCION | CAMBIO
  cantidad INT NOT NULL,
  articulo_nuevo_id INT NULL,
  entrega_nueva_id INT NULL,
  movimiento_salida_id INT NULL,
  movimiento_devolucion_id INT NOT NULL,
  motivo VARCHAR(300) NOT NULL,
  registrado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ajustes_entrega (empresa_id, entrega_id),
  UNIQUE KEY uq_ajustes_entrega_nueva (empresa_id, entrega_nueva_id),
  INDEX idx_ajustes_empresa (empresa_id, creado_en),
  CONSTRAINT fk_ajustes_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_ajustes_entrega FOREIGN KEY (entrega_id) REFERENCES inventario_rrhh_entregas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ajustes_articulo_nuevo FOREIGN KEY (articulo_nuevo_id) REFERENCES inventario_rrhh(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ajustes_entrega_nueva FOREIGN KEY (entrega_nueva_id) REFERENCES inventario_rrhh_entregas(id) ON DELETE SET NULL,
  CONSTRAINT fk_ajustes_mov_devolucion FOREIGN KEY (movimiento_devolucion_id) REFERENCES inventario_rrhh_movimientos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ajustes_mov_salida FOREIGN KEY (movimiento_salida_id) REFERENCES inventario_rrhh_movimientos(id) ON DELETE RESTRICT
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
  -- CLIENTE-PORTAL-1: UNIQUE (empresa_id, id) — destino de la FK compuesta
  -- que usan tms_cliente_usuarios/tms_solicitudes_cliente para impedir a
  -- nivel de base de datos que un cliente_id de la empresa B se asocie
  -- por error a un empresa_id de la empresa A. Ver
  -- sql/migrate-2026-09-tms-portal-clientes-base.sql (punto 0).
  UNIQUE KEY uq_tmsclientes_empresa_id (empresa_id, id),
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
  -- PROGRAMACION-TC-CAJA-REMOLQUE-1: TC/caja/remolque del viaje (recurso distinto de
  -- unidad_id). tc_vehiculo_id = TC interno (flota_vehiculos.id, FK más abajo);
  -- tc_placa_historica = fotografía de su placa; tc_externo_placa = TC del
  -- proveedor en viajes Tercerizados (solo texto). Ver migrate-2026-09-
  -- programacion-tc-caja-remolque.sql.
  tc_vehiculo_id INT NULL,
  tc_placa_historica VARCHAR(40) NULL,
  tc_externo_placa VARCHAR(40) NULL,
  -- PROGRAMACION-VEHICULO-SOLICITADO: vehículo/capacidad solicitado comercialmente por el cliente
  -- (perfil de tms_cotizacion_costeo_perfiles, FK compuesta más abajo) + fotografía de su nombre.
  -- Independiente de la unidad real (unidad_id) y de tarifa_comercial. NULL en viajes históricos.
  -- Ver migrate-2026-10-programacion-vehiculo-solicitado.sql.
  vehiculo_solicitado_perfil_id INT NULL,
  vehiculo_solicitado_nombre VARCHAR(120) NULL,
  piloto_id INT NULL,
  auxiliar_id INT NULL,
  fecha_plan DATE NOT NULL,
  hora_carga VARCHAR(20) NULL,
  tipo_traslado VARCHAR(80) NULL,
  regreso_estimado DATETIME NULL,
  tarifa_comercial DECIMAL(12,2) NULL,
  -- RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1: snapshot de la tarifa
  -- del catálogo (tms_ruta_tarifas) usada en este viaje. tarifa_id es
  -- SOLO informativo (sin FK, mismo criterio que ruta_id) — la fila
  -- maestra puede cambiar o desactivarse después. tarifa_*_historico son
  -- la fotografía del nombre/monto/moneda en el momento de armar el
  -- viaje; si mañana cambia la tarifa maestra, este viaje NO cambia de
  -- monto. `tarifa_comercial` (arriba) sigue siendo el monto realmente
  -- cobrado (editable como override) y el que usan los reportes de
  -- ingresos.
  tarifa_id INT NULL DEFAULT NULL,
  tarifa_nombre_historico VARCHAR(120) NULL DEFAULT NULL,
  tarifa_monto_historico DECIMAL(12,2) NULL DEFAULT NULL,
  tarifa_moneda_historico VARCHAR(10) NULL DEFAULT NULL,
  -- TMS-GASTOS-REPORTES-1: snapshot editable del costo operativo de
  -- referencia (copiado de tms_cliente_rutas.costo_operativo al elegir la
  -- ruta) — ver sql/migrate-2026-09-tms-gastos-reportes.sql.
  costo_operativo_referencia DECIMAL(12,2) NULL DEFAULT NULL,
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
  -- OPS-1: Programado -> En ruta -> Descargado (operación finalizada por
  -- el piloto, pendiente de cierre) -> Cerrado (cierre administrativo,
  -- permiso viajes_cerrar) — o Cancelado en cualquier punto anterior. Ver
  -- sql/migrate-2026-08-ops-1-roles-cierre.sql y
  -- src/lib/tms/cierre-viaje.ts. cerrado_por/cerrado_en quedan NULL hasta
  -- que el UPDATE condicional (WHERE estado = 'Descargado') los llena.
  -- PROGRAMACION-VIAJES-TERCERIZADOS-1 — 'Propio' | 'Tercerizado'
  -- (validado en la aplicación, ver sql/migrate-2026-09-programacion-
  -- viajes-tercerizados.sql). Un viaje Tercerizado deja piloto_id/
  -- auxiliar_id/unidad_id (arriba) en NULL a propósito — el recurso es
  -- externo, sin FK posible — y guarda su propio snapshot de texto en las
  -- 5 columnas siguientes (nunca crea tms_personal/tms_unidades para un
  -- recurso externo).
  tipo_viaje VARCHAR(20) NOT NULL DEFAULT 'Propio',
  piloto_externo_nombre VARCHAR(160) NULL,
  auxiliares_externos TEXT NULL,
  unidad_externa_placa VARCHAR(40) NULL,
  unidad_externa_descripcion VARCHAR(160) NULL,
  transportista_externo VARCHAR(160) NULL,
  -- Informativo/control interno únicamente — NUNCA cuentas por pagar ni
  -- integración con Compras (fuera de alcance, ver el ticket sección 12).
  costo_tercerizado DECIMAL(12,2) NULL,
  cerrado_por VARCHAR(100) NULL,
  cerrado_en DATETIME NULL,
  notas TEXT NULL,
  UNIQUE KEY uq_plan (empresa_id, codigo),
  -- CLIENTE-PORTAL-1 (AJUSTE PRE-MERGE PR #167): destino de la FK
  -- compuesta (empresa_id, plan_id) de tms_solicitudes_cliente — ver
  -- sql/migrate-2026-09-tms-portal-clientes-base.sql (punto 0b).
  UNIQUE KEY uq_tmsplanes_empresa_id (empresa_id, id),
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

-- Requerimientos manuales/transitorios: modelo separado del viático generado
-- desde Programación. DDL canónico en migrate-2026-09-viaticos-requerimientos-manuales.sql.
CREATE TABLE IF NOT EXISTS tms_viatico_requerimientos (
  id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL,
  fecha_requerimiento DATE NOT NULL, empresa_requirente_nombre VARCHAR(200) NOT NULL,
  requirente_usuario_id INT NOT NULL, requirente_nombre_snapshot VARCHAR(200) NOT NULL,
  solicitante_usuario_id INT NOT NULL, solicitante_nombre_snapshot VARCHAR(200) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR', total DECIMAL(14,2) NOT NULL DEFAULT 0,
  observaciones TEXT NULL, autorizado_por_usuario_id INT NULL, autorizado_por_nombre VARCHAR(200) NULL,
  autorizado_en DATETIME NULL, rechazado_por_usuario_id INT NULL, rechazado_por_nombre VARCHAR(200) NULL,
  rechazado_en DATETIME NULL, motivo_rechazo VARCHAR(1000) NULL, metodo_entrega VARCHAR(20) NULL,
  referencia_entrega VARCHAR(100) NULL, entregado_por_usuario_id INT NULL, entregado_por_nombre VARCHAR(200) NULL,
  entregado_en DATETIME NULL, observaciones_entrega VARCHAR(1000) NULL, liquidado_por_usuario_id INT NULL,
  liquidado_por_nombre VARCHAR(200) NULL, liquidado_en DATETIME NULL, observaciones_liquidacion VARCHAR(1000) NULL,
  version INT NOT NULL DEFAULT 1, creado_por INT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vreq_empresa_codigo (empresa_id, codigo), UNIQUE KEY uq_vreq_empresa_id (empresa_id, id),
  KEY idx_vreq_estado_fecha (empresa_id, estado, fecha_requerimiento),
  CONSTRAINT fk_vreq_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT chk_vreq_estado CHECK (estado IN ('BORRADOR','PENDIENTE','AUTORIZADO','RECHAZADO','ENTREGADO','LIQUIDADO')),
  CONSTRAINT chk_vreq_metodo CHECK (metodo_entrega IS NULL OR metodo_entrega IN ('EFECTIVO','TRANSFERENCIA','CHEQUE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tms_viatico_requerimiento_lineas (
  id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, requerimiento_id INT NOT NULL, orden INT NOT NULL,
  fecha_solicitud DATE NOT NULL, fecha_viaje DATE NOT NULL, personal_id INT NOT NULL, empleado_id INT NULL, personal_nombre_snapshot VARCHAR(200) NOT NULL,
  cargo_snapshot VARCHAR(120) NOT NULL, vehiculo_id INT NULL, placa_snapshot VARCHAR(40) NULL,
  cliente_id INT NULL, cliente_nombre_snapshot VARCHAR(200) NULL, cantidad DECIMAL(10,2) NOT NULL DEFAULT 1,
  destino VARCHAR(300) NOT NULL, monto_sugerido DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_unitario DECIMAL(12,2) NOT NULL, motivo_cambio VARCHAR(300) NULL, total DECIMAL(14,2) NOT NULL,
  plan_id INT NULL, origen VARCHAR(20) NOT NULL DEFAULT 'MANUAL', observaciones TEXT NULL,
  UNIQUE KEY uq_vreql_empresa_id (empresa_id, id), UNIQUE KEY uq_vreql_orden (empresa_id, requerimiento_id, orden),
  KEY idx_vreql_personal (empresa_id, personal_id), KEY idx_vreql_plan (empresa_id, plan_id),
  CONSTRAINT fk_vreql_req FOREIGN KEY (empresa_id, requerimiento_id) REFERENCES tms_viatico_requerimientos(empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_vreql_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  -- FKs simples: las relaciones nullable conservan ON DELETE SET NULL sin
  -- intentar nulificar empresa_id; el tenant se valida en la aplicación.
  CONSTRAINT fk_vreql_personal FOREIGN KEY (personal_id) REFERENCES tms_personal(id),
  CONSTRAINT fk_vreql_vehiculo FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE SET NULL,
  CONSTRAINT fk_vreql_cliente FOREIGN KEY (cliente_id) REFERENCES tms_clientes(id) ON DELETE SET NULL,
  CONSTRAINT fk_vreql_plan FOREIGN KEY (plan_id) REFERENCES tms_planes_viaje(id) ON DELETE SET NULL,
  CONSTRAINT chk_vreql_origen CHECK (origen IN ('MANUAL','PROGRAMACION')),
  CONSTRAINT chk_vreql_cantidad CHECK (cantidad > 0), CONSTRAINT chk_vreql_montos CHECK (monto_unitario >= 0 AND total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  tarifa_referencia DECIMAL(12,2) NULL DEFAULT NULL,
  servicio_refrigerado_habitual TINYINT(1) NOT NULL DEFAULT 0,
  costo_operativo DECIMAL(12,2) NULL DEFAULT NULL,
  -- RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1: unidad habitual de la
  -- ruta (opcional). FK simple a flota_vehiculos(id) más abajo; el
  -- aislamiento por empresa lo valida la aplicación
  -- (validarUnidadRecurrenteTx). Programación la precarga como sugerencia;
  -- cambiar la unidad de un viaje NO altera esta configuración.
  unidad_recurrente_id INT NULL DEFAULT NULL,
  contacto_cliente_id INT NULL,
  observaciones VARCHAR(300) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- VIAT-4b: único POR EMPRESA (no por cliente) — confirmado contra el
  -- Excel real: 147 códigos, 147 únicos, funciona como identificador
  -- global del catálogo.
  UNIQUE KEY uq_tmsclirutas_codigo (empresa_id, codigo),
  UNIQUE KEY uq_ruta_personal_empresa_id (empresa_id, id),
  INDEX idx_tmsclirutas_cliente (empresa_id, cliente_id, activo),
  INDEX idx_tmsclirutas_codigo (empresa_id, codigo),
  CONSTRAINT fk_tmsclirutas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsclirutas_cliente FOREIGN KEY (cliente_id) REFERENCES tms_clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Personal y viáticos sugeridos por ruta. Programación copia estos
-- valores al viaje; editar la plantilla no modifica viajes existentes.
CREATE TABLE IF NOT EXISTS tms_cliente_ruta_personal (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  ruta_id INT NOT NULL,
  empleado_id INT NOT NULL,
  rol VARCHAR(20) NOT NULL,
  orden TINYINT UNSIGNED NOT NULL DEFAULT 1,
  viatico_monto DECIMAL(12,2) NULL DEFAULT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ruta_personal_empleado (ruta_id, empleado_id),
  UNIQUE KEY uq_ruta_personal_orden (ruta_id, rol, orden),
  INDEX idx_ruta_personal_empresa (empresa_id, ruta_id, rol, orden),
  INDEX idx_ruta_personal_empleado (empresa_id, empleado_id),
  CONSTRAINT fk_ruta_personal_ruta_ambito FOREIGN KEY (empresa_id, ruta_id)
    REFERENCES tms_cliente_rutas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_ruta_personal_empleado_ambito FOREIGN KEY (empresa_id, empleado_id)
    REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT
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

-- CLIENTE-PORTAL-1: modelo base del Portal del Cliente (usuarios de
-- acceso por cliente TMS + solicitud previa al plan, aún sin flujo de
-- creación/conversión). Ver
-- sql/migrate-2026-09-tms-portal-clientes-base.sql para el detalle de
-- diseño (por qué el UNIQUE del email es global, por qué las FKs
-- empresa_id+cliente_id/plan_id son compuestas, por qué tipo/estado son
-- VARCHAR validados en aplicación y no ENUM/CHECK) y
-- docs/CLIENTE-PORTAL-0-DISCOVERY-SOLICITUDES-SEGUIMIENTO.md para el
-- contexto funcional completo.
CREATE TABLE IF NOT EXISTS tms_cliente_usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  email VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  salt VARCHAR(255) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  debe_cambiar_password TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_acceso DATETIME NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tmscliusr_email (email),
  UNIQUE KEY uq_tmscliusr_empresa_cliente_id (empresa_id, cliente_id, id),
  INDEX idx_tmscliusr_cliente (empresa_id, cliente_id, activo),
  CONSTRAINT fk_tmscliusr_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmscliusr_empresa_cliente FOREIGN KEY (empresa_id, cliente_id)
    REFERENCES tms_clientes(empresa_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_solicitudes_cliente (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  creado_por_usuario_cliente_id INT NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'SOLICITADA',
  fecha_solicitada DATE NOT NULL,
  hora_solicitada TIME NULL,
  referencia_cliente VARCHAR(120) NULL,
  observaciones VARCHAR(500) NULL,
  motivo_rechazo VARCHAR(500) NULL,
  plan_id INT NULL,
  version INT NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tmssolicli_empresa_id (empresa_id, id),
  UNIQUE KEY uq_tmssolicli_plan (empresa_id, plan_id),
  INDEX idx_tmssolicli_cliente (empresa_id, cliente_id, estado),
  INDEX idx_tmssolicli_usuario (empresa_id, cliente_id, creado_por_usuario_cliente_id),
  CONSTRAINT fk_tmssolicli_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmssolicli_empresa_cliente FOREIGN KEY (empresa_id, cliente_id)
    REFERENCES tms_clientes(empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_tmssolicli_usuario FOREIGN KEY (empresa_id, cliente_id, creado_por_usuario_cliente_id)
    REFERENCES tms_cliente_usuarios(empresa_id, cliente_id, id) ON DELETE RESTRICT,
  -- ON DELETE RESTRICT (no SET NULL): una FK compuesta que incluya
  -- empresa_id (NOT NULL) no puede usar SET NULL — ver el comentario
  -- extenso en la migración. RESTRICT es seguro porque tms_planes_viaje
  -- nunca se borra físicamente en este proyecto.
  CONSTRAINT fk_tmssolicli_plan FOREIGN KEY (empresa_id, plan_id)
    REFERENCES tms_planes_viaje(empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_solicitud_paradas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  solicitud_id INT NOT NULL,
  orden TINYINT NOT NULL DEFAULT 1,
  tipo VARCHAR(20) NOT NULL,
  lugar_nombre VARCHAR(200) NOT NULL,
  cliente_ubicacion_id INT NULL,
  referencia VARCHAR(300) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tmssolpar_solicitud (empresa_id, solicitud_id, orden),
  CONSTRAINT fk_tmssolpar_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmssolpar_empresa_solicitud FOREIGN KEY (empresa_id, solicitud_id)
    REFERENCES tms_solicitudes_cliente(empresa_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Flota / Predios
CREATE TABLE IF NOT EXISTS flota_vehiculos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  placa VARCHAR(40) NOT NULL,
  marca VARCHAR(80) NULL,
  modelo VARCHAR(80) NULL,
  descripcion VARCHAR(200) NULL,
  -- PROGRAMACION-TC-CAJA-REMOLQUE-1: 'VEHICULO' | 'CABEZAL' | 'TC' (catálogo validado
  -- en la aplicación, src/lib/flota/tipo-unidad.ts). Default 'VEHICULO'.
  tipo_unidad VARCHAR(20) NOT NULL DEFAULT 'VEHICULO',
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
  -- TMS-GASTOS-REPORTES-1: destino de la FK compuesta de
  -- tms_gastos_operativos.vehiculo_id — mismo patrón que
  -- uq_tmsclientes_empresa_id / uq_tmsplanes_empresa_id /
  -- uq_ruta_personal_empresa_id (empleados/tms_cliente_rutas).
  UNIQUE KEY uq_flota_vehiculos_empresa_id (empresa_id, id),
  CONSTRAINT fk_flota_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fase A del plan Programación SITSA: la FK de tms_unidades.flota_vehiculo_id
-- se declara aquí (no inline arriba en tms_unidades) porque flota_vehiculos
-- recién queda definida en este punto del archivo.
ALTER TABLE tms_unidades
  ADD CONSTRAINT fk_tmsuni_flota
  FOREIGN KEY (flota_vehiculo_id) REFERENCES flota_vehiculos(id)
  ON DELETE SET NULL;

-- PROGRAMACION-TC-CAJA-REMOLQUE-1: índice de disponibilidad diaria del TC y FK a
-- flota_vehiculos (declarada aquí porque flota_vehiculos recién queda definida
-- en este punto). Mismo patrón que fk_tmsuni_flota.
ALTER TABLE tms_planes_viaje
  ADD INDEX idx_tmsplan_tc_fecha (empresa_id, tc_vehiculo_id, fecha_plan),
  ADD CONSTRAINT fk_tmsplan_tc_vehiculo
  FOREIGN KEY (tc_vehiculo_id) REFERENCES flota_vehiculos(id)
  ON DELETE SET NULL;

-- RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1: la FK de
-- tms_cliente_rutas.unidad_recurrente_id se declara aquí (no inline
-- arriba) porque flota_vehiculos recién queda definida en este punto.
-- FK SIMPLE a flota_vehiculos(id), IGUAL que fk_tmsuni_flota arriba
-- (tms_unidades.flota_vehiculo_id): una FK compuesta
-- (empresa_id, unidad_recurrente_id) acopla tms_cliente_rutas.empresa_id
-- al tipo de flota_vehiculos.empresa_id y provoca errno 150 en entornos
-- donde esos tipos difieren (flota puede venir de control-flota). El
-- aislamiento por empresa se valida en la aplicación
-- (validarUnidadRecurrenteTx en src/lib/tms/cliente-rutas.ts).
ALTER TABLE tms_cliente_rutas
  ADD CONSTRAINT fk_tmsclirutas_unidad_recurrente
  FOREIGN KEY (unidad_recurrente_id) REFERENCES flota_vehiculos(id)
  ON DELETE SET NULL;

-- RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1: catálogo de opciones de
-- tarifa por ruta (varias activas a la vez). Cada viaje elige una y
-- guarda su snapshot en tms_planes_viaje (tarifa_nombre/monto/moneda_
-- historico) — cambiar la tarifa maestra NUNCA cambia viajes anteriores.
-- "Solo una predeterminada activa por ruta" se garantiza en la capa de
-- aplicación (ruta-tarifas.ts) dentro de la transacción; la auditoría de
-- cambios va a la tabla `auditoria` genérica.
CREATE TABLE IF NOT EXISTS tms_ruta_tarifas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  ruta_id INT NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(300) NULL,
  monto DECIMAL(12,2) NOT NULL,
  moneda VARCHAR(10) NOT NULL DEFAULT 'GTQ',
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE NULL DEFAULT NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  predeterminada TINYINT(1) NOT NULL DEFAULT 0,
  observacion VARCHAR(300) NULL,
  creado_por INT NULL,
  creado_por_nombre VARCHAR(200) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por INT NULL,
  actualizado_por_nombre VARCHAR(200) NULL,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tmsrutatarifas_ruta (empresa_id, ruta_id, activa, predeterminada),
  CONSTRAINT fk_tmsrutatarifas_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsrutatarifas_ruta_ambito
    FOREIGN KEY (empresa_id, ruta_id) REFERENCES tms_cliente_rutas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsrutatarifas_creador
    FOREIGN KEY (creado_por) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_tmsrutatarifas_editor
    FOREIGN KEY (actualizado_por) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
-- Configuración de identidades contables. No implica asignación de cuentas existentes.
CREATE TABLE IF NOT EXISTS cont_entidades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cont_entidad_codigo (empresa_id, codigo),
  UNIQUE KEY uq_cont_entidad_empresa_id (empresa_id, id),
  CONSTRAINT fk_cont_entidad_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cont_entidad_usuarios (
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  usuario_id INT NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  puede_editar TINYINT(1) NOT NULL DEFAULT 0,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id, entidad_id, usuario_id),
  INDEX idx_cont_entidad_usuario (usuario_id, empresa_id, activo),
  CONSTRAINT fk_cont_eu_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cont_eu_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cont_cuentas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NULL DEFAULT NULL,
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  nivel INT NOT NULL DEFAULT 1,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_cuenta_entidad (empresa_id, entidad_id, codigo),
  UNIQUE KEY uq_cont_cuenta_ambito (empresa_id, entidad_id, id),
  CONSTRAINT fk_cont_cuenta_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
  INDEX idx_cont_cuentas_entidad (empresa_id, entidad_id),
  CONSTRAINT fk_cuenta_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cont_asientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NULL DEFAULT NULL,
  fecha DATE NOT NULL,
  numero VARCHAR(40) NOT NULL,
  glosa VARCHAR(500) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'Borrador',
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_asiento_entidad (empresa_id, entidad_id, numero),
  UNIQUE KEY uq_cont_asiento_ambito (empresa_id, entidad_id, id),
  CONSTRAINT fk_cont_asiento_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
  INDEX idx_cont_asientos_entidad (empresa_id, entidad_id),
  CONSTRAINT fk_asiento_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cont_asiento_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NULL DEFAULT NULL,
  entidad_id INT NULL DEFAULT NULL,
  asiento_id INT NOT NULL,
  cuenta_id INT NOT NULL,
  debe DECIMAL(14,2) NOT NULL DEFAULT 0,
  haber DECIMAL(14,2) NOT NULL DEFAULT 0,
  INDEX idx_cont_detalle_entidad (empresa_id, entidad_id),
  CONSTRAINT fk_cont_detalle_asiento_ambito FOREIGN KEY (empresa_id, entidad_id, asiento_id) REFERENCES cont_asientos(empresa_id, entidad_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cont_detalle_cuenta_ambito FOREIGN KEY (empresa_id, entidad_id, cuenta_id) REFERENCES cont_cuentas(empresa_id, entidad_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_adet_asiento FOREIGN KEY (asiento_id) REFERENCES cont_asientos(id) ON DELETE CASCADE,
  CONSTRAINT fk_adet_cuenta FOREIGN KEY (cuenta_id) REFERENCES cont_cuentas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cont_cxc (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NULL DEFAULT NULL,
  cliente VARCHAR(200) NOT NULL,
  documento VARCHAR(80) NULL,
  fecha DATE NOT NULL,
  vencimiento DATE NULL,
  monto DECIMAL(14,2) NOT NULL DEFAULT 0,
  saldo DECIMAL(14,2) NOT NULL DEFAULT 0,
  estado VARCHAR(40) NOT NULL DEFAULT 'Pendiente',
  INDEX idx_cont_cxc_entidad (empresa_id, entidad_id),
  CONSTRAINT fk_cont_cxc_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cxc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cont_cxp (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NULL DEFAULT NULL,
  proveedor VARCHAR(200) NOT NULL,
  documento VARCHAR(80) NULL,
  fecha DATE NOT NULL,
  vencimiento DATE NULL,
  monto DECIMAL(14,2) NOT NULL DEFAULT 0,
  saldo DECIMAL(14,2) NOT NULL DEFAULT 0,
  estado VARCHAR(40) NOT NULL DEFAULT 'Pendiente',
  INDEX idx_cont_cxp_entidad (empresa_id, entidad_id),
  CONSTRAINT fk_cont_cxp_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
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

-- TMS-GASTOS-REPORTES-1 (fase 1) — ver sql/migrate-2026-09-tms-gastos-reportes.sql
-- para el detalle de diseño y qué catálogos existentes reutiliza.
CREATE TABLE IF NOT EXISTS tms_gastos_operativos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  fecha_solicitud DATE NOT NULL,
  fecha_viaje DATE NULL,
  empleado_id INT NULL,
  vehiculo_id INT NULL,
  cliente_id INT NULL,
  plan_id INT NULL,
  categoria VARCHAR(40) NOT NULL,
  descripcion VARCHAR(300) NULL,
  cantidad DECIMAL(10,2) NOT NULL DEFAULT 1,
  monto DECIMAL(12,2) NOT NULL,
  metodo_pago VARCHAR(40) NULL,
  numero_cuenta_pago VARCHAR(80) NULL,
  tiene_factura TINYINT(1) NOT NULL DEFAULT 0,
  factura_ruta_relativa VARCHAR(500) NULL,
  factura_nombre_original VARCHAR(255) NULL,
  factura_mime VARCHAR(100) NULL,
  factura_tamano BIGINT NULL,
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
  -- Vehículos propios o compartidos (flota_vehiculo_acceso): FK simple; la regla de acceso la valida la aplicación.
  -- Ver sql/migrate-2026-10-fondos-vehiculos-compartidos.sql.
  INDEX idx_gastos_vehiculo_id (vehiculo_id),
  CONSTRAINT fk_gasto_vehiculo FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos (id) ON DELETE RESTRICT,
  CONSTRAINT fk_gasto_cliente_ambito FOREIGN KEY (empresa_id, cliente_id) REFERENCES tms_clientes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_gasto_plan_ambito FOREIGN KEY (empresa_id, plan_id) REFERENCES tms_planes_viaje (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_solicitudes_fondo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  entidad_requirente_id INT NULL,
  entidad_requirente_nombre VARCHAR(200) NULL,
  requirente_empleado_id INT NULL,
  requirente_nombre VARCHAR(200) NULL,
  fecha_requerimiento DATE NOT NULL,
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  autorizante_empleado_id INT NULL,
  autorizante_nombre VARCHAR(200) NULL,
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
  UNIQUE KEY uq_fondo_empresa_id (empresa_id, id),
  INDEX idx_fondo_estado (empresa_id, estado),
  INDEX idx_fondo_fecha (empresa_id, fecha_requerimiento),
  CONSTRAINT fk_fondo_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_fondo_entidad_requirente_ambito FOREIGN KEY (empresa_id, entidad_requirente_id) REFERENCES cont_entidades (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fondo_requirente_ambito FOREIGN KEY (empresa_id, requirente_empleado_id) REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fondo_autorizante_ambito FOREIGN KEY (empresa_id, autorizante_empleado_id) REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- SOLICITUD-FONDOS-REPORTE-1 — ver sql/migrate-2026-09-solicitud-fondos-reporte.sql
-- para el detalle de diseño: fecha_viaje/empleado_id/vehiculo_id/
-- cliente_id/plan_id reutilizan el MISMO patrón de relación ya usado en
-- tms_gastos_operativos; empleado_nombre/cargo/placa/cliente_nombre son
-- SNAPSHOT de texto (no solo el id con JOIN en vivo) para que el reporte
-- histórico no cambie si luego cambian nombres/placas en los catálogos.
CREATE TABLE IF NOT EXISTS tms_solicitud_fondo_lineas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  solicitud_id INT NOT NULL,
  categoria VARCHAR(40) NOT NULL,
  descripcion VARCHAR(300) NULL,
  cantidad DECIMAL(10,2) NOT NULL DEFAULT 1,
  monto DECIMAL(12,2) NOT NULL,
  fecha_viaje DATE NULL DEFAULT NULL,
  empleado_id INT NULL DEFAULT NULL,
  empleado_nombre VARCHAR(200) NULL DEFAULT NULL,
  cargo VARCHAR(100) NULL DEFAULT NULL,
  vehiculo_id INT NULL DEFAULT NULL,
  placa VARCHAR(20) NULL DEFAULT NULL,
  cliente_id INT NULL DEFAULT NULL,
  cliente_nombre VARCHAR(200) NULL DEFAULT NULL,
  plan_id INT NULL DEFAULT NULL,
  orden INT NOT NULL DEFAULT 0,
  INDEX idx_fondolin_solicitud (empresa_id, solicitud_id),
  INDEX idx_fondolin_fviaje (empresa_id, fecha_viaje),
  INDEX idx_fondolin_empleado (empresa_id, empleado_id),
  INDEX idx_fondolin_vehiculo (empresa_id, vehiculo_id),
  INDEX idx_fondolin_cliente (empresa_id, cliente_id),
  INDEX idx_fondolin_plan (empresa_id, plan_id),
  CONSTRAINT fk_fondolin_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_fondolin_solicitud_ambito FOREIGN KEY (empresa_id, solicitud_id) REFERENCES tms_solicitudes_fondo (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_fondolin_empleado_ambito FOREIGN KEY (empresa_id, empleado_id) REFERENCES empleados (empresa_id, id) ON DELETE RESTRICT,
  -- Vehículos propios o compartidos (flota_vehiculo_acceso): FK simple; la regla de acceso la valida la aplicación.
  -- Ver sql/migrate-2026-10-fondos-vehiculos-compartidos.sql.
  INDEX idx_fondolin_vehiculo_id (vehiculo_id),
  CONSTRAINT fk_fondolin_vehiculo FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos (id) ON DELETE RESTRICT,
  CONSTRAINT fk_fondolin_cliente_ambito FOREIGN KEY (empresa_id, cliente_id) REFERENCES tms_clientes (empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fondolin_plan_ambito FOREIGN KEY (empresa_id, plan_id) REFERENCES tms_planes_viaje (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- COTIZADOR-TMS-1 — ver sql/migrate-2026-09-cotizador-tms.sql para el
-- detalle de diseño y qué catálogos existentes reutiliza.
CREATE TABLE IF NOT EXISTS tms_cotizaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  cliente_id INT NOT NULL,
  cliente_nombre VARCHAR(200) NOT NULL,
  ruta_id INT NULL,
  ruta_codigo_historico VARCHAR(40) NULL,
  origen_texto VARCHAR(300) NULL,
  destino_texto VARCHAR(300) NULL,
  tarifa_referencia DECIMAL(12,2) NULL,
  costo_operativo_referencia DECIMAL(12,2) NULL,
  tarifa_cotizada DECIMAL(12,2) NOT NULL,
  incluye_iva TINYINT(1) NOT NULL DEFAULT 0,
  moneda CHAR(3) NOT NULL DEFAULT 'GTQ',
  fecha_emision DATE NOT NULL,
  fecha_vencimiento DATE NULL,
  estado ENUM('Borrador','Enviada','Aceptada','Rechazada','Vencida') NOT NULL DEFAULT 'Borrador',
  piloto_incluido TINYINT(1) NOT NULL DEFAULT 1,
  gps_incluido TINYINT(1) NOT NULL DEFAULT 0,
  seguro_mercaderia_incluido TINYINT(1) NOT NULL DEFAULT 0,
  seguro_terceros_incluido TINYINT(1) NOT NULL DEFAULT 0,
  servicio_refrigerado TINYINT(1) NOT NULL DEFAULT 0,
  km_incluidos DECIMAL(10,2) NULL,
  tarifa_km_adicional DECIMAL(12,2) NULL,
  condiciones_adicionales TEXT NULL,
  observaciones TEXT NULL,
  -- COTIZACIONES FASE 6 — documento comercial (ver sql/migrate-2026-09-cotizaciones-documento-comercial.sql).
  documento_emisor VARCHAR(20) NOT NULL DEFAULT 'KUIQTRANS',   -- 'KUIQTRANS' | 'MONACO' (validado en la aplicación)
  atencion_nombre VARCHAR(160) NULL,
  atencion_cargo VARCHAR(160) NULL,
  unidad_descripcion VARCHAR(160) NULL,
  -- ver sql/migrate-2026-09-cotizaciones-presentacion-comercial.sql — snapshot editable del texto del PDF.
  mensaje_comercial TEXT NULL,
  cierre_comercial TEXT NULL,
  -- ver sql/migrate-2026-10-cotizaciones-credito-combustible.sql — datos comerciales por cotización (snapshot).
  condiciones_credito VARCHAR(300) NULL,
  combustible_referencia_tipo VARCHAR(20) NULL,       -- 'diesel' | 'gasolina' | 'otro' (validado en la aplicación)
  combustible_referencia_precio DECIMAL(12,2) NULL,   -- Q por galón
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cotizacion_codigo (empresa_id, codigo),
  UNIQUE KEY uq_cotizacion_empresa_id (empresa_id, id),
  INDEX idx_cotizacion_cliente (empresa_id, cliente_id),
  INDEX idx_cotizacion_estado (empresa_id, estado),
  INDEX idx_cotizacion_fecha (empresa_id, fecha_emision),
  CONSTRAINT fk_cotizacion_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_cotizacion_cliente_ambito FOREIGN KEY (empresa_id, cliente_id) REFERENCES tms_clientes (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- COTIZACIONES — varias rutas/viajes por cotización (ver
-- sql/migrate-2026-09-cotizaciones-lineas.sql). ADITIVA: la cotización sigue
-- teniendo su propia origen_texto/destino_texto/unidad_descripcion/
-- tarifa_cotizada como LÍNEA PRINCIPAL (orden 1, sin cambios — costeo interno
-- y todo lo demás la siguen usando tal cual); esta tabla guarda SOLO las
-- líneas ADICIONALES (orden 2 en adelante) de la misma propuesta.
CREATE TABLE IF NOT EXISTS tms_cotizacion_lineas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cotizacion_id INT NOT NULL,
  orden INT NOT NULL,
  origen_texto VARCHAR(300) NULL,
  destino_texto VARCHAR(300) NULL,
  unidad_descripcion VARCHAR(160) NULL,
  tarifa_cotizada DECIMAL(12,2) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cotizacion_lineas_empresa_id (empresa_id, id),
  UNIQUE KEY uq_cotizacion_lineas_orden (empresa_id, cotizacion_id, orden),
  INDEX idx_cotizacion_lineas_cotizacion (empresa_id, cotizacion_id),
  CONSTRAINT fk_cotlineas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_cotlineas_cotizacion_ambito FOREIGN KEY (empresa_id, cotizacion_id) REFERENCES tms_cotizaciones (empresa_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- COTIZACIONES-COSTEO (Fase 3) — costeo interno: perfiles y parámetros vivos + snapshot INMUTABLE por
-- cotización. Ver sql/migrate-2026-09-cotizaciones-costeo.sql (aplicada manualmente en producción KT antes de
-- versionarse) y docs/COTIZACIONES-COSTEO-PERSISTENCIA-PROPUESTA.md. Perfiles/parámetros son configuración
-- de negocio: no se siembran aquí.
CREATE TABLE IF NOT EXISTS tms_cotizacion_costeo_perfiles (
  -- Excel 2026: NULL conserva equivalentes anteriores sin inventar costos.
  viajes_mes DECIMAL(10,2) NULL DEFAULT NULL,
  precio_llanta DECIMAL(12,2) NULL DEFAULT NULL,
  cantidad_llantas INT NULL DEFAULT NULL,
  salario_piloto_mensual DECIMAL(12,2) NULL DEFAULT NULL,
  salario_auxiliar_mensual DECIMAL(12,2) NULL DEFAULT NULL,
  -- Paridad Cotizador 2026: UN solo valor «Viáticos y hotel» por viaje (no por persona ni por día). NULL = sin configurar.
  viaticos_hotel_viaje DECIMAL(12,2) NULL DEFAULT NULL,
  -- Paridad Cotizador 2026: comportamiento por hoja fuente. 1 = por cada día de servicio, 0 = una sola vez, NULL = sin configurar.
  auxiliar_multiplica_dias TINYINT(1) NULL DEFAULT NULL,
  viaticos_hotel_multiplica_dias TINYINT(1) NULL DEFAULT NULL,
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,                 -- p. ej. CAMION_5T, CABEZAL
  nombre VARCHAR(120) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  costo_adquisicion DECIMAL(14,2) NULL,        -- informativo
  dias_operacion_mes DECIMAL(5,2) NOT NULL,    -- divisor mensual→diario de GPS/seguro
  gps_mensual DECIMAL(12,2) NOT NULL DEFAULT 0,
  seguro_vehiculo_mensual DECIMAL(12,2) NOT NULL DEFAULT 0,
  costo_aceite_servicio DECIMAL(12,2) NOT NULL DEFAULT 0,
  vida_util_aceite_km DECIMAL(12,2) NOT NULL,
  costo_juego_llantas DECIMAL(14,2) NOT NULL DEFAULT 0,   -- total del juego (ya integra la cantidad de llantas)
  vida_util_llantas_km DECIMAL(12,2) NOT NULL,
  rendimiento_km_galon DECIMAL(8,3) NOT NULL,
  -- Depreciación del vehículo (todas NULL = no deprecia).
  deprec_valor_base DECIMAL(14,2) NULL,
  deprec_anios DECIMAL(5,2) NULL,
  deprec_dias_operacion_mes DECIMAL(5,2) NULL,
  -- Equipo de refrigeración, separado de la depreciación del vehículo.
  refrig_valor_base DECIMAL(14,2) NULL,
  refrig_anios DECIMAL(5,2) NULL,
  refrig_dias_operacion_mes DECIMAL(5,2) NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_costeo_perfil_codigo (empresa_id, codigo),
  UNIQUE KEY uq_costeo_perfil_empresa_id (empresa_id, id),
  INDEX idx_costeo_perfil_activo (empresa_id, activo, nombre),
  CONSTRAINT fk_costeo_perfil_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- PROGRAMACION-VEHICULO-SOLICITADO — se declara aquí porque tms_cotizacion_costeo_perfiles se crea
-- después de tms_planes_viaje. FK compuesta: un viaje nunca apunta al perfil de otra empresa.
-- Instalación limpia: sintaxis estándar, mismo patrón que fk_tmsplan_tc_vehiculo.
ALTER TABLE tms_planes_viaje
  ADD INDEX idx_tmsplan_vehiculo_solicitado (empresa_id, vehiculo_solicitado_perfil_id),
  ADD CONSTRAINT fk_tmsplan_vehiculo_solicitado
  FOREIGN KEY (empresa_id, vehiculo_solicitado_perfil_id)
  REFERENCES tms_cotizacion_costeo_perfiles(empresa_id, id)
  ON DELETE RESTRICT
  ON UPDATE RESTRICT;

CREATE TABLE IF NOT EXISTS tms_cotizacion_costeo_parametros (
  -- Configuración global aditiva por vigencia; no modifica vigencias anteriores.
  seguro_mercaderia_anual DECIMAL(14,2) NULL DEFAULT NULL,
  cantidad_camiones INT NULL DEFAULT NULL,
  viajes_anuales DECIMAL(10,2) NULL DEFAULT NULL,
  dias_depreciacion_mes DECIMAL(5,2) NULL DEFAULT NULL,
  dias_gastos_mes DECIMAL(5,2) NULL DEFAULT NULL,
  gastos_administracion DECIMAL(14,2) NULL DEFAULT NULL,
  gastos_mantenimiento DECIMAL(14,2) NULL DEFAULT NULL,
  gastos_seguridad DECIMAL(14,2) NULL DEFAULT NULL,
  gastos_predios DECIMAL(14,2) NULL DEFAULT NULL,
  dias_laborales_mes DECIMAL(5,2) NULL DEFAULT NULL,
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  vigente_desde DATE NOT NULL,
  precio_combustible_galon DECIMAL(10,4) NOT NULL,
  iva_tasa DECIMAL(6,4) NOT NULL,              -- fracción: 0.1200
  costo_piloto_dia DECIMAL(12,2) NOT NULL,
  costo_auxiliar_dia DECIMAL(12,2) NOT NULL,
  viatico_piloto_dia DECIMAL(12,2) NOT NULL DEFAULT 0,
  viatico_auxiliar_dia DECIMAL(12,2) NOT NULL DEFAULT 0,
  viatico_guia_dia DECIMAL(12,2) NOT NULL DEFAULT 0,
  hotel_dia DECIMAL(12,2) NULL,
  margen_objetivo DECIMAL(6,4) NULL,           -- fracción: 0.2000
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_costeo_param_vigencia (empresa_id, vigente_desde),
  UNIQUE KEY uq_costeo_param_empresa_id (empresa_id, id),
  INDEX idx_costeo_param_fecha (empresa_id, vigente_desde),
  CONSTRAINT fk_costeo_param_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_cotizacion_costeos (
  resultado_snapshot JSON NULL DEFAULT NULL, -- Resultado V2 completo; históricos V1 sin transformar
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cotizacion_id INT NOT NULL,
  -- Origen (SIN FK viva: si el perfil/parámetros cambian, esto NO se altera).
  perfil_id INT NULL,
  perfil_codigo VARCHAR(40) NOT NULL,
  perfil_nombre VARCHAR(120) NOT NULL,
  -- Copia COMPLETA de lo que consumió el motor.
  perfil_snapshot JSON NOT NULL,               -- PerfilCosteoUnidad tal como se usó
  parametros_snapshot JSON NOT NULL,           -- ParametrosEconomicosCosteo tal como se usó
  input_snapshot JSON NOT NULL,                -- km, días, cantidades, banderas, overrides, otros costos, precio de venta
  motor_version VARCHAR(40) NOT NULL,          -- versión de las fórmulas; permite auditar recálculos
  -- Resultados denormalizados para consultas/reportes (los componentes viven en D).
  costo_operativo DECIMAL(16,6) NOT NULL,
  iva DECIMAL(16,6) NOT NULL,
  costo_con_iva DECIMAL(16,6) NOT NULL,
  margen_objetivo DECIMAL(10,6) NOT NULL,
  precio_sugerido DECIMAL(16,6) NOT NULL,
  precio_venta DECIMAL(14,2) NULL,
  utilidad_estimada DECIMAL(16,6) NULL,
  margen_real DECIMAL(12,6) NULL,              -- utilidad / costo con IVA (margen SOBRE COSTO)
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Historial de costeos: N versiones por cotización, cada una inmutable. es_seleccionado = versión utilizada (a lo sumo una; la unicidad la garantiza la app con FOR UPDATE).
  version INT NOT NULL DEFAULT 1,
  es_seleccionado TINYINT(1) NOT NULL DEFAULT 0,
  seleccionado_por VARCHAR(100) NULL DEFAULT NULL,
  seleccionado_en DATETIME NULL DEFAULT NULL,
  UNIQUE KEY uq_cotizacion_costeo_version (empresa_id, cotizacion_id, version),
  UNIQUE KEY uq_cotizacion_costeo_empresa_id (empresa_id, id),
  INDEX idx_cotizacion_costeo_fecha (empresa_id, creado_en),
  INDEX idx_cotizacion_costeo_historial (empresa_id, cotizacion_id, creado_en),
  CONSTRAINT fk_cotizacion_costeo_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_cotizacion_costeo_cotizacion FOREIGN KEY (empresa_id, cotizacion_id) REFERENCES tms_cotizaciones (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_cotizacion_costeo_componentes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  costeo_id INT NOT NULL,
  orden SMALLINT NOT NULL,
  clave VARCHAR(60) NOT NULL,                  -- depreciacion, gps, combustible, otro:0, ...
  concepto VARCHAR(200) NOT NULL,
  monto DECIMAL(16,6) NOT NULL,
  UNIQUE KEY uq_costeo_componente_orden (empresa_id, costeo_id, orden),
  INDEX idx_costeo_componente_costeo (empresa_id, costeo_id),
  CONSTRAINT fk_costeo_componente_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_costeo_componente_costeo FOREIGN KEY (empresa_id, costeo_id) REFERENCES tms_cotizacion_costeos (empresa_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Modelo fiscal: definición para instalaciones nuevas, NO migración de producción.
-- Producción MariaDB 11.8.9: tablas existentes InnoDB/utf8mb4, sin FKs físicas.
-- JSON es alias de LONGTEXT en MariaDB; la aplicación valida estrictamente el contrato.
CREATE TABLE IF NOT EXISTS rrhh_fiscal_empleado_ejercicio (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  ejercicio SMALLINT NOT NULL,
  revision INT NOT NULL,
  inicio_fiscal DATE NULL,
  corte_antecedentes DATE NULL,
  ingresos_gravados_previos DECIMAL(14,2) NULL,
  ingresos_exentos_previos DECIMAL(14,2) NULL,
  igss_laboral_previo DECIMAL(14,2) NULL,
  isr_retenido_previo DECIMAL(14,2) NULL,
  datos JSON NOT NULL,
  creado_por VARCHAR(100) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmado_por VARCHAR(100) NULL,
  confirmado_en DATETIME NULL,
  UNIQUE KEY uq_fiscal_emp_anio_rev (empresa_id, id_empleado, ejercicio, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_fiscal_liquidaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  ejercicio SMALLINT NOT NULL,
  evento_clave VARCHAR(80) NOT NULL,
  revision INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  fecha_corte DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
  retener DECIMAL(14,2) NOT NULL DEFAULT 0,
  devolver DECIMAL(14,2) NOT NULL DEFAULT 0,
  snapshot JSON NOT NULL,
  aplicacion_clave VARCHAR(100) NULL,
  fecha_fiscal_ejecucion DATE NULL,
  referencia_ejecucion VARCHAR(120) NULL,
  creado_por VARCHAR(100) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmado_por VARCHAR(100) NULL,
  confirmado_en DATETIME NULL,
  ejecutado_por VARCHAR(100) NULL,
  ejecutado_en DATETIME NULL,
  UNIQUE KEY uq_liquidacion_rev (empresa_id, id_empleado, ejercicio, evento_clave, revision),
  UNIQUE KEY uq_liquidacion_aplicacion (empresa_id, aplicacion_clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Compras / Repuestos, Fase 1. Funcionalidad actual: solo proveedores.
CREATE TABLE IF NOT EXISTS compras_proveedores (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre_comercial VARCHAR(200) NOT NULL,
  -- COMPRAS-PROVEEDOR-INLINE — identidad normalizada (sql/migrate-2026-09-compras-proveedores-unicidad.sql):
  -- calculada SIEMPRE por el backend (src/lib/compras/proveedor-identidad.ts), nunca confiada del cliente.
  -- Instalación nueva: no requiere backfill (la tabla nace vacía). Producción existente usa la migración.
  nombre_normalizado VARCHAR(200) NULL,
  razon_social VARCHAR(250) NULL,
  nit VARCHAR(30) NULL,
  nit_normalizado VARCHAR(30) NULL,
  direccion VARCHAR(500) NULL,
  telefono VARCHAR(50) NULL,
  correo VARCHAR(200) NULL,
  contacto_nombre VARCHAR(200) NULL,
  contacto_telefono VARCHAR(50) NULL,
  contacto_correo VARCHAR(200) NULL,
  metodo_pago_habitual VARCHAR(80) NULL,
  banco VARCHAR(150) NULL,
  numero_cuenta VARCHAR(100) NULL,
  tipo_cuenta VARCHAR(80) NULL,
  titular_cuenta VARCHAR(200) NULL,
  dias_credito INT NULL,
  observaciones TEXT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_por INT NULL,
  actualizado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_compras_proveedor_empresa (empresa_id, id),
  UNIQUE KEY uq_cb_proveedor_nombre (empresa_id, nombre_normalizado),
  UNIQUE KEY uq_cb_proveedor_nit (empresa_id, nit_normalizado),
  INDEX idx_compras_proveedor_nombre (empresa_id, activo, nombre_comercial),
  INDEX idx_compras_proveedor_nit (empresa_id, nit),
  CONSTRAINT fk_cb_proveedores_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cb_proveedores_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cb_proveedores_editor FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS compras_requerimientos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  fecha_requerimiento DATE NOT NULL,
  entidad_requirente_id INT NULL,
  entidad_requirente_nombre VARCHAR(200) NULL,
  requirente_usuario_id INT NULL,
  requirente_nombre VARCHAR(200) NULL,
  solicitante_usuario_id INT NULL,
  solicitante_nombre VARCHAR(200) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  observaciones TEXT NULL,
  autorizante_usuario_id INT NULL,
  autorizante_nombre VARCHAR(200) NULL,
  autorizado_en DATETIME NULL,
  rechazado_en DATETIME NULL,
  motivo_rechazo VARCHAR(1000) NULL,
  version INT NOT NULL DEFAULT 1,
  creado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  encargado_compras_usuario_id INT NULL DEFAULT NULL,
  encargado_compras_nombre VARCHAR(200) NULL DEFAULT NULL,
  UNIQUE KEY uq_compras_req_empresa (empresa_id, id),
  UNIQUE KEY uq_compras_req_codigo (empresa_id, codigo),
  INDEX idx_compras_req_fecha (empresa_id, estado, fecha_requerimiento),
  CONSTRAINT chk_compras_estado CHECK (estado IN ('Pendiente', 'Autorizada', 'Rechazada')),
  CONSTRAINT fk_cb_requerimientos_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cb_requerimientos_entidad FOREIGN KEY (empresa_id, entidad_requirente_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cb_requerimientos_requirente FOREIGN KEY (requirente_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cb_requerimientos_solicitante FOREIGN KEY (solicitante_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cb_requerimientos_autorizante FOREIGN KEY (autorizante_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cb_requerimientos_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS compras_requerimiento_lineas (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  requerimiento_id INT NOT NULL,
  orden INT NOT NULL,
  vehiculo_id INT NULL,
  unidad_descripcion VARCHAR(200) NULL,
  fecha DATE NOT NULL,
  serie_factura VARCHAR(100) NULL,
  numero_factura VARCHAR(100) NULL,
  proveedor_id INT NOT NULL,
  proveedor_nombre_snapshot VARCHAR(200) NOT NULL,
  proveedor_razon_social_snapshot VARCHAR(250) NULL,
  proveedor_nit_snapshot VARCHAR(30) NULL,
  repuesto_descripcion VARCHAR(1000) NOT NULL,
  metodo_pago VARCHAR(80) NULL,
  condicion_pago VARCHAR(30) NULL,
  banco_snapshot VARCHAR(150) NULL,
  numero_cuenta_snapshot VARCHAR(100) NULL,
  dias_credito_snapshot INT NULL,
  total DECIMAL(12,2) NOT NULL,
  observaciones TEXT NULL,
  UNIQUE KEY uq_compras_linea_identidad (empresa_id, requerimiento_id, id),
  INDEX idx_compras_linea_orden (empresa_id, requerimiento_id, orden, id),
  INDEX idx_compras_linea_proveedor (empresa_id, proveedor_id),
  CONSTRAINT fk_cb_requerimiento_lineas_requerimiento FOREIGN KEY (empresa_id, requerimiento_id) REFERENCES compras_requerimientos(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cb_requerimiento_lineas_proveedor FOREIGN KEY (empresa_id, proveedor_id) REFERENCES compras_proveedores(empresa_id, id) ON DELETE RESTRICT,
  -- Unidad propia o compartida (flota_vehiculo_acceso): FK simple; la regla de acceso la valida la aplicación.
  -- Ver sql/migrate-2026-10-vehiculos-compartidos-global.sql.
  INDEX idx_compras_req_linea_vehiculo_id (vehiculo_id),
  CONSTRAINT fk_cb_requerimiento_lineas_veh FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS compras_linea_documentos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  requerimiento_id INT NOT NULL,
  linea_id INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  ruta_relativa VARCHAR(1000) NOT NULL,
  nombre_original VARCHAR(500) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  tamano BIGINT NOT NULL,
  sha256 CHAR(64) NULL,
  subido_por_usuario_id INT NOT NULL,
  subido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  retirado TINYINT(1) NOT NULL DEFAULT 0,
  retirado_por_usuario_id INT NULL,
  retirado_en DATETIME NULL,
  motivo_retiro VARCHAR(1000) NULL,
  INDEX idx_compras_documento_linea (empresa_id, requerimiento_id, linea_id, retirado),
  CONSTRAINT chk_compras_documento_tipo CHECK (tipo IN ('FACTURA', 'COMPROBANTE')),
  CONSTRAINT fk_cb_linea_documentos_linea FOREIGN KEY (empresa_id, requerimiento_id, linea_id) REFERENCES compras_requerimiento_lineas(empresa_id, requerimiento_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cb_linea_documentos_subido FOREIGN KEY (subido_por_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cb_linea_documentos_retirado FOREIGN KEY (retirado_por_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- RRHH-REQUERIMIENTOS-PROVEEDORES-1 — tablas PROPIAS de RRHH, independientes de compras_proveedores/compras_requerimientos*
-- (ver sql/migrate-2026-09-rrhh-requerimientos-proveedores.sql).
CREATE TABLE IF NOT EXISTS rrhh_proveedores (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre_comercial VARCHAR(200) NOT NULL,
  razon_social VARCHAR(250) NULL,
  nit VARCHAR(30) NULL,
  contacto_nombre VARCHAR(200) NULL,
  telefono VARCHAR(50) NULL,
  email VARCHAR(200) NULL,
  direccion VARCHAR(500) NULL,
  metodo_pago_habitual VARCHAR(80) NULL,
  banco VARCHAR(150) NULL,
  numero_cuenta VARCHAR(100) NULL,
  tipo_cuenta VARCHAR(80) NULL,
  dias_credito INT NULL,
  observaciones TEXT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_por INT NULL,
  actualizado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rrhh_proveedor_empresa (empresa_id, id),
  INDEX idx_rrhh_proveedor_nombre (empresa_id, activo, nombre_comercial),
  INDEX idx_rrhh_proveedor_nit (empresa_id, nit),
  CONSTRAINT fk_rh_proveedores_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_proveedores_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_proveedores_editor FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rrhh_requerimientos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  fecha_requerimiento DATE NOT NULL,
  entidad_requirente_id INT NULL,
  entidad_requirente_nombre VARCHAR(200) NULL,
  requirente_usuario_id INT NULL,
  requirente_nombre VARCHAR(200) NULL,
  solicitante_usuario_id INT NULL,
  solicitante_nombre VARCHAR(200) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  observaciones TEXT NULL,
  autorizante_usuario_id INT NULL,
  autorizante_nombre VARCHAR(200) NULL,
  autorizado_en DATETIME NULL,
  rechazado_en DATETIME NULL,
  motivo_rechazo VARCHAR(1000) NULL,
  version INT NOT NULL DEFAULT 1,
  creado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rrhh_req_empresa (empresa_id, id),
  UNIQUE KEY uq_rrhh_req_codigo (empresa_id, codigo),
  INDEX idx_rrhh_req_fecha (empresa_id, estado, fecha_requerimiento),
  CONSTRAINT chk_rrhh_req_estado CHECK (estado IN ('Pendiente', 'Autorizada', 'Rechazada')),
  CONSTRAINT fk_rh_requerimientos_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_requerimientos_entidad FOREIGN KEY (empresa_id, entidad_requirente_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_requerimientos_requirente FOREIGN KEY (requirente_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_requerimientos_solicitante FOREIGN KEY (solicitante_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_requerimientos_autorizante FOREIGN KEY (autorizante_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_requerimientos_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rrhh_requerimiento_lineas (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  requerimiento_id INT NOT NULL,
  orden INT NOT NULL,
  proveedor_id INT NOT NULL,
  proveedor_nombre_snapshot VARCHAR(200) NOT NULL,
  proveedor_razon_social_snapshot VARCHAR(250) NULL,
  proveedor_nit_snapshot VARCHAR(30) NULL,
  descripcion VARCHAR(1000) NOT NULL,
  cantidad DECIMAL(12,2) NOT NULL DEFAULT 1,
  precio_unitario DECIMAL(12,2) NOT NULL,
  metodo_pago VARCHAR(80) NOT NULL,
  condicion_pago VARCHAR(30) NOT NULL,
  banco_snapshot VARCHAR(150) NULL,
  numero_cuenta_snapshot VARCHAR(100) NULL,
  tipo_cuenta_snapshot VARCHAR(80) NULL,
  dias_credito_snapshot INT NULL,
  total DECIMAL(12,2) NOT NULL,
  observaciones TEXT NULL,
  UNIQUE KEY uq_rrhh_linea_identidad (empresa_id, requerimiento_id, id),
  INDEX idx_rrhh_linea_orden (empresa_id, requerimiento_id, orden, id),
  INDEX idx_rrhh_linea_proveedor (empresa_id, proveedor_id),
  CONSTRAINT chk_rrhh_linea_metodo CHECK (metodo_pago IN ('Transferencia', 'Cheque', 'Efectivo', 'Crédito')),
  CONSTRAINT chk_rrhh_linea_condicion CHECK (condicion_pago IN ('Contado', 'Crédito')),
  CONSTRAINT fk_rh_req_lineas_requerimiento FOREIGN KEY (empresa_id, requerimiento_id) REFERENCES rrhh_requerimientos(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_req_lineas_proveedor FOREIGN KEY (empresa_id, proveedor_id) REFERENCES rrhh_proveedores(empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cuadrilla es un rol independiente: nunca asigna auxiliares ni genera viáticos.
CREATE TABLE IF NOT EXISTS tms_plan_cuadrilla (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  orden SMALLINT NOT NULL,
  tipo VARCHAR(10) NOT NULL,
  id_empleado INT NULL,
  nombre VARCHAR(200) NOT NULL,
  identificacion VARCHAR(100) NULL,
  telefono VARCHAR(50) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tpc_plan_empleado (plan_id, id_empleado),
  UNIQUE KEY uq_tpc_plan_orden (plan_id, orden),
  INDEX idx_tpc_empresa_plan (empresa_id, plan_id),
  INDEX idx_tpc_empresa_empleado (empresa_id, id_empleado),
  CONSTRAINT chk_tpc_tipo CHECK (
    (tipo = 'INTERNO' AND id_empleado IS NOT NULL AND identificacion IS NULL AND telefono IS NULL)
    OR (tipo = 'EXTERNO' AND id_empleado IS NULL)
  ),
  CONSTRAINT fk_tpc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_tpc_plan FOREIGN KEY (empresa_id, plan_id)
    REFERENCES tms_planes_viaje(empresa_id, id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_tpc_empleado FOREIGN KEY (empresa_id, id_empleado)
    REFERENCES empleados(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- Habilitaciones operativas TMS: capa de elegibilidad por empleado, separada de empleados.categoria_ops
-- (puesto/categoría contractual de RRHH, que NO se toca) y de tms_personal (catálogo operativo que se
-- sigue creando/resolviendo igual al asignar un viaje, vía personalDesdeEmpleado()). Un empleado puede
-- tener hasta 2 filas (una por rol); "activo=0" desactiva sin perder historial.
CREATE TABLE IF NOT EXISTS tms_personal_habilitaciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  empleado_id INT NOT NULL,
  rol VARCHAR(20) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'HABILITADO',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tph_empleado_rol (empresa_id, empleado_id, rol),
  INDEX idx_tph_empresa_empleado (empresa_id, empleado_id),
  INDEX idx_tph_empresa_rol_activo (empresa_id, rol, activo),
  CONSTRAINT chk_tph_rol CHECK (rol IN ('PILOTO', 'AUXILIAR')),
  CONSTRAINT chk_tph_estado CHECK (estado IN ('HABILITADO', 'CAPACITACION')),
  CONSTRAINT fk_tph_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_tph_empleado FOREIGN KEY (empresa_id, empleado_id)
    REFERENCES empleados(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- PR A: solo infraestructura. Ejecutar UNICAMENTE tras preflight APTO y autorización.
-- Sin seeds/backfill, sin automatización. Una tabla existente NO se considera compatible por IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS cont_cuentas_rol (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  rol VARCHAR(40) NOT NULL,
  cuenta_id INT NOT NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cont_cuentas_rol (empresa_id, entidad_id, rol),
  KEY idx_cont_cuentas_rol_cuenta (empresa_id, entidad_id, cuenta_id),
  CONSTRAINT fk_cont_rol_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cont_rol_cuenta FOREIGN KEY (empresa_id, entidad_id, cuenta_id) REFERENCES cont_cuentas(empresa_id, entidad_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_cont_rol_valido CHECK (rol IN ('CLIENTES','IVA_POR_PAGAR','VENTAS_SERVICIOS','RETENCION_IVA','TRANSITO_BANCARIO','ANTICIPOS','DEVOLUCIONES_VENTAS','VENTAS_BIENES'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

CREATE TABLE IF NOT EXISTS cont_eventos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  factura_id INT NOT NULL,
  tipo_evento VARCHAR(40) NOT NULL,
  evento_origen_id INT NULL,
  asiento_id INT NOT NULL,
  clave_evento VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  fecha_contable DATE NOT NULL,
  datos_snapshot JSON NOT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cont_evento_clave (empresa_id, entidad_id, clave_evento),
  UNIQUE KEY uq_cont_evento_asiento (empresa_id, entidad_id, asiento_id),
  UNIQUE KEY uq_cont_evento_ambito (empresa_id, entidad_id, factura_id, id),
  KEY idx_cont_evento_factura (empresa_id, entidad_id, factura_id, tipo_evento),
  KEY idx_cont_evento_origen (empresa_id, entidad_id, factura_id, evento_origen_id),
  CONSTRAINT fk_cont_evento_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  -- No modifica fact_facturas: FK física simple + comprobación empresa/entidad bajo lock en el helper.
  CONSTRAINT fk_cont_evento_factura FOREIGN KEY (factura_id) REFERENCES fact_facturas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cont_evento_asiento FOREIGN KEY (empresa_id, entidad_id, asiento_id) REFERENCES cont_asientos(empresa_id, entidad_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cont_evento_origen FOREIGN KEY (empresa_id, entidad_id, factura_id, evento_origen_id) REFERENCES cont_eventos(empresa_id, entidad_id, factura_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_cont_evento_actor FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_cont_evento_tipo CHECK (tipo_evento IN ('FACTURA_EMITIDA','COBRO_CONFIRMADO','RETENCION_NO_EMITIDA')),
  -- COBRO reservado, imposible insertar hasta añadir confirmación + FK en PR B/D.
  CONSTRAINT ck_cont_evento_origen CHECK (
    (tipo_evento = 'FACTURA_EMITIDA' AND evento_origen_id IS NULL) OR
    (tipo_evento = 'RETENCION_NO_EMITIDA' AND evento_origen_id IS NOT NULL)),
  CONSTRAINT ck_cont_evento_huella CHECK (huella REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT ck_cont_evento_snapshot CHECK (JSON_VALID(datos_snapshot) AND JSON_VALUE(datos_snapshot, '$.version') IS NOT NULL AND JSON_VALUE(datos_snapshot, '$.version') = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;
-- PR B: confirmación bancaria independiente de pago informado; sin automatización.
CREATE TABLE IF NOT EXISTS fact_pago_confirmaciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  pago_id INT NULL,
  factura_id INT NOT NULL,
  cuenta_bancaria_id INT NOT NULL,
  monto DECIMAL(14,2) NOT NULL,
  fecha_acreditacion DATE NOT NULL,
  referencia VARCHAR(120) NOT NULL,
  observaciones TEXT NULL,
  idempotency_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  estado VARCHAR(12) NOT NULL DEFAULT 'CONFIRMADA',
  confirmado_por INT NOT NULL,
  confirmado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anulado_por INT NULL,
  anulado_en DATETIME NULL,
  motivo_anulacion TEXT NULL,
  evidencia_ruta VARCHAR(500) NULL,
  evidencia_nombre VARCHAR(255) NULL,
  evidencia_mime VARCHAR(40) NULL,
  evidencia_tamano INT NULL,
  evidencia_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  UNIQUE KEY uq_fpc_idempotencia (empresa_id,entidad_id,idempotency_key),
  KEY idx_fpc_factura_estado (empresa_id,entidad_id,factura_id,estado),
  KEY idx_fpc_banco_fecha (empresa_id,entidad_id,cuenta_bancaria_id,fecha_acreditacion),
  KEY idx_fpc_pago (pago_id),
  CONSTRAINT fk_fpc_entidad FOREIGN KEY (empresa_id,entidad_id) REFERENCES cont_entidades(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fpc_banco FOREIGN KEY (empresa_id,entidad_id,cuenta_bancaria_id) REFERENCES cont_cuentas_bancarias(empresa_id,entidad_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fpc_factura FOREIGN KEY (factura_id) REFERENCES fact_facturas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fpc_pago FOREIGN KEY (pago_id) REFERENCES fact_pagos(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fpc_actor FOREIGN KEY (confirmado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fpc_anulador FOREIGN KEY (anulado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fpc_monto CHECK (monto > 0),
  CONSTRAINT ck_fpc_referencia CHECK (CHAR_LENGTH(TRIM(referencia)) > 0),
  CONSTRAINT ck_fpc_estado CHECK (
    (estado='CONFIRMADA' AND anulado_por IS NULL AND anulado_en IS NULL AND motivo_anulacion IS NULL)
    OR (estado='ANULADA' AND anulado_por IS NOT NULL AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL AND CHAR_LENGTH(TRIM(motivo_anulacion))>0)
  ),
  CONSTRAINT ck_fpc_evidencia CHECK (
    (evidencia_ruta IS NULL AND evidencia_nombre IS NULL AND evidencia_mime IS NULL AND evidencia_tamano IS NULL AND evidencia_sha256 IS NULL)
    OR (evidencia_ruta IS NOT NULL AND evidencia_nombre IS NOT NULL AND evidencia_mime IS NOT NULL AND evidencia_mime IN ('application/pdf','image/png','image/jpeg') AND evidencia_tamano IS NOT NULL AND evidencia_tamano BETWEEN 1 AND 10485760 AND evidencia_sha256 IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- FEL-2A (modelo, dominio e idempotencia con proveedor MOCK). Sin seeds ni datos. Ver sql/migrate-2026-10-fel-2a-modelo.sql.
-- fact_facturas no se define en este archivo: el UNIQUE aditivo es el destino de la FK compuesta de fel_documentos.
-- (1) Único cambio sobre una tabla existente. `id` ya es PK, por lo que cualquier índice UNIQUE que lo contenga se
-- cumple trivialmente (el preflight lo comprueba de todos modos). Es el destino de la FK compuesta de fel_documentos:
-- impide, estructuralmente, ligar un documento fiscal a la factura (o entidad) de otra empresa.
ALTER TABLE fact_facturas
  ADD UNIQUE INDEX IF NOT EXISTS uq_factura_ambito (empresa_id, entidad_id, id);

-- (2) Emisor lógico por (empresa, entidad). ÚNICA fuente del modo. Sin NIT ni datos fiscales aquí.
CREATE TABLE IF NOT EXISTS fel_emisores (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  modo VARCHAR(12) NOT NULL DEFAULT 'DESACTIVADO',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fel_emisor_entidad (empresa_id, entidad_id),
  UNIQUE KEY uq_fel_emisor_empresa_id (empresa_id, id),
  UNIQUE KEY uq_fel_emisor_ambito (empresa_id, id, entidad_id),
  CONSTRAINT fk_fel_emisor_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_emisor_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fel_emisor_modo CHECK (modo IN ('DESACTIVADO','TEST','PROD'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- (3) Configuración POR AMBIENTE (TEST / PROD en filas separadas). base_url/NIT/secreto son NULL hasta que el
-- responsable los configure; ningún valor fiscal ni URL de proveedor se inventa. Los datos que dependen de la
-- documentación de INFILE (afiliación IVA, establecimiento, frases, dirección) se agregan de forma aditiva en FEL-3.
CREATE TABLE IF NOT EXISTS fel_emisor_ambientes (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  emisor_id INT NOT NULL,
  ambiente VARCHAR(4) NOT NULL,
  proveedor VARCHAR(20) NOT NULL,
  base_url VARCHAR(300) NULL,
  nit_emisor VARCHAR(20) NULL,
  nombre_fiscal VARCHAR(250) NULL,
  secreto_cifrado TEXT NULL,
  secreto_actualizado_en DATETIME NULL,
  secreto_actualizado_por INT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fel_amb (empresa_id, emisor_id, ambiente),
  UNIQUE KEY uq_fel_amb_proveedor (empresa_id, emisor_id, ambiente, proveedor),
  CONSTRAINT fk_fel_amb_emisor FOREIGN KEY (empresa_id, emisor_id) REFERENCES fel_emisores(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_amb_actor FOREIGN KEY (secreto_actualizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fel_amb_ambiente CHECK (ambiente IN ('TEST','PROD')),
  CONSTRAINT ck_fel_amb_proveedor CHECK (CAST(proveedor AS BINARY) REGEXP '^[A-Z0-9_]{2,20}$'),
  -- Un documento MOCK jamás puede pertenecer a un ambiente PROD: CERTIFICADO + PROD implica proveedor real.
  CONSTRAINT ck_fel_amb_mock_no_prod CHECK (NOT (proveedor = 'MOCK' AND ambiente = 'PROD'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- (4) Documento FEL: FUENTE DE VERDAD FISCAL. Nunca se borra (ON DELETE RESTRICT en todo). estado_admin de
-- fact_facturas NO es prueba fiscal. Un registro por envío fiscal; RECHAZADO es terminal (una corrección = fila nueva).
CREATE TABLE IF NOT EXISTS fel_documentos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  factura_id INT NOT NULL,
  emisor_id INT NOT NULL,
  entidad_id INT NOT NULL,
  ambiente VARCHAR(4) NOT NULL,
  proveedor VARCHAR(20) NOT NULL,
  tipo_documento VARCHAR(12) NOT NULL,
  estado VARCHAR(14) NOT NULL DEFAULT 'PENDIENTE',
  referencia_emisor CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huella_dto CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dto_json LONGTEXT NOT NULL,
  documento_origen_id INT NULL,
  motivo VARCHAR(500) NULL,
  autorizacion VARCHAR(64) NULL,
  serie VARCHAR(40) NULL,
  numero VARCHAR(40) NULL,
  fecha_certificacion DATETIME NULL,
  anulado_en DATETIME NULL,
  anulado_por INT NULL,
  motivo_anulacion VARCHAR(500) NULL,
  ultimo_codigo VARCHAR(60) NULL,
  ultimo_mensaje VARCHAR(500) NULL,
  version INT NOT NULL DEFAULT 1,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  -- A lo sumo UNA factura fiscal viva por fact_facturas: NULL (no choca) para notas y para RECHAZADO.
  factura_viva TINYINT GENERATED ALWAYS AS (CASE WHEN tipo_documento = 'FACTURA' AND estado <> 'RECHAZADO' THEN 1 ELSE NULL END) STORED,
  UNIQUE KEY uq_fel_doc_referencia (referencia_emisor),
  UNIQUE KEY uq_fel_doc_empresa_id (empresa_id, id),
  UNIQUE KEY uq_fel_doc_origen (empresa_id, emisor_id, id),
  UNIQUE KEY uq_fel_doc_autorizacion (empresa_id, ambiente, autorizacion),
  UNIQUE KEY uq_fel_doc_serie_numero (empresa_id, emisor_id, ambiente, serie, numero),
  UNIQUE KEY uq_fel_doc_factura_viva (empresa_id, factura_id, factura_viva),
  KEY idx_fel_doc_factura (empresa_id, factura_id),
  KEY idx_fel_doc_estado (empresa_id, estado),
  CONSTRAINT fk_fel_doc_factura FOREIGN KEY (empresa_id, entidad_id, factura_id) REFERENCES fact_facturas(empresa_id, entidad_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_doc_emisor FOREIGN KEY (empresa_id, emisor_id, entidad_id) REFERENCES fel_emisores(empresa_id, id, entidad_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_doc_ambiente FOREIGN KEY (empresa_id, emisor_id, ambiente, proveedor) REFERENCES fel_emisor_ambientes(empresa_id, emisor_id, ambiente, proveedor) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_doc_origen FOREIGN KEY (empresa_id, emisor_id, documento_origen_id) REFERENCES fel_documentos(empresa_id, emisor_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_doc_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_doc_anulador FOREIGN KEY (anulado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fel_doc_tipo CHECK (tipo_documento IN ('FACTURA','NOTA_CREDITO','NOTA_DEBITO')),
  CONSTRAINT ck_fel_doc_estado CHECK (estado IN ('PENDIENTE','CERTIFICADO','RECHAZADO','INCIERTO','NO_ENCONTRADO','ANULADO')),
  CONSTRAINT ck_fel_doc_ambiente CHECK (ambiente IN ('TEST','PROD')),
  -- CERTIFICADO/ANULADO exigen la identidad fiscal completa; el resto de estados no puede traerla.
  CONSTRAINT ck_fel_doc_certificacion CHECK (
    (estado IN ('CERTIFICADO','ANULADO') AND autorizacion IS NOT NULL AND serie IS NOT NULL AND numero IS NOT NULL AND fecha_certificacion IS NOT NULL)
    OR (estado NOT IN ('CERTIFICADO','ANULADO') AND autorizacion IS NULL AND serie IS NULL AND numero IS NULL AND fecha_certificacion IS NULL)
  ),
  CONSTRAINT ck_fel_doc_anulacion CHECK (
    (estado = 'ANULADO' AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL)
    OR (estado <> 'ANULADO' AND anulado_en IS NULL AND anulado_por IS NULL AND motivo_anulacion IS NULL)
  ),
  -- Notas de crédito/débito siempre referencian un documento origen; una FACTURA con origen es una refacturación.
  -- La no-autorreferencia NO puede garantizarla la BD: MariaDB no admite AUTO_INCREMENT en un CHECK y la FK acepta una
  -- fila que se referencia a sí misma si se inserta con id explícito. Es una invariante de APLICACIÓN: el servicio solo
  -- inserta el origen ya existente, jamás hace UPDATE de documento_origen_id (lo exige una prueba de arquitectura) y
  -- verify-2026-10-fel-2a-modelo.sql la audita. Sin autorreferencia y con origen inmutable no hay ciclos posibles.
  CONSTRAINT ck_fel_doc_origen CHECK (tipo_documento = 'FACTURA' OR documento_origen_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- (5) Intentos: un envío/consulta/anulación por fila, con la clave de solicitud y la huella del contenido. Se inserta
-- ENVIANDO antes de la llamada externa y se CIERRA una sola vez (ENVIANDO -> resultado). Sin secretos ni XML.
CREATE TABLE IF NOT EXISTS fel_intentos (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  documento_id INT NOT NULL,
  tipo VARCHAR(12) NOT NULL,
  estado VARCHAR(14) NOT NULL DEFAULT 'ENVIANDO',
  clave_solicitud VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
  huella_solicitud CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  codigo VARCHAR(60) NULL,
  mensaje VARCHAR(500) NULL,
  respuesta_redactada TEXT NULL,
  usuario_id INT NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finalizado_en DATETIME(3) NULL,
  UNIQUE KEY uq_fel_int_solicitud (empresa_id, clave_solicitud),
  KEY idx_fel_int_doc (empresa_id, documento_id, id),
  CONSTRAINT fk_fel_int_doc FOREIGN KEY (empresa_id, documento_id) REFERENCES fel_documentos(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_fel_int_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_fel_int_tipo CHECK (tipo IN ('CERTIFICAR','CONSULTAR','ANULAR')),
  CONSTRAINT ck_fel_int_estado CHECK (estado IN ('ENVIANDO','CERTIFICADO','RECHAZADO','PENDIENTE','NO_ENCONTRADO','INCIERTO','ERROR_CONFIG','ANULADO')),
  CONSTRAINT ck_fel_int_cierre CHECK ((estado = 'ENVIANDO' AND finalizado_en IS NULL) OR (estado <> 'ENVIANDO' AND finalizado_en IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- TMS LIQUIDACION DE VIAJES FASE 1 (modelo minimo; sin seeds ni datos). Ver sql/migrate-2026-10-tms-liquidacion-viajes-fase1.sql.
-- (1) Configuracion por empresa. Sin fila, o fecha NULL = la liquidacion NO se exige (el sistema actual no cambia).
CREATE TABLE IF NOT EXISTS tms_liquidacion_config (
  empresa_id INT NOT NULL,
  fecha_activacion_liquidacion DATE NULL DEFAULT NULL,
  actualizado_por INT NULL,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id),
  CONSTRAINT fk_tlc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tlc_actor FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- (2) Liquidacion 1:1 por viaje (estado VIGENTE). La historia vive en tms_viaje_liquidacion_eventos.
CREATE TABLE IF NOT EXISTS tms_viaje_liquidaciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  estado VARCHAR(20) NOT NULL,
  version INT NOT NULL DEFAULT 1,
  reporte_recibido_en DATETIME NOT NULL,
  reporte_recibido_por INT NOT NULL,
  liquidado_en DATETIME NULL,
  liquidado_por INT NULL,
  reabierto_en DATETIME NULL,
  reabierto_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tvl_empresa_plan (empresa_id, plan_id),
  KEY idx_tvl_empresa_estado (empresa_id, estado),
  CONSTRAINT fk_tvl_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvl_plan FOREIGN KEY (empresa_id, plan_id) REFERENCES tms_planes_viaje(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvl_reporte_por FOREIGN KEY (reporte_recibido_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvl_liquidado_por FOREIGN KEY (liquidado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvl_reabierto_por FOREIGN KEY (reabierto_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_tvl_estado CHECK (estado IN ('REPORTE_RECIBIDO', 'LIQUIDADO', 'EN_AJUSTE')),
  CONSTRAINT ck_tvl_version CHECK (version >= 1),
  CONSTRAINT ck_tvl_pares CHECK (
    (liquidado_en IS NULL) = (liquidado_por IS NULL) AND (reabierto_en IS NULL) = (reabierto_por IS NULL)
  ),
  -- Coherencia estado <-> marcas: REPORTE_RECIBIDO solo existe antes de la primera liquidacion; LIQUIDADO y EN_AJUSTE
  -- conservan la ultima liquidacion; EN_AJUSTE exige la ultima reapertura.
  CONSTRAINT ck_tvl_estado_marcas CHECK (
    (estado = 'REPORTE_RECIBIDO' AND liquidado_en IS NULL AND reabierto_en IS NULL)
    OR (estado = 'LIQUIDADO' AND liquidado_en IS NOT NULL)
    OR (estado = 'EN_AJUSTE' AND liquidado_en IS NOT NULL AND reabierto_en IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- (3) Eventos APPEND-ONLY. Una fila por transicion; `version` = version de la liquidacion DESPUES de la transicion, de modo que
-- UNIQUE (empresa_id, plan_id, version) impide duplicar un evento. Nunca se actualiza ni se borra (la aplicacion no emite UPDATE/DELETE;
-- ON DELETE RESTRICT impide borrar la liquidacion mientras tenga eventos).
CREATE TABLE IF NOT EXISTS tms_viaje_liquidacion_eventos (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  version INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  estado_antes VARCHAR(20) NULL,
  estado_despues VARCHAR(20) NOT NULL,
  actor_id INT NOT NULL,
  detalle VARCHAR(500) NULL,
  snapshot_json LONGTEXT NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tvle_version (empresa_id, plan_id, version),
  KEY idx_tvle_actor (actor_id),
  CONSTRAINT fk_tvle_liquidacion FOREIGN KEY (empresa_id, plan_id) REFERENCES tms_viaje_liquidaciones(empresa_id, plan_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvle_actor FOREIGN KEY (actor_id) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_tvle_version CHECK (version >= 1),
  CONSTRAINT ck_tvle_snapshot CHECK (snapshot_json IS NULL OR JSON_VALID(snapshot_json)),
  CONSTRAINT ck_tvle_transicion CHECK (
    (tipo = 'REPORTE_RECIBIDO' AND estado_antes IS NULL AND estado_despues = 'REPORTE_RECIBIDO')
    OR (tipo = 'LIQUIDADO' AND estado_antes = 'REPORTE_RECIBIDO' AND estado_despues = 'LIQUIDADO')
    OR (tipo = 'REABIERTO' AND estado_antes = 'LIQUIDADO' AND estado_despues = 'EN_AJUSTE'
        AND detalle IS NOT NULL AND CHAR_LENGTH(TRIM(detalle)) >= 5)
    OR (tipo = 'RELIQUIDADO' AND estado_antes = 'EN_AJUSTE' AND estado_despues = 'LIQUIDADO')
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ============================================================================
-- TMS LIQUIDACION DE VIAJES - FASE 4 (cargos adicionales facturables). Ver sql/migrate-2026-10-tms-liquidacion-cargos-fase4.sql
-- ============================================================================
-- (1) Cargo: estado VIGENTE (nunca se borra; se anula con motivo y puede reactivarse). Moneda = la de la tarifa del viaje.
CREATE TABLE IF NOT EXISTS tms_viaje_cargos_adicionales (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  concepto VARCHAR(120) NOT NULL,
  monto DECIMAL(12,2) NOT NULL,
  observacion VARCHAR(500) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  version INT NOT NULL DEFAULT 1,
  anulado_por INT NULL,
  anulado_en DATETIME NULL,
  motivo_anulacion VARCHAR(500) NULL,
  clave_envio VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  huella CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por INT NULL,
  actualizado_en DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tvca_empresa_id (empresa_id, id),
  UNIQUE KEY uq_tvca_clave (empresa_id, clave_envio),
  KEY idx_tvca_plan (empresa_id, plan_id, activo),
  CONSTRAINT fk_tvca_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvca_plan FOREIGN KEY (empresa_id, plan_id) REFERENCES tms_planes_viaje(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvca_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvca_actualizador FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvca_anulador FOREIGN KEY (anulado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_tvca_monto CHECK (monto > 0),
  CONSTRAINT ck_tvca_concepto CHECK (CHAR_LENGTH(TRIM(concepto)) >= 2),
  CONSTRAINT ck_tvca_version CHECK (version >= 1),
  CONSTRAINT ck_tvca_activo CHECK (activo IN (0, 1)),
  -- Anulado exige quién, cuándo y motivo; activo no conserva marcas de anulación (la historia vive en los eventos).
  CONSTRAINT ck_tvca_anulacion CHECK (
    (activo = 1 AND anulado_por IS NULL AND anulado_en IS NULL AND motivo_anulacion IS NULL)
    OR (activo = 0 AND anulado_por IS NOT NULL AND anulado_en IS NOT NULL AND motivo_anulacion IS NOT NULL
        AND CHAR_LENGTH(TRIM(motivo_anulacion)) >= 5)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- (2) Eventos APPEND-ONLY: una fila por cambio del cargo, con su estado antes/despues. `version` = version del cargo DESPUES del
-- cambio, de modo que UNIQUE (empresa_id, cargo_id, version) impide duplicar un evento. La aplicacion nunca hace UPDATE/DELETE;
-- ON DELETE RESTRICT impide borrar el cargo mientras tenga historia.
CREATE TABLE IF NOT EXISTS tms_viaje_cargo_eventos (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cargo_id INT NOT NULL,
  plan_id INT NOT NULL,
  version INT NOT NULL,
  tipo VARCHAR(12) NOT NULL,
  actor_id INT NOT NULL,
  estado_antes LONGTEXT NULL,
  estado_despues LONGTEXT NOT NULL,
  motivo VARCHAR(500) NULL,
  creado_en DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_tvce_version (empresa_id, cargo_id, version),
  KEY idx_tvce_plan (empresa_id, plan_id, id),
  KEY idx_tvce_actor (actor_id),
  CONSTRAINT fk_tvce_cargo FOREIGN KEY (empresa_id, cargo_id) REFERENCES tms_viaje_cargos_adicionales(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_tvce_actor FOREIGN KEY (actor_id) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_tvce_version CHECK (version >= 1),
  CONSTRAINT ck_tvce_tipo CHECK (tipo IN ('CREADO', 'EDITADO', 'ANULADO', 'REACTIVADO')),
  CONSTRAINT ck_tvce_json CHECK (JSON_VALID(estado_despues) AND (estado_antes IS NULL OR JSON_VALID(estado_antes))),
  CONSTRAINT ck_tvce_motivo CHECK (tipo <> 'ANULADO' OR (motivo IS NOT NULL AND CHAR_LENGTH(TRIM(motivo)) >= 5))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- ============================================================================
-- RRHH - Justificacion de faltas (capa sobre la ausencia real). Ver sql/migrate-2026-10-rrhh-justificaciones-faltas.sql
-- FK compuesta (empresa_id, empleado_id) -> empleados(empresa_id, id): requiere el UNIQUE (empresa_id, id) de empleados.
-- ============================================================================
CREATE TABLE IF NOT EXISTS (segura de repetir). No altera ni reinterpreta sesiones_trabajo,
-- incidencias, rrhh_asistencia_ausencias, vacaciones, planilla ni `empleados` (NO agrega índices a empleados). No inserta datos.
-- NO ejecutada por este PR. Antes: preflight-2026-10-rrhh-justificaciones-faltas.sql; después: verify-... del mismo nombre.
--
-- IMPORTANTE (contexto): ANTES de ejecutar, SELECCIONAR la base de datos destino (producción: u611730801_Plataforma). Este script
-- usa nombres de tabla SIN esquema (igual que sus hermanos) para poder probarse en una base desechable; el preflight DETIENE si la
-- base seleccionada no es la esperada. No ejecutar con `information_schema` ni `mysql` seleccionadas.
--
-- Una fila por empresa + empleado + fecha. La ausencia SIGUE siendo una ausencia: esta tabla solo registra que RRHH la justificó
-- (tipo del catálogo de incidencias, observación, quién y cuándo) y, si se revierte, quién/cuándo/por qué. Nunca se borra:
-- ACTIVA / REVERTIDA. NO modifica el descuento de planilla (la justificación documenta/audita la razón, nada más). La evidencia
-- opcional reutiliza `documentos_empleados` (sin columnas nuevas allí).
--
-- TENANT-SAFE: FK COMPUESTA (empresa_id, empleado_id) → empleados(empresa_id, id). Exige un índice UNIQUE (empresa_id, id) en
-- `empleados` (en schema.sql: uq_ruta_personal_empresa_id; en producción: uq_multas_empleado_empresa_id; el nombre no importa).
-- Si ese índice NO existe, el CREATE TABLE FALLA por completo (error 1215) y no queda ninguna tabla parcial: el preflight lo
-- comprueba antes y DETIENE. Este script nunca agrega ese índice por su cuenta.
--
-- Política de FKs (igual que rrhh_asistencia_ausencias, sobre la que ya se apoya la limpieza administrativa de empleados):
-- empresa y empleado ON DELETE CASCADE; todas ON UPDATE RESTRICT. Actores como VARCHAR(100) (username), igual que sus hermanas.

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_asistencia_justificaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  empleado_id INT NOT NULL,
  fecha DATE NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  observacion VARCHAR(500) NULL,
  estado VARCHAR(12) NOT NULL DEFAULT 'ACTIVA',
  version INT NOT NULL DEFAULT 1,
  creado_por VARCHAR(100) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por VARCHAR(100) NULL,
  actualizado_en DATETIME NULL,
  revertido_por VARCHAR(100) NULL,
  revertido_en DATETIME NULL,
  motivo_reversion VARCHAR(300) NULL,
  UNIQUE KEY uq_asist_just (empresa_id, empleado_id, fecha),
  INDEX idx_asist_just_fecha (empresa_id, fecha, estado),
  CONSTRAINT fk_asist_just_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id)
    ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_asist_just_empleado FOREIGN KEY (empresa_id, empleado_id)
    REFERENCES empleados(empresa_id, id) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT ck_asist_just_estado CHECK (estado IN ('ACTIVA', 'REVERTIDA')),
  CONSTRAINT ck_asist_just_version CHECK (version >= 1),
  CONSTRAINT ck_asist_just_tipo CHECK (CHAR_LENGTH(TRIM(tipo)) >= 2),
  -- ACTIVA no conserva marcas de reversión; REVERTIDA exige quién, cuándo y motivo.
  CONSTRAINT ck_asist_just_reversion CHECK (
    (estado = 'ACTIVA' AND revertido_por IS NULL AND revertido_en IS NULL AND motivo_reversion IS NULL)
    OR (estado = 'REVERTIDA' AND revertido_por IS NOT NULL AND revertido_en IS NOT NULL AND motivo_reversion IS NOT NULL
        AND CHAR_LENGTH(TRIM(motivo_reversion)) >= 5)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
