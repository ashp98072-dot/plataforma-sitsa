-- CLIENTE-PORTAL-1B-CORRECCION-SCHEMA-PRODUCCION
--
-- CORRECTIVA. Lleva el esquema de producción del Portal del Cliente
-- desde el estado PARCIAL/PRE-HARDENING — verificado directamente en
-- producción el 2026-09-01 (ver DRIFT VERIFICADO más abajo y
-- docs/AUDITORIA-MIGRACIONES-ESTADO-REAL.md, sección "CLIENTE-PORTAL-1")
-- hasta el esquema final endurecido que ya vive en sql/schema.sql y fue
-- aprobado en el PR #167 (ajuste pre-merge, merge commit
-- 095c2b7e5e907436516968434f1ce354bfb13c52).
--
-- IMPORTANTE — qué SÍ y qué NO afirma esta migración sobre el origen de
-- ese estado: lo verificado es el ESTADO OBSERVABLE actual de producción
-- (estructura real de las tablas, vía SHOW/SELECT) — es consistente con
-- haber aplicado sql/migrate-2026-09-tms-portal-clientes-base.sql en una
-- forma anterior al ajuste pre-merge del PR #167 (esa es la única forma
-- documentada en este repositorio que produce exactamente esta
-- estructura). NO se afirma, porque no es observable desde aquí, CUÁNDO
-- se aplicó, QUIÉN lo hizo, ni mediante QUÉ mecanismo exacto (el archivo
-- completo, SQL manual equivalente, u otra vía) — ver
-- docs/AUDITORIA-MIGRACIONES-ESTADO-REAL.md para el registro completo de
-- esta distinción.
--
-- NO modifica ni reemplaza sql/migrate-2026-09-tms-portal-clientes-base.sql
-- — ese archivo queda tal cual, como historial del modelo objetivo que
-- el repositorio documentó desde el inicio. Esta migración es la
-- correctiva para instalaciones (como la producción real de SITSA) cuyo
-- esquema real hoy es consistente con la forma pre-hardening de ese
-- archivo, sin importar cómo llegaron a ese estado.
--
-- Nota aparte, importante para no confundir "corrección" con
-- "re-ejecución": volver a correr HOY sql/migrate-2026-09-tms-portal-clientes-base.sql
-- (que en `main` ya contiene el diseño final endurecido) NO repararía
-- este drift — sus `CREATE TABLE IF NOT EXISTS` son no-ops porque las 3
-- tablas ya existen, y sus 2 `ALTER` sobre `tms_clientes`/
-- `tms_planes_viaje` también son no-ops porque esos índices ya existen.
-- Ninguna de esas sentencias toca ni reemplaza las FK/índices internos
-- ya creados en las 3 tablas nuevas — por eso hace falta esta migración
-- correctiva aparte, con `DROP`/`ADD` explícitos.
--
-- ESTADO: MANUAL. NO se ejecuta automáticamente en runtime. NO se ha
-- ejecutado en ningún entorno (ni local ni producción) al momento de
-- crear este archivo.
--
-- DRIFT VERIFICADO EN PRODUCCIÓN (u611730801_Plataforma, 2026-09-01,
-- vía SHOW/SELECT directos — ver detalle completo en el ticket
-- CLIENTE-PORTAL-1B-CORRECCION-SCHEMA-PRODUCCION):
--  - tms_cliente_usuarios, tms_solicitudes_cliente, tms_solicitud_paradas
--    YA EXISTEN y están VACÍAS (0 filas cada una).
--  - tms_clientes.uq_tmsclientes_empresa_id y
--    tms_planes_viaje.uq_tmsplanes_empresa_id YA EXISTEN — esta
--    migración NO los vuelve a crear.
--  - Las 3 tablas nuevas tienen la forma PRE-HARDENING: FKs simples
--    (fk_tmssolicli_usuario, fk_tmssolicli_plan, fk_tmssolpar_solicitud)
--    e índices sin el prefijo empresa_id que sí tiene sql/schema.sql hoy.
--
-- SEGURA DE EJECUTAR TANTO SOBRE (A) el esquema parcial arriba descrito
-- COMO SOBRE (B) el esquema final ya endurecido (por ejemplo, si esta
-- migración se ejecutara por error una segunda vez, o en un entorno que
-- ya se creó directamente con sql/schema.sql actual): cada ALTER de
-- abajo primero COMPRUEBA LA COMPOSICIÓN REAL del índice/FK existente
-- (columnas exactas Y, cuando aplica, que sea realmente UNIQUE) contra
-- information_schema, y solo actúa si esa composición NO es ya la final
-- esperada — "existe un objeto con este nombre" NUNCA se acepta por sí
-- solo como "ya tiene la forma correcta"; si el nombre existiera con
-- otra composición, se elimina primero y se recrea, en vez de aceptarlo
-- silenciosamente.
--
-- Límite honesto de esta garantía: 2 de las UNIQUE nuevas
-- (uq_tmscliusr_empresa_cliente_id en tms_cliente_usuarios,
-- uq_tmssolicli_empresa_id en tms_solicitudes_cliente) son el destino de
-- una FK compuesta creada MÁS ADELANTE en este mismo script, en OTRA
-- tabla. En una ejecución normal esto nunca es un problema (cada UNIQUE
-- se deja en su forma correcta antes de que la FK que depende de ella
-- se cree). Pero si esta migración se ejecutara una tercera vez o más,
-- sobre un estado ya intervenido a mano de forma inconsistente, y el
-- chequeo de composición de una de esas 2 UNIQUE detectara una
-- composición incorrecta con la FK compuesta de la otra tabla ya
-- creada, el `DROP INDEX` correspondiente fallaría con un error de
-- InnoDB (índice requerido por una FK externa) — a propósito NO se
-- construye aquí un DROP en cascada de FKs de otras tablas para cubrir
-- ese caso extremo: es preferible que el script falle de forma visible
-- y clara en phpMyAdmin, y que un humano revise el estado real con las
-- consultas de la SECCIÓN 4, antes que automatizar una cascada de DROPs
-- entre tablas dentro de un script ya de por sí complejo.
--
-- ORDEN DE DESPLIEGUE:
--   1) Ejecutar la SECCIÓN 0 (prechequeos, solo lectura) y REVISAR A
--      MANO cada resultado. Esta migración NO aborta sola: es
--      responsabilidad de quien la ejecuta detenerse si algo no
--      coincide con lo esperado (mismo criterio ya usado en todo
--      sql/*.sql de este proyecto — ejecución manual revisada, sin CI).
--   2) Si todo lo de la SECCIÓN 0 es lo esperado, ejecutar las SECCIONES
--      1-3 completas, en orden, en una sola sesión (phpMyAdmin o
--      cliente equivalente). El orden entre secciones importa: cada
--      tabla necesita que la UNIQUE/FK de la tabla anterior ya exista
--      antes de poder referenciarla con una FK compuesta.
--   3) Ejecutar la SECCIÓN 4 (post-verificación) y confirmar que
--      devuelve exactamente lo documentado ahí.
--
-- ROLLBACK: solo documental, no se automatiza. Mientras las 3 tablas
-- sigan vacías (cierto en producción al momento de escribir esto),
-- revertir a la forma pre-hardening es seguro con (orden inverso: FKs
-- nuevas primero, luego índices, luego FKs viejas de vuelta):
--   ALTER TABLE tms_solicitud_paradas DROP FOREIGN KEY fk_tmssolpar_empresa_solicitud;
--   ALTER TABLE tms_solicitud_paradas DROP INDEX idx_tmssolpar_solicitud;
--   ALTER TABLE tms_solicitud_paradas ADD INDEX idx_tmssolpar_solicitud (solicitud_id, orden);
--   ALTER TABLE tms_solicitud_paradas ADD CONSTRAINT fk_tmssolpar_solicitud
--     FOREIGN KEY (solicitud_id) REFERENCES tms_solicitudes_cliente(id) ON DELETE CASCADE;
--   ALTER TABLE tms_solicitudes_cliente DROP FOREIGN KEY fk_tmssolicli_usuario;
--   ALTER TABLE tms_solicitudes_cliente DROP FOREIGN KEY fk_tmssolicli_plan;
--   ALTER TABLE tms_solicitudes_cliente DROP INDEX idx_tmssolicli_usuario;
--   ALTER TABLE tms_solicitudes_cliente ADD INDEX idx_tmssolicli_usuario (creado_por_usuario_cliente_id);
--   ALTER TABLE tms_solicitudes_cliente DROP INDEX uq_tmssolicli_plan;
--   ALTER TABLE tms_solicitudes_cliente ADD UNIQUE KEY uq_tmssolicli_plan (plan_id);
--   ALTER TABLE tms_solicitudes_cliente DROP INDEX uq_tmssolicli_empresa_id;
--   ALTER TABLE tms_solicitudes_cliente ADD CONSTRAINT fk_tmssolicli_usuario
--     FOREIGN KEY (creado_por_usuario_cliente_id) REFERENCES tms_cliente_usuarios(id) ON DELETE RESTRICT;
--   ALTER TABLE tms_solicitudes_cliente ADD CONSTRAINT fk_tmssolicli_plan
--     FOREIGN KEY (plan_id) REFERENCES tms_planes_viaje(id) ON DELETE SET NULL;
--   ALTER TABLE tms_cliente_usuarios DROP INDEX uq_tmscliusr_empresa_cliente_id;

SET NAMES utf8mb4;
SET @db := DATABASE();

-- ============================================================
-- SECCIÓN 0 — PRECHEQUEOS DE SOLO LECTURA. Ninguna de estas consultas
-- modifica datos. Revisar A MANO antes de continuar con la SECCIÓN 1.
-- ============================================================

-- 0a) Conteo de filas — en producción (verificado 2026-09-01) las 3 son
-- 0. DETENTE Y REVISA SIN EJECUTAR EL RESTO SI CUALQUIERA ES > 0: esta
-- migración fue diseñada para tablas vacías. Con filas reales, un
-- ADD FOREIGN KEY nuevo (SECCIONES 1-3) puede fallar si ya existe algún
-- cruce de tenant (ver 0b/0c/0d) — mejor descubrirlo aquí, en una
-- consulta de solo lectura, que a mitad de un ALTER.
SELECT
  (SELECT COUNT(*) FROM tms_cliente_usuarios)    AS filas_tms_cliente_usuarios,
  (SELECT COUNT(*) FROM tms_solicitudes_cliente)  AS filas_tms_solicitudes_cliente,
  (SELECT COUNT(*) FROM tms_solicitud_paradas)    AS filas_tms_solicitud_paradas;

-- 0b) Ninguna solicitud debe cruzar empresa/cliente respecto a su
-- usuario creador (lo que la nueva FK compuesta fk_tmssolicli_usuario va
-- a exigir). DETENTE SI DEVUELVE ALGUNA FILA — con 0 filas en las 3
-- tablas (estado real verificado) esto es vacío de forma trivial; se
-- incluye para que la migración siga siendo segura de ejecutar más
-- adelante, si para entonces ya hubiera solicitudes reales.
SELECT s.id, s.empresa_id, s.cliente_id, s.creado_por_usuario_cliente_id,
       u.empresa_id AS usuario_empresa_id, u.cliente_id AS usuario_cliente_id
FROM tms_solicitudes_cliente s
JOIN tms_cliente_usuarios u ON u.id = s.creado_por_usuario_cliente_id
WHERE u.empresa_id <> s.empresa_id OR u.cliente_id <> s.cliente_id;

-- 0c) Ninguna solicitud debe cruzar empresa respecto al plan que tenga
-- enlazado (lo que la nueva FK compuesta fk_tmssolicli_plan va a
-- exigir). DETENTE SI DEVUELVE ALGUNA FILA.
SELECT s.id, s.empresa_id, s.plan_id, p.empresa_id AS plan_empresa_id
FROM tms_solicitudes_cliente s
JOIN tms_planes_viaje p ON p.id = s.plan_id
WHERE s.plan_id IS NOT NULL AND p.empresa_id <> s.empresa_id;

-- 0d) Ninguna parada debe cruzar empresa respecto a su solicitud (lo que
-- la nueva FK compuesta fk_tmssolpar_empresa_solicitud va a exigir).
-- DETENTE SI DEVUELVE ALGUNA FILA.
SELECT pp.id, pp.empresa_id, pp.solicitud_id, s.empresa_id AS solicitud_empresa_id
FROM tms_solicitud_paradas pp
JOIN tms_solicitudes_cliente s ON s.id = pp.solicitud_id
WHERE pp.empresa_id <> s.empresa_id;

-- ============================================================
-- SECCIÓN 1 — tms_cliente_usuarios
-- Falta: UNIQUE uq_tmscliusr_empresa_cliente_id (empresa_id, cliente_id, id).
-- Es ADITIVA en el caso esperado (no reemplaza ni renombra nada
-- existente) — sus FKs actuales (empresa_id -> empresas;
-- (empresa_id,cliente_id) -> tms_clientes) ya coinciden con el diseño
-- final, confirmado en el drift del ticket, así que no se tocan.
--
-- AJUSTE PRE-MERGE PR #168 (punto 1): "existe un índice con este
-- nombre" NUNCA se acepta por sí solo como "ya está correcto" — se
-- comprueba la COMPOSICIÓN EXACTA (columnas Y que sea realmente UNIQUE,
-- NON_UNIQUE=0) contra information_schema. Si existiera con este mismo
-- nombre pero con otra composición (escenario no esperado hoy, pero
-- este archivo no debe confiar en el nombre a ciegas — es justamente el
-- destino de una FK compuesta en la SECCIÓN 2), se elimina primero y se
-- recrea con la forma correcta, en vez de aceptarlo silenciosamente.
SET @comp := (
  SELECT CONCAT(
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ','),
    '|unique=', MAX(NON_UNIQUE)
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_cliente_usuarios'
    AND INDEX_NAME = 'uq_tmscliusr_empresa_cliente_id'
  GROUP BY INDEX_NAME
);
SET @sql := IF(@comp IS NOT NULL AND @comp <> 'empresa_id,cliente_id,id|unique=0',
  'ALTER TABLE tms_cliente_usuarios DROP INDEX uq_tmscliusr_empresa_cliente_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_cliente_usuarios'
    AND INDEX_NAME = 'uq_tmscliusr_empresa_cliente_id'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE tms_cliente_usuarios ADD UNIQUE KEY uq_tmscliusr_empresa_cliente_id (empresa_id, cliente_id, id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- SECCIÓN 2 — tms_solicitudes_cliente
--
-- Orden dentro de esta sección (obligatorio, InnoDB lo exige): primero
-- se eliminan las FKs viejas que dependen de los índices a modificar
-- (un índice no se puede DROP/recrear mientras una FK todavía lo
-- necesita); después se ajustan los índices; al final se crean las FKs
-- compuestas nuevas (que a su vez necesitan que
-- uq_tmscliusr_empresa_cliente_id de la SECCIÓN 1 y
-- uq_tmsplanes_empresa_id — ya existente en producción — estén listos).
-- ============================================================

-- 2.1) DROP fk_tmssolicli_usuario SOLO si su composición actual es la
-- vieja (simple, creado_por_usuario_cliente_id -> tms_cliente_usuarios(id)).
-- Si ya es la compuesta final, o si no existe, no hace nada.
SET @sig := (
  SELECT CONCAT(
    GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ','),
    '->', MAX(REFERENCED_TABLE_NAME), '(',
    GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ','), ')'
  )
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_cliente'
    AND CONSTRAINT_NAME = 'fk_tmssolicli_usuario' AND REFERENCED_TABLE_NAME IS NOT NULL
  GROUP BY CONSTRAINT_NAME
);
SET @sql := IF(@sig IS NOT NULL
    AND @sig <> 'empresa_id,cliente_id,creado_por_usuario_cliente_id->tms_cliente_usuarios(empresa_id,cliente_id,id)',
  'ALTER TABLE tms_solicitudes_cliente DROP FOREIGN KEY fk_tmssolicli_usuario',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.2) DROP fk_tmssolicli_plan SOLO si su composición actual es la vieja
-- (simple, plan_id -> tms_planes_viaje(id)). Si ya es la compuesta
-- final, o si no existe, no hace nada.
SET @sig := (
  SELECT CONCAT(
    GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ','),
    '->', MAX(REFERENCED_TABLE_NAME), '(',
    GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ','), ')'
  )
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_cliente'
    AND CONSTRAINT_NAME = 'fk_tmssolicli_plan' AND REFERENCED_TABLE_NAME IS NOT NULL
  GROUP BY CONSTRAINT_NAME
);
SET @sql := IF(@sig IS NOT NULL
    AND @sig <> 'empresa_id,plan_id->tms_planes_viaje(empresa_id,id)',
  'ALTER TABLE tms_solicitudes_cliente DROP FOREIGN KEY fk_tmssolicli_plan',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.3) uq_tmssolicli_plan: DROP solo si su composición es la vieja
-- (plan_id a secas) — con las FKs ya fuera del camino (2.2), este
-- índice queda libre para modificarse.
--
-- AJUSTE PRE-MERGE PR #168 (punto 1): además de las columnas, se
-- comprueba que sea realmente UNIQUE (NON_UNIQUE=0) — un índice normal
-- (no único) con este mismo nombre y estas mismas columnas NO debe
-- aceptarse como si ya fuera la restricción correcta.
SET @comp := (
  SELECT CONCAT(
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ','),
    '|unique=', MAX(NON_UNIQUE)
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_cliente'
    AND INDEX_NAME = 'uq_tmssolicli_plan'
  GROUP BY INDEX_NAME
);
SET @sql := IF(@comp IS NOT NULL AND @comp <> 'empresa_id,plan_id|unique=0',
  'ALTER TABLE tms_solicitudes_cliente DROP INDEX uq_tmssolicli_plan',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
-- Recrea con la composición final SOLO si ahora falta (index recién
-- eliminado en el paso anterior, o nunca existió).
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_cliente'
    AND INDEX_NAME = 'uq_tmssolicli_plan'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE tms_solicitudes_cliente ADD UNIQUE KEY uq_tmssolicli_plan (empresa_id, plan_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.4) idx_tmssolicli_usuario: DROP solo si su composición es la vieja
-- (creado_por_usuario_cliente_id a secas).
SET @comp := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_cliente'
    AND INDEX_NAME = 'idx_tmssolicli_usuario'
  GROUP BY INDEX_NAME
);
SET @sql := IF(@comp IS NOT NULL AND @comp <> 'empresa_id,cliente_id,creado_por_usuario_cliente_id',
  'ALTER TABLE tms_solicitudes_cliente DROP INDEX idx_tmssolicli_usuario',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_cliente'
    AND INDEX_NAME = 'idx_tmssolicli_usuario'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE tms_solicitudes_cliente ADD INDEX idx_tmssolicli_usuario (empresa_id, cliente_id, creado_por_usuario_cliente_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.5) uq_tmssolicli_empresa_id (empresa_id, id): no existe en el
-- esquema pre-hardening — aditiva en el caso esperado. Es el destino
-- que necesitará la FK compuesta de tms_solicitud_paradas en la
-- SECCIÓN 3, así que (AJUSTE PRE-MERGE PR #168, punto 1) se verifica
-- composición exacta (columnas + NON_UNIQUE=0), igual que en 2.3/1: si
-- el nombre existiera con otra composición, se elimina y se recrea en
-- vez de aceptarlo por nombre.
SET @comp := (
  SELECT CONCAT(
    GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ','),
    '|unique=', MAX(NON_UNIQUE)
  )
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_cliente'
    AND INDEX_NAME = 'uq_tmssolicli_empresa_id'
  GROUP BY INDEX_NAME
);
SET @sql := IF(@comp IS NOT NULL AND @comp <> 'empresa_id,id|unique=0',
  'ALTER TABLE tms_solicitudes_cliente DROP INDEX uq_tmssolicli_empresa_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_cliente'
    AND INDEX_NAME = 'uq_tmssolicli_empresa_id'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE tms_solicitudes_cliente ADD UNIQUE KEY uq_tmssolicli_empresa_id (empresa_id, id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.6) Recrea fk_tmssolicli_usuario en su forma COMPUESTA final, SOLO
-- si no existe ya con esa composición (verificado por nombre — a estas
-- alturas del script, si el nombre existe, ya pasó por 2.1 y por tanto
-- solo puede ser la forma correcta, nunca la vieja).
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_cliente'
    AND CONSTRAINT_NAME = 'fk_tmssolicli_usuario' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE tms_solicitudes_cliente
     ADD CONSTRAINT fk_tmssolicli_usuario
     FOREIGN KEY (empresa_id, cliente_id, creado_por_usuario_cliente_id)
     REFERENCES tms_cliente_usuarios(empresa_id, cliente_id, id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2.7) Recrea fk_tmssolicli_plan en su forma COMPUESTA final, SOLO si no
-- existe ya (mismo razonamiento que 2.6). ON DELETE RESTRICT — NO
-- SET NULL: una FK compuesta que incluye empresa_id (NOT NULL en esta
-- tabla) no puede usar SET NULL, MySQL/MariaDB la rechazaría al crearla.
-- RESTRICT es seguro: tms_planes_viaje nunca se borra físicamente en
-- este proyecto (solo cambia de estado).
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'tms_solicitudes_cliente'
    AND CONSTRAINT_NAME = 'fk_tmssolicli_plan' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE tms_solicitudes_cliente
     ADD CONSTRAINT fk_tmssolicli_plan
     FOREIGN KEY (empresa_id, plan_id)
     REFERENCES tms_planes_viaje(empresa_id, id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- SECCIÓN 3 — tms_solicitud_paradas
-- ============================================================

-- 3.1) DROP fk_tmssolpar_solicitud (nombre VIEJO, se retira — el
-- reemplazo compuesto usa un nombre nuevo, fk_tmssolpar_empresa_solicitud,
-- igual que en sql/schema.sql). Solo actúa si esta FK todavía existe.
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'tms_solicitud_paradas'
    AND CONSTRAINT_NAME = 'fk_tmssolpar_solicitud' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@fk_exists > 0,
  'ALTER TABLE tms_solicitud_paradas DROP FOREIGN KEY fk_tmssolpar_solicitud',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.2) idx_tmssolpar_solicitud: DROP solo si su composición es la vieja
-- (solicitud_id, orden — sin empresa_id).
SET @comp := (
  SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_solicitud_paradas'
    AND INDEX_NAME = 'idx_tmssolpar_solicitud'
  GROUP BY INDEX_NAME
);
SET @sql := IF(@comp IS NOT NULL AND @comp <> 'empresa_id,solicitud_id,orden',
  'ALTER TABLE tms_solicitud_paradas DROP INDEX idx_tmssolpar_solicitud',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_solicitud_paradas'
    AND INDEX_NAME = 'idx_tmssolpar_solicitud'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE tms_solicitud_paradas ADD INDEX idx_tmssolpar_solicitud (empresa_id, solicitud_id, orden)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3.3) fk_tmssolpar_empresa_solicitud (nombre NUEVO, no existía antes
-- bajo ningún nombre en esta forma compuesta). fk_tmssolpar_empresa
-- (empresa_id -> empresas(id)) NO se toca — ya es correcta.
--
-- AJUSTE PRE-MERGE PR #168 (punto 1): aunque el nombre es nuevo (no hay
-- una forma "vieja" con este mismo nombre que reemplazar, a diferencia
-- de fk_tmssolicli_usuario/fk_tmssolicli_plan), tampoco aquí se acepta
-- "el nombre existe" como prueba de que la firma sea la correcta —
-- mismo criterio de composición exacta que en 2.1/2.2, por si este
-- nombre ya existiera con otra firma por cualquier motivo no previsto.
SET @sig := (
  SELECT CONCAT(
    GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ','),
    '->', MAX(REFERENCED_TABLE_NAME), '(',
    GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ','), ')'
  )
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_solicitud_paradas'
    AND CONSTRAINT_NAME = 'fk_tmssolpar_empresa_solicitud' AND REFERENCED_TABLE_NAME IS NOT NULL
  GROUP BY CONSTRAINT_NAME
);
SET @sql := IF(@sig IS NOT NULL
    AND @sig <> 'empresa_id,solicitud_id->tms_solicitudes_cliente(empresa_id,id)',
  'ALTER TABLE tms_solicitud_paradas DROP FOREIGN KEY fk_tmssolpar_empresa_solicitud',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'tms_solicitud_paradas'
    AND CONSTRAINT_NAME = 'fk_tmssolpar_empresa_solicitud' AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE tms_solicitud_paradas
     ADD CONSTRAINT fk_tmssolpar_empresa_solicitud
     FOREIGN KEY (empresa_id, solicitud_id)
     REFERENCES tms_solicitudes_cliente(empresa_id, id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ============================================================
-- SECCIÓN 4 — POST-VERIFICACIÓN (ejecutar después, revisar a mano —
-- ninguna de estas consultas modifica datos)
-- ============================================================

-- 4a) tms_cliente_usuarios: debe existir, además de PRIMARY(id) y
-- UNIQUE(email), la UNIQUE compuesta nueva:
SHOW INDEX FROM tms_cliente_usuarios WHERE Key_name = 'uq_tmscliusr_empresa_cliente_id';

-- 4b) tms_solicitudes_cliente: deben existir las 2 UNIQUE y el INDEX
-- con la composición final:
SHOW INDEX FROM tms_solicitudes_cliente WHERE Key_name IN
  ('uq_tmssolicli_empresa_id', 'uq_tmssolicli_plan', 'idx_tmssolicli_usuario');

-- 4c) tms_solicitud_paradas: debe existir el INDEX con la composición
-- final:
SHOW INDEX FROM tms_solicitud_paradas WHERE Key_name = 'idx_tmssolpar_solicitud';

-- 4d) Las 3 FKs compuestas nuevas — confirmar en el resultado que cada
-- una lista TODAS sus columnas (no solo una) y las columnas
-- referenciadas correctas:
SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, ORDINAL_POSITION,
       REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = @db
  AND CONSTRAINT_NAME IN ('fk_tmssolicli_usuario', 'fk_tmssolicli_plan', 'fk_tmssolpar_empresa_solicitud')
ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;

-- Esperado en 4d (una fila por columna, en este orden):
--  fk_tmssolicli_usuario   -> empresa_id, cliente_id, creado_por_usuario_cliente_id
--                              -> tms_cliente_usuarios(empresa_id, cliente_id, id)
--  fk_tmssolicli_plan      -> empresa_id, plan_id
--                              -> tms_planes_viaje(empresa_id, id)
--  fk_tmssolpar_empresa_solicitud -> empresa_id, solicitud_id
--                              -> tms_solicitudes_cliente(empresa_id, id)

-- 4e) Confirmar que el nombre viejo ya no existe (debe devolver 0
-- filas):
SELECT COUNT(*) AS fk_vieja_aun_presente
FROM information_schema.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = @db AND TABLE_NAME = 'tms_solicitud_paradas'
  AND CONSTRAINT_NAME = 'fk_tmssolpar_solicitud' AND CONSTRAINT_TYPE = 'FOREIGN KEY';

-- 4f) Confirmar que las 3 tablas siguen vacías (esta migración nunca
-- inserta, borra ni modifica filas — solo estructura):
SELECT
  (SELECT COUNT(*) FROM tms_cliente_usuarios)    AS filas_tms_cliente_usuarios,
  (SELECT COUNT(*) FROM tms_solicitudes_cliente)  AS filas_tms_solicitudes_cliente,
  (SELECT COUNT(*) FROM tms_solicitud_paradas)    AS filas_tms_solicitud_paradas;
