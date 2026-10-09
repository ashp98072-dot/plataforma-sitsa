-- PROPUESTA: NO ejecutada. MariaDB 11.8.9. Ejecutar primero sql/preflight-2026-10-fact-2-borrador-snapshots-iva.sql
-- y revisar. DEBE aplicarse ANTES de desplegar el código FACT-2 (el código lee y escribe estas columnas).
--
-- FACT-2 (viaje cerrado -> borrador de factura): congela en el borrador los datos que no deben cambiar si luego
-- editan el cliente, la ruta o la tarifa, y guarda el desglose de IVA. Sin FEL: no hay UUID, serie, XML ni
-- certificación en este modelo.
--
-- Aditiva e idempotente (ADD COLUMN IF NOT EXISTS). Todo es NULL / DEFAULT para no tocar filas existentes:
-- los borradores/facturas creados antes de FACT-2 quedan con snapshot NULL y la aplicación los muestra con los
-- datos que ya tenían (monto_total, monto_asignado). No hace backfill, no borra, no cambia índices ni FKs.
-- NO se agrega ninguna columna de "facturable" (se deriva) ni de FEL.

ALTER TABLE fact_facturas
  -- Moneda del documento (una sola por factura). DEFAULT 'GTQ' = comportamiento previo (solo quetzales).
  ADD COLUMN IF NOT EXISTS moneda CHAR(3) NOT NULL DEFAULT 'GTQ',
  -- Desglose. monto_total (ya existente) sigue siendo el TOTAL con IVA; subtotal + iva_monto = monto_total.
  ADD COLUMN IF NOT EXISTS subtotal DECIMAL(14,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS iva_monto DECIMAL(14,2) NULL DEFAULT NULL,
  -- Política usada al calcular (decisión de negocio pendiente de Contabilidad; ver src/lib/facturacion/impuestos.ts).
  ADD COLUMN IF NOT EXISTS porcentaje_iva DECIMAL(5,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS precio_incluye_iva TINYINT(1) NULL DEFAULT NULL,
  -- Fotografía del cliente al crear el borrador.
  ADD COLUMN IF NOT EXISTS cliente_nombre_snapshot VARCHAR(250) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cliente_nit_snapshot VARCHAR(40) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cliente_direccion_snapshot VARCHAR(300) NULL DEFAULT NULL;

ALTER TABLE fact_factura_viajes
  -- Fotografía del viaje/ruta al crear el borrador (no se vuelve a consultar el dato vivo para mostrar).
  ADD COLUMN IF NOT EXISTS codigo_viaje_snapshot VARCHAR(80) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fecha_viaje_snapshot DATE NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ruta_codigo_snapshot VARCHAR(40) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS origen_snapshot VARCHAR(200) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS destino_snapshot VARCHAR(300) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS descripcion VARCHAR(500) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cantidad DECIMAL(10,2) NOT NULL DEFAULT 1,
  -- monto_asignado (ya existente) = monto capturado de la línea; base + iva = total_linea.
  ADD COLUMN IF NOT EXISTS base_monto DECIMAL(14,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS iva_monto DECIMAL(14,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_linea DECIMAL(14,2) NULL DEFAULT NULL;

-- Nada más: la protección contra doble facturación sigue siendo UNIQUE KEY uq_factviaje_plan (plan_id), ya existente.
