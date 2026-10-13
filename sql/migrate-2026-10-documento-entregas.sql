-- =====================================================================
-- MIGRACIÓN — CONTROL DE ENTREGA DE DOCUMENTOS (PR 1: base común)
-- Archivo: sql/migrate-2026-10-documento-entregas.sql
--
-- PROPUESTA PARA REVISIÓN. NO se ejecuta desde la aplicación ni desde este PR. Correr MANUALMENTE y solo tras autorización
-- explícita, DESPUÉS de revisar sql/preflight-2026-10-documento-entregas.sql y, al terminar, verificar con
-- sql/verificar-2026-10-documento-entregas.sql (ambos de solo lectura).
--
-- QUÉ HACE (aditivo): crea UNA tabla nueva `documento_entregas`. No modifica ninguna tabla existente, no agrega columnas,
-- no hace UPDATE/DELETE/DROP, no crea filas. Los documentos históricos quedan sin entregas (el PDF mostrará casillas en blanco).
--
-- MODELO: una fila = una entrega física del expediente de un documento (Solicitud de fondo, Gasto operativo o Requerimiento de
-- compra) de un ÁREA a otra. Separada del estado del documento: registrar entregas NO cambia el estado del documento.
--   EMITIDA --(receptor confirma con firma | recepción presencial con firma dibujada)--> RECIBIDA
--   EMITIDA --(receptor rechaza con motivo; solo modo SISTEMA)------------------------> RECHAZADA
--   EMITIDA --(emisor, o quien tenga entregas_anular, con motivo)----------------------> ANULADA
-- Los pares origen -> destino permitidos viven en código (src/lib/entregas/catalogo.ts), no en la base.
--
-- INVARIANTES QUE LA BASE GARANTIZA (además de la aplicación):
--   * empresa_id obligatorio; FK a empresas; UNIQUE (empresa_id, id) para FKs compuestas futuras.
--   * Una sola entrega EMITIDA (pendiente) por documento: columna generada `pendiente_documento` + UNIQUE.
--   * Idempotencia de la emisión: UNIQUE (empresa_id, clave_idempotencia); clave y huella obligatorias (tabla nueva).
--   * Firma de emisión obligatoria (FK a firmas_electronicas); RECIBIDA exige firma de recepción.
--   * Coherencia por estado/modo (CHECK): datos de recepción solo en RECIBIDA; datos de cierre solo en RECHAZADA/ANULADA;
--     PRESENCIAL sin usuario receptor y con usuario operador; SISTEMA con usuario receptor; receptor distinto del emisor.
--
-- PERMISOS: se agregan como filas de usuario_modulo (VARCHAR(40), ya existente) — NO requieren SQL. Ningún rol los recibe.
--
-- ESQUEMA EXPLÍCITO: califica `u611730801_Plataforma.<tabla>` (no depende del esquema activo de la sesión de
-- phpMyAdmin/Hostinger). En otra base (pruebas), reemplazar el nombre del esquema en todo el archivo.
--
-- REQUISITOS: MariaDB con CHECK aplicado (>= 10.2.1; producción 11.8) e InnoDB. firmas_electronicas con columnas de imagen
-- (sql/propuesta-2026-08-firma-electronica-viaticos-imagen.sql, ya aplicada) y usuario_id NULL (diseño original).
--
-- IDEMPOTENTE: CREATE TABLE IF NOT EXISTS; reejecutarla no falla ni cambia nada (si la tabla ya existe, no la altera:
-- revisar con el script de verificación).
-- =====================================================================

