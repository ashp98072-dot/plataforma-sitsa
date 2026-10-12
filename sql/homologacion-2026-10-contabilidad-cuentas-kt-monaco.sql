-- HOMOLOGACIÓN EJECUTABLE — 18 cuentas de Milenium → cont_cuentas (KT entidad 1 · MONACO entidad 2, empresa 1).
--
-- ESTADO: PROPUESTO PARA REVISIÓN. NO SE HA EJECUTADO en ningún entorno real. NO ejecutar sin:
--   1) autorización explícita del responsable,
--   2) respaldo de la base,
--   3) el PREFLIGHT (sql/preflight-2026-10-contabilidad-homologacion-milenium.sql, §3) con «APTO: 0 colisiones».
--
-- Desbloqueo: Contabilidad aprobó el diccionario TIPO_CTA (1 Activo · 2 Pasivo · 3 Capital · 4 Ingreso · 5 Gasto;
-- «van de cajón siempre»). Las 18 cuentas del inventario tienen TIPO_CTA ∈ {1, 2, 4} en AMBOS catálogos (verificado en co01).
--
-- Lo que este script HACE: inserta 18 filas en cont_cuentas (10 KT + 8 MONACO) y las verifica EXACTAMENTE.
-- Lo que NO hace: no toca la cuenta de prueba 32234, no carga VENTAS_BIENES (falta código de Contabilidad), no carga
--   bancos (cont_cuentas_bancarias), no crea roles, no genera pólizas ni asientos, no hace UPDATE/DELETE/ALTER.
--   No usa nivel 5 como regla de movimiento (no confirmada): `nivel` es NIVEL_CTA verbatim, solo informativo.
--
-- FALLA CERRADO:
--   · INSERT simple (sin IGNORE ni ON DUPLICATE KEY): un duplicado (empresa, entidad, código) hace fallar la sentencia
--     completa; no se actualiza ni se ignora nada.
--   · Verificación exacta contra la tabla temporal `esperado` (entidad, código, nombre, tipo, nivel, activa).
--   · COMMIT solo si el INSERT insertó exactamente 18 filas Y hay 0 diferencias; en cualquier otro caso ROLLBACK. Si el
--     INSERT falla (p. ej. cuenta preexistente), no queda nada insertado y el resultado final es ROLLBACK.
--   Correrlo completo, en una sola sesión (el cliente debe detenerse ante el primer error o ejecutarlo hasta el final;
--   en ambos casos el resultado es «sin cambios»).
--
-- Los nombres bancarios se registran SIN el número de cuenta (Contabilidad define el nombre final).

-- ───────────────────────── 0. Esperado (tabla TEMPORAL de la sesión; no persiste) ─────────────────────────────────
DROP TEMPORARY TABLE IF EXISTS esperado;
CREATE TEMPORARY TABLE esperado (
  entidad_id INT NOT NULL,
  codigo     VARCHAR(40)  NOT NULL,
  nombre     VARCHAR(200) NOT NULL,
  tipo       VARCHAR(40)  NOT NULL,
  nivel      INT          NOT NULL,
  PRIMARY KEY (entidad_id, codigo)
) DEFAULT CHARSET=utf8mb4;

