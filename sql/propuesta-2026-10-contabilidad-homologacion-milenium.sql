-- PROPUESTA — INVENTARIO, PENDIENTES, BANCOS Y DISEÑO DE ROLES. NO CONTIENE NINGÚN INSERT EJECUTABLE.
-- Homologación Milenium → cont_cuentas para KT (entidad_id = 1) y MONACO (entidad_id = 2), empresa_id = 1.
--
-- ACTUALIZACIÓN 2026-10-12: Contabilidad APROBÓ el diccionario TIPO_CTA → tipo (1 Activo · 2 Pasivo · 3 Capital ·
--   4 Ingreso · 5 Gasto). El SQL ejecutable de carga de las 18 cuentas vive ahora en
--   sql/homologacion-2026-10-contabilidad-cuentas-kt-monaco.sql (propuesto; NO ejecutado).
--
-- Sigue PENDIENTE CONTABILIDAD: la cuenta de VENTAS_BIENES (el rol está confirmado; falta el CÓDIGO — no se usa
--   41101001/41101002), la aprobación de los bancos para cont_cuentas_bancarias, y la naturaleza formal. La regla
--   «nivel 5 = cuenta de movimiento» NO está confirmada (la respuesta de Contabilidad fue sobre clasificación 1-7).
--
-- Contenido ejecutable de este archivo: ÚNICAMENTE el SELECT de la sección 1 (solo lectura). Todo lo demás está comentado.
-- No hay INSERT, UPDATE, DELETE, ALTER ni DDL ejecutables. Los NOMBRES de las cuentas bancarias de Milenium incluyen el
-- número de cuenta bancaria; aquí se OMITE (Contabilidad define el nombre final, p. ej. con los últimos 4 dígitos).

-- ═════════════════════════════ 1. INVENTARIO PROPUESTO (solo lectura) ═══════════════════════════════════════════════
-- 10 cuentas KT + 8 Mónaco. Cada una se declara POR SEPARADO por entidad: un mismo código NO implica la misma cuenta
-- (51 códigos comunes tienen nombre distinto entre las dos entidades). empresa_id = 1.
SELECT p.entidad_id, p.codigo, p.nombre, p.tipo_aprobado, p.nivel, p.rol_observado, p.evidencia
FROM (
  SELECT 1 AS entidad_id, '11203001' AS codigo, 'CLIENTES LOCALES' AS nombre, 'Activo' AS tipo_aprobado, 5 AS nivel, 'CLIENTES' AS rol_observado, 'f10.CUECLI_FPV; D en 97.2 % de F/1' AS evidencia
  UNION ALL SELECT 1, '21401001', 'IVA POR PAGAR', 'Pasivo', 5, 'IVA_POR_PAGAR', 'f10.CUEIXP_FPV; H de cada factura'
  UNION ALL SELECT 1, '41101003', 'VENTAS DE SERVICIOS', 'Ingreso', 5, 'VENTAS_SERVICIOS', 'f10.CUEVEN_FPV; H de cada factura'
  UNION ALL SELECT 1, '11302005', 'RETENCIONES DE IVA', 'Activo', 5, 'RETENCION_IVA', 'D en 84.0 % de las aplicaciones C/E'
  UNION ALL SELECT 1, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL', 'Pasivo', 5, 'ANTICIPOS', 'f10.CUANSV_FPV'
  UNION ALL SELECT 1, '11101002', 'TRASLADO EN TRANSITO', 'Activo', 5, 'TRANSITO_BANCARIO', 'f10.CUECAJ_FPV; D del recibo, H del deposito'
  UNION ALL SELECT 1, '41501002', 'DEV. SOBRE VENTAS VARIAS', 'Ingreso', 5, 'DEVOLUCIONES_VENTAS', 'f10.CUGANC_FPV; D de la nota de credito'
  UNION ALL SELECT 1, '11103002', 'BANCO INDUSTRIAL, S. A.', 'Activo', 5, 'BANCOS', 'b02 0001; 19 206 lineas hasta 2026-05'
  UNION ALL SELECT 1, '11103001', 'G&T CONTINENTAL', 'Activo', 5, 'BANCOS', 'b02 0002; 5 238 lineas hasta 2026-05'
  UNION ALL SELECT 1, '11103004', 'BANCO INDUSTRIAL (FONDO OPERATIVO)', 'Activo', 5, 'BANCOS', 'b02 0005; 1 150 lineas hasta 2026-04'
  UNION ALL SELECT 2, '11203001', 'CLIENTES LOCALES', 'Activo', 5, 'CLIENTES', 'f10.CUECLI_FPV; D en 99.5 % de F/1'
  UNION ALL SELECT 2, '21401001', 'IVA POR PAGAR', 'Pasivo', 5, 'IVA_POR_PAGAR', 'f10.CUEIXP_FPV'
  UNION ALL SELECT 2, '41101003', 'VENTAS DE SERVICIOS', 'Ingreso', 5, 'VENTAS_SERVICIOS', 'f10.CUEVEN_FPV'
  UNION ALL SELECT 2, '11302005', 'RETENCIONES DE IVA', 'Activo', 5, 'RETENCION_IVA', 'D en 85.0 % de las aplicaciones C/E'
  UNION ALL SELECT 2, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL', 'Pasivo', 5, 'ANTICIPOS', 'f10.CUANSV_FPV'
  UNION ALL SELECT 2, '11101002', 'TRASLADO EN TRANSITO', 'Activo', 5, 'TRANSITO_BANCARIO', 'f10.CUECAJ_FPV; 100 % de los C/R'
  UNION ALL SELECT 2, '41501002', 'DEV. SOBRE VENTAS VARIAS', 'Ingreso', 5, 'DEVOLUCIONES_VENTAS', 'f10.CUGANC_FPV; 6 de 6 C/C'
  UNION ALL SELECT 2, '11103002', 'BANCO INDUSTRIAL, S. A.', 'Activo', 5, 'BANCOS', 'b02 0001/0002; unico banco con movimiento'
) p
ORDER BY p.entidad_id, p.codigo;

