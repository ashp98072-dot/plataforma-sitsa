-- PENDIENTE DE AUDITORIA. NO EJECUTADO. REQUIERE AUTORIZACION DDL SEPARADA.
-- PASO 1: una sola sentencia; base objetivo seleccionada y preflight aprobado.
-- Flag apagado en todos los nodos. NO importar junto con paso 2.
-- PARAR al terminar (tambien ante error/timeout). Ejecutar luego SOLO el
-- archivo verificar-2026-10-cb2-documentos-fase2-paso1.sql y auditar su resultado.
ALTER TABLE flota_cb2_facturas
  ADD COLUMN revision_documental INT NOT NULL DEFAULT 0,
  ADD CONSTRAINT ck_cb2f_revision_documental CHECK (revision_documental>=0);
