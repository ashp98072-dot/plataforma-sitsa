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
  -- Admin | RRHH | Contabilidad | Operaciones | CoordinadorPredios | Visualizador
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
  puede_editar TINYINT(1) NOT NULL DEFAULT 0,
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
  tipo_horario VARCHAR(40) NOT NULL DEFAULT 'Fijo',
  fecha_alta DATE NULL,
  fecha_inicio_laboral DATE NULL,
  hora_entrada_teorica VARCHAR(20) NOT NULL DEFAULT '08:00:00',
  hora_salida_teorica VARCHAR(20) NOT NULL DEFAULT '17:00:00',
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo',
  UNIQUE KEY uq_emp_empresa_codigo (empresa_id, codigo),
  CONSTRAINT fk_emp_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sesiones_trabajo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  fecha_jornada DATE NOT NULL,
  entrada_at DATETIME NULL,
  salida_at DATETIME NULL,
  estado VARCHAR(40) NULL,
  comentarios_rrhh TEXT NULL,
  UNIQUE KEY uq_sesion (empresa_id, id_empleado, fecha_jornada),
  CONSTRAINT fk_ses_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_ses_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS incidencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  dias_habiles DECIMAL(8,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_inc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_inc_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
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

CREATE TABLE IF NOT EXISTS inventario_rrhh (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(80) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  categoria VARCHAR(80) NULL,
  stock INT NOT NULL DEFAULT 0,
  unidad VARCHAR(40) NOT NULL DEFAULT 'Unidad',
  estado VARCHAR(20) NOT NULL DEFAULT 'Activo',
  UNIQUE KEY uq_inv_rrhh (empresa_id, codigo),
  CONSTRAINT fk_invrh_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
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
  tipo VARCHAR(40) NOT NULL DEFAULT 'Camion',
  marca VARCHAR(80) NULL,
  modelo VARCHAR(80) NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Disponible',
  UNIQUE KEY uq_unidad (empresa_id, placa),
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

-- Flota / Predios
CREATE TABLE IF NOT EXISTS flota_vehiculos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  placa VARCHAR(40) NOT NULL,
  marca VARCHAR(80) NULL,
  modelo VARCHAR(80) NULL,
  km_actual INT NULL,
  km_intervalo_servicio INT NOT NULL DEFAULT 10000,
  km_ultimo_servicio INT NULL,
  fecha_ultimo_servicio DATE NULL,
  en_taller TINYINT(1) NOT NULL DEFAULT 0,
  fecha_entrada_taller DATE NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Activo',
  UNIQUE KEY uq_flota_placa (empresa_id, placa),
  CONSTRAINT fk_flota_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flota_lecturas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  vehiculo_id INT NOT NULL,
  km INT NOT NULL,
  fecha_lectura DATE NOT NULL,
  nota VARCHAR(300) NULL,
  registrado_por VARCHAR(100) NULL,
  CONSTRAINT fk_flotal_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_flotal_veh FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flota_servicios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  vehiculo_id INT NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  km_servicio INT NULL,
  fecha_servicio DATE NOT NULL,
  costo DECIMAL(12,2) NOT NULL DEFAULT 0,
  descripcion TEXT NULL,
  CONSTRAINT fk_flotas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_flotas_veh FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE CASCADE
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
