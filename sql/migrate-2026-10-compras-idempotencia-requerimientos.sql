-- =====================================================================
-- MIGRACIÓN — IDEMPOTENCIA DE CREACIÓN: Requerimientos de Compras (PR B)
-- Archivo: sql/migrate-2026-10-compras-idempotencia-requerimientos.sql
--
-- PROPUESTA PARA REVISIÓN. NO se ejecuta desde la aplicación ni desde este PR. Correr MANUALMENTE y solo tras autorización
-- explícita, DESPUÉS de revisar sql/preflight-2026-10-compras-idempotencia-requerimientos.sql y, al terminar, verificar con
-- sql/verificar-2026-10-compras-idempotencia-requerimientos.sql (ambos de solo lectura).
--
-- QUÉ HACE (aditivo, sin tocar datos):
--   * compras_requerimientos : + clave_idempotencia VARCHAR(64) NULL, + huella_idempotencia CHAR(64) NULL,
--                              + UNIQUE uq_compras_req_empresa_clave (empresa_id, clave_idempotencia)
--
-- QUÉ NO HACE: no hay UPDATE/DELETE/DROP, no se inventan claves para filas existentes (quedan NULL: histórico), no se
-- deduplica ni se modifica ninguna fila ni línea.
--
-- POR QUÉ UN UNIQUE CON NULL ES SEGURO: MariaDB/MySQL permiten VARIAS filas con NULL en un índice UNIQUE; solo las filas
-- que traen clave compiten. La unicidad es por (empresa_id, clave): la misma clave en otra empresa no choca.
--
-- QUÉ ES `clave_idempotencia`: token aleatorio que genera el formulario por intento de creación (NO se deriva de
-- fecha/proveedor/monto/concepto: dos requerimientos legítimos iguales deben poder coexistir).
-- QUÉ ES `huella_idempotencia`: SHA-256 (hex) del contenido funcional enviado (cabecera, observaciones, total y líneas en
-- orden); distingue un reintento idéntico (mismo registro) de una reutilización de la clave con otro contenido (HTTP 409).
--
-- COMPATIBILIDAD DE DESPLIEGUE: la aplicación tolera que estas columnas todavía no existan (opera en modo legado, sin
-- protección y sin fallar). Aplicar la migración ANTES o DESPUÉS del código es seguro; la protección empieza cuando ambos
-- están en producción.
--
-- ESQUEMA EXPLÍCITO: califica `u611730801_Plataforma.<tabla>` (no depende del esquema activo de la sesión de
-- phpMyAdmin/Hostinger). En otra base (pruebas), reemplazar el nombre del esquema en todo el archivo.
--
-- IDEMPOTENTE: IF NOT EXISTS en columnas e índice; reejecutarla no falla ni repite cambios.
-- =====================================================================

ALTER TABLE u611730801_Plataforma.compras_requerimientos
  ADD COLUMN IF NOT EXISTS clave_idempotencia VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS huella_idempotencia CHAR(64) NULL,
  ADD UNIQUE INDEX IF NOT EXISTS uq_compras_req_empresa_clave (empresa_id, clave_idempotencia);

-- ---------------------------------------------------------------------
-- REVERSIÓN (NO ejecutar salvo decisión explícita; los requerimientos con clave perderían la protección de reintentos):
--   ALTER TABLE u611730801_Plataforma.compras_requerimientos DROP INDEX uq_compras_req_empresa_clave,
--     DROP COLUMN huella_idempotencia, DROP COLUMN clave_idempotencia;
-- ---------------------------------------------------------------------
