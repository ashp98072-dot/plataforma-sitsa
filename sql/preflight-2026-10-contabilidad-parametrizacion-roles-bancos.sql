-- PREFLIGHT DE SOLO LECTURA — Parametrización contable por entidad: roles → cuentas y bancos (KT / MÓNACO).
-- Solo SELECT / WITH … SELECT, consultas a information_schema y SET de variables de sesión (@…) con PREPARE de SELECT para
-- tolerar que `cont_cuentas_rol` aún no exista. NO hay INSERT/UPDATE/DELETE/ALTER/DDL. Se puede ejecutar en producción
-- con un usuario de solo lectura.
--
-- ESQUEMA EXPLÍCITO: todas las consultas usan `u611730801_Plataforma.<tabla>` y `TABLE_SCHEMA = 'u611730801_Plataforma'` (nada depende del
-- esquema activo de la sesión ni de DATABASE(): en phpMyAdmin/Hostinger eso producía errores contra information_schema).
-- Si se corre en OTRA base (p. ej. pruebas), reemplazar el nombre del esquema en todo el archivo.
--
-- Contexto esperado (informado por el responsable): empresa_id = 1 · entidad 1 = KT / KuiqTrans · entidad 2 = MONACO /
-- Logiservicios Mónaco · cont_cuentas con 10 cuentas homologadas en KT y 8 en MONACO (la cuenta de prueba ya no existe).
-- Revisar el resultado ANTES de pensar en ejecutar sql/propuesta-2026-10-contabilidad-parametrizacion-roles-bancos.sql
-- (que NO se ejecuta sin autorización explícita).
--
-- No muestra números de cuenta bancaria: solo cuenta contable, banco y alias/referencia tal como estén en la base; la §6.5
-- marca cualquier `referencia` que parezca un número largo para que se corrija.
-- Documento asociado: docs/CONTABILIDAD-PARAMETRIZACION-ROLES-BANCOS.md

-- ───────────────────────── 1. Entidades ──────────────────────────────────────────────────────────────────────────
-- Esperado: 2 filas activas (1 = KT, 2 = MONACO).
SELECT id, empresa_id, codigo, nombre, activa FROM u611730801_Plataforma.cont_entidades WHERE empresa_id = 1 ORDER BY id;

-- ───────────────────────── 2. Cuentas homologadas por entidad ────────────────────────────────────────────────────
-- 2.1 Resumen. Esperado: KT = 10, MONACO = 8 (y 0 con entidad_id NULL).
SELECT COALESCE(CAST(entidad_id AS CHAR), 'NULL (legado)') AS entidad_id, COUNT(*) AS cuentas, SUM(activa = 1) AS activas
FROM u611730801_Plataforma.cont_cuentas WHERE empresa_id = 1
GROUP BY entidad_id ORDER BY entidad_id;

-- 2.2 Las 18 cuentas homologadas contra lo esperado (código, nombre, tipo aprobado, nivel, activa).
--     estado = OK | FALTA | DIFIERE (nombre/tipo/nivel) | INACTIVA
WITH esperado AS (
  SELECT 1 AS entidad_id, '11203001' AS codigo, 'CLIENTES LOCALES' AS nombre, 'Activo' AS tipo, 5 AS nivel
  UNION ALL SELECT 1, '21401001', 'IVA POR PAGAR',                      'Pasivo',  5
  UNION ALL SELECT 1, '41101003', 'VENTAS DE SERVICIOS',                'Ingreso', 5
  UNION ALL SELECT 1, '11302005', 'RETENCIONES DE IVA',                 'Activo',  5
  UNION ALL SELECT 1, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL',  'Pasivo',  5
  UNION ALL SELECT 1, '11101002', 'TRASLADO EN TRANSITO',               'Activo',  5
  UNION ALL SELECT 1, '41501002', 'DEV. SOBRE VENTAS VARIAS',           'Ingreso', 5
  UNION ALL SELECT 1, '11103002', 'BANCO INDUSTRIAL, S. A.',            'Activo',  5
  UNION ALL SELECT 1, '11103001', 'G&T CONTINENTAL',                    'Activo',  5
  UNION ALL SELECT 1, '11103004', 'BANCO INDUSTRIAL (FONDO OPERATIVO)', 'Activo',  5
  UNION ALL SELECT 2, '11203001', 'CLIENTES LOCALES',                   'Activo',  5
  UNION ALL SELECT 2, '21401001', 'IVA POR PAGAR',                      'Pasivo',  5
  UNION ALL SELECT 2, '41101003', 'VENTAS DE SERVICIOS',                'Ingreso', 5
  UNION ALL SELECT 2, '11302005', 'RETENCIONES DE IVA',                 'Activo',  5
  UNION ALL SELECT 2, '21302001', 'ANTICIPO DE CLIENTES MONEDA LOCAL',  'Pasivo',  5
  UNION ALL SELECT 2, '11101002', 'TRASLADO EN TRANSITO',               'Activo',  5
  UNION ALL SELECT 2, '41501002', 'DEV. SOBRE VENTAS VARIAS',           'Ingreso', 5
  UNION ALL SELECT 2, '11103002', 'BANCO INDUSTRIAL, S. A.',            'Activo',  5
)
SELECT e.entidad_id, e.codigo, e.nombre AS nombre_esperado, c.nombre AS nombre_actual, e.tipo AS tipo_esperado, c.tipo AS tipo_actual,
       e.nivel AS nivel_esperado, c.nivel AS nivel_actual, c.activa,
       CASE
         WHEN c.id IS NULL THEN 'FALTA'
         WHEN c.activa <> 1 THEN 'INACTIVA'
         WHEN c.nombre <> e.nombre OR c.tipo <> e.tipo OR c.nivel <> e.nivel THEN 'DIFIERE'
         ELSE 'OK'
       END AS estado
