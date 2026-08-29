-- VIATICOS-LIQUIDACION-ESTRUCTURADA — APLICADA MANUALMENTE POR EL USUARIO
-- (fuera de esta sesión de Claude, tras aprobación explícita). Se
-- conserva en el repo como registro histórico de la migración.
--
-- Hoy `liquidarViatico()` (src/lib/tms/viaticos.ts) solo acepta
-- observaciones de texto libre: "cierre administrativo", sin comprobantes
-- ni reintegro (ver comentario explícito en el código, que ya anticipaba
-- esta ampliación). El usuario aprobó capturar la liquidación de forma
-- estructurada: monto entregado, gastos comprobados, reintegro,
-- diferencia, observaciones.
--
-- Campos que YA EXISTEN y se reutilizan sin cambio de esquema:
--   - monto_asignado   -> es el "monto entregado" (el monto fijado al
--     autorizar/programar; registrarEntregaViatico() explícitamente NO
--     lo modifica al entregar — sigue siendo el monto real entregado).
--   - observaciones_liquidacion VARCHAR(300) -> observaciones opcionales.
--
-- Campos que NO EXISTEN y sí requieren esta migración:
--   - gastos_comprobados
--   - reintegro
--
-- "diferencia" NO se persiste (se calcula en lectura: monto_asignado -
-- gastos_comprobados - reintegro) — ver fórmula validada contra los 3
-- casos del ticket en el reporte de entrega. Evita una columna
-- redundante que podría desincronizarse de sus 3 insumos.
--
ALTER TABLE tms_viaticos
  ADD COLUMN IF NOT EXISTS gastos_comprobados DECIMAL(12,2) NULL AFTER observaciones_liquidacion,
  ADD COLUMN IF NOT EXISTS reintegro DECIMAL(12,2) NULL AFTER gastos_comprobados;

-- NULL mientras el viático no está LIQUIDADO (mismo criterio que el resto
-- de columnas de esta tabla: autorizado_por/entregado_por/liquidado_por
-- son NULL hasta su transición correspondiente) — nunca 0 por defecto,
-- para no confundir "sin liquidar todavía" con "liquidado con gasto
-- comprobado de Q0".
