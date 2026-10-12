-- PROPUESTA (NO EJECUTAR sin autorización explícita y revisión de Contabilidad). Homologación Milenium → cont_cuentas
-- para KT (entidad_id = 1) y MONACO (entidad_id = 2), empresa_id = 1.
--
-- Qué es:
--   · SOLO INSERT de las cuentas SUFICIENTEMENTE CONFIRMADAS (código y nombre tal como existen en el catálogo `co01` de
--     Milenium de cada entidad, y usadas por sus parámetros `f10` y/o por sus pólizas reales). Lo demás está COMENTADO.
--   · Idempotente: ON DUPLICATE KEY UPDATE id = id (no modifica nada si la cuenta ya existe; la clave única es
--     empresa_id + entidad_id + codigo).
--   · Sin DELETE, sin UPDATE destructivo, sin DDL, sin tocar la cuenta de prueba (32234 / safdasf).
--   · No inventa códigos: cada código sale de Milenium. KT y MONACO se declaran POR SEPARADO aunque hoy coincidan;
--     un mismo código NO implica la misma cuenta (51 códigos comunes tienen nombre distinto entre las dos entidades).
--
-- Qué NO es: ni asientos, ni pólizas, ni bancos (cont_cuentas_bancarias), ni parametrización por rol, ni jerarquía.
--
-- Mapeo de campos (ver docs/CONTABILIDAD-HOMOLOGACION-MILENIUM-KT-MONACO.md §8):
--   CODIGO_CTA → codigo (texto, ceros conservados) · NOMBRE_CTA → nombre · NIVEL_CTA → nivel (verbatim)
--   TIPO_CTA → tipo: 1 → 'Activo', 2 → 'Pasivo', 3 → 'Capital', 4 → 'Ingreso', 5 → 'Gasto'  [INFERENCIA fuerte,
--   consistente con el 100 % de los nombres en las 3 bases; pendiente de aprobación de Contabilidad: ver §3.2 del doc]
--   activa = 1 (LINACTIVA_ = false en el 100 % de las cuentas). Cuentas de nivel 5 = de movimiento.
--
-- Orden recomendado (todo manual, con respaldo): preflight → revisar → ejecutar dentro de una transacción
-- (START TRANSACTION; … ; verificar con las consultas del final; COMMIT o ROLLBACK).
--
-- Los NOMBRES de las cuentas bancarias de Milenium incluyen el número de cuenta bancaria; aquí se OMITE a propósito
-- (no se expone en el repositorio). Contabilidad debe confirmar el nombre final (p. ej. con los últimos 4 dígitos).

