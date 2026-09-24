-- TMS-VIATICOS-REQUERIMIENTO-FORMAL — snapshots del formato administrativo (PROPUESTA: NO se ejecuta desde el código ni
-- desde Claude; revisar y aplicar manualmente ANTES de desplegar el código que escribe estas columnas).
-- Solo agrega columnas NULLables (los requerimientos ya existentes quedan con NULL: PDF/Excel muestran "—").

ALTER TABLE tms_viatico_requerimientos
  ADD COLUMN IF NOT EXISTS periodo_tipo  VARCHAR(10) NULL AFTER fecha_requerimiento,
  ADD COLUMN IF NOT EXISTS periodo_desde DATE NULL AFTER periodo_tipo,
  ADD COLUMN IF NOT EXISTS periodo_hasta DATE NULL AFTER periodo_desde;

ALTER TABLE tms_viatico_requerimiento_lineas
  ADD COLUMN IF NOT EXISTS cuenta_snapshot VARCHAR(80) NULL AFTER cargo_snapshot,
  ADD COLUMN IF NOT EXISTS banco_snapshot  VARCHAR(150) NULL AFTER cuenta_snapshot;

-- Integridad del periodo (tipo cerrado; desde/hasta coherentes). MariaDB >= 10.2.
ALTER TABLE tms_viatico_requerimientos
  ADD CONSTRAINT chk_vreq_periodo CHECK (
    (periodo_tipo IS NULL AND periodo_desde IS NULL AND periodo_hasta IS NULL)
    OR (periodo_tipo IN ('DIA','SEMANA','MES') AND periodo_desde IS NOT NULL AND periodo_hasta IS NOT NULL AND periodo_desde <= periodo_hasta)
  );
