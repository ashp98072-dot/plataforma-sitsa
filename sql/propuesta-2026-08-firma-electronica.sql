-- PORTAL-HARDENING-2 (Fase H) — PROPUESTA DE DISEÑO, NO APLICAR.
--
-- Este archivo NO se ha ejecutado contra ninguna base de datos (ni local
-- ni de producción). Se entrega únicamente para revisión, junto con
-- FIRMA-ELECTRONICA-DISENO.md (raíz del repo), que explica cada campo,
-- las reglas de atomicidad/auditoría y los riesgos.
--
-- Por qué se detiene aquí: el ticket PORTAL-HARDENING-2 pide DISEÑAR la
-- base de firma electrónica transaccional, pero explícitamente NO activar
-- firma en ninguna acción real todavía, y detener cualquier migración de
-- firma hasta aprobación explícita de negocio (ver regla de parada,
-- CLAUDE.md §4 y §12).
--
-- Si se aprueba, aplicar manualmente (o vía el mecanismo de migración que
-- ya use el proyecto) — NUNCA automáticamente desde una sesión de Claude.

CREATE TABLE IF NOT EXISTS firmas_electronicas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  usuario_id INT NULL,
  empleado_id INT NULL,
  accion VARCHAR(60) NOT NULL,
  modulo VARCHAR(40) NOT NULL,
  entidad_tipo VARCHAR(60) NOT NULL,
  entidad_id INT NOT NULL,
  fecha_hora_servidor DATETIME NOT NULL,
  hash_payload CHAR(64) NOT NULL,
  payload_canonico TEXT NOT NULL,
  sesion_id VARCHAR(128) NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  metodo VARCHAR(20) NOT NULL,
  resultado ENUM('EXITOSA','FALLIDA') NOT NULL DEFAULT 'EXITOSA',
  codigo_firma VARCHAR(30) NOT NULL,
  version VARCHAR(10) NOT NULL DEFAULT '1',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_firma_codigo (codigo_firma),
  INDEX idx_firma_entidad (empresa_id, entidad_tipo, entidad_id),
  INDEX idx_firma_accion (empresa_id, accion, creado_en),
  CONSTRAINT fk_firma_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_firma_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT fk_firma_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS firma_pins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  usuario_id INT NULL,
  empleado_id INT NULL,
  pin_hash VARCHAR(255) NOT NULL,
  intentos_fallidos INT NOT NULL DEFAULT 0,
  bloqueado_hasta DATETIME NULL,
  actualizado_en DATETIME NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pin_usuario (empresa_id, usuario_id),
  UNIQUE KEY uq_pin_empleado (empresa_id, empleado_id),
  CONSTRAINT fk_pin_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_pin_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_pin_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
