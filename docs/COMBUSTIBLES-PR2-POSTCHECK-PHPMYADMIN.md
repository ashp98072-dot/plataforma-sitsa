# PR #507: postcheck independiente para phpMyAdmin

El operador reporto migracion correcta con CB2_IMPORT_FINAL, metadata FINAL,
15 validaciones, cero incidencias y las cuatro tablas presentes en Hostinger.
Ese dato es aportado por el operador: esta tarea NO conecto a produccion.
No reejecutar la migracion para comprobar su resultado.

## Archivo exacto

**sql/postcheck-phpmyadmin-2026-10-combustibles-pr2.sql** del SHA final auditado
en feature/combustibles-pr2-sql-diseno. Descargar Raw/Download raw file desde
GitHub. Es independiente del importador de migracion y no requiere sus variables
ni su conexion. NO usar el postcheck canonico multirresultado directamente en
el importador que produjo #2014.

Solo lectura de datos y estructura: USE, variables de sesion/locales, ajustes
SESSION de modos, SELECT/SELECT INTO y SIGNAL. No tiene CREATE/ALTER/DROP,
INSERT/UPDATE/DELETE/REPLACE, COMMIT/ROLLBACK, PREPARE/EXECUTE, archivos de salida,
procedimientos auxiliares ni escrituras globales. Tampoco modifica las flags
FOREIGN_KEY_CHECKS/CHECK_CONSTRAINT_CHECKS: exige que esten en 1.
El ajuste/restauracion de sql_mode e innodb_strict_mode es exclusivamente de sesion;
no cambia tablas, datos ni configuracion global de Hostinger.

## Como evita #2014 y conserva la validacion

