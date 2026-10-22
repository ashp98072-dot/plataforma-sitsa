# Laboratorio remoto del PR #507 — pendiente de aprobación y ejecución

Correccion #2014: import silencioso + prueba mysqli real sin next_result().
Consultar el procedimiento phpMyAdmin actualizado y evidencia sin-resultados.
El runner Windows requiere tambien PHP portable (mbstring/mysqli) y sql-parser
5.10.0 de phpMyAdmin bajo .lab-runtime; no se suple su ausencia omitiendo la prueba.

Importacion phpMyAdmin autocontenida y pruebas nuevas: ver
[procedimiento](../../../docs/COMBUSTIBLES-PR2-IMPORT-PHPMYADMIN.md).
El SQL exacto publicado es sql/import-phpmyadmin-2026-10-combustibles-pr2.sql;
no importar el migrate canonico aislado sin su preparacion de sesion.

Actualizacion: el laboratorio portable MariaDB 11.8.9 ya se ejecuto; ver
[informe de resultados](../../../docs/COMBUSTIBLES-PR2-LAB-RESULTADOS-MARIADB-11.8.9.md).
Las menciones historicas a escenarios pendientes quedan sustituidas por ese informe;
la ruta remota Actions y la ejecucion en produccion siguen sin realizarse.

Parametro obligatorio: los tres SQL requieren `SET @cb2_schema` explicito en la
misma conexion, sin fallback a DATABASE(). El arnes lo fija a cb2_lab por query.
Ver [procedimiento actualizado](../../../docs/COMBUSTIBLES-PR2-CONTEXTO-SESION.md).
Los nuevos casos de contexto information_schema, objetivo NULL e InnoDB no
estricto requieren laboratorio aprobado; no se ejecutaron con el self-test.

Este directorio contiene exclusivamente un arnés de pruebas SQL y fixtures sintéticos.
No es un servicio de la aplicación. Los tres scripts SQL auditados se leen sin modificarlos.
El PR debe permanecer Draft. Publicar este workflow no autoriza ejecutarlo ni hacer merge.

## Ejecucion portable Windows autorizada el 2026-10-22

El usuario autorizo ejecutar las pruebas pendientes en una base aislada, sin produccion.
Se agrega run-portable-windows.mjs para compartir la MISMA suite/aserciones con un
servidor MariaDB 11.8.9 portable. No simula Docker ni falsea GITHUB_ACTIONS; las
guardias del backend Actions siguen intactas. La ruta remota descrita abajo sigue
requiriendo su launcher/environment y no se publico ni ejecuto.

El backend portable solo acepta --run-isolated y binarios en .lab-runtime dentro
del checkout. Requiere ZIP 11.8.9 y sha256sums.txt oficiales; comprueba el hash ZIP,
registra hashes de binarios/fuentes y crea un datadir NUEVO con UUID por escenario.
No lee .env, dumps, credenciales o archivos de configuracion de MySQL instalados.
No instala servicio; servidor y cliente usan --no-defaults. Servidor con
--skip-networking y named pipe de UUID; cliente --protocol=PIPE --host=. y ese
socket fijo, sin parametros de host/URL. Verifica @@skip_networking=1, @@named_pipe=1,
@@socket, @@datadir y VERSION() antes de crear cb2_lab o aplicar fixtures.
Entorno de procesos reducido a variables del sistema y TEMP de este run, sin tokens.

Es aislamiento de base/proceso, no un contenedor ni una VM: no hay limites Docker
de CPU/memoria/red del sistema operativo. El canal local named pipe se distingue
del socket Unix del laboratorio remoto; TCP esta deshabilitado. No se accede a
ninguna base preexistente ni al servicio MySQL instalado en el equipo.
La limpieza usa SHUTDOWN en ese canal exclusivo y confirma que deja de aceptar
conexiones. Se conservan datadirs sinteticos y evidencia bajo .lab-runtime (ignorado
por Git); no se ejecuta prune ni borrado global. No habilita ejecucion automatica.

Preparacion desde raiz de este checkout (PowerShell; descarga oficial, sin instalar):

