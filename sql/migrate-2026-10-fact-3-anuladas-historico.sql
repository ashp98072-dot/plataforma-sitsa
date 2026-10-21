-- PROPUESTA PARA DESPLIEGUE. Probada únicamente en bases MariaDB desechables, incluida su segunda ejecución
-- (idempotencia); NO ejecutada en Hostinger/producción. Ejecutar primero
-- sql/preflight-2026-10-fact-3-anuladas-historico.sql y revisar. DEBE aplicarse ANTES de desplegar el código FACT-3
-- (anular copia las líneas a esta tabla; sin ella, anular responde 503 y no modifica nada).
--
-- FACT-3 — conservar el detalle histórico de las facturas ANULADAS sin perder la liberación de sus viajes.
--
-- PROBLEMA: anular una factura borraba sus filas de fact_factura_viajes (para liberar UNIQUE(plan_id) y que el viaje
-- pudiera facturarse de nuevo), y con ellas el detalle del documento anulado.
--
-- SOLUCIÓN: una tabla APARTE, solo para líneas de facturas anuladas. fact_factura_viajes sigue conteniendo ÚNICAMENTE
-- vínculos ACTIVOS, por lo que UNIQUE(plan_id) (la defensa contra doble facturación) y todos sus lectores (viajes
-- pendientes, reportes TMS, notificaciones, limpiezas administrativas) quedan EXACTAMENTE igual. Al anular, la
-- aplicación copia cada línea aquí y borra la activa en la MISMA transacción.
--
-- Aditiva e idempotente (CREATE TABLE IF NOT EXISTS). No toca filas existentes, no borra, no cambia índices ni FKs de
-- tablas existentes, y NO intenta reconstruir las líneas de facturas ya anuladas (esas no se pueden recuperar sin
-- inferir datos; quedan «sin detalle»).
--
--  - factura_id  FK -> fact_facturas  ON DELETE CASCADE   (si se limpia/borra la factura, se va su histórico).
--  - plan_id     FK -> tms_planes_viaje ON DELETE SET NULL (el histórico NO bloquea borrar un viaje; su fotografía
--                (código, fecha, ruta, descripción, importes) basta para mostrar el documento).
--  - UNIQUE (factura_id, plan_id): una factura no puede copiar dos veces el mismo viaje (defensa ante reintentos).
--    A propósito NO hay UNIQUE(plan_id): un viaje puede aparecer en el histórico de varias facturas anuladas.

CREATE TABLE IF NOT EXISTS fact_factura_viajes_anuladas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  factura_id INT NOT NULL,
  plan_id INT NULL,
  monto_asignado DECIMAL(14,2) NOT NULL,
  -- Fotografía fiscal de la línea tal como estaba al anular (mismas columnas que fact_factura_viajes, FACT-2).
  codigo_viaje_snapshot VARCHAR(80) NULL DEFAULT NULL,
  fecha_viaje_snapshot DATE NULL DEFAULT NULL,
  ruta_codigo_snapshot VARCHAR(40) NULL DEFAULT NULL,
  origen_snapshot VARCHAR(200) NULL DEFAULT NULL,
  destino_snapshot VARCHAR(300) NULL DEFAULT NULL,
  descripcion VARCHAR(500) NULL DEFAULT NULL,
  cantidad DECIMAL(10,2) NOT NULL DEFAULT 1,
  precio_incluye_iva TINYINT(1) NULL DEFAULT NULL,
  porcentaje_iva DECIMAL(5,2) NULL DEFAULT NULL,
  base_monto DECIMAL(14,2) NULL DEFAULT NULL,
  iva_monto DECIMAL(14,2) NULL DEFAULT NULL,
  total_linea DECIMAL(14,2) NULL DEFAULT NULL,
  -- Trazabilidad: cuándo se creó la línea originalmente, y cuándo/quién la archivó al anular.
  linea_creada_en DATETIME NULL DEFAULT NULL,
  anulada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anulada_por INT NULL DEFAULT NULL,
  UNIQUE KEY uq_factviajeanul_factura_plan (factura_id, plan_id),
  KEY idx_factviajeanul_factura (factura_id),
  KEY idx_factviajeanul_plan (plan_id),
  CONSTRAINT fk_factviajeanul_factura FOREIGN KEY (factura_id) REFERENCES fact_facturas(id) ON DELETE CASCADE,
  CONSTRAINT fk_factviajeanul_plan FOREIGN KEY (plan_id) REFERENCES tms_planes_viaje(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Nada más: UNIQUE KEY uq_factviaje_plan (plan_id) de fact_factura_viajes sigue siendo la garantía anti doble facturación.
