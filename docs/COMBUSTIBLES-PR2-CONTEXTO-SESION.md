# PR #507: contexto y modo SQL de sesion en phpMyAdmin

Auditoria 2026-10-22 sobre `c49b6c3fb017285aa4d817220bedc33f6121c776`.
No se ha ejecutado SQL contra Hostinger, ni migracion ni cambios globales.
Los siguientes pasos son instrucciones para revision y autorizacion del operador;
este documento no autoriza su ejecucion en produccion.

## Diagnostico separado

1. Todos los inventarios y cruces del contrato filtran por `DATABASE()`.
   Con `information_schema` seleccionado se buscan alli empresas, usuarios y las
   otras tablas base: no hay coincidencias y los LEFT JOIN producen `ok=0`.
   Eso explica los falsos negativos estructurales observados si la ejecucion
   completa uso ese contexto. Un SELECT correcto en otro envio no lo demuestra.
2. `NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION` carece de STRICT_ALL_TABLES y
   STRICT_TRANS_TABLES. Con ese valor la fila BASE/entorno vale 0 y
   base_compatible=0/DIVERGENTE, incluso con estructura correcta. Este modo no
   convierte por si solo todas las columnas, indices y FK en `ok=0`.
3. Detectar 18 columnas de empresas/usuarios prueba visibilidad parcial, no
   conformidad de tipos, nullability, EXTRA, claves u orden. Si, bajo el contexto
   comprobado en el mismo envio, quedan objetos en cero, hay que contrastar su
   metadata con el contrato; no atribuirlos automaticamente al sql_mode.
4. FK checks y CHECK checks en 1 cumplen solo dos requisitos. Siguen vigentes
   version 11.8.x MariaDB, innodb_strict_mode=1, pagina >=8192,
   group_concat_max_len>=8192, ausencia de NO_BACKSLASH_ESCAPES, motores,
   particiones, triggers y todas las demas comprobaciones originales.

Los tres SQL auditados no cambian. No se sustituyen resultados ni se fuerza CLEAN.
Las conversiones explicitas de cotejamientos y la normalizacion conservadora de
CHECK/generacion permanecen intactas.

## Que se verifico sobre phpMyAdmin

