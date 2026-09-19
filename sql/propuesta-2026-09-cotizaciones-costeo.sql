-- COTIZACIONES-COSTEO (Fase 1 + 2) — PROPUESTA de persistencia para la Fase 3.
--
-- ESTE ARCHIVO ES UNA PROPUESTA PARA REVISIÓN. NO SE EJECUTA AUTOMÁTICAMENTE
-- Y NO ES UNA MIGRACIÓN DEFINITIVA: faltan decisiones de negocio (ver
-- "Decisiones pendientes" al final y docs/COTIZACIONES-COSTEO-MOTOR.md). El
-- PR que la introduce NO agrega columnas a tms_cotizaciones ni cambia el
-- módulo actual de Cotizaciones; el motor (src/lib/tms/cotizacion-costeo.ts)
-- es puro y no lee ninguna de estas tablas todavía.
--
-- Convenciones tomadas de sql/migrate-2026-09-cotizador-tms.sql:
-- INT AUTO_INCREMENT, empresa_id con FK a empresas, FK COMPUESTA
-- (empresa_id, id) para el aislamiento multiempresa, InnoDB utf8mb4.
--
-- REQUISITO DE SNAPSHOT (obligatorio): una cotización debe guardar TODOS los
-- valores usados en su costeo. Una cotización histórica NO puede cambiar si
-- después cambian combustible, salario, viáticos, seguro, GPS, llantas,
-- aceite, depreciación, rendimiento o parámetros de la ruta. Por eso las
-- tablas A y B son "vivas" (se editan/versionan por vigencia) y las tablas C
-- y D son SNAPSHOT INMUTABLE: copian los valores, nunca los referencian con
-- FK en vivo, y la aplicación nunca las actualiza (solo INSERT).

-- ---------------------------------------------------------------------------
-- A) Perfiles de unidad (catálogo vivo). Un perfil = un juego de parámetros
--    del motor; NO hay columnas ni lógica por tipo de vehículo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tms_cotizacion_costeo_perfiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,                 -- p. ej. CAMION_5T, CABEZAL
  nombre VARCHAR(120) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  costo_adquisicion DECIMAL(14,2) NULL,        -- informativo
  dias_operacion_mes DECIMAL(5,2) NOT NULL,    -- divisor mensual→diario de GPS/seguro
  gps_mensual DECIMAL(12,2) NOT NULL DEFAULT 0,
  seguro_vehiculo_mensual DECIMAL(12,2) NOT NULL DEFAULT 0,
  costo_aceite_servicio DECIMAL(12,2) NOT NULL DEFAULT 0,
  vida_util_aceite_km DECIMAL(12,2) NOT NULL,
  costo_juego_llantas DECIMAL(14,2) NOT NULL DEFAULT 0,   -- total del juego (ya integra la cantidad de llantas)
  vida_util_llantas_km DECIMAL(12,2) NOT NULL,
  rendimiento_km_galon DECIMAL(8,3) NOT NULL,
  -- Depreciación del vehículo (todas NULL = no deprecia).
  deprec_valor_base DECIMAL(14,2) NULL,
  deprec_anios DECIMAL(5,2) NULL,
  deprec_dias_operacion_mes DECIMAL(5,2) NULL,
  -- Equipo de refrigeración, separado de la depreciación del vehículo.
  refrig_valor_base DECIMAL(14,2) NULL,
  refrig_anios DECIMAL(5,2) NULL,
  refrig_dias_operacion_mes DECIMAL(5,2) NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_costeo_perfil_codigo (empresa_id, codigo),
  UNIQUE KEY uq_costeo_perfil_empresa_id (empresa_id, id),
  CONSTRAINT fk_costeo_perfil_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- B) Parámetros económicos por VIGENCIA (catálogo vivo). Se inserta una fila
--    nueva cuando cambia el combustible, un salario, un viático, etc.; la
--    vigente es la de mayor vigente_desde <= fecha de cotización. La app
--    valida que no haya traslapes de vigencia por empresa.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tms_cotizacion_costeo_parametros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  vigente_desde DATE NOT NULL,
  precio_combustible_galon DECIMAL(10,4) NOT NULL,
  iva_tasa DECIMAL(6,4) NOT NULL,              -- fracción: 0.1200
  costo_piloto_dia DECIMAL(12,2) NOT NULL,
  costo_auxiliar_dia DECIMAL(12,2) NOT NULL,
  viatico_piloto_dia DECIMAL(12,2) NOT NULL DEFAULT 0,
  viatico_auxiliar_dia DECIMAL(12,2) NOT NULL DEFAULT 0,
  viatico_guia_dia DECIMAL(12,2) NOT NULL DEFAULT 0,
  hotel_dia DECIMAL(12,2) NULL,
  margen_objetivo DECIMAL(6,4) NULL,           -- fracción: 0.2000
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_costeo_param_vigencia (empresa_id, vigente_desde),
  CONSTRAINT fk_costeo_param_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- C) SNAPSHOT del costeo de una cotización (1:1, INMUTABLE).
