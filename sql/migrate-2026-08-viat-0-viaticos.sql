-- VIAT-0: viáticos operativos asociados a una programación/viaje (piloto y
-- auxiliares). Aditivo e idempotente — seguro correrlo más de una vez.
--
-- MIGRACIÓN REAL: YA SE EJECUTÓ MANUALMENTE EN PRODUCCIÓN. Se deja aquí
-- como referencia del esquema real (src/lib/tms/viaticos.ts NO crea ni
-- altera tablas en tiempo de ejecución — asume que esta migración ya está
-- aplicada; si las tablas no existen, las funciones fallan con el error
-- real de MySQL en vez de crear estructura por su cuenta). No volver a
-- ejecutar como parte de un cambio de código; es aditiva/idempotente por
-- si hiciera falta reaplicarla en otro entorno (dev/staging), no porque
-- deba correrse de nuevo en producción.
--
-- Los viáticos son un flujo puramente OPERATIVO de TMS/viaje — NUNCA se
-- pagan por planilla/nómina. Sin relación con rrhh_planilla_lineas, sin
-- descuentos/ingresos de nómina generados desde aquí.

CREATE TABLE IF NOT EXISTS tms_viaticos_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  -- Reutiliza el mismo vocabulario que empleados.categoria_ops /
  -- tms_personal.tipo (Piloto | Auxiliar | ...) — no es un catálogo nuevo.
  puesto VARCHAR(60) NOT NULL,
  monto_defecto DECIMAL(12,2) NOT NULL DEFAULT 0,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  actualizado_por VARCHAR(100) NULL,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_viaticos_cfg (empresa_id, puesto),
  CONSTRAINT fk_viacfg_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_viaticos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  plan_id INT NOT NULL,
  -- tms_personal.id del piloto/auxiliar REALMENTE asignado al viaje (nunca
  -- empleados.id directo — algunos tms_personal no tienen id_empleado
  -- vinculado; el empleado real, cuando existe, se deriva vía
  -- tms_personal.id_empleado, no se duplica aquí).
  personal_id INT NOT NULL,
  rol VARCHAR(20) NOT NULL, -- 'Piloto' | 'Auxiliar'
  monto_sugerido DECIMAL(12,2) NOT NULL DEFAULT 0,
  monto_asignado DECIMAL(12,2) NOT NULL DEFAULT 0,
  motivo_cambio VARCHAR(300) NULL,
  modificado_por VARCHAR(100) NULL,
  -- Fase operativa posterior VIAT-1 (no usado todavía): PENDIENTE/
  -- PROGRAMADO -> AUTORIZADO -> ENTREGADO (dinero entregado al piloto/
  -- auxiliar) -> LIQUIDADO (cierre administrativo del viático). VIAT-0
  -- nunca escribe otro valor que 'PROGRAMADO'. Nunca depende de una
  -- planilla ni de rrhh_planilla_lineas.
  estado VARCHAR(30) NOT NULL DEFAULT 'PROGRAMADO',
  -- Fase VIAT-1 (no usado todavía): medio de entrega del efectivo, p. ej.
  -- Efectivo | Transferencia | Cheque. NUNCA 'Planilla' -- los viáticos no
  -- se pagan por nómina.
  metodo_pago VARCHAR(20) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_viatico_plan_personal (plan_id, personal_id),
  INDEX idx_viatico_empresa_plan (empresa_id, plan_id),
  CONSTRAINT fk_via_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_via_plan FOREIGN KEY (plan_id) REFERENCES tms_planes_viaje(id) ON DELETE CASCADE,
  CONSTRAINT fk_via_personal FOREIGN KEY (personal_id) REFERENCES tms_personal(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Semilla mínima: Piloto y Auxiliar siempre disponibles para configurar
-- (monto en 0 hasta que un admin lo ajuste desde
-- /api/empresas/{slug}/tms/viaticos-config). No pisa configuración ya
-- guardada.
INSERT IGNORE INTO tms_viaticos_config (empresa_id, puesto, monto_defecto)
SELECT id, 'Piloto', 0 FROM empresas WHERE activa = 1;
INSERT IGNORE INTO tms_viaticos_config (empresa_id, puesto, monto_defecto)
SELECT id, 'Auxiliar', 0 FROM empresas WHERE activa = 1;