```powershell
New-Item -ItemType Directory -Force .lab-runtime | Out-Null
curl.exe --fail --location --output .lab-runtime/mariadb-11.8.9-winx64.zip https://archive.mariadb.org/mariadb-11.8.9/winx64-packages/mariadb-11.8.9-winx64.zip
curl.exe --fail --location --output .lab-runtime/sha256sums.txt https://archive.mariadb.org/mariadb-11.8.9/winx64-packages/sha256sums.txt
# Comprobar SHA-256 oficial ANTES de extraer/ejecutar:
Get-FileHash -Algorithm SHA256 .lab-runtime/mariadb-11.8.9-winx64.zip
# Esperado: 830c46727d9278eae212ae3eca44eeb9e71b2a68704e95f344a64fba7b1963f5
Expand-Archive -LiteralPath .lab-runtime/mariadb-11.8.9-winx64.zip -DestinationPath .lab-runtime
node scripts/ci/combustibles-pr2-lab/run-portable-windows.mjs --run-isolated
```

El runner no descarga nada ni acepta binarios externos por argumento. stdout indica
el directorio de evidencia del run; summary.json PASS solo aparece si concluye toda
la suite. No inferir PASS de los self-tests en memoria. No ejecutar este comando
como rutina sin revisar el alcance/autorizacion del laboratorio.

## Entrada y seguridad del backend remoto (no ejecutado)

Workflow: `.github/workflows/combustibles-pr2-sql-lab.yml`.

- Único evento: `workflow_dispatch`; sin push, pull_request, schedule, workflow_run o workflow_call.
- Único input: confirmación booleana de aprobación independiente, por defecto false.
  Es una declaración del operador, no sustituye la revisión ni constituye un gate externo de aprobadores.
- Launcher restringido al repositorio y refs/heads/main; fuente fijada a un SHA literal auditado de #507.
  La plantilla local contiene un SHA cero y falla antes del checkout.
- Runner efímero hospedado por GitHub, Ubuntu 24.04; nunca self-hosted ni equipo local.
- `contents: read`; sin permisos de escritura, secrets, OIDC ni SSH. Environment exclusivo
  cb2-sql-lab-auditado sin secretos, con aprobacion independiente obligatoria (ver abajo).
  GitHub puede registrar un deployment del environment; no despliega la aplicacion.
- Checkout del SHA literal auditado, comprobado con git rev-parse HEAD; sparse checkout de fixtures/arnés y tres SQL; persist-credentials false.
  Actions fijadas a SHA completo. No npm install, imports de aplicación, .env ni dumps.
- MariaDB 11.8 descargada de imagen oficial. El tag se resuelve a RepoDigest antes de iniciar contenedores;
  todos los escenarios usan ese mismo digest y cada servidor debe identificar VERSION() como 11.8.x MariaDB.
  El tag inicial puede cambiar entre ejecuciones: registrar/revisar digest; no se promete un digest fijo entre runs.
- Docker usa exclusivamente el socket Unix del runner, argumentos sin shell, HOME/configuración registry vacíos
  y entorno reducido sin heredar credenciales/tokens. Rechaza overrides de endpoint Docker.
- Cada escenario crea un contenedor con UUID propio, etiqueta run_id/attempt, network none, skip-networking,
  ningún puerto publicado, ningún bind mount ni volumen persistente; datadir y socket en tmpfs.
- Cuenta root local vacía, solo por socket interno del contenedor descartable. No credenciales productivas.
- Inspección obligatoria de aislamiento antes del SQL. No hay parámetros de host, URL, SQL o rutas arbitrarias.
- Los ALTER de pruebas negativas afectan únicamente al esquema sintético cb2_lab del contenedor nuevo.
  No se modifican tablas históricas reales ni archivos de migraciones históricas.
- Limpieza en finally y paso always: solo nombres/etiquetas registrados de este run, nunca prune ni rm global.
- Límite de 20 minutos; recursos del contenedor limitados y escenarios secuenciales.

El runner necesita salida a GitHub/Docker Hub para checkout, descarga de imagen y artefactos.
Esto no equivale a aislamiento de red de TODO el runner: el aislamiento de red se aplica al servidor MariaDB.
El arnés no tiene código de conexión a servicios externos de BD, cliente TCP, Hostinger o producción.

## Archivos