-- ═════════════════════════════ A. KUIQTRANS — entidad_id = 1 ═════════════════════════════════════════════════════
-- Fuente: Milenium empresa 01 (BASES001): co01 (catálogo) + f10 (parámetros de ventas) + co03 (pólizas 2017-09 → 2026-05).
INSERT INTO cont_cuentas (empresa_id, entidad_id, codigo, nombre, tipo, nivel, activa) VALUES
  -- CLIENTES · f10.CUECLI_FPV · D de TODA factura (crédito y contado) en el 97 % de las pólizas F/1
  (1, 1, '11203001', 'CLIENTES LOCALES',                       'Activo',  5, 1),
  -- IVA_POR_PAGAR · f10.CUEIXP_FPV · H de cada factura (10.71 % del total con IVA)
  (1, 1, '21401001', 'IVA POR PAGAR',                          'Pasivo',  5, 1),
  -- VENTAS_SERVICIOS · f10.CUEVEN_FPV · H de cada factura (89.29 % del total)
  (1, 1, '41101003', 'VENTAS DE SERVICIOS',                    'Ingreso', 5, 1),
  -- RETENCION_IVA · D en las aplicaciones C/E (84 % de ellas) · Milenium la trata como ACTIVO (tipo 1)
  (1, 1, '11302005', 'RETENCIONES DE IVA',                     'Activo',  5, 1),
  -- ANTICIPOS (de clientes) · f10.CUANSV_FPV
  (1, 1, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL',      'Pasivo',  5, 1),
  -- TRANSITO_BANCARIO · f10.CUECAJ_FPV · D del recibo (C/R) y H del depósito (B/3)
  (1, 1, '11101002', 'TRASLADO EN TRANSITO',                   'Activo',  5, 1),
  -- DEVOLUCIONES / NOTA DE CRÉDITO · f10.CUGANC_FPV · D de la nota de crédito (C/C)
  (1, 1, '41501002', 'DEV. SOBRE VENTAS VARIAS',               'Ingreso', 5, 1),
  -- BANCOS (cuentas contables de bancos con movimiento actual en 2026). Nombre SIN el número de cuenta bancaria.
  (1, 1, '11103002', 'BANCO INDUSTRIAL, S. A.',                'Activo',  5, 1),
  (1, 1, '11103001', 'G&T CONTINENTAL',                        'Activo',  5, 1),
  (1, 1, '11103004', 'BANCO INDUSTRIAL (FONDO OPERATIVO)',     'Activo',  5, 1)
ON DUPLICATE KEY UPDATE id = id;

-- ═════════════════════════════ B. LOGISERVICIOS MÓNACO — entidad_id = 2 ═══════════════════════════════════════════
-- Fuente: Milenium empresa 08 (BASES008, actual desde 2023-09) + 00 (BASES000, histórico 2021-07 → 2023-10; MISMA entidad).
INSERT INTO cont_cuentas (empresa_id, entidad_id, codigo, nombre, tipo, nivel, activa) VALUES
  (1, 2, '11203001', 'CLIENTES LOCALES',                       'Activo',  5, 1),   -- f10.CUECLI_FPV
  (1, 2, '21401001', 'IVA POR PAGAR',                          'Pasivo',  5, 1),   -- f10.CUEIXP_FPV
  (1, 2, '41101003', 'VENTAS DE SERVICIOS',                    'Ingreso', 5, 1),   -- f10.CUEVEN_FPV
  (1, 2, '11302005', 'RETENCIONES DE IVA',                     'Activo',  5, 1),   -- C/E: 85 % de las aplicaciones
  (1, 2, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL',      'Pasivo',  5, 1),   -- f10.CUANSV_FPV
  (1, 2, '11101002', 'TRASLADO EN TRANSITO',                   'Activo',  5, 1),   -- f10.CUECAJ_FPV
  (1, 2, '41501002', 'DEV. SOBRE VENTAS VARIAS',               'Ingreso', 5, 1),   -- f10.CUGANC_FPV
  (1, 2, '11103002', 'BANCO INDUSTRIAL, S. A.',                'Activo',  5, 1)    -- ÚNICO banco de Mónaco con movimiento
ON DUPLICATE KEY UPDATE id = id;

-- ═════════════════════════════ C. PENDIENTES — NO se insertan (requieren decisión de Contabilidad) ═════════════════
-- Descomentar solo tras confirmación explícita, cuenta por cuenta.
--
-- ── KT ──
-- VENTAS_BIENES: Milenium NO parametriza una cuenta de ventas de bienes (f10 solo tiene CUEVEN = servicios). Candidatas:
-- (1, 1, '41101001', 'VENTAS DE MERCADERIA',                 'Ingreso', 5, 1),   -- INFERENCIA; 1 póliza histórica
-- (1, 1, '41101002', 'VENTAS VARIAS',                        'Ingreso', 5, 1),   -- INFERENCIA
-- Ventas no estándar (uso residual): ESPECIALES (11 líneas), EXENTAS (2 líneas; ver «exento» en el doc §4.3)
-- (1, 1, '41101004', 'VENTAS DE SERVICIOS ESPECIALES',       'Ingreso', 5, 1),
-- (1, 1, '41101006', 'VENTAS EXENTAS',                       'Ingreso', 5, 1),
-- Retenciones / provisión (uso real pero fuera del flujo de venta confirmado):
-- (1, 1, '21301007', 'PROVISION RETENCIONES DE IVA',         'Pasivo',  5, 1),   -- 31 líneas desde 2024-11
-- (1, 1, '11302006', 'RETENCIONES DE ISR',                   'Activo',  5, 1),   -- 0 movimientos; ISR PENDIENTE
-- (1, 1, '21401002', 'ISR POR PAGAR (EMPRESA)',              'Pasivo',  5, 1),   -- f10.CUEISP_FPV; 2 líneas; ISR PENDIENTE
-- (1, 1, '41201001', 'OTROS INGRESOS',                       'Ingreso', 5, 1),   -- f10.CUINND_FPV; 6 líneas
-- Bancos/caja sin movimiento reciente (¿vigentes?):
-- (1, 1, '11103006', 'G&T CONTINENTAL',                      'Activo',  5, 1),   -- último movimiento 2023-06
-- (1, 1, '11101001', 'CAJA GENERAL',                         'Activo',  5, 1),   -- último movimiento 2023-06
-- (1, 1, '11104003', 'BANCO INDUSTRIAL (AHORRO DOLARES)',    'Activo',  5, 1),   -- moneda extranjera; sin movimiento
--
-- ── MÓNACO ──
-- (1, 2, '41101001', 'VENTAS DE MERCADERIA',                 'Ingreso', 5, 1),   -- candidata VENTAS_BIENES (INFERENCIA)
-- (1, 2, '41101002', 'VENTAS VARIAS',                        'Ingreso', 5, 1),
-- (1, 2, '41101004', 'VENTAS DE TRATAMIENTO',                'Ingreso', 5, 1),   -- OJO: en KT el mismo código es «ESPECIALES»
-- (1, 2, '41101006', 'VENTAS EXENTAS',                       'Ingreso', 5, 1),   -- 3 líneas (2025-04/05)
-- (1, 2, '21301007', 'PROVISION RETENCIONES DE IVA',         'Pasivo',  5, 1),   -- 7 líneas 2025
-- (1, 2, '11302006', 'RETENCIONES DE ISR',                   'Activo',  5, 1),
-- (1, 2, '21401002', 'ISR POR PAGAR (EMPRESA)',              'Pasivo',  5, 1),
-- (1, 2, '41201001', 'OTROS INGRESOS',                       'Ingreso', 5, 1),

-- ═════════════════════════════ D. BANCOS (cont_cuentas_bancarias) — COMENTADO, fase posterior ═════════════════════
-- Requiere que las cuentas de la sección A/B ya existan y que Contabilidad confirme alias, moneda y los últimos 4
-- dígitos a mostrar. La cuenta contable se enlaza por (empresa, entidad, código): nunca por id escrito a mano.
-- KT:
-- INSERT INTO cont_cuentas_bancarias (empresa_id, entidad_id, cuenta_id, banco, alias, referencia, moneda)
-- SELECT 1, 1, c.id, 'Banco Industrial',        'Monetaria Q (operaciones)', '***<últimos 4>', 'GTQ' FROM cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = 1 AND c.codigo = '11103002'
-- UNION ALL
-- SELECT 1, 1, c.id, 'G&T Continental',         'Monetaria Q',               '***<últimos 4>', 'GTQ' FROM cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = 1 AND c.codigo = '11103001'
-- UNION ALL
-- SELECT 1, 1, c.id, 'Banco Industrial',        'Fondo operativo',           '***<últimos 4>', 'GTQ' FROM cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = 1 AND c.codigo = '11103004';
-- MÓNACO:
-- INSERT INTO cont_cuentas_bancarias (empresa_id, entidad_id, cuenta_id, banco, alias, referencia, moneda)
-- SELECT 1, 2, c.id, 'Banco Industrial',        'Monetaria Q',               '***<últimos 4>', 'GTQ' FROM cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = 2 AND c.codigo = '11103002';

-- ═════════════════════════════ E. PARAMETRIZACIÓN POR ROL — DISEÑO, NO MIGRAR TODAVÍA ═══════════════════════════════
-- Hoy NO existe ninguna estructura reutilizable (ver preflight §7). Diseño propuesto (aditivo; requiere su propia
-- revisión y autorización, y NO forma parte de esta homologación):
--
-- CREATE TABLE IF NOT EXISTS cont_cuentas_rol (
--   empresa_id INT NOT NULL,
--   entidad_id INT NOT NULL,
--   rol VARCHAR(40) NOT NULL,            -- CLIENTES | BANCOS(*) | VENTAS_SERVICIOS | VENTAS_BIENES | IVA_POR_PAGAR |
--                                        -- RETENCION_IVA | ANTICIPOS | TRANSITO_BANCARIO | DEVOLUCIONES_VENTAS | …
--   cuenta_id INT NOT NULL,
--   activo TINYINT(1) NOT NULL DEFAULT 1,
--   actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
--   PRIMARY KEY (empresa_id, entidad_id, rol),
--   CONSTRAINT fk_cont_rol_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
--   CONSTRAINT fk_cont_rol_cuenta  FOREIGN KEY (empresa_id, entidad_id, cuenta_id) REFERENCES cont_cuentas(empresa_id, entidad_id, id) ON DELETE RESTRICT
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- (*) BANCOS no es un rol único: la cuenta sale de la cuenta bancaria elegida (cont_cuentas_bancarias), ya existente.
--
-- Carga inicial sugerida (por código, nunca por id), tras aprobar sección A/B:
-- INSERT INTO cont_cuentas_rol (empresa_id, entidad_id, rol, cuenta_id)
-- SELECT c.empresa_id, c.entidad_id, m.rol, c.id
-- FROM (SELECT 'CLIENTES' AS rol, '11203001' AS codigo UNION ALL SELECT 'IVA_POR_PAGAR', '21401001'
--       UNION ALL SELECT 'VENTAS_SERVICIOS', '41101003' UNION ALL SELECT 'RETENCION_IVA', '11302005'
--       UNION ALL SELECT 'ANTICIPOS', '21302001' UNION ALL SELECT 'TRANSITO_BANCARIO', '11101002'
--       UNION ALL SELECT 'DEVOLUCIONES_VENTAS', '41501002') m
-- JOIN cont_cuentas c ON c.empresa_id = 1 AND c.entidad_id IN (1, 2) AND c.codigo = m.codigo;
-- (VENTAS_BIENES queda SIN cuenta hasta que Contabilidad la defina: el motor debe rechazar una línea BIEN si el rol
--  no está configurado en la entidad, en lugar de usar la de servicios.)

-- ═════════════════════════════ F. VERIFICACIÓN POSTERIOR (solo lectura) ═══════════════════════════════════════════
-- Esperado tras A + B: KT = 1 (prueba) + 10 = 11 cuentas; MONACO = 8.
-- SELECT entidad_id, COUNT(*) AS cuentas FROM cont_cuentas WHERE empresa_id = 1 GROUP BY entidad_id ORDER BY entidad_id;
-- SELECT entidad_id, codigo, nombre, tipo, nivel, activa FROM cont_cuentas WHERE empresa_id = 1 ORDER BY entidad_id, codigo;