INSERT INTO esperado (entidad_id, codigo, nombre, tipo, nivel) VALUES
  -- KT (entidad 1) · Milenium empresa 01
  (1, '11203001', 'CLIENTES LOCALES',                       'Activo',  5),   -- TIPO_CTA 1 · rol CLIENTES
  (1, '21401001', 'IVA POR PAGAR',                          'Pasivo',  5),   -- TIPO_CTA 2 · rol IVA_POR_PAGAR
  (1, '41101003', 'VENTAS DE SERVICIOS',                    'Ingreso', 5),   -- TIPO_CTA 4 · rol VENTAS_SERVICIOS
  (1, '11302005', 'RETENCIONES DE IVA',                     'Activo',  5),   -- TIPO_CTA 1 · rol RETENCION_IVA
  (1, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL',      'Pasivo',  5),   -- TIPO_CTA 2 · rol ANTICIPOS
  (1, '11101002', 'TRASLADO EN TRANSITO',                   'Activo',  5),   -- TIPO_CTA 1 · rol TRANSITO_BANCARIO
  (1, '41501002', 'DEV. SOBRE VENTAS VARIAS',               'Ingreso', 5),   -- TIPO_CTA 4 · rol DEVOLUCIONES_VENTAS
  (1, '11103002', 'BANCO INDUSTRIAL, S. A.',                'Activo',  5),   -- TIPO_CTA 1 · banco
  (1, '11103001', 'G&T CONTINENTAL',                        'Activo',  5),   -- TIPO_CTA 1 · banco
  (1, '11103004', 'BANCO INDUSTRIAL (FONDO OPERATIVO)',     'Activo',  5),   -- TIPO_CTA 1 · banco (fondo)
  -- MONACO (entidad 2) · Milenium empresas 08 + 00
  (2, '11203001', 'CLIENTES LOCALES',                       'Activo',  5),
  (2, '21401001', 'IVA POR PAGAR',                          'Pasivo',  5),
  (2, '41101003', 'VENTAS DE SERVICIOS',                    'Ingreso', 5),
  (2, '11302005', 'RETENCIONES DE IVA',                     'Activo',  5),
  (2, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL',      'Pasivo',  5),
  (2, '11101002', 'TRASLADO EN TRANSITO',                   'Activo',  5),
  (2, '41501002', 'DEV. SOBRE VENTAS VARIAS',               'Ingreso', 5),
  (2, '11103002', 'BANCO INDUSTRIAL, S. A.',                'Activo',  5);

-- Cantidad esperada: exactamente 18 (10 + 8). Si no lo son, el cierre de la sección 2 será ROLLBACK.
SELECT COUNT(*) AS filas_esperadas, SUM(entidad_id = 1) AS kt, SUM(entidad_id = 2) AS monaco FROM esperado;

-- ───────────────────────── 1. Carga (INSERT simple dentro de una transacción) ─────────────────────────────────────
START TRANSACTION;

INSERT INTO cont_cuentas (empresa_id, entidad_id, codigo, nombre, tipo, nivel, activa)
SELECT 1, e.entidad_id, e.codigo, e.nombre, e.tipo, e.nivel, 1
FROM esperado e
ORDER BY e.entidad_id, e.codigo;
-- Filas que ESTA sentencia insertó (si falló por duplicado, ROW_COUNT() no es 18 y el cierre será ROLLBACK:
-- una cuenta preexistente, aunque idéntica, NO cuenta como «carga confirmada»).
SET @insertadas := ROW_COUNT();

-- ───────────────────────── 2. Verificación EXACTA y cierre condicionado ───────────────────────────────────────────
-- diferencias = filas esperadas ausentes, o presentes con nombre/tipo/nivel/activa distintos.
SET @diferencias := (
  SELECT COUNT(*)
  FROM esperado e
  LEFT JOIN cont_cuentas c
    ON c.empresa_id = 1 AND c.entidad_id = e.entidad_id AND c.codigo = e.codigo
  WHERE c.id IS NULL
     OR BINARY c.nombre <> BINARY e.nombre
     OR c.tipo   <> e.tipo
     OR c.nivel  <> e.nivel
     OR c.activa <> 1
);
SET @esperadas := (SELECT COUNT(*) FROM esperado);
SET @cierre := IF(@diferencias = 0 AND @esperadas = 18 AND @insertadas = 18, 'COMMIT', 'ROLLBACK');
PREPARE cierre FROM @cierre;
EXECUTE cierre;
DEALLOCATE PREPARE cierre;

SELECT @esperadas AS filas_esperadas, @insertadas AS filas_insertadas, @diferencias AS diferencias, @cierre AS cierre,
       IF(@cierre = 'COMMIT', 'CARGA CONFIRMADA', 'REVERTIDO: no se cambió nada') AS resultado;

-- ───────────────────────── 3. Estado final (solo lectura) ─────────────────────────────────────────────────────────
SELECT entidad_id, COUNT(*) AS cuentas FROM cont_cuentas WHERE empresa_id = 1 GROUP BY entidad_id ORDER BY entidad_id;
SELECT entidad_id, codigo, nombre, tipo, nivel, activa
FROM cont_cuentas WHERE empresa_id = 1 ORDER BY entidad_id, codigo;

DROP TEMPORARY TABLE IF EXISTS esperado;
