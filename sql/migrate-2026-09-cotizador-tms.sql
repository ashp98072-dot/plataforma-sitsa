-- COTIZADOR-TMS-1 (fase 1) — cotizaciones comerciales de TMS.
--
-- NO se ejecuta automáticamente — revisar y correr manualmente contra la
-- base real (mismo criterio que las migraciones recientes de TMS:
-- sql/migrate-2026-09-rutas-personal-tarifario.sql,
-- sql/migrate-2026-09-tms-gastos-reportes.sql).
--
-- Reutiliza catálogos existentes, no duplica nada:
--   - tms_clientes      -> cliente_id (mismo maestro que tms_planes_viaje/
--                          tms_cliente_rutas/tms_gastos_operativos)
--   - tms_cliente_rutas -> ruta_id (OPCIONAL, SIN FK — mismo criterio que
--                          tms_planes_viaje.ruta_id: es una fotografía
--                          histórica, nunca una referencia en vivo; ver
--                          columnas *_texto/*_referencia abajo, todas
--                          snapshot copiado al cotizar)
--   - auditoria         -> se reutiliza vía registrarAuditoria/
--                          registrarAuditoriaTx (src/lib/auditoria.ts);
--                          no se crea una bitácora paralela de estados.
--
-- "Condiciones de servicio" (piloto/GPS/seguros/km incluidos/tarifa por
-- km adicional/texto libre) son columnas de la MISMA fila, no una tabla
-- aparte: es una relación 1:1 con la cotización, no una lista — crear un
-- catálogo o tabla hija para esto sería una duplicación innecesaria.
--
-- AISLAMIENTO MULTIEMPRESA: cliente_id usa FK COMPUESTA (empresa_id, id)
-- contra tms_clientes (que ya tiene ese índice, ver
-- uq_tmsclientes_empresa_id) — mismo patrón que tms_gastos_operativos
-- (ver sql/migrate-2026-09-tms-gastos-reportes.sql). ON DELETE RESTRICT
-- (nunca SET NULL: cliente_id es NOT NULL). ruta_id no tiene FK (ver
-- arriba), así que la validación de que pertenezca a la empresa actual
-- es responsabilidad de la aplicación (src/lib/tms/cotizaciones.ts,
-- validarReferenciasCotizacion) — igual que ya ocurre con
-- tms_planes_viaje.ruta_id en Programación.

CREATE TABLE IF NOT EXISTS tms_cotizaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  cliente_id INT NOT NULL,
  -- Snapshot al cotizar — igual que tms_planes_viaje.ruta_codigo_historico/
  -- contacto_*_historico: si el nombre del cliente cambia después, esta
  -- cotización ya emitida no debe reflejarlo.
  cliente_nombre VARCHAR(200) NOT NULL,
  ruta_id INT NULL,
  ruta_codigo_historico VARCHAR(40) NULL,
  origen_texto VARCHAR(300) NULL,
  destino_texto VARCHAR(300) NULL,
  -- Snapshot de tms_cliente_rutas.tarifa_referencia/costo_operativo AL
  -- MOMENTO de cotizar. Cambios futuros de la ruta maestra NUNCA alteran
  -- estos valores ya guardados (mismo criterio que
  -- tms_planes_viaje.costo_operativo_referencia).
  tarifa_referencia DECIMAL(12,2) NULL,
  costo_operativo_referencia DECIMAL(12,2) NULL,
  tarifa_cotizada DECIMAL(12,2) NOT NULL,
  incluye_iva TINYINT(1) NOT NULL DEFAULT 0,
  moneda CHAR(3) NOT NULL DEFAULT 'GTQ',
  fecha_emision DATE NOT NULL,
  fecha_vencimiento DATE NULL,
  estado ENUM('Borrador','Enviada','Aceptada','Rechazada','Vencida') NOT NULL DEFAULT 'Borrador',
  -- Condiciones de servicio (snapshot, ver nota arriba).
  piloto_incluido TINYINT(1) NOT NULL DEFAULT 1,
  gps_incluido TINYINT(1) NOT NULL DEFAULT 0,
  seguro_mercaderia_incluido TINYINT(1) NOT NULL DEFAULT 0,
  seguro_terceros_incluido TINYINT(1) NOT NULL DEFAULT 0,
  -- "Kilómetros incluidos" = radio/km incluidos en la tarifa cotizada.
  km_incluidos DECIMAL(10,2) NULL,
  tarifa_km_adicional DECIMAL(12,2) NULL,
  condiciones_adicionales TEXT NULL,
  observaciones TEXT NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cotizacion_codigo (empresa_id, codigo),
  INDEX idx_cotizacion_cliente (empresa_id, cliente_id),
  INDEX idx_cotizacion_estado (empresa_id, estado),
  INDEX idx_cotizacion_fecha (empresa_id, fecha_emision),
  CONSTRAINT fk_cotizacion_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_cotizacion_cliente_ambito FOREIGN KEY (empresa_id, cliente_id) REFERENCES tms_clientes (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
