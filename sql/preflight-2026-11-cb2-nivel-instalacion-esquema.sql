-- VARIANTE CON ESQUEMA EXPLÍCITO del detector `preflight-2026-11-cb2-nivel-instalacion.sql` (SOLO LECTURA). Misma lógica, mismas firmas SHA-256, misma clasificación C/V/P y mismo comportamiento fail-closed;
-- la ÚNICA diferencia es que TODAS las consultas a information_schema filtran por `@esquema` en lugar de `DATABASE()`. Sirve cuando el cliente (p. ej. phpMyAdmin) ejecuta con `DATABASE()` = information_schema
-- u otro esquema distinto del de la aplicación, caso en que la versión original daría falsamente el nivel 0. NO ejecutado en producción: lo ejecuta el operador.
-- Uso: editar la línea SET de abajo con el nombre EXACTO de la base de la aplicación y ejecutar el archivo completo.
-- Guardas adicionales (fail-closed): si `@esquema` es NULL/vacío, no existe, es un esquema del sistema (information_schema, mysql, performance_schema, sys) o no contiene `flota_cb2_consumos`, el resultado es
-- `INCONSISTENTE` / `DETENER Y AUDITAR` con el motivo en `diagnostico_esquema`: NUNCA un nivel aparentemente válido (ni un falso nivel 0).
SET @esquema = 'u611730801_Plataforma';   -- ← nombre exacto de la base de la aplicación

