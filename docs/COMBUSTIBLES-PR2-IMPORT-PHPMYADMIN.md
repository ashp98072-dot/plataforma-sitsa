# PR #507: importacion autocontenida para phpMyAdmin

Fecha: 2026-10-22. Base revisada: cc0ea1df36bc2c5128d146b432a641a81e01d336.
No se conecto a Hostinger ni se ejecuto SQL de produccion. No se autoriza un nuevo
intento con este documento: requiere auditoria independiente y autorizacion posterior.

## Diagnostico del #1644

El archivo migrate canonico exige @cb2_schema, esquema seleccionado correcto,
modo SQL estricto e innodb_strict_mode=1 en SU conexion. No los inicializa.
Un preflight CLEAN en otra peticion no los transmite al importador; el generador
preflight restaura los modos anteriores al terminar. Los valores observados antes
(NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION e innodb_strict_mode=0) incumplen entorno.
Si @cb2_schema no existe, base_ok=0 y estado=DIVERGENTE. Si DATABASE() difiere del
objetivo, la guardia de DDL tambien rechaza, aunque metadata sea CLEAN.

El #1644 con el texto del SIGNAL demuestra que se alcanzo y ejecuto esa guardia;
no es el mismo problema que un #1064 por fragmentacion. Sin la salida de los
parametros de ESA importacion, no es posible atribuirlo a una sola condicion.
Las advertencias del analizador estatico sobre BEGIN NOT ATOMIC no son el error
del servidor. [MariaDB admite esa sintaxis fuera de procedimientos](https://mariadb.com/docs/server/reference/sql-statements/programmatic-compound-statements/begin-end).
No retirar la guardia ni el bloque para silenciar advertencias.

El archivo anterior tiene siete sentencias superiores, excluyendo DELIMITER.
El contador de phpMyAdmin no prueba que las siete finalizaran ni que se crearan
tablas. Las cuatro tablas ausentes se comprobaron tras un intento anterior: hay
que comprobar de nuevo el inventario actual antes de autorizar otro intento.

El [importador SQL de phpMyAdmin 5.2.2](https://github.com/phpmyadmin/phpmyadmin/blob/RELEASE_5_2_2/libraries/classes/Plugins/Import/ImportSql.php)
usa BufferedQuery para extraer sentencias y puede establecer SQL_MODE desde
opciones de compatibilidad. No hay garantia de variables heredadas de otro envio.
La seleccion de base hecha por el cliente entre sentencias tampoco es estable.
No se ha identificado la version/configuracion concreta de Hostinger.

## Archivo que debe auditarse y descargarse desde GitHub

**sql/import-phpmyadmin-2026-10-combustibles-pr2.sql**

Usar ese archivo del commit final auditado mediante Raw/Download raw file. No usar
migrate-2026-10-combustibles-pr2-consumos-facturas.sql directamente en phpMyAdmin,
ni pegar fragmentos JSON_TABLE, ni copiar el HTML de GitHub. El SQL importable
esta publicado en la rama feature/combustibles-pr2-sql-diseno; no es solo un
artefacto local. Empieza con USE y esta codificado UTF-8 sin BOM, con LF fijado
por .gitattributes para que Windows no lo recodifique al checkout.

El archivo hace USE explicito de u611730801_Plataforma y envia un solo bloque
BEGIN NOT ATOMIC al servidor. Dentro del bloque:

1. Guarda ambos modos en variables LOCALES, define un EXIT HANDLER que restaura
   esos modos y RESIGNAL (no oculta ni continua errores).
2. Fija @cb2_schema literal, activa STRICT_ALL_TABLES preservando otros modos y
   activa InnoDB estricto SOLO por sesion. Verifica el esquema real.
3. Ejecuta preflight completo; migrate completo, con sus dos validaciones y
   guardias; y postcheck completo. No hay intervencion del cliente entre ellos.
4. Emite IMPORT_FIN y restaura los modos originales, tambien por sesion.

Los tres SQL canonicos permanecen identicos a cc0ea1df. El generador solo adapta
DELIMITER y convierte BEGIN NOT ATOMIC internos a BEGIN para anidarlos. Preserva
literalmente sus CTE, comprobaciones, SIGNAL, CREATE TABLE y lecturas de datos.
No hay CREATE PROCEDURE, tablas auxiliares, SET GLOBAL, permisos ni cambios de
configuracion. El bloque no es transaccion atomica: el handler no revierte DDL.
Un error despues del primer CREATE puede dejar parcial y requiere diagnostico.

## Procedimiento propuesto para el operador, NO ejecutado en produccion

1. ChatGPT debe auditar este commit, archivo SQL y evidencia antes de autorizar.
   El respaldo y CLEAN anterior no sustituyen esa aprobacion.
2. Comprobar el estado ACTUAL con una lectura literal, sin depender de DATABASE():

   ```sql
   SELECT TABLE_NAME FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
   AND TABLE_NAME IN ('flota_cb2_importaciones','flota_cb2_facturas',
                     'flota_cb2_consumos','flota_cb2_filas')
   ORDER BY TABLE_NAME;
   ```

   Si hay una a tres tablas: detenerse, diagnosticar parcial. Si hay cuatro:
   diagnosticar/postcheck autorizado, sin reejecutar migracion. Cero tablas es
   requisito para el intento inicial, no certifica por si solo compatibilidad.
3. Descargar el archivo Raw del SHA aprobado y verificar que empieza con USE,
   sin BOM. Si se trabaja con el repo en Windows, NO usar Set-Content, Out-File
   ni > para generarlo. Para reconstruir/verificar la copia publicada:

   ```powershell
   node scripts/ci/combustibles-pr2-lab/build-phpmyadmin-import.mjs --write
   node scripts/ci/combustibles-pr2-lab/build-phpmyadmin-import.mjs --check
   ```

   --check exige bytes exactos contra el generador y fuentes actuales.
4. Solo tras autorizacion: seleccionar la base de produccion en phpMyAdmin,
   pestana Importar, archivo completo, formato SQL, codificacion UTF-8,
   compatibilidad NONE y delimitador inicial punto y coma. Respetar las directivas
   DELIMITER del archivo. No omitir consultas, reanudar importacion parcial,
   transformar SQL ni continuar tras errores. No enviar SET separado.
5. Conservar salida completa. IMPORT_INICIO debe mostrar esquema actual/objetivo
   correctos, STRICT_ALL_TABLES e InnoDB estricto=1 y checks FK/CHECK en 1.
   Preflight debe CLEAN/base_compatible=1, migracion APLICADA_PENDIENTE_POSTCHECK
   FINAL, postcheck RESULTADO FINAL y 15 DATO=0. IMPORT_FIN: misma_conexion=1,
   migracion_completada=1, estado_metadata=FINAL y esquema correcto.
   IMPORT_RESTAURADO debe mostrar los modos originales.
6. Si phpMyAdmin oculta resultados intermedios, faltan marcas, hay error o timeout,
   no certificar exito por el contador o mensaje generico. Conservar la evidencia
   y revisar inventario actual/postcheck autorizado; no reintentar automaticamente.

La llamada al servidor es un bloque indivisible a efectos de envio del cliente:
no puede cambiar DATABASE() entre los CTE internos y CREATE. Sigue habiendo
commits implicitos y posibilidad de parcial ante fallo de DDL. Mantener exclusividad
operativa: ninguna escritura ni cambio de esquema concurrente durante la operacion.

## Pruebas realizadas

**MariaDB 11.8.9 portable Win64, exclusivamente fixtures sinteticos:** PASS final,
run 72a84295-3486-4895-a597-0f1afcd7c44e: 24 registros, 501 llamadas del cliente,
13 instancias nuevas. Todas cerradas con SHUTDOWN=0, canal sin conexion posterior
y PIDs terminados. No Docker/Actions ni servicios globales modificados.

- Import desde @cb2_schema=NULL, DATABASE()=information_schema, modos no estrictos
  iguales a los reportados por Hostinger: el lote selecciona cb2_lab, prepara
  sesion, da CLEAN, crea las cuatro tablas y postcheck FINAL; restaura los dos modos.
- Base incompatible: SIGNAL 1644 exacto, cero tablas CB2. Otra prueba captura ese
  RESIGNAL en un bloque EXTERNO solo de test y comprueba, en la MISMA sesion,
  restauracion a NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION e InnoDB=0.
  El SQL publicado no tiene CONTINUE HANDLER ni oculta el error.
- Suite previa completa: conteos 4/86/34/18/26, FK/CHECK/UNIQUE, 15 DATO=0,
  snapshots, rechazos de esquema parcial/alterado, indices y modos estrictos.
- 5 pruebas Node PASS, self-test PASS, node --check y git diff --check PASS.
  El test nuevo exige bytes del archivo generado, cuerpos canonicos integros,
  cuatro CREATE identicos, handlers y ninguna escritura global.

**Parser oficial phpmyadmin/sql-parser 5.10.0 BufferedQuery**, PHP 8.4.14 portable:
PASS con chunks de 1, 7, 4096 y 164089 bytes. Extrae siempre DOS sentencias:
USE y BEGIN NOT ATOMIC completo. Hash del bloque identico en los cuatro casos;
ningun JSON_TABLE queda como sentencia independiente. La prueba no abre BD.
Este es el componente utilizado por ImportSql; no reproduce toda la interfaz,
plugins, version o configuracion de Hostinger.

Reproducir parser: descargar sql-parser tag 5.10.0 de su repo oficial y extraer
bajo .lab-runtime/sql-parser-5.10.0; PHP portable con mbstring bajo .lab-runtime/php.
Ejecutar desde raiz:

```powershell
.\.lab-runtime\php\php.exe -n -d extension_dir=.lab-runtime/php/ext -d extension=php_mbstring.dll scripts/ci/combustibles-pr2-lab/test-phpmyadmin-buffer.php
```

Evidencia versionada en docs/evidence/combustibles-pr2-phpmyadmin-import:
summary.json, source.json, parser.json, resultados positivos/negativos y cierres.
source.json conserva el marcador historico baseline=bc12de32 del runner anterior;
los hashes de fuentes identifican el codigo realmente probado y se comprobaron
contra los archivos finales. La base de este cambio es cc0ea1df.
La copia ensayada por el motor solo sustituye el esquema literal por cb2_lab;
no cambia ninguna otra parte de los cuerpos canonicos.

## Limites para auditoria independiente

No se ejecuto phpMyAdmin de Hostinger, su UI ni SQL en produccion. Motor probado
Win64 y parser fijado 5.10.0: contrastar con la version desplegada. Los fixtures no
certifican datos historicos, privilegios, volumen, bloqueos o capacidad de Hostinger.
Se conserva el contrato aprobado; no se relajan guardias ni se fuerza CLEAN.
No hubo merge. Toda ejecucion futura de produccion requiere autorizacion explicita.
