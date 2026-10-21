-- PREFLIGHT DE SOLO LECTURA — Homologación contable Milenium → plataforma (KT / MÓNACO).
-- Solo SELECT (y WITH … SELECT). No hay INSERT/UPDATE/DELETE/ALTER/DDL ni SET que modifique datos. Se puede ejecutar en producción
-- con un usuario de solo lectura. Revisar el resultado ANTES de pensar en ejecutar
-- sql/propuesta-2026-10-contabilidad-homologacion-milenium.sql (que NO se ejecuta sin autorización explícita).
--
-- Contexto esperado (según producción, informado por el responsable):
--   empresa_id = 1 · entidad 1 = KT / KuiqTrans · entidad 2 = MONACO / Logiservicios Mónaco
--   cont_cuentas casi vacío: KT tiene UNA cuenta de prueba (código 32234, nombre «safdasf»); Mónaco, ninguna.
--
-- Documento asociado: docs/CONTABILIDAD-HOMOLOGACION-MILENIUM-KT-MONACO.md

-- ───────────────────────── 1. Entidades y plantillas ─────────────────────────────────────────────────────────────
-- Esperado: 2 filas activas (1 = KT, 2 = MONACO).
SELECT id, empresa_id, codigo, nombre, activa FROM cont_entidades WHERE empresa_id = 1 ORDER BY id;

-- Esperado: una fila por entidad (KT = CODIGO_DESCRIPCION_TOTAL, MONACO = CANTIDAD_DESCRIPCION_UNITARIO_VALOR).
SELECT empresa_id, entidad_id, plantilla_factura FROM fact_entidad_config WHERE empresa_id = 1 ORDER BY entidad_id;

-- ───────────────────────── 2. Catálogo actual ────────────────────────────────────────────────────────────────────
-- Resumen por entidad. Esperado: KT = 1 (la cuenta de prueba), MONACO = sin fila (0).
SELECT empresa_id, entidad_id, COUNT(*) AS cuentas, SUM(activa = 1) AS activas
FROM cont_cuentas WHERE empresa_id = 1 GROUP BY empresa_id, entidad_id ORDER BY entidad_id;

-- Detalle completo (debe ser corto). Cuentas con entidad_id NULL = datos legados anteriores a C2.
SELECT id, empresa_id, entidad_id, codigo, nombre, tipo, nivel, activa
FROM cont_cuentas WHERE empresa_id = 1 ORDER BY entidad_id, codigo;

