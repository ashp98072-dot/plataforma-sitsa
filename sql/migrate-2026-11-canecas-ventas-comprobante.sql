-- Canecas · comprobante de venta imprimible: quién lleva / quién recibe.
-- Migración MANUAL (no se ejecuta sola ni con el despliegue). Requisitos: respaldo restaurable verificado y autorización expresa.
-- Es aditiva e idempotente: dos columnas NULL al final de canecas_ventas; no modifica filas, índices, CHECK ni triggers existentes.
-- El código funciona SIN esta migración (los campos quedan vacíos en el comprobante); con ella, quedan guardados por venta.
--
-- Preflight (solo lectura; debe devolver 0 si aún no se aplicó, 2 si ya está):
--   SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME IN ('quien_lleva','quien_recibe');
-- Postcheck (solo lectura; debe devolver 2 filas, ambas VARCHAR(160) NULL):
--   SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME IN ('quien_lleva','quien_recibe') ORDER BY COLUMN_NAME;
-- Reversión (solo si no hay datos que conservar): ALTER TABLE canecas_ventas DROP COLUMN quien_lleva, DROP COLUMN quien_recibe;

ALTER TABLE canecas_ventas
  ADD COLUMN IF NOT EXISTS quien_lleva VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS quien_recibe VARCHAR(160) NULL;
