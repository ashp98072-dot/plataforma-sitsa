-- SOLO LECTURA (preflight nivel 4). Migracion afectada: sql/migrate-2026-11-cb2-piloto-reportado.sql (nivel 4, opcional). NO ejecutado en produccion: lo ejecuta el operador.
-- Compara por firma SHA-256 el texto REAL de los CHECK de flota_cb2_consumos contra los de MariaDB 11.8.9 (nivel 3 = ck_cb2c_unidad_tipo v3 + ck_cb2_piloto_unico; nivel 4 = v4 + ck_cb2_piloto_reportado) y cuenta, sobre la base indicada, las filas que el
-- nuevo CHECK podria rechazar. Con DATABASE() = la base de la aplicacion seleccionada.
-- Fail-closed: esquema no fijado/inexistente/del sistema, tabla o columnas ausentes, o CHECK distintos => DETENER Y AUDITAR.
SET @esquema = DATABASE();

SET @ok_esq = (SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=@esquema AND @esquema IS NOT NULL AND @esquema<>'' AND @esquema NOT IN ('information_schema','mysql','performance_schema','sys') AND @esquema REGEXP '^[A-Za-z0-9_$]+$');
SET @ok_tab = (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=@esquema AND TABLE_NAME='flota_cb2_consumos' AND ENGINE='InnoDB');
SET @ok_cols = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@esquema AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME IN ('vehiculo_id','empleado_id','asociacion_externa_id','identidad_externa','piloto_externo_id','unidad_externa_id'));
SET @filas = NULL, @filas_reportado_v1 = NULL, @filas_incompatibles = NULL;
-- Conteo de impacto de SOLO LECTURA sobre la base indicada (la consulta se arma con el nombre ya validado arriba).
SET @sql = IF(@ok_esq=1 AND @ok_tab=1 AND @ok_cols=6,
 CONCAT('SELECT COUNT(*), COALESCE(SUM(COALESCE(JSON_VALUE(identidad_externa,''$.politica''),'''')=''REPORTADO_V1''),0), ',
        'COALESCE(SUM(COALESCE(JSON_VALUE(identidad_externa,''$.politica''),'''')=''REPORTADO_V1'' AND NOT (empleado_id IS NULL AND piloto_externo_id IS NULL AND asociacion_externa_id IS NULL)),0) ',
        'INTO @filas, @filas_reportado_v1, @filas_incompatibles FROM `', @esquema, '`.flota_cb2_consumos'), 'DO 0');
PREPARE consulta_impacto FROM @sql; EXECUTE consulta_impacto; DEALLOCATE PREPARE consulta_impacto;

WITH chk AS (SELECT CONSTRAINT_NAME n, SHA2(CHECK_CLAUSE,256) h FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=@esquema AND TABLE_NAME='flota_cb2_consumos'),
 o AS (SELECT (SELECT h FROM chk WHERE n='ck_cb2c_unidad_tipo') h_unidad, (SELECT h FROM chk WHERE n='ck_cb2_piloto_unico') h_unico,
             (SELECT COUNT(*) FROM chk WHERE n='ck_cb2_piloto_reportado') rep_n, (SELECT h FROM chk WHERE n='ck_cb2_piloto_reportado') h_rep),
 esperado AS (SELECT 'a016ce55e58339190282fde61746ddc0cd7c216c7d1fd4b4b8fcf08058ce4b11' v3, '28781d771233313d4eb5566a36c334243dc2c6d2618e6a7eee6485e236599e1c' v4, '9cb6e121e9347f72bfae196a0adf79c3de2d2ae0d652d7b1fe634d737643d75f' unico, 'fe346d20a395c985d664dd71c3d9290f48b0fd2b41bf5326f8fa37855af40093' rep)

SELECT CASE
  WHEN NOT (@ok_esq=1 AND @ok_tab=1 AND @ok_cols=6) THEN 'DETENER Y AUDITAR'
  WHEN o.h_unidad=e.v3 AND o.h_unico=e.unico AND o.rep_n=0 AND @filas_reportado_v1=0 THEN 'APTO PARA APLICAR NIVEL 4'
  WHEN o.h_unidad=e.v4 AND o.h_unico=e.unico AND o.h_rep=e.rep THEN 'YA INSTALADO (NIVEL 4): NO EJECUTAR LA MIGRACION'
  ELSE 'DETENER Y AUDITAR' END AS veredicto,
 CASE
  WHEN @esquema IS NULL OR @esquema='' THEN 'esquema no fijado'
  WHEN @ok_esq<>1 THEN 'esquema inexistente, del sistema o con nombre no valido'
  WHEN @ok_tab<>1 THEN 'flota_cb2_consumos no existe en el esquema o no es InnoDB'
  WHEN @ok_cols<>6 THEN 'faltan columnas de los niveles 1 a 3: instalar la cadena anterior (no esta migracion)'
  WHEN o.h_unidad=e.v3 AND o.h_unico=e.unico AND o.rep_n=0 AND @filas_reportado_v1=0 THEN 'nivel 3 exacto (firma SHA-256 de ck_cb2c_unidad_tipo v3 y ck_cb2_piloto_unico); ck_cb2_piloto_reportado ausente; ninguna fila REPORTADO_V1'
  WHEN o.h_unidad=e.v4 AND o.h_unico=e.unico AND o.h_rep=e.rep THEN 'nivel 4 exacto ya presente'
  WHEN o.h_unidad=e.v3 AND o.rep_n=0 AND @filas_reportado_v1>0 THEN 'hay filas con politica REPORTADO_V1 sin el CHECK: auditar antes'
  ELSE 'CHECK de consumos distintos a los esperados (modificados, de otro nivel o normalizados distinto): comparar con 00-capturar-checks-solo-lectura.sql' END AS motivo,
 CASE o.h_unidad WHEN e.v3 THEN 3 WHEN e.v4 THEN 4 ELSE IF(o.h_unidad IS NULL,0,9) END AS version_ck_unidad_tipo,
 (o.h_unico=e.unico) AS ck_piloto_unico_exacto, o.rep_n AS ck_piloto_reportado_presente, @filas AS filas_consumos, @filas_reportado_v1 AS filas_ya_reportado_v1, @filas_incompatibles AS filas_que_violarian_el_nuevo_check,
 'El ALTER reconstruye flota_cb2_consumos y bloquea escrituras: ejecutarlo en ventana, con importaciones pausadas. No cambia ni borra filas.' AS impacto
FROM o, esperado e;
