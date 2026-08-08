-- Migración Hostinger: Clientes compartidos + Facturación (cuestionario)
-- Seguro de re-ejecutar (IF NOT EXISTS / JSON append defensivo).

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

CREATE TABLE IF NOT EXISTS fact_empresa_perfil (
  empresa_id INT NOT NULL PRIMARY KEY,
  respuestas_json LONGTEXT NOT NULL,
  completado_pct TINYINT UNSIGNED NOT NULL DEFAULT 0,
  actualizado_por INT NULL,
  actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_fact_emp_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

-- Nota: la app también agrega "clientes"/"facturacion" a modulos_json
-- automáticamente al abrir esos módulos (Hostinger sin re-seed).
