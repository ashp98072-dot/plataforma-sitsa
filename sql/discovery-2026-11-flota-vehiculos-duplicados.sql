-- DISCOVERY DE VEHÍCULOS DUPLICADOS POR PLACA — SOLO LECTURA (SELECT y PREPARE de SELECT). No modifica datos, esquema ni IDs.
-- Uso: phpMyAdmin → pestaña SQL. Edita SOLO las tres variables de «Parámetros».
-- ESQUEMA: TODAS las consultas leen exclusivamente la base indicada en @db (= @esquema, o DATABASE() si @esquema es NULL), aunque la base activa sea otra
-- (p. ej. information_schema en phpMyAdmin). Las tablas se califican como `base`.`tabla`; un esquema inexistente o con nombre no válido devuelve una fila ESQUEMA_INVALIDO y ningún dato.
-- Cada consulta es independiente; ejecuta en orden y guarda los resultados como evidencia para la revisión.

-- ===== Parámetros =====
SET @esquema = NULL;                 -- NULL = base seleccionada (DATABASE()); o el nombre de la base, p. ej. 'u611730801_Plataforma'
SET @ids = '2,3,6';                  -- IDs a inspeccionar (duplicados y candidato a canónico), solo dígitos y comas, sin espacios
SET @empresa = NULL;                 -- NULL = todas las empresas; o el ID de una empresa
SET @db = COALESCE(@esquema, DATABASE());
SET SESSION group_concat_max_len = 1000000;
-- Validación: nombre seguro, esquema existente, IDs numéricos y empresa numérica (todo lo que se concatena en SQL dinámico pasa por aquí).
SET @ok = IFNULL(@db REGEXP '^[A-Za-z0-9_]+$' AND EXISTS(SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = @db) AND @ids REGEXP '^[0-9]+(,[0-9]+)*$' AND (@empresa IS NULL OR @empresa REGEXP '^[0-9]+$'), 0);
SET @invalido = 'SELECT ''ESQUEMA_INVALIDO'' AS error, ''Revisa @esquema (solo letras, dígitos y _; debe existir), @ids (dígitos separados por coma) y @empresa (número o NULL)'' AS detalle';
SET @v = CONCAT('`', @db, '`.flota_vehiculos');
SET @filtro_empresa = IF(@empresa IS NULL, '1=1', CONCAT('v.empresa_id=', @empresa));
SET @norm_v = 'UPPER(REPLACE(REPLACE(REPLACE(REPLACE(v.placa,'' '',''''),''-'',''''),''–'',''''),''—'',''''))';

-- ===== 1. Placas duplicadas por EMPRESA (misma normalización que la aplicación: sin espacios ni guiones, mayúsculas) =====
-- Vehículos de empresas distintas con la misma placa NO se agrupan.
SET @q = IF(@ok, CONCAT('SELECT v.empresa_id, ', @norm_v, ' AS placa_normalizada, COUNT(*) AS vehiculos, GROUP_CONCAT(v.id ORDER BY v.id) AS ids, ',
  'GROUP_CONCAT(CONCAT(''«'',v.placa,''»'') ORDER BY v.id SEPARATOR '' | '') AS placas_originales, GROUP_CONCAT(CONCAT(v.estado,''/activo='',v.activo) ORDER BY v.id SEPARATOR '' | '') AS estados ',
  'FROM ', @v, ' v WHERE ', @filtro_empresa, ' GROUP BY v.empresa_id, placa_normalizada HAVING COUNT(*) > 1 ORDER BY v.empresa_id, placa_normalizada'), @invalido);
PREPARE s1 FROM @q; EXECUTE s1; DEALLOCATE PREPARE s1;

-- ===== 2. Atributos de los vehículos inspeccionados (compara empresa, tipo, marca, modelo, chasis, estado, km, taller, etc.) =====
SET @q = IF(@ok, CONCAT('SELECT v.* FROM ', @v, ' v WHERE FIND_IN_SET(v.id, ''', @ids, ''') ORDER BY v.id'), @invalido);
PREPARE s2 FROM @q; EXECUTE s2; DEALLOCATE PREPARE s2;

-- ===== 3. Disponibilidad del ID candidato y siguiente AUTO_INCREMENT (nunca se asume que un ID está libre) =====
SET @q = IF(@ok, CONCAT('SELECT x.id AS id_consultado, (v.id IS NOT NULL) AS ocupado, v.empresa_id, v.placa, v.estado, v.activo, ',
  '(SELECT t.AUTO_INCREMENT FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA=''', @db, ''' AND t.TABLE_NAME=''flota_vehiculos'') AS siguiente_auto_increment, (SELECT MAX(m.id) FROM ', @v, ' m) AS id_maximo ',
  'FROM (SELECT CAST(j.valor AS UNSIGNED) AS id FROM (SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(''', @ids, ''', '','', n.n), '','', -1) AS valor FROM ',
  '(SELECT 1 n UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8) n WHERE n.n <= 1 + LENGTH(''', @ids, ''') - LENGTH(REPLACE(''', @ids, ''', '','', ''''))) j) x ',
  'LEFT JOIN ', @v, ' v ON v.id = x.id ORDER BY x.id'), @invalido);
