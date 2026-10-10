-- PROPUESTA PARA DESPLIEGUE. Probada únicamente en bases MariaDB desechables, incluida su segunda ejecución
-- (idempotencia); NO ejecutada en Hostinger/producción. Ejecutar primero
-- sql/preflight-2026-10-fact-4-lineas-contado-retencion.sql y revisar. DEBE aplicarse ANTES de desplegar el código
-- FACT-4 (crear/editar/leer borradores usa estas columnas y tablas).
--
-- FACT-4 — modelo de líneas de factura + condición de pago/banco + retención de IVA, como MOTOR COMÚN para todas las
-- entidades emisoras (KT, Mónaco…). Nada aquí es específico de una empresa: las diferencias van en datos por entidad.
--
-- Aditiva e idempotente (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ADD CONSTRAINT … IF NOT EXISTS).
-- NO borra ni reescribe filas, NO toca UNIQUE(plan_id) de fact_factura_viajes, NO altera clientes/cont_cuentas/cont_asientos.
-- Las facturas existentes quedan con modelo_lineas = 0 y se leen como antes (una línea implícita por viaje).
-- NO crea asientos, NO guarda números de cuenta contable en código y NO incluye ninguna cuenta bancaria real: las
-- cuentas bancarias y la plantilla de cada entidad se dan de alta A MANO, tras revisión de Contabilidad (ver ejemplos al final).

