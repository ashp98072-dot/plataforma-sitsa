# PR #507: importacion phpMyAdmin sin resultados pendientes

Fecha: 2026-10-22. Sustituye el procedimiento del commit 4745d2d.
No se conecto a Hostinger, no se ejecuto SQL de produccion ni se hizo merge.
La auditoria independiente debe aprobar este SHA antes de autorizar otro intento.

## Diagnostico corregido: #2014

La variante 4745d2d emitia numerosos resultados desde un mismo BEGIN NOT ATOMIC:
IMPORT_INICIO, preflight, resultado de migracion, metadata, filas DATO y otras marcas.
Que el parser extraiga un bloque completo NO demuestra que el cliente consuma sus
resultados. La prueba anterior cubria division y motor, pero no ese protocolo.

[PHP documenta](https://www.php.net/manual/en/mysqli.quickstart.stored-procedures.php)
que deben consumirse todos los resultados antes de ejecutar otra orden. Sin ese
consumo, un SET posterior puede fallar con Commands out of sync. El SET de
FOREIGN_KEY_CHECKS que muestra phpMyAdmin puede ser solo la siguiente operacion
que encuentra el problema; no demuestra un fallo de la FK ni justifica desactivarla.
No se conoce la version exacta de phpMyAdmin/mysqlnd de Hostinger.

Reproduccion local REAL: mysqli->query('BEGIN NOT ATOMIC SELECT 1; SELECT 2; END'),
free() del primer resultado y despues SET FOREIGN_KEY_CHECKS=ON, sin next_result():
error 2014. Es una reproduccion minima del mecanismo, no una conexion a Hostinger
ni una reproduccion de su UI completa. El #2014 por si solo no prueba cuanto DDL
llego a ejecutarse. El operador reporto cero tablas CB2 despues del intento;
verificar de nuevo el inventario actual antes de cualquier accion autorizada.

## Archivo exacto publicado

**sql/import-phpmyadmin-2026-10-combustibles-pr2.sql**, del NUEVO SHA auditado de
feature/combustibles-pr2-sql-diseno. Descartar la copia de 4745d2d.
Descargar mediante Raw/Download raw file desde GitHub; no copiar HTML ni fragmentos.
El archivo tiene UTF-8 sin BOM y LF fijado mediante .gitattributes.

El importador recibe cuatro sentencias superiores:

1. USE explicito del esquema objetivo.
2. SET @cb2_import_ok=0: certificacion cerrada incluso si un cliente continua tras error.
3. Un bloque BEGIN NOT ATOMIC SIN resultados tabulares. Guarda/restaura modos,
   prepara @cb2_schema literal, activa los dos modos estrictos por sesion, conserva
   las guardias de CLEAN, ejecuta exactamente el DDL aprobado, revalida metadata
   FINAL y evalua las 15 incidencias del postcheck mediante SELECT ... INTO.
4. Un unico SELECT superior, buffered normal, con una fila de resumen y el detalle
   JSON de las 15 incidencias. Solo da CB2_IMPORT_FINAL si el bloque termino; en
   otro caso SIN_CERTIFICAR. No es un SELECT dentro de un bloque/CALL.

En el bloque, solo el reporte final de migrate pasa de SELECT a SELECT INTO.
No hay PREPARE/EXECUTE/CALL que devuelvan datos al cliente. Las incidencias se
obtienen literalmente del CTE original del postcheck; se agregan a JSON y variables
sin emitir filas. Se exige 15 comprobaciones no nulas y suma cero o se lanza SIGNAL.
El inventario y los diagnosticos no bloqueantes no se emiten desde el bloque.

Los tres archivos canonicos preflight/migrate/postcheck NO cambian respecto a
4745d2d. Los cuatro CREATE TABLE, columnas, indices, FK y CHECK son identicos.
Las dos validaciones canonicas completas de migrate y todos sus SIGNAL permanecen.
Las 15 comprobaciones de datos conservan exactamente sus subconsultas y predicados.
No hay SET FOREIGN_KEY_CHECKS, SET CHECK_CONSTRAINT_CHECKS ni cambios globales en
el archivo publicado. Las flags se leen y se exigen en 1, sin forzarlas.

EXIT HANDLER restaura ambos modos y RESIGNAL; no oculta errores ni sigue con DDL.
El indicador de exito solo cambia a 1 al concluir todas las comprobaciones y
restauraciones. DDL tiene commits implicitos: no se promete rollback global ni
limpieza automatica de tablas parciales. El unico bloque evita cambios de contexto
por el cliente entre metadata y DDL, pero no aporta aislamiento frente a otros usuarios.

## Procedimiento propuesto: ejecutar SOLO despues de auditoria/autorizacion

1. Auditar el commit nuevo, el SQL, el generador y la evidencia de mysqli.
2. Comprobar el estado actual mediante una lectura literal, sin depender de DATABASE():

   ```sql
   SELECT TABLE_NAME FROM information_schema.TABLES
   WHERE TABLE_SCHEMA='u611730801_Plataforma'
   AND TABLE_NAME IN ('flota_cb2_importaciones','flota_cb2_facturas',
                     'flota_cb2_consumos','flota_cb2_filas') ORDER BY TABLE_NAME;
   ```

   Cero tablas es requisito de un primer intento, no certifica CLEAN. Una a tres
   tablas exige diagnostico de parcial; cuatro exige verificacion, no reejecucion.
   El respaldo y el CLEAN anterior no sustituyen las comprobaciones actuales.
3. Descargar Raw del SQL del SHA aprobado. Opcionalmente, con checkout de ese SHA:

   ```powershell
   node scripts/ci/combustibles-pr2-lab/build-phpmyadmin-import.mjs --check
   ```

   Si se reconstruye, --write escribe directamente sin BOM. No usar Set-Content,
   Out-File ni > para crear el SQL. Empieza con USE, no con comentarios o BOM.
4. Tras autorizacion explicita: seleccionar u611730801_Plataforma, pestana Importar,
   archivo completo, formato SQL, UTF-8, compatibilidad NONE y delimitador inicial ;.
   Respetar DELIMITER del archivo. No saltar consultas, reanudar importacion parcial,
   transformar SQL ni continuar tras errores. Mantener FK/CHECK activados; no usar
   ninguna opcion de deshabilitacion para intentar que pase.
5. Conservar la fila unica de salida. Exigir simultaneamente:
   resultado=CB2_IMPORT_FINAL, estado_metadata=FINAL, validaciones=15,
   incidencias=0, los 15 valores de detalle_datos en cero,
   esquema_objetivo=u611730801_Plataforma y misma_conexion=1.
   sql_mode_restaurado e innodb_restaurado deben ser los valores iniciales.
6. Error, timeout, SIN_CERTIFICAR, salida oculta o incompleta => no certificar ni
   reintentar. Conservar el error y consultar inventario actual de solo lectura.
   Los canonicos con multiples resultados no deben usarse como sustituto directo
   de este archivo en ese importador. Para diagnosticos adicionales, revisar antes
   el flujo de cliente; no quitar validaciones ni correr el DDL manualmente por partes.

## Pruebas reales y evidencia

Resultado FINAL: PASS, run e1402bdf-a62f-4edf-80c9-4dc2ea542d30: 25 registros,
507 llamadas del cliente del arnes mas el flujo directo mysqli, 14 instancias.
Todos los SHUTDOWN devolvieron 0, los canales cerraron y los PIDs terminaron.
Conteos independientes: 4 tablas, 86 columnas, 34 indices, 18 FK, 26 CHECK;
postcheck FINAL y 15 incidencias en cero. Pruebas Node: 5 PASS; self-test,
node --check, php -l y git diff --check PASS. Los tres canonicos siguen identicos
a 4745d2d.

Una repeticion previa se detuvo al inicializar otro datadir, con solo 63 MB libres.
No se conto como PASS. Se verifico ausencia de servidores activos y se eliminaron
unicamente 92 datadirs sinteticos cb2-UUID dentro del runtime de este workspace,
con limites de ruta comprobados y evidencia preservada. Con espacio liberado,
el mismo codigo completo la suite final. El fallo de infraestructura se conserva
en infrastructure-failure.json. No se borraron datos ajenos ni evidencia.

La prueba nueva usa PHP 8.4.14/mysqlnd, mysqli real y BufferedQuery 5.10.0 oficial
sobre MariaDB 11.8.9 portable, transporte PIPE local con UUID y TCP deshabilitado.
No conecta a servicios existentes ni usa dumps, .env o credenciales productivas.

El driver usa query() buffered simple y free() del unico resultado, sin next_result()
ni multi_query. Despues de CADA sentencia intenta SET FOREIGN_KEY_CHECKS=ON y
SET CHECK_CONSTRAINT_CHECKS=ON, reproduciendo el tipo de limpieza que fallo.
Nunca desactiva esos controles. Exige more_results()=false tras cada consulta.
El bloque debe dar fields=0; solo el SELECT superior da fields=9 y una fila.
Verifica cuatro tablas, FINAL, las 15 incidencias en cero, flags en 1 y restauracion.
La misma prueba reproduce primero el 2014 del bloque minimo multirresultado.

Tambien se ejecuta la suite previa completa: guardias, escenarios incompatibles,
modos de sesion, restauracion tras error, indices, FK/CHECK/UNIQUE, snapshots y
postchecks. Los resultados del run final y sus hashes se publican en
**docs/evidence/combustibles-pr2-phpmyadmin-sin-resultados/**.
La prueba de BufferedQuery lee chunks de 1, 7, 4096 y archivo completo; siempre
extrae cuatro sentencias con el mismo bloque, sin fragmentar JSON_TABLE.
Las pruebas Node exigen DDL exacto, cuerpo de migracion salvo su salida INTO,
CTE de las 15 incidencias exacto y ausencia de cambios de flags/globales.

Reproduccion local (solo despues de preparar el laboratorio portable del README):

```powershell
node scripts/ci/combustibles-pr2-lab/build-phpmyadmin-import.mjs --check
node --test scripts/ci/combustibles-pr2-lab/build-phpmyadmin-import.test.mjs scripts/ci/combustibles-pr2-lab/build-session-preflight.test.mjs
node scripts/ci/combustibles-pr2-lab/run-portable-windows.mjs --run-isolated
.\.lab-runtime\php\php.exe -n -d extension_dir=.lab-runtime/php/ext -d extension=php_mbstring.dll scripts/ci/combustibles-pr2-lab/test-phpmyadmin-buffer.php
```

El runner portable necesita PHP portable en .lab-runtime/php y sql-parser 5.10.0
oficial en .lab-runtime/sql-parser-5.10.0. Invoca test-phpmyadmin-mysqli.php con
mbstring/mysqli y un pipe cb2 de la instancia propia. Ese driver solo admite cb2_lab
sintetico; rechaza el nombre productivo y cualquier endpoint externo.

## Limites

El flujo de cliente probado reproduce parser, mysqli buffered y limpieza posterior;
no se ejecuto la UI/configuracion de Hostinger ni su version exacta. Motor Win64 y
fixtures sinteticos no certifican datos historicos, privilegios, concurrencia, volumen
ni tiempos de DDL de Linux/Hostinger. No se altero el contrato aprobado.
El #2014 era un riesgo de protocolo que el ensayo anterior no cubria; la prueba
actual lo reproduce y comprueba su ausencia con el archivo nuevo, sin drenar
resultados por fuera para ocultar el problema. Produccion sigue pendiente de
la auditoria independiente y de autorizacion explicita. No hubo merge.
