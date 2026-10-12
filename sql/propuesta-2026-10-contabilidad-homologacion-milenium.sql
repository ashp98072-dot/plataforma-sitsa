-- PROPUESTA — INVENTARIO Y PATRÓN DE CARGA. NO CONTIENE NINGÚN INSERT EJECUTABLE.
-- Homologación Milenium → cont_cuentas para KT (entidad_id = 1) y MONACO (entidad_id = 2), empresa_id = 1.
--
-- ESTADO: BLOQUEADO por una decisión de Contabilidad.
--   La traducción TIPO_CTA → cont_cuentas.tipo (1 Activo · 2 Pasivo · 3 Capital · 4 Ingreso · 5 Gasto) es una INFERENCIA
--   fuerte, NO una regla aprobada (docs/CONTABILIDAD-HOMOLOGACION-MILENIUM-KT-MONACO.md §3.2 y §8). Mientras no la apruebe
--   Contabilidad de forma explícita, NO se genera SQL ejecutable de carga y NO se escribe ningún valor de `tipo` en este
--   archivo (ni definitivo ni temporal). cont_cuentas.tipo es NOT NULL: sin esa decisión no hay INSERT válido.
--
-- Qué SÍ está confirmado para cada cuenta del inventario (evidencia: catálogo `co01`, parámetros `f10` y pólizas `co03`):
--   entidad · código · nombre · nivel · rol observado en las pólizas reales.
-- Qué NO está aprobado todavía (PENDIENTE CONTABILIDAD):
--   tipo (diccionario TIPO_CTA) · naturaleza formal (MULTIP_CTA) · si «nivel 5» es la regla de cuenta de movimiento.
-- Por tanto: las cuentas están IDENTIFICADAS, pero la FILA productiva de cont_cuentas aún NO está completamente aprobada.
--
-- Contenido ejecutable de este archivo: ÚNICAMENTE el SELECT de la sección 1 (solo lectura). Todo lo demás está comentado.
-- No hay INSERT, UPDATE, DELETE, ALTER ni DDL ejecutables. Los NOMBRES de las cuentas bancarias de Milenium incluyen el
-- número de cuenta bancaria; aquí se OMITE (Contabilidad define el nombre final, p. ej. con los últimos 4 dígitos).

-- ═════════════════════════════ 1. INVENTARIO PROPUESTO (solo lectura, sin `tipo`) ═══════════════════════════════════
-- 10 cuentas KT + 8 Mónaco. Cada una se declara POR SEPARADO por entidad: un mismo código NO implica la misma cuenta
-- (51 códigos comunes tienen nombre distinto entre las dos entidades). empresa_id = 1.
SELECT p.entidad_id, p.codigo, p.nombre, p.nivel, p.rol_observado, p.evidencia
FROM (
  -- KT (entidad_id = 1) — Milenium empresa 01 (BASES001)
  SELECT 1 AS entidad_id, '11203001' AS codigo, 'CLIENTES LOCALES' AS nombre, 5 AS nivel, 'CLIENTES' AS rol_observado, 'f10.CUECLI_FPV; D en 97.2 % de F/1' AS evidencia
  UNION ALL SELECT 1, '21401001', 'IVA POR PAGAR',                          5, 'IVA_POR_PAGAR',       'f10.CUEIXP_FPV; H de cada factura'
  UNION ALL SELECT 1, '41101003', 'VENTAS DE SERVICIOS',                    5, 'VENTAS_SERVICIOS',    'f10.CUEVEN_FPV; H de cada factura'
  UNION ALL SELECT 1, '11302005', 'RETENCIONES DE IVA',                     5, 'RETENCION_IVA',       'D en 84.0 % de las aplicaciones C/E'
  UNION ALL SELECT 1, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL',      5, 'ANTICIPOS',           'f10.CUANSV_FPV'
  UNION ALL SELECT 1, '11101002', 'TRASLADO EN TRANSITO',                   5, 'TRANSITO_BANCARIO',   'f10.CUECAJ_FPV; D del recibo, H del deposito'
  UNION ALL SELECT 1, '41501002', 'DEV. SOBRE VENTAS VARIAS',               5, 'DEVOLUCIONES_VENTAS', 'f10.CUGANC_FPV; D de la nota de credito'
  UNION ALL SELECT 1, '11103002', 'BANCO INDUSTRIAL, S. A.',                5, 'BANCOS',              'b02 0001; 19 206 lineas hasta 2026-05'
  UNION ALL SELECT 1, '11103001', 'G&T CONTINENTAL',                        5, 'BANCOS',              'b02 0002; 5 238 lineas hasta 2026-05'
  UNION ALL SELECT 1, '11103004', 'BANCO INDUSTRIAL (FONDO OPERATIVO)',     5, 'BANCOS',              'b02 0005; 1 150 lineas hasta 2026-04'
  -- MONACO (entidad_id = 2) — Milenium empresa 08 actual + 00 histórico (misma entidad)
  UNION ALL SELECT 2, '11203001', 'CLIENTES LOCALES',                       5, 'CLIENTES',            'f10.CUECLI_FPV; D en 99.5 % de F/1'
  UNION ALL SELECT 2, '21401001', 'IVA POR PAGAR',                          5, 'IVA_POR_PAGAR',       'f10.CUEIXP_FPV'
  UNION ALL SELECT 2, '41101003', 'VENTAS DE SERVICIOS',                    5, 'VENTAS_SERVICIOS',    'f10.CUEVEN_FPV'
  UNION ALL SELECT 2, '11302005', 'RETENCIONES DE IVA',                     5, 'RETENCION_IVA',       'D en 85.0 % de las aplicaciones C/E'
  UNION ALL SELECT 2, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL',      5, 'ANTICIPOS',           'f10.CUANSV_FPV'
  UNION ALL SELECT 2, '11101002', 'TRASLADO EN TRANSITO',                   5, 'TRANSITO_BANCARIO',   'f10.CUECAJ_FPV; 100 % de los C/R'
  UNION ALL SELECT 2, '41501002', 'DEV. SOBRE VENTAS VARIAS',               5, 'DEVOLUCIONES_VENTAS', 'f10.CUGANC_FPV; 6 de 6 C/C'
  UNION ALL SELECT 2, '11103002', 'BANCO INDUSTRIAL, S. A.',                5, 'BANCOS',              'b02 0001/0002; unico banco con movimiento'
) p
ORDER BY p.entidad_id, p.codigo;