-- ═════════════════════════════ 2. CARGA — AHORA EN UN ARCHIVO EJECUTABLE PROPIO ════════════════════════════════════
-- Contabilidad APROBÓ el diccionario TIPO_CTA (1 Activo · 2 Pasivo · 3 Capital · 4 Ingreso · 5 Gasto) el 2026-10-12.
-- El SQL ejecutable de las 18 cuentas está en:  sql/homologacion-2026-10-contabilidad-cuentas-kt-monaco.sql
-- (propuesto, NO ejecutado; falla cerrado: INSERT simple + verificación exacta + COMMIT/ROLLBACK condicionado).
-- Este archivo conserva solo el INVENTARIO (§1), los PENDIENTES (§3), los BANCOS (§4) y el DISEÑO de roles (§5).

-- ═════════════════════════════ 3. PENDIENTES — fuera del inventario (requieren decisión de Contabilidad) ═══════════
-- Ninguna entra en el inventario de §1. Se listan para que no se pierdan; todas con la misma salvedad de `tipo`.
-- ── KT ──
--   VENTAS_BIENES: rol CONFIRMADO conceptualmente por Contabilidad («VENTA DE BIENES», cuenta separada de VENTAS DE
--     SERVICIOS); el CÓDIGO sigue PENDIENTE CONTABILIDAD (no lo dio). NO usar 41101001 ni 41101002 automáticamente.
--   Ventas no estándar: 41101004 VENTAS DE SERVICIOS ESPECIALES (11) · 41101006 VENTAS EXENTAS (2)
--   Retenciones / ISR: 21301007 PROVISION RETENCIONES DE IVA (31) · 11302006 RETENCIONES DE ISR (0 mov.; ISR PENDIENTE)
--     · 21401002 ISR POR PAGAR (EMPRESA) (2) · 41201001 OTROS INGRESOS (6)
--   Bancos/caja sin movimiento reciente: 11103006 G&T CONTINENTAL (hasta 2023-06) · 11101001 CAJA GENERAL (hasta 2023-06)
--     · 11104003 BANCO INDUSTRIAL (AHORRO DOLARES) (sin movimiento)
-- ── MONACO ──
--   VENTAS_BIENES: igual que KT (rol confirmado, código pendiente; no usar 41101001 / 41101002 automáticamente).
--   41101004 = «VENTAS DE TRATAMIENTO» en Mónaco (en KT «ESPECIALES»: misma clave, distinta cuenta) · 41101006 (3)
--   21301007 (7) · 11302006 / 21401002 (0 mov.) · 41201001 (1)