La [configuracion oficial](https://docs.phpmyadmin.net/en/latest/config.html#cfg_PersistentConnections)
permite conexiones persistentes; no establece una garantia de estado de sesion
entre envios del formulario. Ademas, [mysqli documenta](https://www.php.net/manual/en/mysqli.persistconns.php)
la limpieza de variables al reutilizar conexiones persistentes. Por tanto, ni una
cookie de phpMyAdmin ni el mismo CONNECTION_ID prueban que se preservo el modo.
El esquema puede volver a seleccionarse por la interfaz en cada peticion.

No se conoce la version/configuracion efectiva de phpMyAdmin de Hostinger ni se
ha medido alli su persistencia. Verificado documentalmente: no debe dependerse
de ella. Pendiente de comprobacion por el operador, si se autoriza, con esta
sonda sin escrituras persistentes:

Envio A (una ejecucion):

```sql
USE `u611730801_Plataforma`;
SET @cb2_probe_token = UUID(), @cb2_probe_connection = CONNECTION_ID();
SELECT CONNECTION_ID() AS conexion, DATABASE() AS esquema,
       @@SESSION.sql_mode AS sql_mode, @cb2_probe_token AS token;
```

Envio B (otra ejecucion, sin USE ni SET previos):

```sql
SELECT CONNECTION_ID() AS conexion, DATABASE() AS esquema,
       @@SESSION.sql_mode AS sql_mode, @cb2_probe_token AS token,
       @cb2_probe_connection AS conexion_anterior;
```

Guardar ambas salidas. Token NULL/cambiado, conexion distinta o esquema diferente
prueban perdida/cambio de estado. Coincidencia solo prueba esos dos envios; no
garantiza el siguiente. Esta sonda no modifica sql_mode; la prueba principal
comprueba el modo efectivo antes y despues del preflight dentro del mismo envio.

## Nueva prueba manual: lecturas, sin migracion

Solo tras autorizacion explicita. El lote incluye USE y SET de sesion, ademas de
SELECT; no es exclusivamente SELECT, pero no escribe datos, tablas ni variables
globales. Habilita estrictitud real de esta conexion y conserva los otros modos.
No desactiva controles ni corrige automaticamente otros requisitos incumplidos.

1. Desde la raiz del repositorio, generar localmente el lote completo:

   ```powershell
   node scripts/ci/combustibles-pr2-lab/build-session-preflight.mjs --output "$env:TEMP\cb2-preflight-sesion.sql"
   if ($LASTEXITCODE -ne 0) { throw 'No se genero el archivo' }
   node scripts/ci/combustibles-pr2-lab/build-session-preflight.mjs --check "$env:TEMP\cb2-preflight-sesion.sql"
   if ($LASTEXITCODE -ne 0) { throw 'Archivo SQL no verificado' }
   ```

   El generador lee el preflight y escribe directamente UTF-8 sin BOM con --output
   (sin argumentos conserva stdout). El archivo empieza con SELECT, sin comentarios
   iniciales. --check verifica bytes UTF-8, ausencia de BOM e identidad del lote. No carga .env,
   credenciales, drivers ni conexiones. No ejecuta SQL. Revisar el archivo.
2. En phpMyAdmin seleccionar `u611730801_Plataforma`. Configurar la ejecucion
   para detenerse ante el primer error (no continuar un lote fallido). Pegar TODO
   el archivo generado en un solo envio SQL. No ejecutar primero el SET y luego
   cargar el preflight en otro envio. No pegar migrate ni postcheck en esta prueba.
3. Conservar todas las salidas, incluidas ANTES, PREFLIGHT_INICIO, inventario de
   columnas, todas las verificaciones/resumen, PREFLIGHT_FIN y RESTAURADO.
   No limitar la evidencia a la ultima tabla que muestre phpMyAdmin.
4. Exigir en PREFLIGHT_INICIO y PREFLIGHT_FIN: esquema exacto
   `u611730801_Plataforma`, esquema_correcto=1, estricto=1, mismo sql_mode y
   misma conexion; en FIN, misma_conexion=1. Las comprobaciones BASE deben estar
   todas en 1. Las cuatro CB2 ausentes pueden tener objetos NUEVO en 0: CLEAN
   depende de BASE compatible y cero tablas CB2, no de nuevas_ok=1.
5. Si las condiciones de contexto fallan, falta algun resultado o hay cualquier
   error, el resultado queda SIN CERTIFICAR. No ejecutar la migracion. Si el
   entorno queda en 0, revisar los valores de version, modo, flags, pagina y
   group_concat mostrados; no eliminar su comprobacion. Si falla un objeto base,
   conservar su nombre y obtener su metadata en el esquema correcto para comparar.

El lote guarda el modo inicial, agrega STRICT_ALL_TABLES con SET SESSION,
comprueba el estado, incluye literalmente el preflight original y verifica de
nuevo antes de restaurar el modo inicial. Si se interrumpe antes de restaurar,
cerrar la conexion de base de datos; no depender del siguiente envio para limpiar
variables. Cada nueva prueba debe incluir nuevamente el lote completo.
No se cambia el modo global ni se borra NO_BACKSLASH_ESCAPES si estaba presente:
en ese caso el contrato debe continuar rechazando el entorno.

## Preparacion de migracion y postcheck: propuesta, NO ejecutar ahora

[MariaDB define](https://mariadb.com/docs/server/server-management/variables-and-modes/sql_mode)
modo estricto por STRICT_ALL_TABLES o STRICT_TRANS_TABLES. Se propone el primero
para cubrir todas las tablas, preservando los modos existentes. En cada ejecucion
independiente, en una unica conexion, usar este prefijo antes del script completo:

```sql
USE `u611730801_Plataforma`;
SET @cb2_audit_sql_mode_before = @@SESSION.sql_mode,
    @cb2_audit_connection = CONNECTION_ID();
SET SESSION sql_mode = IF(
 FIND_IN_SET('STRICT_ALL_TABLES', @@SESSION.sql_mode) > 0,
 @@SESSION.sql_mode,
 CONCAT_WS(',', NULLIF(@@SESSION.sql_mode, ''), 'STRICT_ALL_TABLES')
);
SELECT CONNECTION_ID() AS conexion, DATABASE() AS esquema,
       @@SESSION.sql_mode AS sql_mode;
```

A continuacion, el script COMPLETO autorizado, y solo al terminar sus comprobaciones:

```sql
SELECT CONNECTION_ID() AS conexion,
       CONNECTION_ID() = @cb2_audit_connection AS misma_conexion,
       DATABASE() AS esquema, @@SESSION.sql_mode AS sql_mode;
SET SESSION sql_mode = @cb2_audit_sql_mode_before;
```

Repetir el prefijo en migracion y postcheck; no heredar el SET de un preflight
anterior. Preferir un cliente MariaDB de conexion unica con soporte de DELIMITER,
base indicada explicitamente y parada ante error, sin opcion --force. No usar una
transaccion como promesa de rollback del DDL. Una futura migracion requiere
aprobacion separada y evidencia CLEAN previa en esta base; su guard interno
revalida el contrato antes de CREATE. Fallo/parcial exige diagnostico, sin reintento
automatico. Postcheck exige FINAL y sus comprobaciones de datos; repetir la
preparacion de sesion no sustituye ninguna de ellas.

El self-test detectaba cero bloques canonicos cuando Git entregaba CRLF en
Windows. Se corrigio exclusivamente su extraccion para aceptar LF/CRLF y
normalizar finales de linea al comparar: sigue exigiendo cuatro bloques iguales
y los mismos predicados. No cambia el SQL enviado al motor.

## Validacion local y limites

- PASS: self-test del arnes (snapshots, casos negativos y cuatro contratos iguales).
- PASS: node --check del generador y del arnes; git diff --check.
- PASS: salida generada contiene el preflight completo sin modificar, un unico
  USE del esquema objetivo, SET SESSION sql_mode y diagnosticos de inicio/fin.
  Revision estatica: sin DDL/DML ni SET GLOBAL en el lote generado.
- PASS: los blobs de preflight/migrate/postcheck son identicos al commit c49b6c3f.
- No se ejecuto SQL, Docker, workflows ni conexiones a Hostinger.
- Pendiente de MariaDB 11.8.9 real: ejecucion y resultados del lote; persistencia
  concreta de phpMyAdmin, metadata base, CLEAN, migracion y FINAL.

## Incidente #1064 al inicio: codificacion, comentarios y multiples sentencias

La receta anterior con `Set-Content -Encoding utf8` era incorrecta para Windows
PowerShell 5.1: agrega BOM UTF-8. Reproduccion local con PowerShell 5.1.26100.9711:
escribir `SELECT 1;` de esa forma produce `EF BB BF 53 45 4C 45 43 54`.
[Microsoft documenta esta diferencia](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding).
No usar tampoco `>` ni Out-File para generar el archivo en PowerShell 5.1, pues
pueden escribir UTF-16LE. La nueva opcion --output escribe bytes desde Node y
funciona sin recodificacion tanto en Windows PowerShell 5.1 como en PowerShell 7.

El comentario original `-- PR #507` contiene el espacio requerido por
[MariaDB](https://mariadb.com/docs/server/reference/sql-statements/comment-syntax).
No hay evidencia de que ese comentario, por si solo, sea SQL invalido. El BOM
antes del comentario es una causa plausible del error en posicion 0, no una
reproduccion confirmada del parser de Hostinger: no se recibio el archivo fallido
ni se ejecuto contra ese servicio. El prefijo ahora empieza por SELECT para
eliminar tambien la dependencia de comentarios iniciales del analizador cliente.
Los comentarios internos del preflight se conservan literalmente.

El error en posicion 0 no demuestra un problema de multiples sentencias. Si el
archivo verificado sigue fallando, guardar sentencia exacta, posicion y version
de phpMyAdmin. No dividir el SET y el preflight entre peticiones para intentar
solucionarlo: se perderia la garantia de sesion. Tampoco eliminar comentarios o
validaciones del contrato para silenciar el analizador.

Metodo preferido: generar y verificar con los dos comandos --output/--check de
arriba; abrir el archivo como UTF-8 y pegar TODO en la pestana SQL de la base en
un solo envio, solamente tras autorizacion. Como alternativa, phpMyAdmin ofrece
[Importar archivos SQL](https://docs.phpmyadmin.net/en/latest/import_export.html):
seleccionar el mismo archivo verificado, formato SQL y juego de caracteres UTF-8.
No habilitar reanudacion/importacion parcial ni omitir consultas iniciales; no
continuar tras error. Si la interfaz fragmenta el lote o no muestra las evidencias
inicial/final, el resultado queda SIN CERTIFICAR. No se ha certificado esta ruta
en la instalacion de Hostinger. Mantener los criterios de conexion, esquema,
estrictitud y todas las filas BASE descritos arriba.

Verificacion hexadecimal opcional, sin ejecutar SQL:

```powershell
$cb2SqlBytes = [System.IO.File]::ReadAllBytes("$env:TEMP\cb2-preflight-sesion.sql")
[System.BitConverter]::ToString($cb2SqlBytes[0..5])
```

Debe imprimir `53-45-4C-45-43-54` (SELECT), nunca EF-BB-BF ni FF-FE.
--check ademas rechaza UTF-8 invalido, cabecera con comentarios, truncamiento y
cualquier cambio respecto del lote que genera esta version del repositorio.
No necesita SQL, red, variables de entorno de la aplicacion ni acceso al servidor.

Prueba de regresion:

```powershell
node --test scripts/ci/combustibles-pr2-lab/build-session-preflight.test.mjs
```

PASS local: escritura directa, ruta con espacios, equivalencia de stdout, SELECT
inicial, preflight literal una sola vez y rechazo de BOM UTF-8 (reproduce PS 5.1),
UTF-16LE, comentarios iniciales, bytes invalidos y archivo truncado. Tambien
pasaron self-test del arnes, node --check y git diff --check. Los tres contratos
SQL conservan sus blobs originales; no se ejecuto SQL ni migracion ni Hostinger.
