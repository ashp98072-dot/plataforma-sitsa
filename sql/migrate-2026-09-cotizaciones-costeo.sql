-- COTIZACIONES-COSTEO (Fase 3) — modelo de persistencia del costeo interno.
--
-- PRODUCCIÓN KT FUE APLICADA MANUALMENTE ANTES DE VERSIONAR ESTA MIGRACIÓN.
-- Este archivo deja en el repo, como definición canónica, EXACTAMENTE lo que
-- ya se aplicó a mano; NO debe volver a ejecutarse contra esa base (todas las
-- sentencias son idempotentes por si se corre de nuevo, pero no hace falta).
-- Sirve para instalaciones nuevas y como fuente de verdad del esquema.
--
-- NO inserta perfiles ni parámetros: son configuración de negocio, ya
-- cargada manualmente en producción (empresa_id = 1) y administrada fuera
-- de las migraciones. Tampoco altera columnas de tms_cotizaciones: el único
-- cambio sobre esa tabla es un índice ÚNICO ADITIVO (empresa_id, id), que
-- exige la FK compuesta del snapshot.
--
-- Diseño (ver docs/COTIZACIONES-COSTEO-PERSISTENCIA-PROPUESTA.md y
-- docs/COTIZACIONES-COSTEO-MOTOR.md):
--   - tms_cotizacion_costeo_perfiles / _parametros: catálogos VIVOS.
--   - tms_cotizacion_costeos / _componentes: SNAPSHOT INMUTABLE 1:1 por
--     cotización (solo INSERT; sin UPDATE/DELETE de contenido). Una
--     cotización histórica no cambia aunque cambien combustible, salarios,
--     viáticos, seguro, GPS, llantas, aceite, depreciación o rendimiento.
--
-- El DDL de abajo reproduce EXACTAMENTE el esquema aplicado en Hostinger:
-- mismos tipos DECIMAL, mismos nombres y columnas de índices/claves únicas/FKs
-- (verificable con los SHOW CREATE TABLE del preflight).
--
-- Verificación previa: sql/preflight-2026-09-cotizaciones-costeo.sql
-- (solo SHOW; sin information_schema, que el usuario de producción no puede leer).

-- Índice único requerido por la FK compuesta (empresa_id, cotizacion_id).
ALTER TABLE tms_cotizaciones ADD UNIQUE KEY IF NOT EXISTS uq_cotizacion_empresa_id (empresa_id, id);

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
  INDEX idx_costeo_perfil_activo (empresa_id, activo, nombre),
  CONSTRAINT fk_costeo_perfil_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
  UNIQUE KEY uq_costeo_param_empresa_id (empresa_id, id),
  INDEX idx_costeo_param_fecha (empresa_id, vigente_desde),
  CONSTRAINT fk_costeo_param_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_cotizacion_costeos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cotizacion_id INT NOT NULL,
  -- Origen (SIN FK viva: si el perfil/parámetros cambian, esto NO se altera).
  perfil_id INT NULL,
  perfil_codigo VARCHAR(40) NOT NULL,
  perfil_nombre VARCHAR(120) NOT NULL,
  -- Copia COMPLETA de lo que consumió el motor.
  perfil_snapshot JSON NOT NULL,               -- PerfilCosteoUnidad tal como se usó
  parametros_snapshot JSON NOT NULL,           -- ParametrosEconomicosCosteo tal como se usó
  input_snapshot JSON NOT NULL,                -- km, días, cantidades, banderas, overrides, otros costos, precio de venta
  motor_version VARCHAR(20) NOT NULL,          -- versión de las fórmulas; permite auditar recálculos
  -- Resultados denormalizados para consultas/reportes (los componentes viven en D).
  costo_operativo DECIMAL(16,6) NOT NULL,
  iva DECIMAL(16,6) NOT NULL,
  costo_con_iva DECIMAL(16,6) NOT NULL,
  margen_objetivo DECIMAL(10,6) NOT NULL,
  precio_sugerido DECIMAL(16,6) NOT NULL,
  precio_venta DECIMAL(14,2) NULL,
  utilidad_estimada DECIMAL(16,6) NULL,
  margen_real DECIMAL(12,6) NULL,              -- utilidad / costo con IVA (margen SOBRE COSTO)
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cotizacion_costeo_cotizacion (empresa_id, cotizacion_id),
  UNIQUE KEY uq_cotizacion_costeo_empresa_id (empresa_id, id),
  INDEX idx_cotizacion_costeo_fecha (empresa_id, creado_en),
  CONSTRAINT fk_cotizacion_costeo_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_cotizacion_costeo_cotizacion FOREIGN KEY (empresa_id, cotizacion_id) REFERENCES tms_cotizaciones (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tms_cotizacion_costeo_componentes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  costeo_id INT NOT NULL,
  orden SMALLINT NOT NULL,
  clave VARCHAR(60) NOT NULL,                  -- depreciacion, gps, combustible, otro:0, ...
  concepto VARCHAR(200) NOT NULL,
  monto DECIMAL(16,6) NOT NULL,
  UNIQUE KEY uq_costeo_componente_orden (empresa_id, costeo_id, orden),
  INDEX idx_costeo_componente_costeo (empresa_id, costeo_id),
  CONSTRAINT fk_costeo_componente_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_costeo_componente_costeo FOREIGN KEY (empresa_id, costeo_id) REFERENCES tms_cotizacion_costeos (empresa_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
