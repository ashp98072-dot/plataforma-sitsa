-- SOLO LECTURA de datos/metadatos. No ejecutado por este PR.
-- Configuración explícita: ajustar SOLO este literal para otra instalación.
-- Ejecutar el archivo completo; no depende de la vista activa de phpMyAdmin.
SET @compras_schema_objetivo = 'u611730801_Plataforma';
--
-- COMPRAS-FASE-3-DOCUMENTOS-LINEA — preflight ACOTADO: a diferencia de
-- preflight-2026-09-compras-base.sql (que valida 4 tablas nuevas completas),
-- este solo revisa UN constraint existente (compras_linea_documentos.tipo),
-- así que no repite el diff completo de columnas/índices/FKs de esa tabla
-- — esos ya están cubiertos por el preflight base y no cambian aquí.
--
-- APLICAR = el CHECK sigue con los 2 valores originales (FACTURA/COMPROBANTE)
--           -> ejecutar migrate-2026-09-compras-documentos-linea-tipo.sql.
-- NOOP    = el CHECK ya tiene los 6 valores esperados -> no aplicar nada.
-- DETENER = la tabla no existe, o el CHECK tiene una forma inesperada
--           (ni los 2 valores viejos ni los 6 nuevos) -> revisar a mano,
--           NO aplicar la migración a ciegas.
SELECT VERSION() AS version_servidor, @compras_schema_objetivo AS base_destino, DATABASE() AS contexto_activo;

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @compras_schema_objetivo AND TABLE_NAME = 'compras_linea_documentos';

SELECT CONSTRAINT_NAME, CHECK_CLAUSE
FROM information_schema.CHECK_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = @compras_schema_objetivo
  AND TABLE_NAME = 'compras_linea_documentos'
  AND CONSTRAINT_NAME = 'chk_compras_documento_tipo';

-- CORRECCIÓN post-revisión: este archivo tenía un SELECT informativo
-- (conteo de filas por `tipo`) que consultaba compras_linea_documentos
-- directamente, SIN calificar el esquema — a diferencia de todo lo demás
-- aquí, que solo lee information_schema filtrando por
-- @compras_schema_objetivo. Ese SELECT sí dependía de DATABASE()/USE
-- activo, contradiciendo la garantía "no depende de la vista activa de
-- phpMyAdmin" de la cabecera. Se eliminó en vez de calificarlo (MariaDB no
-- permite parametrizar un identificador de esquema en un SELECT plano; la
-- alternativa —PREPARE/EXECUTE armando el nombre calificado con CONCAT—
-- añadía complejidad para un dato puramente informativo que no participa
-- en la decisión APLICAR/NOOP/DETENER). Un CHECK más permisivo nunca
-- invalida filas ya guardadas, así que no hace falta para decidir si es
-- seguro aplicar la migración.

WITH normalizado AS (
  SELECT LOWER(REPLACE(REPLACE(REPLACE(CHECK_CLAUSE, '`', ''), ' ', ''), CHAR(10), '')) AS clausula
  FROM information_schema.CHECK_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @compras_schema_objetivo
    AND TABLE_NAME = 'compras_linea_documentos'
    AND CONSTRAINT_NAME = 'chk_compras_documento_tipo'
)
SELECT
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = @compras_schema_objetivo AND TABLE_NAME = 'compras_linea_documentos')
      THEN 'DETENER'
    WHEN NOT EXISTS (SELECT 1 FROM normalizado)
      THEN 'DETENER'
    WHEN (SELECT clausula FROM normalizado) = "tipoin('factura','comprobante')"
      THEN 'APLICAR'
    WHEN (SELECT clausula FROM normalizado) = "tipoin('factura','cotizacion','orden_compra','comprobante','nota_credito','otro')"
      THEN 'NOOP'
    ELSE 'DETENER'
  END AS decision,
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = @compras_schema_objetivo AND TABLE_NAME = 'compras_linea_documentos')
      THEN 'La tabla compras_linea_documentos no existe — aplicar primero migrate-2026-09-compras-base.sql.'
    WHEN NOT EXISTS (SELECT 1 FROM normalizado)
      THEN 'No se encontró el constraint chk_compras_documento_tipo — revisar SHOW CREATE TABLE a mano.'
    WHEN (SELECT clausula FROM normalizado) = "tipoin('factura','comprobante')"
      THEN 'CHECK con los 2 valores originales — seguro ejecutar la migración (aditiva, sin backfill).'
    WHEN (SELECT clausula FROM normalizado) = "tipoin('factura','cotizacion','orden_compra','comprobante','nota_credito','otro')"
      THEN 'CHECK ya ampliado a los 6 valores — nada que hacer.'
    ELSE 'La cláusula del CHECK no coincide con ninguna forma esperada — revisar SHOW CREATE TABLE a mano antes de tocarlo.'
  END AS detalle;