-- ───────────────────────── 1. Cuentas bancarias de la ENTIDAD (parametrización contable) ─────────────────────────────
-- Una cuenta bancaria = una cuenta contable del catálogo de la entidad + datos para mostrar. La cuenta contable (la que se
-- cargará en una venta al contado) sale de aquí, nunca de código. Una factura al contado referencia una fila de esta tabla.
CREATE TABLE IF NOT EXISTS cont_cuentas_bancarias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  cuenta_id INT NOT NULL,
  banco VARCHAR(120) NOT NULL,
  alias VARCHAR(120) NOT NULL,
  referencia VARCHAR(60) NULL DEFAULT NULL,
  moneda CHAR(3) NOT NULL DEFAULT 'GTQ',
  activa TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cont_cuenta_bancaria (empresa_id, entidad_id, cuenta_id),
  CONSTRAINT fk_cont_cb_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cont_cb_cuenta FOREIGN KEY (empresa_id, entidad_id, cuenta_id) REFERENCES cont_cuentas(empresa_id, entidad_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ───────────────────────── 2. Configuración de facturación POR ENTIDAD ───────────────────────────────────────────
-- Hoy solo la plantilla del PDF. Aquí irán después (aditivo): logo, series FEL, razón social/NIT/dirección, políticas de crédito…
-- Valores válidos de plantilla_factura (los define el código): CODIGO_DESCRIPCION_TOTAL | CANTIDAD_DESCRIPCION_UNITARIO_VALOR.
CREATE TABLE IF NOT EXISTS fact_entidad_config (
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  plantilla_factura VARCHAR(40) NOT NULL DEFAULT 'CODIGO_DESCRIPCION_TOTAL',
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id, entidad_id),
  CONSTRAINT fk_fact_ent_cfg_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ───────────────────────── 3. Retención de IVA por cliente ───────────────────────────────────────────────────────
-- 0 = el cliente no es agente de retención; 15 o 30 = porcentaje confirmado por Contabilidad. «aplica» = (valor > 0).
-- Se valida en la aplicación (0/15/30). Las filas existentes quedan en 0.
ALTER TABLE fact_cliente_perfil
  ADD COLUMN IF NOT EXISTS retencion_iva_pct TINYINT UNSIGNED NOT NULL DEFAULT 0;

-- ───────────────────────── 4. Decisiones congeladas en la factura ────────────────────────────────────────────────
ALTER TABLE fact_facturas
  -- Entidad emisora (libro contable). NULL solo en facturas anteriores a FACT-4: la aplicación la exige en las nuevas.
  ADD COLUMN IF NOT EXISTS entidad_id INT NULL DEFAULT NULL,
  -- 1 = el documento tiene líneas guardadas (fact_factura_lineas) y los totales salen de ellas; 0 = modelo anterior.
  ADD COLUMN IF NOT EXISTS modelo_lineas TINYINT(1) NOT NULL DEFAULT 0,
  -- CREDITO | CONTADO. NULL = no definida (facturas anteriores). Ya NO depende del tipo de documento FEL.
  ADD COLUMN IF NOT EXISTS condicion_pago VARCHAR(10) NULL DEFAULT NULL,
  -- Solo CONTADO: cuenta bancaria elegida y su fotografía (banco, alias, cuenta contable y su código/nombre al momento).
  ADD COLUMN IF NOT EXISTS cuenta_bancaria_id INT NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cuenta_bancaria_snapshot LONGTEXT NULL DEFAULT NULL,
  -- Retención de IVA aplicada a ESTA factura (0/15/30) y la que tenía configurada el cliente al crearla (auditoría de cambios).
  ADD COLUMN IF NOT EXISTS retencion_iva_pct TINYINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retencion_iva_cliente_pct TINYINT UNSIGNED NULL DEFAULT NULL,
  -- Monto de la retención CONGELADO (regla confirmada por Contabilidad): ROUND(IVA de la factura × porcentaje, 2).
  -- No reduce Ventas ni IVA por pagar; es informativo hasta que exista la póliza (después de la certificación FEL).
  ADD COLUMN IF NOT EXISTS retencion_iva_monto DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE fact_facturas
  ADD CONSTRAINT fk_fact_factura_entidad FOREIGN KEY IF NOT EXISTS (empresa_id, entidad_id)
    REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_fact_factura_cuenta_bancaria FOREIGN KEY IF NOT EXISTS (cuenta_bancaria_id)
    REFERENCES cont_cuentas_bancarias(id) ON DELETE RESTRICT;

-- ───────────────────────── 5. Líneas de factura (agrupables) y su trazabilidad a viajes ──────────────────────────
-- La LÍNEA es la unidad fiscal/visual (cantidad × precio unitario = valor). Varios viajes pueden alimentar una línea y un
-- viaje puede estar en varias líneas (p. ej. flete y descarga). El vínculo viaje↔factura ACTIVO sigue en
-- fact_factura_viajes con UNIQUE(plan_id): estas tablas NO participan de la defensa contra doble facturación y por eso
-- sobreviven, intactas, a la anulación (FACT-3 conserva el detalle de viajes; aquí queda el detalle de líneas).
CREATE TABLE IF NOT EXISTS fact_factura_lineas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  factura_id INT NOT NULL,
  orden SMALLINT UNSIGNED NOT NULL,
  cantidad DECIMAL(12,2) NOT NULL,
  descripcion VARCHAR(500) NOT NULL,
  precio_unitario DECIMAL(14,2) NOT NULL,
  -- valor = ROUND(cantidad × precio_unitario, 2): lo CAPTURADO (con IVA incluido o antes de IVA según precio_incluye_iva).
  valor DECIMAL(14,2) NOT NULL,
  -- SERVICIO | BIEN: decidirá la cuenta de ventas (parametrizada por entidad). Sin número de cuenta en código.
  clasificacion VARCHAR(10) NOT NULL,
  precio_incluye_iva TINYINT(1) NOT NULL,
  porcentaje_iva DECIMAL(5,2) NOT NULL,
  base_monto DECIMAL(14,2) NOT NULL,
  iva_monto DECIMAL(14,2) NOT NULL,
  total_linea DECIMAL(14,2) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_factlinea_orden (factura_id, orden),
  CONSTRAINT fk_factlinea_factura FOREIGN KEY (factura_id) REFERENCES fact_facturas(id) ON DELETE CASCADE,
  -- Defensa en profundidad (la aplicación ya valida): clasificación cerrada y cantidad/precio positivos.
  CONSTRAINT ck_factlinea_clasificacion CHECK (clasificacion IN ('SERVICIO', 'BIEN')),
  CONSTRAINT ck_factlinea_importes CHECK (cantidad > 0 AND precio_unitario > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fact_factura_linea_viajes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  linea_id INT NOT NULL,
  plan_id INT NULL DEFAULT NULL,
  -- Sobrevive si luego se borra el viaje (plan_id pasa a NULL).
  codigo_viaje_snapshot VARCHAR(80) NULL DEFAULT NULL,
  UNIQUE KEY uq_factlineaviaje (linea_id, plan_id),
  KEY idx_factlineaviaje_plan (plan_id),
  CONSTRAINT fk_factlineaviaje_linea FOREIGN KEY (linea_id) REFERENCES fact_factura_lineas(id) ON DELETE CASCADE,
  CONSTRAINT fk_factlineaviaje_plan FOREIGN KEY (plan_id) REFERENCES tms_planes_viaje(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Nada más: UNIQUE KEY uq_factviaje_plan (plan_id) de fact_factura_viajes sigue siendo la garantía anti doble facturación.

-- ───────────────────────── EJEMPLOS DE ALTA MANUAL (NO se ejecutan; plantillas para revisar con Contabilidad) ───────
-- Cuenta bancaria de una entidad (la cuenta contable ya debe existir en cont_cuentas de ESA entidad):
--   INSERT INTO cont_cuentas_bancarias (empresa_id, entidad_id, cuenta_id, banco, alias, referencia, moneda)
--   VALUES (<empresa_id>, <entidad_id>, <cont_cuentas.id>, '<Banco>', '<Alias visible>', '<últimos dígitos>', 'GTQ');
-- Plantilla de factura de una entidad:
--   INSERT INTO fact_entidad_config (empresa_id, entidad_id, plantilla_factura)
--   VALUES (<empresa_id>, <entidad_id>, 'CANTIDAD_DESCRIPCION_UNITARIO_VALOR')
--   ON DUPLICATE KEY UPDATE plantilla_factura = VALUES(plantilla_factura);