CREATE TABLE IF NOT EXISTS u611730801_Plataforma.documento_entregas (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  -- Documento (referencia polimórfica: la existencia y la empresa se validan en la aplicación con FOR UPDATE).
  modulo VARCHAR(20) NOT NULL,
  entidad_tipo VARCHAR(40) NOT NULL,
  entidad_id INT NOT NULL,
  documento_codigo VARCHAR(40) NULL,                    -- snapshot del código del documento al emitir
  etapa_origen VARCHAR(20) NOT NULL,
  etapa_destino VARCHAR(20) NOT NULL,
  modo VARCHAR(12) NOT NULL,                            -- SISTEMA | PRESENCIAL (cómo se recibirá)
  estado VARCHAR(12) NOT NULL DEFAULT 'EMITIDA',
  -- Emisión (siempre un usuario del sistema; nombre/rol son snapshot: el rol puede cambiar después)
  emitido_por_usuario_id INT NOT NULL,
  emitido_por_nombre VARCHAR(200) NOT NULL,
  emitido_por_rol VARCHAR(40) NULL,
  emitido_en DATETIME NOT NULL,
  firma_emision_id INT NOT NULL,
  observaciones_emision VARCHAR(1000) NULL,
  -- Recepción (SISTEMA: el receptor con su usuario; PRESENCIAL: persona sin usuario, nombre + firma dibujada)
  recibido_por_usuario_id INT NULL,
  recibido_por_nombre VARCHAR(200) NULL,
  recibido_por_rol VARCHAR(40) NULL,
  recibido_en DATETIME NULL,
  firma_recepcion_id INT NULL,
  observaciones_recepcion VARCHAR(1000) NULL,
  recepcion_operada_por_usuario_id INT NULL,            -- PRESENCIAL: usuario que operó el dispositivo
  recepcion_operada_por_nombre VARCHAR(200) NULL,
  -- Cierre sin recepción (RECHAZADA / ANULADA)
  cerrado_por_usuario_id INT NULL,
  cerrado_por_nombre VARCHAR(200) NULL,
  cerrado_en DATETIME NULL,
  motivo_cierre VARCHAR(1000) NULL,
  -- Idempotencia de la emisión (mismo contrato que Fondos/Gastos/Compras; aquí obligatoria)
  clave_idempotencia VARCHAR(64) NOT NULL,
  huella_idempotencia CHAR(64) NOT NULL,
  -- 'MODULO:entidad_id' solo mientras la entrega está EMITIDA; NULL en cualquier otro estado (NULL no compite en UNIQUE).
  pendiente_documento VARCHAR(40) AS (IF(estado = 'EMITIDA', CONCAT(modulo, ':', entidad_id), NULL)) PERSISTENT,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_de_empresa_id (empresa_id, id),
  UNIQUE KEY uq_de_empresa_clave (empresa_id, clave_idempotencia),
  UNIQUE KEY uq_de_pendiente (empresa_id, pendiente_documento),
  INDEX idx_de_documento (empresa_id, modulo, entidad_id, id),
  INDEX idx_de_bandeja (empresa_id, estado, modo, modulo, etapa_destino),

  CONSTRAINT chk_de_modulo CHECK (modulo IN ('FONDOS', 'GASTOS', 'COMPRAS')),
  CONSTRAINT chk_de_entidad_tipo CHECK (
    (modulo = 'FONDOS' AND entidad_tipo = 'SOLICITUD_FONDO')
    OR (modulo = 'GASTOS' AND entidad_tipo = 'GASTO_OPERATIVO')
    OR (modulo = 'COMPRAS' AND entidad_tipo = 'REQUERIMIENTO_COMPRA')),
  CONSTRAINT chk_de_etapas CHECK (
    etapa_origen IN ('OPERACIONES', 'COMPRAS', 'TESORERIA', 'CONTABILIDAD')
    AND etapa_destino IN ('OPERACIONES', 'COMPRAS', 'TESORERIA', 'CONTABILIDAD')
    AND etapa_origen <> etapa_destino),
  CONSTRAINT chk_de_modo CHECK (modo IN ('SISTEMA', 'PRESENCIAL')),
  CONSTRAINT chk_de_estado CHECK (estado IN ('EMITIDA', 'RECIBIDA', 'RECHAZADA', 'ANULADA')),
  CONSTRAINT chk_de_recepcion CHECK (
    (estado = 'RECIBIDA'
      AND recibido_en IS NOT NULL AND firma_recepcion_id IS NOT NULL AND recibido_por_nombre IS NOT NULL
      AND ((modo = 'SISTEMA' AND recibido_por_usuario_id IS NOT NULL AND recepcion_operada_por_usuario_id IS NULL)
        OR (modo = 'PRESENCIAL' AND recibido_por_usuario_id IS NULL AND recepcion_operada_por_usuario_id IS NOT NULL)))
    OR (estado <> 'RECIBIDA'
      AND recibido_en IS NULL AND firma_recepcion_id IS NULL AND recibido_por_usuario_id IS NULL
      AND recibido_por_nombre IS NULL AND recepcion_operada_por_usuario_id IS NULL)),
  CONSTRAINT chk_de_cierre CHECK (
    (estado IN ('RECHAZADA', 'ANULADA') AND cerrado_en IS NOT NULL AND cerrado_por_usuario_id IS NOT NULL AND motivo_cierre IS NOT NULL)
    OR (estado IN ('EMITIDA', 'RECIBIDA') AND cerrado_en IS NULL AND cerrado_por_usuario_id IS NULL AND motivo_cierre IS NULL)),
  CONSTRAINT chk_de_rechazo_sistema CHECK (estado <> 'RECHAZADA' OR modo = 'SISTEMA'),
  CONSTRAINT chk_de_receptor_no_emisor CHECK (recibido_por_usuario_id IS NULL OR recibido_por_usuario_id <> emitido_por_usuario_id),
  CONSTRAINT chk_de_firmas_distintas CHECK (firma_recepcion_id IS NULL OR firma_recepcion_id <> firma_emision_id),
  CONSTRAINT chk_de_huella CHECK (CHAR_LENGTH(huella_idempotencia) = 64 AND CHAR_LENGTH(clave_idempotencia) >= 16),

  CONSTRAINT fk_de_empresa FOREIGN KEY (empresa_id) REFERENCES u611730801_Plataforma.empresas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_de_emisor FOREIGN KEY (emitido_por_usuario_id) REFERENCES u611730801_Plataforma.usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_de_receptor FOREIGN KEY (recibido_por_usuario_id) REFERENCES u611730801_Plataforma.usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_de_operador FOREIGN KEY (recepcion_operada_por_usuario_id) REFERENCES u611730801_Plataforma.usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_de_cerrado_por FOREIGN KEY (cerrado_por_usuario_id) REFERENCES u611730801_Plataforma.usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_de_firma_emision FOREIGN KEY (firma_emision_id) REFERENCES u611730801_Plataforma.firmas_electronicas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_de_firma_recepcion FOREIGN KEY (firma_recepcion_id) REFERENCES u611730801_Plataforma.firmas_electronicas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- REVERSIÓN (NO ejecutar salvo decisión explícita; solo es segura si la tabla está vacía — si tiene filas, se perdería el
-- historial de entregas; las firmas en firmas_electronicas quedarían sin entrega asociada):
--   SELECT COUNT(*) FROM u611730801_Plataforma.documento_entregas;   -- debe ser 0
--   DROP TABLE u611730801_Plataforma.documento_entregas;
-- ---------------------------------------------------------------------
