-- VIATICOS-FIRMA-VISUAL — columna de imagen manuscrita sobre
-- firmas_electronicas (ya existente, ver
-- sql/propuesta-2026-08-firma-electronica-viaticos.sql).
--
-- REGISTRO HISTÓRICO — este ALTER se entregó originalmente en el chat de
-- la sesión (no se había guardado como archivo, a diferencia de las
-- demás migraciones de este proyecto) durante el ticket "FIRMA VISUAL
-- MANUSCRITA PARA VIÁTICOS". El usuario confirmó haberlo ejecutado
-- manualmente, pero el log real de producción (2026-08-29, Hostinger,
-- ver hbuilds/versions/.../nodejs/console.log) muestra:
--
--   Error: Unknown column 'imagen_ruta' in 'INSERT INTO'
--
-- Es decir, las columnas NO existen en la base de datos que la app
-- realmente usa en producción (aplicado a otra base, ALTER fallido sin
-- notarlo, o falta ejecutarlo en este entorno). Verificar con:
--
--   DESCRIBE firmas_electronicas;
--
-- y ejecutar el ALTER de abajo si `imagen_ruta` no aparece en el
-- resultado. Sin cláusula AFTER (a diferencia de la versión entregada
-- en el chat) para no depender de la posición exacta de columnas
-- existentes — MySQL las agrega al final, funcionalmente idéntico.

ALTER TABLE firmas_electronicas
  ADD COLUMN IF NOT EXISTS imagen_ruta VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS imagen_nombre_original VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS imagen_mime VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS imagen_tamano INT NULL;

-- Verificación posterior recomendada:
-- DESCRIBE firmas_electronicas;
-- Debe listar imagen_ruta / imagen_nombre_original / imagen_mime / imagen_tamano.