- `base.sql`: nueve tablas mínimas compatibles con contrato BASE; datos de dos empresas, tres proveedores,
  un usuario y dos vehículos sintéticos, uno compartido. No copia el esquema completo ni datos reales.
- `seed.sql`: importación, facturas, consumo sin factura y evidencia ORIGEN sintéticos.
- `associate.sql`: asociación documental y dos eventos de una misma posición/revisión dentro de REANUDAR.
- `run.mjs`: arnés sin dependencias, comandos Docker fijos y comprobaciones de resultados/errors concretos.

El fixture base está escrito explícitamente; no se genera desde los manifiestos durante el test.
`archivo_sha256` histórico está incluido por la dependencia del índice C2B.
La equivalencia es solo respecto al contrato mínimo, no demuestra equivalencia con el esquema desplegado.

## Comprobaciones previstas

1. BASE compatible, preflight CLEAN y postcheck previo SIN certificación de datos (DIVERGENTE).
2. Migración completa sin errores; resultado APLICADA_PENDIENTE_POSTCHECK FINAL.
3. Preflight FINAL, postcheck FINAL y exactamente 15 comprobaciones únicas en cero.
4. Conteos independientes de information_schema: 4 tablas, 86 columnas, 34 índices, 18 FKs y 26 CHECK;
   SHOW CREATE de las cuatro tablas para auditoría, versión y variables efectivas.
5. JSON_TABLE efectivo; estado STORED PENDIENTE_FACTURA -> FACTURADO al asociar.
6. Vehículo compartido aceptado; dos eventos legítimos misma fila/revisión; evidencia ORIGEN sin cambios;
   tres filas de diario y un solo consumo referenciado; postcheck sigue FINAL.
7. Rechazo por FK (1452): empresa/proveedor/factura incompatibles y vehículo inexistente.
8. Rechazo por CHECK (4025): asociación sin actor, NULL con metadata, JSON inválido, marca ORIGEN NULL.
9. Duplicados (1062) con nombre de índice comprobado: ordinal repetido y segundo ORIGEN misma posición.
10. Repetir migración con FINAL rechaza por SIGNAL (1644); rechazos transaccionales no corrompen el postcheck.
11. Diario incompleto con CHECK individual válido: preflight FINAL, postcheck DIVERGENTE e incidencia concreta.
12. Contenedor nuevo parcialmente migrado: DIVERGENTE, SIGNAL, solo una tabla CB2 y ninguna consulta DATO.
13. Contenedores nuevos con longitud, CHECK o unicidad de índice alterados: DIVERGENTE, SIGNAL y sin DATO.
14. BASE sintética incompatible: DIVERGENTE, SIGNAL y cero tablas CB2 creadas.

Los errores negativos DML requieren codigo, SQLSTATE y nombre exacto de constraint/indice.
Un error de sintaxis o conexión no cuenta como rechazo exitoso de integridad.
La primera prueba positiva fallida detiene la suite: casos posteriores quedan NO EJECUTADOS, no PASS.
Si el motor normaliza expresiones de otra forma y preflight falla, conservar metadata y someter corrección
a auditoría; no relajar guards, desactivar constraints ni parchear SQL automáticamente.

## Evidencia

Artefacto `cb2-sql-lab-<run_id>-<attempt>`, retención 14 días (o política menor de la organización):

- SHA del checkout, hashes SHA-256 de SQL/fixtures/arnés, fecha UTC y digest de imagen.
- Cada SQL enviado, stdout, stderr, código de salida y errores de proceso.
- Versiones/variables, SHOW CREATE, inspecciones de aislamiento y logs de contenedores.
- results.json, summary.json, failure.txt si aplica y cleanup.json.

Solo se sube RUNNER_TEMP/cb2-sql-lab/evidence, incluso en fallos; no workspace completo, Docker config,
variables de entorno, GITHUB_TOKEN ni archivos ocultos. El registro interno de nombres no se sube.
Una cancelación forzada/fallo del runner puede impedir subir artefactos; los logs del run y el estado
cancelled/failure no deben confundirse con una ejecución certificada. La VM es efímera.

## Aprobación y primera ejecución: limitación de GitHub

**No ejecutado; no se ha enviado workflow_dispatch.**

