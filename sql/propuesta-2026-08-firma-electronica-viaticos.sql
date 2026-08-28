-- VIATICOS-FIRMA — APLICADA MANUALMENTE POR EL USUARIO (fuera de esta
-- sesión de Claude, tras aprobación explícita). Se conserva en el repo
-- como registro histórico de la migración, no como propuesta pendiente.
--
-- Decisión de negocio: usar firma electrónica interna simbólica en
-- Viáticos (autorización y liquidación), confirmando identidad con la
-- CONTRASEÑA actual del usuario (no PIN). Por eso este archivo contiene
-- ÚNICAMENTE la tabla `firmas_electronicas` de la propuesta original
-- (sql/propuesta-2026-08-firma-electronica.sql, diseño completo en
-- FIRMA-ELECTRONICA-DISENO.md) — NO incluye `firma_pins` (no se usará
-- PIN en ningún módulo activado hasta ahora).

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

-- Notas de uso previstas para Viáticos (aplicación, no DDL):
--   accion         = 'AUTORIZAR_VIATICO' | 'LIQUIDAR_VIATICO'
--   modulo         = 'VIATICOS'
--   entidad_tipo   = 'VIATICO'
--   entidad_id     = tms_viaticos.id
--   metodo         = 'PASSWORD' (único método activado; 'PIN' queda
--                    contemplado por el tipo pero no se usa)
--   resultado      = 'FALLIDA' se registra también en un intento de
--                    contraseña incorrecta (control de fuerza bruta),
--                    pero NUNCA autoriza la transición de estado.
-- La tabla es de solo-inserción a nivel de aplicación (append-only): no
-- se expone ningún UPDATE/DELETE de firmas desde la UI ni desde el
-- backend de Viáticos.