-- ═════════════════════════════ 4. BANCOS (cont_cuentas_bancarias) — COMENTADO, fase posterior ═════════════════════
-- Requiere que las cuentas de la carga (sql/homologacion-…) ya existan y que Contabilidad confirme alias, moneda y los últimos 4 dígitos a mostrar.
-- La cuenta contable se enlaza por (empresa, entidad, código): nunca por id escrito a mano. INSERT simple (falla ante
-- duplicado; UNIQUE(empresa, entidad, cuenta)).
-- KT:
-- INSERT INTO cont_cuentas_bancarias (empresa_id, entidad_id, cuenta_id, banco, alias, referencia, moneda)
-- SELECT 1, 1, c.id, 'Banco Industrial', 'Monetaria Q (operaciones)', '***<últimos 4>', 'GTQ' FROM cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = 1 AND c.codigo = '11103002'
-- UNION ALL
-- SELECT 1, 1, c.id, 'G&T Continental',  'Monetaria Q',               '***<últimos 4>', 'GTQ' FROM cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = 1 AND c.codigo = '11103001'
-- UNION ALL
-- SELECT 1, 1, c.id, 'Banco Industrial', 'Fondo operativo',           '***<últimos 4>', 'GTQ' FROM cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = 1 AND c.codigo = '11103004';
-- MONACO:
-- INSERT INTO cont_cuentas_bancarias (empresa_id, entidad_id, cuenta_id, banco, alias, referencia, moneda)
-- SELECT 1, 2, c.id, 'Banco Industrial', 'Monetaria Q',               '***<últimos 4>', 'GTQ' FROM cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = 2 AND c.codigo = '11103002';

-- ═════════════════════════════ 5. PARAMETRIZACIÓN POR ROL — DISEÑO, NO MIGRAR TODAVÍA ═══════════════════════════════
-- Hoy NO existe ninguna estructura reutilizable (ver preflight §7). Diseño propuesto (aditivo; requiere su propia
-- revisión y autorización, y NO forma parte de esta homologación):
--
-- CREATE TABLE IF NOT EXISTS cont_cuentas_rol (
--   empresa_id INT NOT NULL,
--   entidad_id INT NOT NULL,
--   rol VARCHAR(40) NOT NULL,            -- CLIENTES | VENTAS_SERVICIOS | VENTAS_BIENES | IVA_POR_PAGAR | RETENCION_IVA |
--                                        -- ANTICIPOS | TRANSITO_BANCARIO | DEVOLUCIONES_VENTAS | …  (BANCOS: ver nota)
--   cuenta_id INT NOT NULL,
--   activo TINYINT(1) NOT NULL DEFAULT 1,
--   actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
--   PRIMARY KEY (empresa_id, entidad_id, rol),
--   CONSTRAINT fk_cont_rol_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
--   CONSTRAINT fk_cont_rol_cuenta  FOREIGN KEY (empresa_id, entidad_id, cuenta_id) REFERENCES cont_cuentas(empresa_id, entidad_id, id) ON DELETE RESTRICT
-- ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Nota: BANCOS no es un rol único; la cuenta sale de la cuenta bancaria elegida (cont_cuentas_bancarias, ya existente).
--
-- Carga inicial sugerida (por código, nunca por id; INSERT simple que falla ante duplicado), tras la carga de cuentas:
-- INSERT INTO cont_cuentas_rol (empresa_id, entidad_id, rol, cuenta_id)
-- SELECT c.empresa_id, c.entidad_id, m.rol, c.id
-- FROM (SELECT 'CLIENTES' AS rol, '11203001' AS codigo UNION ALL SELECT 'IVA_POR_PAGAR', '21401001'
--       UNION ALL SELECT 'VENTAS_SERVICIOS', '41101003' UNION ALL SELECT 'RETENCION_IVA', '11302005'
--       UNION ALL SELECT 'ANTICIPOS', '21302001' UNION ALL SELECT 'TRANSITO_BANCARIO', '11101002'
--       UNION ALL SELECT 'DEVOLUCIONES_VENTAS', '41501002') m
-- JOIN cont_cuentas c ON c.empresa_id = 1 AND c.entidad_id IN (1, 2) AND c.codigo = m.codigo;
-- (VENTAS_BIENES queda SIN cuenta hasta que Contabilidad la defina: el motor debe rechazar una línea BIEN si el rol
--  no está configurado en la entidad, en lugar de usar la de servicios.)