La propuesta requiere publicar **unicamente** el archivo
`.github/workflows/combustibles-pr2-sql-lab.yml` en main mediante un cambio separado autorizado.
La version local es la plantilla concreta: unico trigger workflow_dispatch, ejecucion solo desde
main, environment obligatorio, checkout sparse de un SHA literal y acciones fijadas a SHA completo.
No admite inputs de codigo/ref ni ejecuta la punta de una rama. No se copia SQL, fixtures, arnes
ni codigo de aplicacion a main. El PR #507 debe permanecer Draft y sin merge.

Secuencia propuesta, NO autorizada ni realizada:

1. Auditar estos cambios y crear un commit de fuente en la rama de #507. Publicarlo requiere
   autorizacion posterior. Registrar su SHA completo e inmutable.
2. En un cambio separado autorizado para main, publicar solo el YAML indicado, sustituyendo sus
   40 ceros en CB2_AUDITED_SHA por ese SHA auditado. No usar variables de repositorio, inputs
   ni refs moviles para elegir codigo. El workflow proviene de main y el codigo de otro commit:
   no hay dependencia circular del SHA. Cambiar el SHA exige otra revision del YAML.
3. Antes de habilitarlo, un administrador autorizado debe crear cb2-sql-lab-auditado SIN secretos:
   required reviewers independientes, Prevent self-review, impedir bypass de administradores,
   deployment branch policy exclusivamente main. Verificar que plan/visibilidad permiten estas
   protecciones; si no, mantener bloqueado. Un environment creado automaticamente sin reglas
   o el booleano auditoria_aprobada NO satisfacen la autorizacion independiente.
4. Tras autorizacion independiente, seleccionar main en el dispatch y auditoria_aprobada=true.
   El job espera la aprobacion del environment antes de cualquier paso. El revisor comprueba
   SHA del workflow en main, SHA fijo de fuente y alcance del laboratorio.

No se modifico main, no se configuraron environments ni se envio dispatch. La plantilla en esta
rama rechaza dispatch de esta rama. Publicarla aqui no habilita el laboratorio. Este launcher
solo permite un commit auditado; no pretende impedir que un administrador altere las politicas
o publique otros workflows. No se eluden permisos GitHub.

Referencias oficiales:
- [GitHub: workflow_dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch).
- [GitHub: reviewers, self-review, bypass y disponibilidad](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).



## Verificación local de preparación

Ejecutar solo controles estáticos, sin Docker ni SQL:

```text
node --check scripts/ci/combustibles-pr2-lab/run.mjs
node scripts/ci/combustibles-pr2-lab/run.mjs --self-test
```

--self-test valida aserciones de resultados (incluidos falsos positivos/negativos) y equivalencia de los
bloques canónicos SQL; no intenta iniciar procesos Docker. --run y --cleanup exigen contexto Actions
github-hosted/manual/repositorio/main, SHA auditado no nulo y confirmacion manual.

Estado al preparar el commit: pruebas de motor PENDIENTES DE APROBACIÓN Y EJECUCIÓN.
Verificación local ejecutada: node --check, --self-test y ESLint del arnés sin errores;
parseo YAML y controles estáticos de trigger/permisos/acciones fijadas correctos, sin ejecutar SQL.
Estas comprobaciones no implementan permisos de aplicación, canonización de huellas, concurrencia,
filesystem/auditoría de servicios ni pruebas de producción. No demuestran seguridad de una migración real.


## Aislamiento y limpieza de cada rechazo DML

Cada query inicia un proceso docker exec/mariadb independiente por socket interno. Debe terminar
con status=1, sin error de spawn, timeout ni senal y un unico diagnostico SQL reconocido:
1452/23000 + FK exacta, 4025/23000 + CHECK exacto o 1062/23000 + indice exacto.
Los guards requieren 1644/45000 y mensaje literal. Sintaxis, conexion, nombres parecidos,
SQLSTATE incorrecto o multiples errores causan FAIL.