FROM esperado e
LEFT JOIN u611730801_Plataforma.cont_cuentas c ON c.empresa_id = 1 AND c.entidad_id = e.entidad_id AND c.codigo = e.codigo
ORDER BY e.entidad_id, e.codigo;

-- 2.3 Cuentas presentes que NO son de las 18 homologadas (informativo; esperado: ninguna).
SELECT c.entidad_id, c.codigo, c.nombre, c.tipo, c.nivel, c.activa
FROM u611730801_Plataforma.cont_cuentas c
WHERE c.empresa_id = 1
  AND (c.entidad_id, c.codigo) NOT IN (
    (1,'11203001'),(1,'21401001'),(1,'41101003'),(1,'11302005'),(1,'21302001'),(1,'11101002'),(1,'41501002'),
    (1,'11103002'),(1,'11103001'),(1,'11103004'),
    (2,'11203001'),(2,'21401001'),(2,'41101003'),(2,'11302005'),(2,'21302001'),(2,'11101002'),(2,'41501002'),(2,'11103002'))
ORDER BY c.entidad_id, c.codigo;

-- ───────────────────────── 3. ¿Existe ya una estructura de roles reutilizable? ───────────────────────────────────
-- Esperado hoy: ninguna fila (no hay cont_cuentas_rol ni parametrización similar).
SELECT TABLE_NAME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
  AND (TABLE_NAME LIKE 'cont\_%rol%' OR TABLE_NAME LIKE 'cont\_param%' OR TABLE_NAME LIKE 'cont\_cuentas\_%' OR TABLE_NAME LIKE 'fact\_%cuenta%')
ORDER BY TABLE_NAME;

SET @existe_roles := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'cont_cuentas_rol');

-- 3.1 Filas actuales de cont_cuentas_rol (si la tabla existe); si no, un aviso.
SET @q := IF(@existe_roles = 1,
  'SELECT r.id, r.empresa_id, r.entidad_id, r.rol, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre, c.entidad_id AS cuenta_entidad_id,
          c.activa AS cuenta_activa, r.activa AS rol_activo
   FROM u611730801_Plataforma.cont_cuentas_rol r LEFT JOIN u611730801_Plataforma.cont_cuentas c ON c.id = r.cuenta_id
   WHERE r.empresa_id = 1 ORDER BY r.entidad_id, r.rol',
  'SELECT ''cont_cuentas_rol NO existe todavia (esperado antes de la migracion)'' AS estado');
PREPARE q FROM @q; EXECUTE q; DEALLOCATE PREPARE q;