La [documentacion mysqli](https://www.php.net/manual/en/mysqli.quickstart.stored-procedures.php)
explica que los resultados multiples deben consumirse antes de otra consulta.
El postcheck canonico emite varias tablas desde un bloque; en el flujo observado,
una orden posterior de phpMyAdmin encuentra resultados pendientes y falla #2014.
No corregir eso deshabilitando FK/CHECK ni quitando comprobaciones.

Este archivo contiene cuatro sentencias superiores: USE, inicializacion de estado,
bloque SIN resultados tabulares y un unico SELECT exterior de una fila/9 columnas.
El bloque realiza toda la validacion con SELECT INTO; no genera resultados que
necesiten next_result(). El SELECT exterior se consume como consulta buffered normal.
No crea rutinas ni objetos persistentes para lograrlo.

El bloque guarda los modos previos, fija el esquema objetivo literal
u611730801_Plataforma, prepara STRICT_ALL_TABLES e InnoDB estricto por sesion y
verifica contexto. Incluye el contrato de metadata COMPLETO del postcheck canonico
sin cambiar un predicado: columnas, tipos, nullability, charset/collation, generacion,
indices con nombres y orden exactos, FK/acciones, CHECK, conteos, triggers,
particiones y entorno. No depende de DATABASE() para los filtros de metadata;
la guardia de contexto impide consultar datos en otro esquema.

Solo si metadata=FINAL y BASE compatible evalua el CTE exacto de las 15 incidencias.
Lo proyecta a JSON y variables; exige 15 valores no nulos y suma cero para FINAL.
Si hay datos incompatibles, devuelve DIVERGENTE con las incidencias. Si la metadata
no es FINAL, devuelve DIVERGENTE y deja validaciones/incidencias/detalle en NULL:
no intenta leer tablas CB2 inexistentes o de estructura desconocida.

Handler de excepcion: restaura los modos y RESIGNAL. No oculta errores. El flag de
finalizacion se inicializa a cero fuera del bloque; si un cliente continua tras
error, el reporte no debe certificarse y usa SIN_CERTIFICAR si el bloque no termino.
El flag no habilita escrituras; el archivo no tiene ninguna.

Los tres SQL canonicos y el importador de migracion aprobado permanecen identicos
a d5d01c4f. El nuevo generador obtiene la metadata y las incidencias de esas fuentes.
No se modifica el contrato de ninguna de las cuatro tablas.

## Procedimiento manual propuesto, solo despues de auditoria/autorizacion

1. Auditar este commit, SQL, generador, pruebas y evidencia antes de ejecutar en
   Hostinger. No se requiere ni se propone reimportar la migracion.
2. Descargar Raw del archivo nuevo del SHA aprobado. No copiar HTML ni fragmentos,
   no usar Set-Content/Out-File/> para producirlo. Tiene UTF-8 sin BOM y LF fijado
   en .gitattributes. Comienza con USE.
3. Opcionalmente, verificar/reconstruir desde el checkout del mismo SHA:

   ```powershell
   node scripts/ci/combustibles-pr2-lab/build-phpmyadmin-postcheck.mjs --check
   # Solo si se necesita reconstruir la copia local:
   node scripts/ci/combustibles-pr2-lab/build-phpmyadmin-postcheck.mjs --write
   ```

   El generador no ejecuta SQL ni abre conexiones.
4. Una vez autorizado: seleccionar u611730801_Plataforma en phpMyAdmin, Importar,
   archivo completo, formato SQL, UTF-8, compatibilidad NONE y delimitador inicial ;.
   Respetar DELIMITER. No saltar consultas, fragmentar o reanudar importaciones ni
   continuar tras error. Mantener FK/CHECK activados. No hace falta SET separado.
5. Conservar la unica fila completa. Para certificar exigir simultaneamente:
   resultado=CB2_POSTCHECK_FINAL, estado_metadata=FINAL, validaciones=15,
   incidencias=0, los 15 valores JSON de detalle_datos=0,
   esquema_objetivo=u611730801_Plataforma y misma_conexion=1.
   Los modos finales son los RESTAURADOS: innodb_restaurado=0 puede ser correcto
   si ese era el valor inicial; dentro del bloque el contrato exigio 1.
6. DIVERGENTE, SIN_CERTIFICAR, error, timeout o salida incompleta no certifican.
   Conservar evidencia para diagnostico; no modificar datos ni reejecutar DDL
   para intentar cambiar el resultado. Esta lectura no aporta aislamiento frente
   a escrituras concurrentes: coordinar la ventana de verificacion.

## Pruebas

Resultado final PASS: run 79da826d-0509-427e-a12e-3864540dd3f1, 26 registros,
692 llamadas del cliente del arnes mas flujos directos mysqli, 15 instancias.
Todos los SHUTDOWN=0, canales cerrados y PIDs terminados. Se comprobaron cuatro
comparaciones de snapshots de datos y tres de estructura (13 tablas en cada una).
Pruebas Node: 6 PASS; self-test, node --check, php -l y git diff --check PASS.
El ZIP lab-evidence.zip del directorio de evidencia incluye TODAS las entradas SQL,
stdout/stderr, resultados, snapshots, SHOW CREATE, logs y cierres del run final;
excluye datadirs y binarios. SHA-256 del ZIP:
3f0be01ba07cd1370045d66f1ec59a1afaf04d5731c86f56a229315707d04fbd.
El archivo SQL exacto tiene SHA-256:
7c9e579fdf5230f3c2bf93ff2eed21bd047165f1e238aa4168c47f18441980c4.

MariaDB 11.8.9 portable Win64, bases sinteticas propias, PIPE local UUID y TCP
deshabilitado. No se usa Hostinger, datos reales ni respaldos. Casos:

- Sin tablas CB2: DIVERGENTE, metadata CLEAN, datos NULL y cero tablas creadas.
- Metadata FINAL con datos sinteticos y asociacion documental: CB2_POSTCHECK_FINAL,
  15 validaciones, cero incidencias. Tambien lectura con cliente CLI MariaDB.
- Diario incompleto creado SOLO por el fixture de prueba: DIVERGENTE,
  metadata FINAL, 15 validaciones y una incidencia; el defecto no se corrige.
- Metadata alterada SOLO en el laboratorio: DIVERGENTE y datos NULL, sin lectura
  de datos CB2 no certificables ni reparacion automatica del esquema.
- Snapshots de datos completos y tipados de 13 tablas antes/despues iguales.
  SHOW CREATE de las 13 tablas antes/despues tambien identicos en los casos
  correspondientes: ninguna modificacion de filas, columnas, indices, FK o CHECK.

Cada caso usa mysqli real PHP 8.4.14/mysqlnd y BufferedQuery 5.10.0, query buffered
simple, fetch/free y NINGUN next_result()/multi_query(). Se exige more_results=false
tras cada sentencia. Despues se prueban SET FOREIGN_KEY_CHECKS=ON y
SET CHECK_CONSTRAINT_CHECKS=ON (ambas ya en 1) para reproducir la operacion posterior
del cliente que fallaba. Bloque fields=0, unico SELECT exterior fields=9, una fila.
Se exige restauracion exacta de los dos modos con sesion inicialmente no estricta.

El parser se prueba con chunks de 1, 7, 4096 y archivo completo: cuatro sentencias,
bloque identico, sin fragmentar JSON_TABLE. Las pruebas Node comparan metadata y
CTE de datos exactos con el canonico y rechazan SQL de escritura persistente.
Se repite tambien la suite previa de migracion e integridad para detectar regresiones.
Evidencia publicada: **docs/evidence/combustibles-pr2-postcheck-phpmyadmin/**.

Comandos de reproduccion, con dependencias portables preparadas segun el README:

```powershell
node scripts/ci/combustibles-pr2-lab/build-phpmyadmin-postcheck.mjs --check
node --test scripts/ci/combustibles-pr2-lab/build-phpmyadmin-postcheck.test.mjs scripts/ci/combustibles-pr2-lab/build-phpmyadmin-import.test.mjs scripts/ci/combustibles-pr2-lab/build-session-preflight.test.mjs
node scripts/ci/combustibles-pr2-lab/run-portable-windows.mjs --run-isolated
.\.lab-runtime\php\php.exe -n -d extension_dir=.lab-runtime/php/ext -d extension=php_mbstring.dll scripts/ci/combustibles-pr2-lab/test-phpmyadmin-buffer.php --postcheck
```

## Limites

No se ejecuto la UI/version concreta de phpMyAdmin de Hostinger. Se prueba su
flujo equivalente parser/mysqli y MariaDB 11.8.9, en Win64 con fixtures; no se
certifican datos productivos, privilegios, volumen ni concurrencia de Hostinger.
Los ALTER/UPDATE usados para generar casos negativos son solo preparacion del
laboratorio, fuera del archivo postcheck: no pertenecen al SQL que debe usar el operador.
No hubo SQL en produccion, cambios de tablas productivas ni merge.