rejectTransaction envia START TRANSACTION y una sola sentencia DML sin COMMIT. No depende de
un ROLLBACK posterior al error: InnoDB revierte la transaccion abierta al cerrar la conexion.
Antes y despues, otras conexiones leen las 13 tablas BASE/CB2 completas: columnas ordenadas y tipadas,
NULL separado de vacio, longitud en bytes y HEX por celda, filas ordenadas en memoria y duplicados preservados. Se comparan
instantaneas completas, no solo conteos/checksums. La suite es secuencial y sin otros escritores.
SQL/salidas quedan en evidencia; truncamiento o fallo de lectura aborta. No se exige restaurar
contadores internos AUTO_INCREMENT: un INSERT rechazado puede consumir valores sin cambiar filas.

El control posterior se ejecuta en finally incluso si falla la expectativa del rechazo. Cada caso
exige datos identicos y postcheck FINAL con las 15 incidencias en cero antes de PASS; se conserva
ademas el postcheck agregado. Al fallar se aborta y la limpieza del contenedor continua en finally
mas el paso always, verificando identidad/aislamiento antes de eliminarlo. Timeout/cancelacion
nunca certifican limpieza ni PASS; VM y tmpfs son efimeros.

Empresa/proveedor cruzados anulan factura y su metadata para aislar fk_cb2c_importacion;
empresa=2 usa proveedor=3 valido para esa empresa. No dependen del orden de varias FKs invalidas.

Estado: solo verificaciones estaticas locales. Rollback efectivo, diagnosticos reales y FINAL
tras rechazos siguen pendientes del laboratorio autorizado; no hay certificacion de motor.

## Revision local del 22 de octubre de 2026

PASS: node --check, --self-test, ESLint del arnes, parseo YAML con js-yaml y aserciones
estaticas de trigger unico, permisos read, main, environment, SHA cero bloqueante, checkout
fijado/verificado, actions por SHA y cleanup always. git diff --check sin errores.
Los cuatro archivos originales del commit ac8aecd8 permanecen intactos.
No se ejecuto Docker, SQL, workflows, push ni merge; no se accedio a Hostinger ni secretos.
No se modifico el estado remoto del PR ni main. El documento de laboratorio no rastreado
preexistente se dejo intacto. Estos tres archivos se preparan en un commit exclusivamente local; requieren nueva auditoria.

## Compatibilidad documental del environment y propietario unico

Consulta oficial del 22 de octubre de 2026, sin consultar ni cambiar configuracion remota:

- Los environments y sus reglas de proteccion estan disponibles en repositorios publicos con
  todos los planes actuales de GitHub; los planes legacy Bronze/Silver/Gold quedan excluidos.
  Required reviewers es compatible con repositorios publicos, incluido GitHub Free.
- Los revisores de environment necesitan al menos acceso de lectura, no escritura. Por tanto,
  que el propietario sea el unico usuario con escritura NO implica por si solo que sea imposible
  designar un revisor independiente. Debe existir otra persona elegible, configurada expresamente
  como required reviewer, que efectivamente revise y apruebe; no se presume por ser publico.
- Si el propietario inicia el workflow y es el unico required reviewer, Prevent self-review le
  impide aprobar ese job. Sin otro revisor elegible y sin bypass permitido, el job no puede avanzar
  por aprobacion. Desactivar self-review o usar bypass no satisface la independencia exigida.
- La revision de ChatGPT en este chat no equivale a la aprobacion de un usuario revisor en GitHub.
  No se comprobo que cb2-sql-lab-auditado exista o tenga reglas/revisores; se considera pendiente.
  Nombrarlo en YAML no configura sus protecciones y GitHub puede crearlo sin reglas. Mantener
  el SHA cero y no publicar/ejecutar hasta verificar configuracion y revisor independiente real.

