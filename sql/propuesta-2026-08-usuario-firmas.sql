-- MI-FIRMA-1 — firma manuscrita personal reutilizable, PROPUESTA (NO
-- ejecutada por Claude — ejecutar manualmente, mismo criterio que el
-- resto de migraciones de este proyecto).
--
-- Diseño aprobado por el usuario:
--   1. usuario_firmas es GLOBAL por usuario (la tabla `usuarios` es
--      global a la plataforma, no por empresa — un mismo usuario puede
--      tener acceso a varias empresas).
--   2. UNIQUE(usuario_id) — una sola firma activa por usuario. "Cambiar
--      firma" reemplaza esta fila (no versiona); "Eliminar firma" borra
--      la fila + el archivo físico.
--   3. Sin empresa_id — no es información propia de una empresa, es un
--      atributo personal del usuario.
--   4. Cada USO de esta firma guardada (al autorizar/liquidar un
--      viático) debe generar una COPIA física independiente asociada a
--      su propia fila de firmas_electronicas (con su propio código,
--      hash, imagenSha256, fecha) — nunca apunta al archivo de esta
--      tabla. Por eso cambiar o eliminar la firma personal NUNCA
--      modifica firmas históricas ya generadas.
--
-- Historial global / "Ver firmas" queda FUERA de este ticket
-- (FIRMAS-HISTORIAL-1, futuro).

CREATE TABLE IF NOT EXISTS usuario_firmas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  imagen_ruta VARCHAR(255) NOT NULL,
  imagen_nombre_original VARCHAR(255) NULL,
  imagen_mime VARCHAR(50) NOT NULL,
  imagen_tamano INT NOT NULL,
  imagen_sha256 CHAR(64) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_usuario_firma (usuario_id),
  CONSTRAINT fk_usuario_firma_usuario
    FOREIGN KEY (usuario_id)
    REFERENCES usuarios(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
