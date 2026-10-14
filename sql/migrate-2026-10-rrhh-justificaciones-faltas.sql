-- RRHH — Justificación de faltas desde Reportes de asistencia (capa sobre la ausencia real).
--
-- ADITIVA y no destructiva: solo CREATE TABLE IF NOT EXISTS (segura de repetir). No altera ni reinterpreta sesiones_trabajo,
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