-- ───────────────────────── 4. Roles mínimos: ¿qué falta por configurar? ──────────────────────────────────────────
-- 7 roles × 2 entidades = 14. `cuenta_disponible` = existe en esa entidad, activa y con el TIPO esperado del rol.
-- VENTAS_BIENES NO está en la lista: sigue PENDIENTE (§5). BANCOS NO es un rol fijo: se resuelve por cont_cuentas_bancarias (§6).
SET @q := IF(@existe_roles = 1,
  'WITH esperado AS (
     SELECT 1 AS entidad_id, ''CLIENTES'' AS rol, ''11203001'' AS codigo, ''Activo'' AS tipo
     UNION ALL SELECT 1, ''IVA_POR_PAGAR'', ''21401001'', ''Pasivo''
     UNION ALL SELECT 1, ''VENTAS_SERVICIOS'', ''41101003'', ''Ingreso''
     UNION ALL SELECT 1, ''RETENCION_IVA'', ''11302005'', ''Activo''
     UNION ALL SELECT 1, ''ANTICIPOS'', ''21302001'', ''Pasivo''
     UNION ALL SELECT 1, ''TRANSITO_BANCARIO'', ''11101002'', ''Activo''
     UNION ALL SELECT 1, ''DEVOLUCIONES_VENTAS'', ''41501002'', ''Ingreso''
     UNION ALL SELECT 2, ''CLIENTES'', ''11203001'', ''Activo''
     UNION ALL SELECT 2, ''IVA_POR_PAGAR'', ''21401001'', ''Pasivo''
     UNION ALL SELECT 2, ''VENTAS_SERVICIOS'', ''41101003'', ''Ingreso''
     UNION ALL SELECT 2, ''RETENCION_IVA'', ''11302005'', ''Activo''
     UNION ALL SELECT 2, ''ANTICIPOS'', ''21302001'', ''Pasivo''
     UNION ALL SELECT 2, ''TRANSITO_BANCARIO'', ''11101002'', ''Activo''
     UNION ALL SELECT 2, ''DEVOLUCIONES_VENTAS'', ''41501002'', ''Ingreso'')
   SELECT e.entidad_id, e.rol, e.codigo AS codigo_esperado,
          IF(c.id IS NOT NULL AND c.activa = 1 AND c.tipo = e.tipo, ''SI'', ''NO'') AS cuenta_disponible,
          r.id AS rol_existente_id, rc.codigo AS cuenta_configurada,
          CASE WHEN r.id IS NULL THEN ''SIN CONFIGURAR''
               WHEN rc.codigo = e.codigo AND rc.entidad_id = e.entidad_id AND r.activa = 1 THEN ''CONFIGURADO OK''
               ELSE ''CONFIGURADO DISTINTO - REVISAR'' END AS estado
   FROM esperado e
   LEFT JOIN u611730801_Plataforma.cont_cuentas c ON c.empresa_id = 1 AND c.entidad_id = e.entidad_id AND c.codigo = e.codigo
   LEFT JOIN u611730801_Plataforma.cont_cuentas_rol r ON r.empresa_id = 1 AND r.entidad_id = e.entidad_id AND r.rol = e.rol
   LEFT JOIN u611730801_Plataforma.cont_cuentas rc ON rc.id = r.cuenta_id
   ORDER BY e.entidad_id, e.rol',
  'WITH esperado AS (
     SELECT 1 AS entidad_id, ''CLIENTES'' AS rol, ''11203001'' AS codigo, ''Activo'' AS tipo
     UNION ALL SELECT 1, ''IVA_POR_PAGAR'', ''21401001'', ''Pasivo''
     UNION ALL SELECT 1, ''VENTAS_SERVICIOS'', ''41101003'', ''Ingreso''
     UNION ALL SELECT 1, ''RETENCION_IVA'', ''11302005'', ''Activo''
     UNION ALL SELECT 1, ''ANTICIPOS'', ''21302001'', ''Pasivo''
     UNION ALL SELECT 1, ''TRANSITO_BANCARIO'', ''11101002'', ''Activo''
     UNION ALL SELECT 1, ''DEVOLUCIONES_VENTAS'', ''41501002'', ''Ingreso''
     UNION ALL SELECT 2, ''CLIENTES'', ''11203001'', ''Activo''
     UNION ALL SELECT 2, ''IVA_POR_PAGAR'', ''21401001'', ''Pasivo''
     UNION ALL SELECT 2, ''VENTAS_SERVICIOS'', ''41101003'', ''Ingreso''
     UNION ALL SELECT 2, ''RETENCION_IVA'', ''11302005'', ''Activo''
     UNION ALL SELECT 2, ''ANTICIPOS'', ''21302001'', ''Pasivo''
     UNION ALL SELECT 2, ''TRANSITO_BANCARIO'', ''11101002'', ''Activo''
     UNION ALL SELECT 2, ''DEVOLUCIONES_VENTAS'', ''41501002'', ''Ingreso'')
   SELECT e.entidad_id, e.rol, e.codigo AS codigo_esperado,
          IF(c.id IS NOT NULL AND c.activa = 1 AND c.tipo = e.tipo, ''SI'', ''NO'') AS cuenta_disponible,
          NULL AS rol_existente_id, NULL AS cuenta_configurada, ''SIN CONFIGURAR (tabla inexistente)'' AS estado
   FROM esperado e
   LEFT JOIN u611730801_Plataforma.cont_cuentas c ON c.empresa_id = 1 AND c.entidad_id = e.entidad_id AND c.codigo = e.codigo
   ORDER BY e.entidad_id, e.rol');