-- ───────────────────────── 3. Colisiones con el inventario propuesto (COMPUERTA de la carga futura) ───────────────
-- Para cada cuenta del inventario (sql/homologacion-2026-10-contabilidad-cuentas-kt-monaco.sql) muestra lo propuesto contra
-- lo que YA existe en esa entidad: entidad, código, nombre/tipo/nivel propuestos y nombre/tipo/nivel/activa existentes.
-- El `tipo` propuesto sale del diccionario TIPO_CTA 1-5 APROBADO por Contabilidad (2026-10-12).
-- Esperado hoy: «SIN COLISION» en las 18 filas (la única cuenta de KT es la de prueba 32234) y la fila final «APTO».
-- REGLA: la carga autorizada exige 0 colisiones. Cualquier fila distinta de «SIN COLISION» DETIENE la carga: no se
-- actualiza, no se ignora y no se «absorbe» una cuenta existente (ni siquiera una idéntica; se resuelve a mano).
WITH propuesta AS (
  SELECT 1 AS entidad_id, '11203001' AS codigo, 'CLIENTES LOCALES' AS nombre, 'Activo' AS tipo, 5 AS nivel, 'CLIENTES' AS rol_propuesto
  UNION ALL SELECT 1, '21401001', 'IVA POR PAGAR', 'Pasivo', 5, 'IVA_POR_PAGAR'
  UNION ALL SELECT 1, '41101003', 'VENTAS DE SERVICIOS', 'Ingreso', 5, 'VENTAS_SERVICIOS'
  UNION ALL SELECT 1, '11302005', 'RETENCIONES DE IVA', 'Activo', 5, 'RETENCION_IVA'
  UNION ALL SELECT 1, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL', 'Pasivo', 5, 'ANTICIPOS'
  UNION ALL SELECT 1, '11101002', 'TRASLADO EN TRANSITO', 'Activo', 5, 'TRANSITO_BANCARIO'
  UNION ALL SELECT 1, '41501002', 'DEV. SOBRE VENTAS VARIAS', 'Ingreso', 5, 'DEVOLUCIONES_VENTAS'
  UNION ALL SELECT 1, '11103002', 'BANCO INDUSTRIAL, S. A.', 'Activo', 5, 'BANCOS'
  UNION ALL SELECT 1, '11103001', 'G&T CONTINENTAL', 'Activo', 5, 'BANCOS'
  UNION ALL SELECT 1, '11103004', 'BANCO INDUSTRIAL (FONDO OPERATIVO)', 'Activo', 5, 'BANCOS'
  UNION ALL SELECT 2, '11203001', 'CLIENTES LOCALES', 'Activo', 5, 'CLIENTES'
  UNION ALL SELECT 2, '21401001', 'IVA POR PAGAR', 'Pasivo', 5, 'IVA_POR_PAGAR'
  UNION ALL SELECT 2, '41101003', 'VENTAS DE SERVICIOS', 'Ingreso', 5, 'VENTAS_SERVICIOS'
  UNION ALL SELECT 2, '11302005', 'RETENCIONES DE IVA', 'Activo', 5, 'RETENCION_IVA'
  UNION ALL SELECT 2, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL', 'Pasivo', 5, 'ANTICIPOS'
  UNION ALL SELECT 2, '11101002', 'TRASLADO EN TRANSITO', 'Activo', 5, 'TRANSITO_BANCARIO'
  UNION ALL SELECT 2, '41501002', 'DEV. SOBRE VENTAS VARIAS', 'Ingreso', 5, 'DEVOLUCIONES_VENTAS'
  UNION ALL SELECT 2, '11103002', 'BANCO INDUSTRIAL, S. A.', 'Activo', 5, 'BANCOS'
),
comparacion AS (
  SELECT p.entidad_id, p.codigo, p.rol_propuesto,
         p.nombre AS nombre_propuesto, p.tipo AS tipo_propuesto, p.nivel AS nivel_propuesto,
         c.id AS existente_id, c.nombre AS nombre_existente, c.tipo AS tipo_existente,
         c.nivel AS nivel_existente, c.activa AS activa_existente,
         CASE
           WHEN c.id IS NULL THEN 'SIN COLISION'
           WHEN c.nombre = p.nombre AND c.tipo = p.tipo AND c.nivel = p.nivel AND c.activa = 1
             THEN 'COLISION: ya existe e IGUAL en nombre/tipo/nivel/activa - DETENER'
           ELSE 'COLISION: ya existe y DIFIERE (nombre/tipo/nivel/activa) - DETENER'
         END AS resultado
  FROM propuesta p
  LEFT JOIN cont_cuentas c ON c.empresa_id = 1 AND c.entidad_id = p.entidad_id AND c.codigo = p.codigo
)
SELECT entidad_id, codigo, rol_propuesto, nombre_propuesto, tipo_propuesto, nivel_propuesto,
       existente_id, nombre_existente, tipo_existente, nivel_existente, activa_existente, resultado
FROM comparacion
UNION ALL
SELECT NULL, 'TOTAL', NULL, NULL, NULL, COUNT(*), NULL, NULL, NULL, NULL, NULL,
       CASE WHEN SUM(resultado <> 'SIN COLISION') = 0
            THEN 'APTO: 0 colisiones' ELSE CONCAT('NO APTO: ', SUM(resultado <> 'SIN COLISION'), ' colision(es)') END
FROM comparacion
ORDER BY entidad_id IS NULL, entidad_id, codigo;

-- ───────────────────────── 4. Cuenta de prueba KT «32234 / safdasf» ──────────────────────────────────────────────
-- 4a. La fila. Esperado: 0 o 1 fila.
SELECT id, empresa_id, entidad_id, codigo, nombre, tipo, nivel, activa
FROM cont_cuentas
WHERE empresa_id = 1 AND entidad_id = 1 AND codigo = '32234';

-- 4b. Todas las FKs de la base que REFERENCIAN cont_cuentas (descubiertas, no supuestas). Esperado: cont_asiento_detalle
-- (2 FKs: por cuenta_id y compuesta de ámbito) y cont_cuentas_bancarias (FK compuesta).
SELECT k.TABLE_NAME AS tabla_referenciante, k.CONSTRAINT_NAME AS restriccion, k.COLUMN_NAME AS columna,
       k.REFERENCED_COLUMN_NAME AS columna_referenciada, r.DELETE_RULE AS al_borrar
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME = 'cont_cuentas'
ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION;