--    Requiere una clave única (empresa_id, id) en tms_cotizaciones para la FK
--    compuesta. Es un cambio ADITIVO de índice, no de columnas; revisar antes
--    de aplicar:
--      ALTER TABLE tms_cotizaciones ADD UNIQUE KEY uq_cotizacion_empresa_id (empresa_id, id);
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tms_cotizacion_costeos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cotizacion_id INT NOT NULL,
  -- Origen (SIN FK viva: si el perfil/parámetros cambian, esto NO se altera).
  perfil_id INT NULL,
  perfil_codigo VARCHAR(40) NOT NULL,
  perfil_nombre VARCHAR(120) NOT NULL,
  -- Copia COMPLETA de lo que consumió el motor. Con estos tres JSON el
  -- cálculo es reproducible sin consultar ninguna tabla viva.
  perfil_snapshot JSON NOT NULL,               -- PerfilCosteoUnidad tal como se usó
  parametros_snapshot JSON NOT NULL,           -- ParametrosEconomicosCosteo tal como se usó
  input_snapshot JSON NOT NULL,                -- km, días, cantidades, banderas, overrides, otros costos, precio de venta
  motor_version VARCHAR(20) NOT NULL,          -- versión de las fórmulas (ver docs); permite auditar recálculos
  -- Resultados denormalizados para consultas/reportes (los componentes viven en D).
  costo_operativo DECIMAL(16,6) NOT NULL,
  iva DECIMAL(16,6) NOT NULL,
  costo_con_iva DECIMAL(16,6) NOT NULL,
  margen_objetivo DECIMAL(6,4) NOT NULL,
  precio_sugerido DECIMAL(16,6) NOT NULL,
  precio_venta DECIMAL(14,2) NULL,
  utilidad_estimada DECIMAL(16,6) NULL,
  margen_real DECIMAL(10,6) NULL,              -- utilidad / costo con IVA (margen SOBRE COSTO)
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cotizacion_costeo_cotizacion (empresa_id, cotizacion_id),
  UNIQUE KEY uq_cotizacion_costeo_empresa_id (empresa_id, id),
  CONSTRAINT fk_cotizacion_costeo_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_cotizacion_costeo_cotizacion FOREIGN KEY (empresa_id, cotizacion_id) REFERENCES tms_cotizaciones (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- D) Componentes del snapshot (INMUTABLE): un renglón por componente del
--    resultado (ResultadoCosteoServicio.componentes), incluidos los "otros
--    costos" itemizados. SUM(monto) = costo_operativo de C.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tms_cotizacion_costeo_componentes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  costeo_id INT NOT NULL,
  orden SMALLINT NOT NULL,
  clave VARCHAR(60) NOT NULL,                  -- depreciacion, gps, combustible, otro:0, ...
  concepto VARCHAR(200) NOT NULL,
  monto DECIMAL(16,6) NOT NULL,
  UNIQUE KEY uq_costeo_componente_orden (costeo_id, orden),
  INDEX idx_costeo_componente_empresa (empresa_id, costeo_id),
  CONSTRAINT fk_costeo_componente_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_costeo_componente_costeo FOREIGN KEY (empresa_id, costeo_id) REFERENCES tms_cotizacion_costeos (empresa_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------------
-- Decisiones pendientes (antes de convertir esto en migración):
--  1. ¿Un costeo por cotización (1:1, como está) o historial de recosteos
--     con un vigente? Aquí: 1:1 y una cotización se recostea creando otra.
--  2. Precisión de persistencia: aquí DECIMAL(16,6) para no redondear
--     prematuramente; la política de redondeo de presentación aún no existe.
--  3. Significado de los dos porcentajes históricos del libro (15%/20%): el
--     motor aplica UN margen; no se modela un segundo hasta confirmarlo.
--  4. Cómo se lleva el snapshot a la tarifa cotizada (tarifa_cotizada sigue
--     siendo la tarifa COMERCIAL; el costeo solo la alimenta/sugiere).
--  5. Permisos del costeo (es información interna de costos, no debe salir
--     en el PDF comercial).
-- ---------------------------------------------------------------------------