PREPARE q FROM @q; EXECUTE q; DEALLOCATE PREPARE q;

-- ───────────────────────── 5. VENTAS_BIENES (rol confirmado; CÓDIGO pendiente) ───────────────────────────────────
-- Contabilidad confirmó el rol «VENTA DE BIENES» pero NO dio código. NO se usa 41101001 ni 41101002.
-- Esperado: sin fila de rol VENTAS_BIENES. Lo siguiente solo informa si esas cuentas candidatas existen en cada entidad
-- (no están entre las 18 homologadas) y si alguien ya configuró el rol.
SELECT e.id AS entidad_id, e.codigo AS entidad,
       (SELECT COUNT(*) FROM u611730801_Plataforma.cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = e.id AND c.codigo IN ('41101001', '41101002')) AS candidatas_presentes,
       'PENDIENTE CONTABILIDAD: falta el codigo de la cuenta VENTA DE BIENES' AS estado
FROM u611730801_Plataforma.cont_entidades e WHERE e.empresa_id = 1 ORDER BY e.id;

SET @q := IF(@existe_roles = 1,
  'SELECT r.entidad_id, r.rol, r.cuenta_id, r.activa, ''ALERTA: VENTAS_BIENES configurado antes de confirmar el codigo'' AS estado
   FROM u611730801_Plataforma.cont_cuentas_rol r WHERE r.empresa_id = 1 AND r.rol = ''VENTAS_BIENES''',
  'SELECT ''Sin tabla de roles: VENTAS_BIENES no puede estar configurado'' AS estado');
PREPARE q FROM @q; EXECUTE q; DEALLOCATE PREPARE q;

-- ───────────────────────── 6. Bancos ─────────────────────────────────────────────────────────────────────────────
-- 6.1 Bancos actuales (esperado hoy: 0 filas, o las que Contabilidad ya haya dado de alta).
SELECT b.id, b.entidad_id, e.codigo AS entidad, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre, c.activa AS cuenta_activa,
       b.banco, b.alias, b.referencia, b.moneda, b.activa AS banco_activo
FROM u611730801_Plataforma.cont_cuentas_bancarias b
LEFT JOIN u611730801_Plataforma.cont_entidades e ON e.empresa_id = b.empresa_id AND e.id = b.entidad_id
LEFT JOIN u611730801_Plataforma.cont_cuentas c ON c.id = b.cuenta_id
WHERE b.empresa_id = 1
ORDER BY b.entidad_id, b.banco, b.alias;

-- 6.2 Candidatos detectados en Milenium y su estado en la plataforma.
--     decision: CONFIRMADO CON MOVIMIENTO (hasta 2026) | PENDIENTE (sin movimiento reciente / no homologada)
WITH candidatos AS (
  SELECT 1 AS entidad_id, '11103002' AS codigo, 'BANCO INDUSTRIAL, S. A.' AS nombre_milenium, 'CON MOVIMIENTO hasta 2026-05' AS evidencia
  UNION ALL SELECT 1, '11103001', 'G&T CONTINENTAL',                     'CON MOVIMIENTO hasta 2026-05'
  UNION ALL SELECT 1, '11103004', 'BANCO INDUSTRIAL (FONDO OPERATIVO)',  'CON MOVIMIENTO hasta 2026-04'
  UNION ALL SELECT 1, '11103006', 'G&T CONTINENTAL',                     'SIN MOVIMIENTO desde 2023-06 - PENDIENTE confirmar si sigue activa'
  UNION ALL SELECT 2, '11103002', 'BANCO INDUSTRIAL, S. A.',             'CON MOVIMIENTO hasta 2026-05 (Milenium tenia 2 registros 0001/0002 a esta misma cuenta)'
)
SELECT k.entidad_id, k.codigo, k.nombre_milenium, k.evidencia,
       IF(c.id IS NULL, 'NO homologada en cont_cuentas', IF(c.activa = 1, 'homologada y activa', 'homologada INACTIVA')) AS cuenta,
       IF(b.id IS NULL, 'SIN banco configurado', CONCAT('banco #', b.id, IF(b.activa = 1, ' activo', ' INACTIVO'))) AS banco
FROM candidatos k
LEFT JOIN u611730801_Plataforma.cont_cuentas c ON c.empresa_id = 1 AND c.entidad_id = k.entidad_id AND c.codigo = k.codigo
LEFT JOIN u611730801_Plataforma.cont_cuentas_bancarias b ON b.empresa_id = 1 AND b.entidad_id = k.entidad_id AND b.cuenta_id = c.id
ORDER BY k.entidad_id, k.codigo;

-- 6.3 Cuentas homologadas «de banco/caja» (11103xxx, 11104xxx, 11101001) SIN fila en cont_cuentas_bancarias.
SELECT c.entidad_id, c.codigo, c.nombre, c.activa
FROM u611730801_Plataforma.cont_cuentas c
LEFT JOIN u611730801_Plataforma.cont_cuentas_bancarias b ON b.empresa_id = c.empresa_id AND b.entidad_id = c.entidad_id AND b.cuenta_id = c.id
WHERE c.empresa_id = 1 AND (c.codigo LIKE '11103%' OR c.codigo LIKE '11104%' OR c.codigo = '11101001') AND b.id IS NULL
ORDER BY c.entidad_id, c.codigo;

-- 6.4 Duplicados y colisiones. Esperado: 0 filas en cada bloque.
--     (a) misma cuenta contable con más de un banco (la UNIQUE lo impide; se verifica igual)
SELECT 'misma cuenta, varios bancos' AS problema, b.entidad_id, b.cuenta_id, COUNT(*) AS filas
FROM u611730801_Plataforma.cont_cuentas_bancarias b WHERE b.empresa_id = 1 GROUP BY b.entidad_id, b.cuenta_id HAVING COUNT(*) > 1
UNION ALL
--     (b) mismo banco + alias repetido dentro de una entidad (no hay UNIQUE que lo impida)
SELECT 'banco+alias repetido en la entidad', b.entidad_id, NULL, COUNT(*)
FROM u611730801_Plataforma.cont_cuentas_bancarias b WHERE b.empresa_id = 1 GROUP BY b.entidad_id, b.banco, b.alias HAVING COUNT(*) > 1
UNION ALL
--     (c) misma referencia (últimos dígitos) y banco en DOS entidades distintas: ¿mismo banco físico en KT y Mónaco?
SELECT 'misma referencia+banco en varias entidades', NULL, NULL, COUNT(DISTINCT b.entidad_id)
FROM u611730801_Plataforma.cont_cuentas_bancarias b WHERE b.empresa_id = 1 AND b.referencia IS NOT NULL
GROUP BY b.banco, b.referencia HAVING COUNT(DISTINCT b.entidad_id) > 1;

-- 6.5 Higiene: `referencia` que parece un número bancario COMPLETO (6 o más dígitos seguidos). Esperado: 0 filas.
SELECT b.id, b.entidad_id, b.banco, b.alias, 'referencia con numero largo: debe ser solo ultimos 4' AS problema
FROM u611730801_Plataforma.cont_cuentas_bancarias b
WHERE b.empresa_id = 1 AND b.referencia REGEXP '[0-9]{6,}';

-- ───────────────────────── 7. Mezcla KT / Mónaco (integridad cruzada) ────────────────────────────────────────────
-- Esperado: 0 filas en cada bloque. Las FKs compuestas lo impiden; se verifica por si hubiera datos legados.
SELECT 'banco apunta a cuenta de OTRA entidad' AS problema, b.id AS id, b.entidad_id, c.entidad_id AS cuenta_entidad_id
FROM u611730801_Plataforma.cont_cuentas_bancarias b JOIN u611730801_Plataforma.cont_cuentas c ON c.id = b.cuenta_id
WHERE b.empresa_id = 1 AND (c.entidad_id <> b.entidad_id OR c.empresa_id <> b.empresa_id)
UNION ALL
SELECT 'cuenta con entidad_id NULL (legado)', c.id, NULL, NULL
FROM u611730801_Plataforma.cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id IS NULL;

SET @q := IF(@existe_roles = 1,
  'SELECT ''rol apunta a cuenta de OTRA entidad/empresa'' AS problema, r.id AS id, r.entidad_id, c.entidad_id AS cuenta_entidad_id
   FROM u611730801_Plataforma.cont_cuentas_rol r JOIN u611730801_Plataforma.cont_cuentas c ON c.id = r.cuenta_id
   WHERE r.empresa_id = 1 AND (c.entidad_id <> r.entidad_id OR c.empresa_id <> r.empresa_id)
   UNION ALL
   SELECT ''rol activo apunta a cuenta INACTIVA'', r.id, r.entidad_id, c.entidad_id
   FROM u611730801_Plataforma.cont_cuentas_rol r JOIN u611730801_Plataforma.cont_cuentas c ON c.id = r.cuenta_id
   WHERE r.empresa_id = 1 AND r.activa = 1 AND c.activa <> 1',
  'SELECT ''Sin tabla de roles: nada que cruzar'' AS problema, NULL AS id, NULL AS entidad_id, NULL AS cuenta_entidad_id');
PREPARE q FROM @q; EXECUTE q; DEALLOCATE PREPARE q;

-- El MISMO código existe en ambas entidades por diseño (Milenium comparte códigos). Informativo: son FILAS distintas
-- (ids distintos) y deben resolverse SIEMPRE por empresa_id + entidad_id + codigo.
SELECT k.codigo, k.id AS id_kt, m.id AS id_monaco, IF(k.id = m.id, 'MISMA FILA - ERROR', 'filas distintas (esperado)') AS estado
FROM u611730801_Plataforma.cont_cuentas k
JOIN u611730801_Plataforma.cont_cuentas m ON m.empresa_id = k.empresa_id AND m.codigo = k.codigo AND m.entidad_id = 2
WHERE k.empresa_id = 1 AND k.entidad_id = 1
ORDER BY k.codigo;

-- ───────────────────────── 8. Compuerta de la carga de roles ─────────────────────────────────────────────────────
-- Una fila: lista para cargar roles solo si las 14 cuentas existen activas con su tipo y no hay roles previos distintos.
WITH esperado AS (
  SELECT 1 AS entidad_id, '11203001' AS codigo, 'Activo' AS tipo UNION ALL SELECT 1, '21401001', 'Pasivo'
  UNION ALL SELECT 1, '41101003', 'Ingreso' UNION ALL SELECT 1, '11302005', 'Activo' UNION ALL SELECT 1, '21302001', 'Pasivo'
  UNION ALL SELECT 1, '11101002', 'Activo' UNION ALL SELECT 1, '41501002', 'Ingreso'
  UNION ALL SELECT 2, '11203001', 'Activo' UNION ALL SELECT 2, '21401001', 'Pasivo'
  UNION ALL SELECT 2, '41101003', 'Ingreso' UNION ALL SELECT 2, '11302005', 'Activo' UNION ALL SELECT 2, '21302001', 'Pasivo'
  UNION ALL SELECT 2, '11101002', 'Activo' UNION ALL SELECT 2, '41501002', 'Ingreso'
)
SELECT COUNT(*) AS roles_esperados,
       SUM(c.id IS NOT NULL AND c.activa = 1 AND c.tipo = e.tipo) AS cuentas_disponibles,
       @existe_roles AS tabla_roles_existe,
       CASE
         WHEN SUM(c.id IS NOT NULL AND c.activa = 1 AND c.tipo = e.tipo) <> COUNT(*)
           THEN 'NO APTO: faltan/difieren cuentas homologadas'
         WHEN @existe_roles = 1 THEN 'REVISAR: la tabla de roles ya existe (ver 3.1 y 4)'
         ELSE 'APTO: crear cont_cuentas_rol y cargar los 14 roles (con autorizacion)'
       END AS compuerta
FROM esperado e
LEFT JOIN u611730801_Plataforma.cont_cuentas c ON c.empresa_id = 1 AND c.entidad_id = e.entidad_id AND c.codigo = e.codigo;