-- 4c. Conteo de referencias reales a ESA cuenta, tabla por tabla.
--     (Las dos últimas son referencias «blandas»: texto libre / JSON, sin FK.)
SELECT 'cont_asiento_detalle (cuenta_id)' AS referencia, COUNT(*) AS filas
FROM cont_asiento_detalle d
JOIN cont_cuentas c ON c.id = d.cuenta_id
WHERE c.empresa_id = 1 AND c.entidad_id = 1 AND c.codigo = '32234'
UNION ALL
SELECT 'cont_cuentas_bancarias (cuenta_id)', COUNT(*)
FROM cont_cuentas_bancarias b
JOIN cont_cuentas c ON c.id = b.cuenta_id
WHERE c.empresa_id = 1 AND c.entidad_id = 1 AND c.codigo = '32234'
UNION ALL
SELECT 'fact_facturas.cuenta_bancaria_snapshot (JSON, blando)', COUNT(*)
FROM fact_facturas
WHERE empresa_id = 1 AND cuenta_bancaria_snapshot LIKE '%"cuentaContableCodigo":"32234"%'
UNION ALL
SELECT 'auditoria.detalle (texto, blando)', COUNT(*)
FROM auditoria
WHERE empresa_id = 1 AND detalle LIKE '%32234%';

-- 4d. Veredicto de solo lectura. NO ejecuta ningún cambio: solo dice qué sería posible, con autorización.
--     refs_duras = filas que impiden ELIMINAR por FK (RESTRICT); las blandas no impiden nada pero se deben conocer.
SELECT
  c.id AS cuenta_id,
  c.activa AS activa_hoy,
  (SELECT COUNT(*) FROM cont_asiento_detalle d WHERE d.cuenta_id = c.id)
    + (SELECT COUNT(*) FROM cont_cuentas_bancarias b WHERE b.cuenta_id = c.id) AS refs_duras,
  CASE
    WHEN (SELECT COUNT(*) FROM cont_asiento_detalle d WHERE d.cuenta_id = c.id)
       + (SELECT COUNT(*) FROM cont_cuentas_bancarias b WHERE b.cuenta_id = c.id) = 0
      THEN 'SIN referencias duras: puede DESACTIVARSE y, con autorización, ELIMINARSE'
    ELSE 'CON referencias duras: solo DESACTIVAR (eliminar sería rechazado por la FK RESTRICT)'
  END AS veredicto
FROM cont_cuentas c
WHERE c.empresa_id = 1 AND c.entidad_id = 1 AND c.codigo = '32234';

-- ───────────────────────── 5. Contabilidad ya registrada (debe ser nada) ─────────────────────────────────────────
-- Esperado: sin filas / 0. Si ya hay asientos, la homologación NO puede asumir un libro vacío.
SELECT entidad_id, COUNT(*) AS asientos FROM cont_asientos WHERE empresa_id = 1 GROUP BY entidad_id;
SELECT COUNT(*) AS lineas_de_asiento FROM cont_asiento_detalle WHERE empresa_id = 1;

-- ───────────────────────── 6. Bancos actuales y uso de FACT-4 ────────────────────────────────────────────────────
-- Esperado hoy: 0 filas (los bancos se darán de alta después de homologar las cuentas).
SELECT b.id, b.empresa_id, b.entidad_id, b.cuenta_id, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre,
       b.banco, b.alias, b.referencia, b.moneda, b.activa
FROM cont_cuentas_bancarias b
LEFT JOIN cont_cuentas c ON c.id = b.cuenta_id
WHERE b.empresa_id = 1
ORDER BY b.entidad_id, b.banco, b.alias;

-- Facturas por entidad y condición de pago (informativo; esperado: modelo FACT-4 recién desplegado).
SELECT entidad_id, condicion_pago, modelo_lineas, estado_admin, COUNT(*) AS facturas
FROM fact_facturas WHERE empresa_id = 1
GROUP BY entidad_id, condicion_pago, modelo_lineas, estado_admin
ORDER BY entidad_id, condicion_pago, modelo_lineas, estado_admin;

-- ───────────────────────── 7. Estructura disponible en cont_cuentas (para el diseño de homologación) ──────────────
-- Confirma qué columnas existen hoy (no hay padre, naturaleza ni «movimiento/agrupación»).
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cont_cuentas'
ORDER BY ORDINAL_POSITION;

-- ¿Existe ya alguna estructura de parametrización por rol? (Esperado: ninguna fila.)
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND (TABLE_NAME LIKE 'cont\_%rol%' OR TABLE_NAME LIKE 'cont\_param%' OR TABLE_NAME LIKE 'fact\_%cuenta%');