-- ═════════════════════════════ 2. CARGA FUTURA — COMENTADA, BLOQUEADA POR `tipo` ══════════════════════════════════
-- NO descomentar hasta que Contabilidad apruebe por escrito el diccionario TIPO_CTA → tipo. Entonces se genera el SQL
-- ejecutable definitivo (con el `tipo` aprobado en cada fila) y se somete a una nueva revisión. `<TIPO>` es un MARCADOR,
-- no un valor: no existe un tipo provisional.
--
-- PATRÓN — FALLAR CERRADO (obligatorio para la carga autorizada):
--   a) Ejecutar PRIMERO el preflight (sql/preflight-2026-10-contabilidad-homologacion-milenium.sql §3). Exigir
--      0 colisiones inesperadas: todas las filas deben decir «SIN COLISION». Cualquier otro resultado DETIENE la carga y se
--      resuelve a mano (una cuenta existente con nombre/tipo/nivel distinto jamás se «absorbe»).
--   b) INSERT simple, SIN `IGNORE` y SIN `ON DUPLICATE KEY UPDATE`: ante un duplicado la sentencia FALLA (ER_DUP_ENTRY) y
--      no inserta ninguna fila de esa sentencia. No se actualiza ni se ignora nada en silencio.
--   c) Dentro de una transacción explícita: START TRANSACTION; INSERT …; verificación exacta (d); COMMIT solo si la
--      verificación devuelve 0 filas con diferencias; si no, ROLLBACK.
--   d) Verificación posterior: comparar la tabla contra el inventario aprobado EXACTAMENTE (entidad, código, nombre, tipo,
--      nivel, activa). Un solo renglón distinto o faltante aborta.
--
-- Plantilla (KT) — una fila por cuenta del inventario de §1:
-- START TRANSACTION;
-- INSERT INTO cont_cuentas (empresa_id, entidad_id, codigo, nombre, tipo, nivel, activa) VALUES
--   (1, 1, '11203001', 'CLIENTES LOCALES',                       <TIPO>, 5, 1),
--   (1, 1, '21401001', 'IVA POR PAGAR',                          <TIPO>, 5, 1),
--   (1, 1, '41101003', 'VENTAS DE SERVICIOS',                    <TIPO>, 5, 1),
--   (1, 1, '11302005', 'RETENCIONES DE IVA',                     <TIPO>, 5, 1),
--   (1, 1, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL',      <TIPO>, 5, 1),
--   (1, 1, '11101002', 'TRASLADO EN TRANSITO',                   <TIPO>, 5, 1),
--   (1, 1, '41501002', 'DEV. SOBRE VENTAS VARIAS',               <TIPO>, 5, 1),
--   (1, 1, '11103002', 'BANCO INDUSTRIAL, S. A.',                <TIPO>, 5, 1),
--   (1, 1, '11103001', 'G&T CONTINENTAL',                        <TIPO>, 5, 1),
--   (1, 1, '11103004', 'BANCO INDUSTRIAL (FONDO OPERATIVO)',     <TIPO>, 5, 1);
-- Plantilla (MONACO):
-- INSERT INTO cont_cuentas (empresa_id, entidad_id, codigo, nombre, tipo, nivel, activa) VALUES
--   (1, 2, '11203001', 'CLIENTES LOCALES',                       <TIPO>, 5, 1),
--   (1, 2, '21401001', 'IVA POR PAGAR',                          <TIPO>, 5, 1),
--   (1, 2, '41101003', 'VENTAS DE SERVICIOS',                    <TIPO>, 5, 1),
--   (1, 2, '11302005', 'RETENCIONES DE IVA',                     <TIPO>, 5, 1),
--   (1, 2, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL',      <TIPO>, 5, 1),
--   (1, 2, '11101002', 'TRASLADO EN TRANSITO',                   <TIPO>, 5, 1),
--   (1, 2, '41501002', 'DEV. SOBRE VENTAS VARIAS',               <TIPO>, 5, 1),
--   (1, 2, '11103002', 'BANCO INDUSTRIAL, S. A.',                <TIPO>, 5, 1);
-- -- verificación (esperado: 0 filas) y, solo entonces, COMMIT:
-- -- SELECT … FROM (inventario aprobado) esperado LEFT JOIN cont_cuentas c ON … WHERE c.id IS NULL OR c.nombre <> esperado.nombre
-- --        OR c.tipo <> esperado.tipo OR c.nivel <> esperado.nivel OR c.activa <> 1;
-- COMMIT;   -- o ROLLBACK;

-- ═════════════════════════════ 3. PENDIENTES — fuera del inventario (requieren decisión de Contabilidad) ═══════════
-- Ninguna entra en el inventario de §1. Se listan para que no se pierdan; todas con la misma salvedad de `tipo`.
-- ── KT ──
--   VENTAS_BIENES: Milenium NO parametriza cuenta de ventas de bienes (f10 solo tiene CUEVEN = servicios).
--     Candidatas (INFERENCIA): 41101001 VENTAS DE MERCADERIA (1 póliza histórica) · 41101002 VENTAS VARIAS
--   Ventas no estándar: 41101004 VENTAS DE SERVICIOS ESPECIALES (11) · 41101006 VENTAS EXENTAS (2)
--   Retenciones / ISR: 21301007 PROVISION RETENCIONES DE IVA (31) · 11302006 RETENCIONES DE ISR (0 mov.; ISR PENDIENTE)
--     · 21401002 ISR POR PAGAR (EMPRESA) (2) · 41201001 OTROS INGRESOS (6)
--   Bancos/caja sin movimiento reciente: 11103006 G&T CONTINENTAL (hasta 2023-06) · 11101001 CAJA GENERAL (hasta 2023-06)
--     · 11104003 BANCO INDUSTRIAL (AHORRO DOLARES) (sin movimiento)
-- ── MONACO ──
--   VENTAS_BIENES: igual que KT (41101001 / 41101002 candidatas).
--   41101004 = «VENTAS DE TRATAMIENTO» en Mónaco (en KT «ESPECIALES»: misma clave, distinta cuenta) · 41101006 (3)
--   21301007 (7) · 11302006 / 21401002 (0 mov.) · 41201001 (1)

-- ═════════════════════════════ 4. BANCOS (cont_cuentas_bancarias) — COMENTADO, fase posterior ═════════════════════
-- Requiere que las cuentas de §2 ya existan y que Contabilidad confirme alias, moneda y los últimos 4 dígitos a mostrar.
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
-- Carga inicial sugerida (por código, nunca por id; INSERT simple que falla ante duplicado), tras aprobar §2:
-- INSERT INTO cont_cuentas_rol (empresa_id, entidad_id, rol, cuenta_id)
-- SELECT c.empresa_id, c.entidad_id, m.rol, c.id
-- FROM (SELECT 'CLIENTES' AS rol, '11203001' AS codigo UNION ALL SELECT 'IVA_POR_PAGAR', '21401001'
--       UNION ALL SELECT 'VENTAS_SERVICIOS', '41101003' UNION ALL SELECT 'RETENCION_IVA', '11302005'
--       UNION ALL SELECT 'ANTICIPOS', '21302001' UNION ALL SELECT 'TRANSITO_BANCARIO', '11101002'
--       UNION ALL SELECT 'DEVOLUCIONES_VENTAS', '41501002') m
-- JOIN cont_cuentas c ON c.empresa_id = 1 AND c.entidad_id IN (1, 2) AND c.codigo = m.codigo;
-- (VENTAS_BIENES queda SIN cuenta hasta que Contabilidad la defina: el motor debe rechazar una línea BIEN si el rol
--  no está configurado en la entidad, en lugar de usar la de servicios.)
