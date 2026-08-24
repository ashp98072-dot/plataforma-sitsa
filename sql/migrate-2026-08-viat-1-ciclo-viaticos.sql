-- VIAT-1: ciclo completo de viáticos operativos —
-- PROGRAMADO -> AUTORIZADO -> ENTREGADO -> LIQUIDADO.
-- Aditiva e idempotente. NO se ejecuta automáticamente en runtime (mismo
-- criterio que el resto de SITSA: migraciones SQL explícitas antes de
-- desplegar). NO borra ni transforma ningún dato existente.
--
-- tms_viaticos.estado y tms_viaticos.metodo_pago YA EXISTEN (desde
-- VIAT-0/migrate-2026-08-viat-0-viaticos.sql) — se reutilizan tal cual,
-- sin ALTER. Esta migración solo agrega las columnas que todavía faltan
-- para registrar quién/cuándo autorizó, entregó y liquidó, y los datos de
-- la entrega (método/referencia/observaciones).

ALTER TABLE tms_viaticos
  ADD COLUMN IF NOT EXISTS autorizado_por VARCHAR(100) NULL AFTER metodo_pago,
  ADD COLUMN IF NOT EXISTS autorizado_en DATETIME NULL AFTER autorizado_por,
  ADD COLUMN IF NOT EXISTS entregado_por VARCHAR(100) NULL AFTER autorizado_en,
  ADD COLUMN IF NOT EXISTS entregado_en DATETIME NULL AFTER entregado_por,
  ADD COLUMN IF NOT EXISTS referencia_pago VARCHAR(100) NULL AFTER entregado_en,
  ADD COLUMN IF NOT EXISTS observaciones_entrega VARCHAR(300) NULL AFTER referencia_pago,
  ADD COLUMN IF NOT EXISTS liquidado_por VARCHAR(100) NULL AFTER observaciones_entrega,
  ADD COLUMN IF NOT EXISTS liquidado_en DATETIME NULL AFTER liquidado_por,
  ADD COLUMN IF NOT EXISTS observaciones_liquidacion VARCHAR(300) NULL AFTER liquidado_en;

-- Nota de diseño: "liquidado" en esta fase significa únicamente "cerrado
-- administrativamente" (observaciones_liquidacion es texto libre). Si más
-- adelante el negocio requiere comprobantes/devoluciones, se ampliaría con
-- columnas/tabla adicionales entonces — no se anticipa esa lógica aquí.