Fuentes oficiales:
- [Disponibilidad y creacion de environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
- [Required reviewers, acceso minimo y Prevent self-review](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#required-reviewers).

## Correccion puntual de dataSnapshot para nueva auditoria

Solo cambios locales, pendientes de revision/publicacion; no se ejecuto SQL ni Docker.
Se reemplaza CONCAT_WS por tres campos independientes por columna: indicador N/V, longitud
OCTET_LENGTH y HEX. No hay concatenacion SQL entre columnas. El transporte solo usa N/V,
digitos decimales y HEX mayusculo: tabs/newlines del valor se codifican como bytes HEX. NULL
exige N/0/vacio y un valor vacio exige V/0/vacio. El parser valida aridad exacta, HEX par valido
y que longitud declarada coincida con todos los bytes recibidos. No usa trim ni elimina vacios.
La representacion final es JSON de arrays de celdas, con limites explicitos, sin hashes.

El inventario exige los nombres de las 13 tablas y ordinales continuos de sus columnas. Incluye
nombre, DATA_TYPE, COLUMN_TYPE (precision/escala), charset, collation, nullability y EXTRA de
cada columna; cambiar tipo/orden cambia el snapshot. Solo se admiten los tipos presentes en
los fixtures y SQL auditados: tinyint/int/bigint/decimal/date/datetime/char/varchar/text/longtext.
Un tipo nuevo falla hasta tener una codificacion revisada. Para escalares se usa CAST AS CHAR
CHARACTER SET utf8mb4 antes del CAST AS BINARY y HEX, sin longitud ni conversion JS a Number:
HEX(numero) directamente puede convertirlo a BIGINT y perder fracciones. Las cadenas se leen
como bytes sin transcodificarlas. Se fija UTC para la sesion. Se comparan valores SQL logicos,
incluidas generated; no paginas fisicas, padding interno de CHAR ni contadores AUTO_INCREMENT.

Cada tabla se lee en una conexion independiente con transaccion WITH CONSISTENT SNAPSHOT,
COUNT(*) antes/despues y warning_count de la serializacion igual a cero. Se exige conteo
identico y que coincida con las filas recibidas usando BigInt. Un marcador final obligatorio
permite rechazar salidas incompletas. No se usan GROUP_CONCAT, LIMIT, cast con longitud ni
ordenacion por collation SQL: se ordenan en JS las filas completas codificadas, preservando
multiplicidad. La suite es secuencial, sin otros escritores entre tablas. El limite de salida
de spawnSync sigue siendo 16 MiB: excederlo produce error de proceso y FAIL, nunca un snapshot
recortado aceptado. Tambien fallan warnings, bytes faltantes, columnas omitidas o datos corruptos.
Las comprobaciones posteriores de rechazo/conexion independiente y postcheck FINAL se conservan.

El self-test ejecuta solo funciones JS: extrae las tres filas de compras_proveedores del fixture
base y comprueba cambios de nombre, empresa, activo, NULL/vacio, eliminacion y duplicacion.
Un lector simulado ejercita el mismo dataSnapshot en las 13 tablas y detecta una mutacion en
cada tabla y un inventario incompleto. Otros casos cubren limites de columna, separadores,
NUL/tab/newline, Unicode, texto de 100000 bytes, tipos distintos, decimales que difieren solo
en fracciones, microsegundos, reordenacion equivalente, cero filas, longitudes incorrectas,
HEX invalido/truncado, columnas perdidas, warning y falta de marcador/terminador.
Estas pruebas demuestran el comparador/parser y la construccion estatica del SELECT, no que
MariaDB haya ejecutado o validado esa consulta. La comprobacion de motor queda pendiente.

Fuentes oficiales consultadas para la codificacion:
- [HEX: numeros frente a cadenas](https://mariadb.com/docs/server/reference/sql-functions/string-functions/hex).
- [CAST y charset explicito](https://mariadb.com/docs/server/reference/sql-functions/string-functions/cast).
- [OCTET_LENGTH en bytes](https://mariadb.com/docs/server/reference/sql-functions/string-functions/octet_length).

Preparacion adicional del cliente de prueba PHP (sin instalar servicios):

```powershell
curl.exe --fail --location --output .lab-runtime/php.zip https://windows.php.net/downloads/releases/archives/php-8.4.14-nts-Win32-vs17-x64.zip
curl.exe --fail --location --output .lab-runtime/sql-parser.zip https://github.com/phpmyadmin/sql-parser/archive/refs/tags/5.10.0.zip
Expand-Archive -LiteralPath .lab-runtime/php.zip -DestinationPath .lab-runtime/php
Expand-Archive -LiteralPath .lab-runtime/sql-parser.zip -DestinationPath .lab-runtime
```

La suite portable invoca el driver mysqli con mbstring/mysqli habilitados.
No se necesita servidor web ni una instalacion phpMyAdmin, y esto no certifica
la UI/version exacta de Hostinger. El flujo probado no usa next_result().