-- SOLO LECTURA. Detector del NIVEL de instalación de la cadena CB2 de identidades externas. NO ejecutado en producción: lo ejecuta el operador, con la base ya seleccionada.
-- La cadena (cada paso exige el anterior y NO es idempotente: repetirlo falla por columna/restricción duplicada):
--   nivel 1 = sql/migrate-2026-11-cb2-terceros.sql                   (3 tablas flota_cb2_externos_* + columnas asociacion_externa_id/identidad_externa + vehiculo_id NULL + fk_cb2c_externo + ck_cb2c_unidad_tipo v1)
--   nivel 2 = sql/migrate-2026-11-cb2-terceros-directos.sql          (piloto_externo_id/unidad_externa_id + 2 FK + 2 índices + ck_cb2c_unidad_tipo v2)
--   nivel 3 = sql/migrate-2026-11-cb2-identidades-independientes.sql (ck_cb2_piloto_unico + ck_cb2c_unidad_tipo v3)
--   nivel 4 = sql/migrate-2026-11-cb2-piloto-reportado.sql           (ck_cb2_piloto_reportado + ck_cb2c_unidad_tipo v4)  [OPCIONAL]
-- MÉTODO (no se acredita nada por buscar subcadenas ni por contar objetos): cada objeto de la cadena se compara por FIRMA SHA-256 de su estructura REAL (tipo, nulabilidad y valor por defecto de columnas; índices; claves foráneas con
-- columnas, tabla/columnas referenciadas y reglas ON DELETE/UPDATE; CHECK con su texto completo; motor) contra la firma esperada de MariaDB 11.8.9 (CTE `esperado`, regenerada por la prueba con MariaDB real: si el SQL de una migración
-- cambia, la prueba falla). Cada nivel resulta C (completo y exacto), V (ausente por completo) o P (parcial/alterado). Solo estas secuencias son válidas: VVVV→0, CVVV→1, CCVV→2, CCCV→3, CCCC→4, y además la versión del CHECK
-- `ck_cb2c_unidad_tipo` debe coincidir con el nivel. CUALQUIER otra combinación (CHECK ausente, modificado o de otra versión; FK distinta; columna faltante o con otro tipo; objeto de un nivel superior presente a medias) o una versión
-- de MariaDB que normalice los textos de otra forma da `INCONSISTENTE` / `DETENER Y AUDITAR`: ante la duda NUNCA se propone un paso. En ese caso comparar `observada` contra `esperada` de la columna de hechos.
-- Resultado 1: filas `RESUMEN` (nivel, siguiente paso, secuencia por nivel, versión del CHECK de unidad) y filas `HECHO` por objeto (nivel, presente, ok, firma observada, firma esperada).
-- Resultado 2: prerrequisitos de la cadena y de los vínculos con fondos / tablas Shell. Resultado 3: definición vigente de los CHECK de consumos (guardarlos antes de cualquier ALTER).
-- BEGIN-CTE
WITH
 col AS (SELECT TABLE_NAME t, COLUMN_NAME c, ORDINAL_POSITION o, IS_NULLABLE nul,
   CONCAT(COLUMN_TYPE,'|',IS_NULLABLE,'|',IFNULL(COLUMN_DEFAULT,'~'),'|',IFNULL(CHARACTER_SET_NAME,''),'|',IFNULL(COLLATION_NAME,''),'|',EXTRA) f
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@esquema),
 idx AS (SELECT TABLE_NAME t, INDEX_NAME n, CONCAT(MAX(NON_UNIQUE),':',GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX),':',MAX(INDEX_TYPE)) f
  FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@esquema GROUP BY TABLE_NAME, INDEX_NAME),
 fk AS (SELECT x.t, x.n, CONCAT(x.cols,'->',x.rt,'(',x.rcols,')',x.reg) f FROM (
   SELECT k.TABLE_NAME t, k.CONSTRAINT_NAME n, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) cols, MAX(k.REFERENCED_TABLE_NAME) rt,
          GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) rcols, MAX(CONCAT(r.UPDATE_RULE,'/',r.DELETE_RULE)) reg
   FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
     ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
   WHERE k.CONSTRAINT_SCHEMA=@esquema AND k.REFERENCED_TABLE_NAME IS NOT NULL GROUP BY k.TABLE_NAME, k.CONSTRAINT_NAME) x),
 chk AS (SELECT TABLE_NAME t, CONSTRAINT_NAME n, CHECK_CLAUSE f FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=@esquema),
 tab AS (SELECT TABLE_NAME t, ENGINE e FROM information_schema.TABLES WHERE TABLE_SCHEMA=@esquema),
 esq AS (SELECT SCHEMA_NAME s FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=@esquema AND @esquema IS NOT NULL AND @esquema<>'' AND SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys')),
 obs AS (
  SELECT 1 nivel, CONCAT('tabla ',x.t) objeto, (SELECT COUNT(*) FROM tab WHERE t=x.t) presente,
   SHA2(CONCAT_WS('#',(SELECT e FROM tab WHERE t=x.t),(SELECT GROUP_CONCAT(c,':',f ORDER BY o SEPARATOR ';') FROM col WHERE t=x.t),(SELECT GROUP_CONCAT(n,':',f ORDER BY n SEPARATOR ';') FROM idx WHERE t=x.t),
     (SELECT GROUP_CONCAT(f ORDER BY f SEPARATOR ';') FROM fk WHERE t=x.t),(SELECT GROUP_CONCAT(f ORDER BY f SEPARATOR ';') FROM chk WHERE t=x.t)),256) firma
   FROM (SELECT 'flota_cb2_externos_pilotos' t UNION ALL SELECT 'flota_cb2_externos_unidades' UNION ALL SELECT 'flota_cb2_externos_asociaciones') x
  UNION ALL
  SELECT x.nivel, CONCAT('columna flota_cb2_consumos.',x.c), (SELECT COUNT(*) FROM col WHERE t='flota_cb2_consumos' AND c=x.c AND (x.c<>'vehiculo_id' OR nul='YES')),
   (SELECT SHA2(f,256) FROM col WHERE t='flota_cb2_consumos' AND c=x.c)
   FROM (SELECT 1 nivel,'asociacion_externa_id' c UNION ALL SELECT 1,'identidad_externa' UNION ALL SELECT 1,'vehiculo_id' UNION ALL SELECT 2,'piloto_externo_id' UNION ALL SELECT 2,'unidad_externa_id') x
  UNION ALL
  SELECT x.nivel, CONCAT('fk flota_cb2_consumos.',x.n), (SELECT COUNT(*) FROM fk WHERE t='flota_cb2_consumos' AND n=x.n), (SELECT SHA2(f,256) FROM fk WHERE t='flota_cb2_consumos' AND n=x.n)
   FROM (SELECT 1 nivel,'fk_cb2c_externo' n UNION ALL SELECT 2,'fk_cb2c_piloto_directo' UNION ALL SELECT 2,'fk_cb2c_unidad_directa') x
  UNION ALL
  SELECT 2, CONCAT('indice flota_cb2_consumos.',x.n), (SELECT COUNT(*) FROM idx WHERE t='flota_cb2_consumos' AND n=x.n), (SELECT SHA2(f,256) FROM idx WHERE t='flota_cb2_consumos' AND n=x.n)
   FROM (SELECT 'ix_cb2c_piloto_directo' n UNION ALL SELECT 'ix_cb2c_unidad_directa') x
  UNION ALL
  SELECT x.nivel, CONCAT('check flota_cb2_consumos.',x.n), (SELECT COUNT(*) FROM chk WHERE t='flota_cb2_consumos' AND n=x.n), (SELECT SHA2(f,256) FROM chk WHERE t='flota_cb2_consumos' AND n=x.n)
   FROM (SELECT 3 nivel,'ck_cb2_piloto_unico' n UNION ALL SELECT 4,'ck_cb2_piloto_reportado') x
  UNION ALL
  SELECT 0, 'check flota_cb2_consumos.ck_cb2c_unidad_tipo', (SELECT COUNT(*) FROM chk WHERE t='flota_cb2_consumos' AND n='ck_cb2c_unidad_tipo'), (SELECT SHA2(f,256) FROM chk WHERE t='flota_cb2_consumos' AND n='ck_cb2c_unidad_tipo')
 )
-- END-CTE
,
 esperado AS (
-- BEGIN-ESPERADO
  SELECT 'ck_cb2c_unidad_tipo v1' objeto, '3decc689823c75085f1f68421da8a46f86444c24f4e15e95fb77dcbd783f4722' firma
  UNION ALL SELECT 'columna flota_cb2_consumos.asociacion_externa_id', 'a5bbb08aaf289949461134e6a7d91c08a56967a55b2b8d38ba46dfbb6bcfe3c8'
  UNION ALL SELECT 'columna flota_cb2_consumos.identidad_externa', 'd12f902a6c9853c950d3377b5cf0abc8f49fd184fe26efca0a807b1b71dc3190'
  UNION ALL SELECT 'columna flota_cb2_consumos.vehiculo_id', 'a5bbb08aaf289949461134e6a7d91c08a56967a55b2b8d38ba46dfbb6bcfe3c8'
  UNION ALL SELECT 'fk flota_cb2_consumos.fk_cb2c_externo', '539a4e774c445fc6262fae75e1bc5a60483a3476d2fa0d15e422e48055769ac6'
  UNION ALL SELECT 'tabla flota_cb2_externos_asociaciones', 'a01e301fd012e794ba433a67cf30088c7da1ce276d8dde3c9b2b68c93e667bfd'
  UNION ALL SELECT 'tabla flota_cb2_externos_pilotos', '7321b3579d29d65a213a02ec75142531c9d13ffe52f8db317e26121bec26f8d5'
  UNION ALL SELECT 'tabla flota_cb2_externos_unidades', '59278315a80b304350f4023aef75a88250e442c655be817508f0b15073ad0ba0'
  UNION ALL SELECT 'ck_cb2c_unidad_tipo v2', '0f8d28ecab69cdad27581bae5f893ae7abdc4d5d957d9abd63d8a0a2297f4bdc'
  UNION ALL SELECT 'columna flota_cb2_consumos.piloto_externo_id', 'a5bbb08aaf289949461134e6a7d91c08a56967a55b2b8d38ba46dfbb6bcfe3c8'
  UNION ALL SELECT 'columna flota_cb2_consumos.unidad_externa_id', 'a5bbb08aaf289949461134e6a7d91c08a56967a55b2b8d38ba46dfbb6bcfe3c8'
  UNION ALL SELECT 'fk flota_cb2_consumos.fk_cb2c_piloto_directo', 'dd6a0bb2b50be18992e7daf5e95d515793811a17bbd9911f08fe4d4d97b1eeff'
  UNION ALL SELECT 'fk flota_cb2_consumos.fk_cb2c_unidad_directa', '56addde37832438bcd8ea664140f502aa1b40f9b9e45148d5e950a622b4c3bd3'
  UNION ALL SELECT 'indice flota_cb2_consumos.ix_cb2c_piloto_directo', '2e4cb3aab4410147097c0db4c8019260d03848692f094b03e07a4bcca5e24942'
  UNION ALL SELECT 'indice flota_cb2_consumos.ix_cb2c_unidad_directa', 'fe7e2b03af1b02ebbb0967be31e326a49116a4b771622bd4ad83c28c59588ab6'
  UNION ALL SELECT 'ck_cb2c_unidad_tipo v3', 'a016ce55e58339190282fde61746ddc0cd7c216c7d1fd4b4b8fcf08058ce4b11'
  UNION ALL SELECT 'check flota_cb2_consumos.ck_cb2_piloto_unico', '9cb6e121e9347f72bfae196a0adf79c3de2d2ae0d652d7b1fe634d737643d75f'
  UNION ALL SELECT 'ck_cb2c_unidad_tipo v4', '28781d771233313d4eb5566a36c334243dc2c6d2618e6a7eee6485e236599e1c'
  UNION ALL SELECT 'check flota_cb2_consumos.ck_cb2_piloto_reportado', 'fe346d20a395c985d664dd71c3d9290f48b0fd2b41bf5326f8fa37855af40093'
-- END-ESPERADO
 ),
 hechos AS (SELECT o.nivel, o.objeto, o.presente, COALESCE(o.firma=e.firma,0) ok, o.firma observada, e.firma esperada
  FROM obs o LEFT JOIN esperado e ON e.objeto=o.objeto WHERE o.nivel>0),
 version_ck AS (SELECT CASE WHEN o.presente=0 THEN 0 ELSE COALESCE((SELECT CAST(RIGHT(e.objeto,1) AS UNSIGNED) FROM esperado e WHERE e.objeto LIKE 'ck_cb2c_unidad_tipo v_' AND e.firma=o.firma),9) END v
  FROM obs o WHERE o.nivel=0),
 estado AS (SELECT nivel, CASE WHEN SUM(presente)=0 THEN 'V' WHEN SUM(ok)=COUNT(*) THEN 'C' ELSE 'P' END st FROM hechos GROUP BY nivel),
 secuencia AS (SELECT GROUP_CONCAT(st ORDER BY nivel SEPARATOR '') s FROM estado),
 resultado AS (SELECT s.s, v.v,
   (SELECT COUNT(*) FROM esq) AS esq_ok, (SELECT COUNT(*) FROM tab WHERE t='flota_cb2_consumos') AS base_ok,
   CASE WHEN (SELECT COUNT(*) FROM esq)=0 OR (SELECT COUNT(*) FROM tab WHERE t='flota_cb2_consumos')=0 THEN 'INCONSISTENTE' WHEN s.s='VVVV' AND v.v=0 THEN '0' WHEN s.s='CVVV' AND v.v=1 THEN '1' WHEN s.s='CCVV' AND v.v=2 THEN '2' WHEN s.s='CCCV' AND v.v=3 THEN '3' WHEN s.s='CCCC' AND v.v=4 THEN '4' ELSE 'INCONSISTENTE' END nivel_detectado
  FROM secuencia s, version_ck v)
SELECT 'RESUMEN' tipo, NULL nivel, 'nivel_detectado' objeto, NULL presente, NULL ok, r.nivel_detectado observada, NULL esperada FROM resultado r
UNION ALL SELECT 'RESUMEN', NULL, 'siguiente_paso', NULL, NULL,
  CASE r.nivel_detectado WHEN '0' THEN 'migrate-2026-11-cb2-terceros.sql' WHEN '1' THEN 'migrate-2026-11-cb2-terceros-directos.sql' WHEN '2' THEN 'migrate-2026-11-cb2-identidades-independientes.sql'
   WHEN '3' THEN 'OPCIONAL: migrate-2026-11-cb2-piloto-reportado.sql (nombre reportado sobre unidad externa)' WHEN '4' THEN 'NINGUNO: cadena completa' ELSE 'DETENER Y AUDITAR' END, NULL FROM resultado r
UNION ALL SELECT 'RESUMEN', NULL, 'diagnostico_esquema', NULL, NULL, CASE WHEN r.esq_ok=0 THEN 'ESQUEMA_NO_FIJADO_NO_EXISTE_O_NO_PERMITIDO' WHEN r.base_ok=0 THEN 'BASE_CB2_AUSENTE_EN_EL_ESQUEMA (flota_cb2_consumos no existe)' ELSE 'OK' END, NULL FROM resultado r
UNION ALL SELECT 'RESUMEN', NULL, 'esquema_analizado', NULL, NULL, @esquema, NULL FROM resultado r
UNION ALL SELECT 'RESUMEN', NULL, 'secuencia_por_nivel (C completo, V ausente, P parcial)', NULL, NULL, r.s, NULL FROM resultado r
UNION ALL SELECT 'RESUMEN', NULL, 'version_ck_unidad_tipo (0 ausente, 1-4 conocida, 9 desconocida)', NULL, NULL, CAST(r.v AS CHAR), NULL FROM resultado r
UNION ALL SELECT 'HECHO', h.nivel, h.objeto, h.presente, h.ok, h.observada, h.esperada FROM hechos h
ORDER BY (tipo='HECHO'), nivel, objeto;

-- Resultado 2: prerrequisitos (1 = presente).
SELECT
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@esquema AND TABLE_NAME='flota_cb2_consumos' AND ENGINE='InnoDB') AS consumos_innodb,
 (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@esquema AND TABLE_NAME='flota_cb2_consumos' AND INDEX_NAME='uq_cb2c_ambito' AND NON_UNIQUE=0) AS uq_cb2c_ambito,
 (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@esquema AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME IN ('empleado_id','revision_asignacion','producto_clasificado')) AS cols_asignacion_de_3,
 (SELECT COUNT(DISTINCT INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=@esquema AND TABLE_NAME='tms_solicitud_fondo_lineas' AND INDEX_NAME='uq_fondolin_c2a_empresa_id' AND NON_UNIQUE=0) AS uq_fondolin_c2a_empresa_id,
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@esquema AND TABLE_NAME IN ('flota_cb2_pilotos_reportados','flota_cb2_consumo_piloto_reportado','flota_cb2_pilotos_equivalencias')) AS tablas_shell_de_3,
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@esquema AND TABLE_NAME='flota_cb2_fondos_vinculos') AS fondos_vinculos;

-- Resultado 3: definiciones vigentes de CHECK (guardarlas antes de cambiar nada).
SELECT CONSTRAINT_NAME, CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=@esquema AND TABLE_NAME='flota_cb2_consumos' ORDER BY CONSTRAINT_NAME;