PREPARE s3 FROM @q; EXECUTE s3; DEALLOCATE PREPARE s3;

-- ===== 4. Inventario de columnas que pueden referenciar vehículos (FK declaradas y referencias sin FK) — information_schema filtrado por @db =====
SELECT c.TABLE_NAME AS tabla, c.COLUMN_NAME AS columna, t.ENGINE AS motor, t.TABLE_TYPE AS tipo,
       EXISTS(SELECT 1 FROM information_schema.COLUMNS e WHERE e.TABLE_SCHEMA=c.TABLE_SCHEMA AND e.TABLE_NAME=c.TABLE_NAME AND e.COLUMN_NAME='empresa_id') AS tiene_empresa_id,
       (SELECT GROUP_CONCAT(CONCAT(k.CONSTRAINT_NAME,' → ',k.REFERENCED_TABLE_NAME,'(',k.REFERENCED_COLUMN_NAME,')') SEPARATOR '; ') FROM information_schema.KEY_COLUMN_USAGE k
         WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL) AS fk,
       (SELECT GROUP_CONCAT(CONCAT(r.DELETE_RULE,'/',r.UPDATE_RULE) SEPARATOR '; ') FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
         ON r.CONSTRAINT_SCHEMA=k.TABLE_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
         WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME='flota_vehiculos') AS reglas_fk
FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
WHERE @ok AND c.TABLE_SCHEMA=@db AND c.TABLE_NAME NOT IN ('flota_vehiculos')
  AND (c.COLUMN_NAME REGEXP '(^|_)vehiculo(_.*)?_id$' OR c.COLUMN_NAME IN ('vehiculo_id','unidad_recurrente_id','flota_vehiculo_id','tc_vehiculo_id')
       OR EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME='flota_vehiculos'))
ORDER BY c.TABLE_NAME, c.COLUMN_NAME;

-- ===== 5. Conteo REAL de referencias por tabla y por ID inspeccionado (genera y ejecuta solo SELECT COUNT sobre `@db`.`tabla`) =====
SET @sql5 = (SELECT GROUP_CONCAT(CONCAT('SELECT ''', c.TABLE_NAME, ''' AS tabla, ''', c.COLUMN_NAME, ''' AS columna, `', c.COLUMN_NAME, '` AS vehiculo_id, COUNT(*) AS filas FROM `', @db, '`.`', c.TABLE_NAME, '` WHERE FIND_IN_SET(`', c.COLUMN_NAME, '`, ''', @ids, ''') GROUP BY `', c.COLUMN_NAME, '`') SEPARATOR ' UNION ALL ')
  FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME AND t.TABLE_TYPE='BASE TABLE'
  WHERE @ok AND c.TABLE_SCHEMA=@db AND c.TABLE_NAME<>'flota_vehiculos' AND c.COLUMN_NAME REGEXP '^[A-Za-z0-9_]+$' AND c.TABLE_NAME REGEXP '^[A-Za-z0-9_]+$'
    AND (c.COLUMN_NAME REGEXP '(^|_)vehiculo(_.*)?_id$' OR c.COLUMN_NAME IN ('vehiculo_id','unidad_recurrente_id','flota_vehiculo_id','tc_vehiculo_id')));
SET @q = IF(@ok, CONCAT('SELECT * FROM (', COALESCE(@sql5, 'SELECT NULL AS tabla, NULL AS columna, NULL AS vehiculo_id, 0 AS filas'), ') r ORDER BY tabla, columna, vehiculo_id'), @invalido);
PREPARE s5 FROM @q; EXECUTE s5; DEALLOCATE PREPARE s5;

-- ===== 6. Claves únicas / índices que incluyen una columna de vehículo (posibles conflictos al reasignar un ID) =====
SELECT s.TABLE_NAME AS tabla, s.INDEX_NAME AS indice, s.NON_UNIQUE = 0 AS es_unico, GROUP_CONCAT(s.COLUMN_NAME ORDER BY s.SEQ_IN_INDEX) AS columnas
FROM information_schema.STATISTICS s
WHERE @ok AND s.TABLE_SCHEMA=@db AND s.TABLE_NAME<>'flota_vehiculos'
  AND s.INDEX_NAME IN (SELECT i.INDEX_NAME FROM information_schema.STATISTICS i WHERE i.TABLE_SCHEMA=s.TABLE_SCHEMA AND i.TABLE_NAME=s.TABLE_NAME AND i.NON_UNIQUE=0
        AND (i.COLUMN_NAME REGEXP '(^|_)vehiculo(_.*)?_id$' OR i.COLUMN_NAME IN ('unidad_recurrente_id','flota_vehiculo_id','tc_vehiculo_id')))
GROUP BY s.TABLE_NAME, s.INDEX_NAME, s.NON_UNIQUE
ORDER BY s.TABLE_NAME, s.INDEX_NAME;

-- ===== 7. Triggers, vistas y rutinas que dependen de vehículos (filtrados por @db) =====
SELECT 'TRIGGER' AS objeto, TRIGGER_NAME AS nombre, EVENT_OBJECT_TABLE AS tabla, LEFT(ACTION_STATEMENT, 200) AS definicion FROM information_schema.TRIGGERS
 WHERE @ok AND TRIGGER_SCHEMA=@db AND (EVENT_OBJECT_TABLE='flota_vehiculos' OR ACTION_STATEMENT LIKE '%flota_vehiculos%' OR ACTION_STATEMENT LIKE '%vehiculo%')
UNION ALL SELECT 'VISTA', TABLE_NAME, TABLE_NAME, LEFT(VIEW_DEFINITION, 200) FROM information_schema.VIEWS WHERE @ok AND TABLE_SCHEMA=@db AND VIEW_DEFINITION LIKE '%vehiculo%'
UNION ALL SELECT ROUTINE_TYPE, ROUTINE_NAME, NULL, LEFT(ROUTINE_DEFINITION, 200) FROM information_schema.ROUTINES WHERE @ok AND ROUTINE_SCHEMA=@db AND ROUTINE_DEFINITION LIKE '%vehiculo%'
ORDER BY 1, 2;

-- ===== 8. Accesos compartidos, fusiones/alias e identidad física de los IDs inspeccionados =====
SET @ids_q = CONCAT('''', @ids, '''');
SET @q = IF(@ok, CONCAT(
  IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='flota_vehiculo_acceso'),
     CONCAT('SELECT ''acceso'' AS fuente, vehiculo_id AS id_a, empresa_id AS id_b, NULL AS detalle FROM `', @db, '`.flota_vehiculo_acceso WHERE FIND_IN_SET(vehiculo_id, ', @ids_q, ')'),
     'SELECT ''acceso'' AS fuente, NULL AS id_a, NULL AS id_b, ''tabla flota_vehiculo_acceso ausente'' AS detalle'),
  ' UNION ALL ',
  IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='flota_vehiculos_fusiones'),
     CONCAT('SELECT ''fusion'', origen_id, destino_id, motivo FROM `', @db, '`.flota_vehiculos_fusiones WHERE FIND_IN_SET(origen_id, ', @ids_q, ') OR FIND_IN_SET(destino_id, ', @ids_q, ')'),
     'SELECT ''fusion'', NULL, NULL, ''tabla flota_vehiculos_fusiones ausente (migración de fusiones no instalada)'''),
  ' UNION ALL ',
  IF(EXISTS(SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA=@db AND TABLE_NAME='flota_identidad_miembros'),
     CONCAT('SELECT ''identidad_fisica'', vehiculo_id, identidad_id, NULL FROM `', @db, '`.flota_identidad_miembros WHERE FIND_IN_SET(vehiculo_id, ', @ids_q, ')'),
     'SELECT ''identidad_fisica'', NULL, NULL, ''tabla flota_identidad_miembros ausente''')), @invalido);
PREPARE s8 FROM @q; EXECUTE s8; DEALLOCATE PREPARE s8;

-- ===== 9. Pares de la MISMA empresa con placa equivalente y sus diferencias de datos (resumen de conflicto) =====
SET @n_a = 'UPPER(REPLACE(REPLACE(REPLACE(REPLACE(a.placa,'' '',''''),''-'',''''),''–'',''''),''—'',''''))', @n_b = 'UPPER(REPLACE(REPLACE(REPLACE(REPLACE(b.placa,'' '',''''),''-'',''''),''–'',''''),''—'',''''))';
SET @q = IF(@ok, CONCAT('SELECT a.empresa_id, a.id AS id_a, b.id AS id_b, a.placa AS placa_a, b.placa AS placa_b, (a.tipo_unidad <=> b.tipo_unidad) AS mismo_tipo, (a.chasis <=> b.chasis) AS mismo_chasis, ',
  '(a.marca <=> b.marca) AS misma_marca, (a.modelo <=> b.modelo) AS mismo_modelo, (a.estado <=> b.estado) AS mismo_estado, a.km_actual AS km_a, b.km_actual AS km_b, a.en_taller AS taller_a, b.en_taller AS taller_b ',
  'FROM ', @v, ' a JOIN ', @v, ' b ON a.empresa_id=b.empresa_id AND a.id<b.id AND ', @n_a, '=', @n_b, ' ',
  'WHERE ', IF(@empresa IS NULL, '1=1', CONCAT('a.empresa_id=', @empresa)), ' ORDER BY a.empresa_id, a.id, b.id'), @invalido);
PREPARE s9 FROM @q; EXECUTE s9; DEALLOCATE PREPARE s9;
