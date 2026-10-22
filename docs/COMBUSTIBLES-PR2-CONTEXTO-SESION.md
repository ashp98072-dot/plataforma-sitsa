# PR #507: esquema objetivo explicito y estrictitud de sesion

Auditoria 2026-10-22. Sustituye el procedimiento anterior basado en DATABASE()
constante. No se ejecuto SQL contra Hostinger, migracion ni cambios globales.

## Evidencia y causa

El operador reporto MariaDB 11.8.9, inicio en u611730801_Plataforma y fin en
information_schema, con misma conexion 198809682. STRICT_ALL_TABLES estaba activo,
foreign_key_checks/check_constraint_checks=1, pagina=16384 y
 group_concat_max_len=10485760. innodb_strict_mode=0 es un incumplimiento adicional.
Empresas=8 y usuarios=10 suman las 18 columnas visibles informadas previamente;
no significa 18 columnas en cada tabla ni prueba conformidad del contrato.

Un SELECT de metadata no selecciona por si mismo una nueva base en MariaDB.
El cambio observado es compatible con seleccion de base realizada por el cliente.
En [phpMyAdmin 5.2.2, Sql::executeQueryAndGetQueryResponse](https://github.com/phpmyadmin/phpmyadmin/blob/RELEASE_5_2_2/libraries/classes/Sql.php)
se llama selectDb($db) antes de ejecutar la consulta. Esa evidencia demuestra
que el cliente puede reseleccionar contexto; no identifica la ruta exacta que
Hostinger uso: falta su version/configuracion y una traza del cliente. No se ha
inspeccionado ni intervenido esa instalacion. No atribuir automaticamente el
problema al motor ni a perdida de conexion. Consultar information_schema no debe
cambiar el objetivo de una validacion.

Los filtros anteriores usaban DATABASE() en cada sentencia. Si el cliente elige
information_schema antes del contrato, no encuentran las tablas base y todos los
LEFT JOIN resultan ok=0. El estado final observado respalda esta explicacion,
pero no determina el instante exacto del cambio. No demuestra divergencia real
de la estructura de produccion. innodb_strict_mode=0 hace fallar entorno de forma
independiente; no explica por si mismo todos los ceros estructurales.

## Cambio de contrato de entrada; mismas comprobaciones estructurales

Preflight, los dos bloques de migrate y postcheck usan ahora @cb2_schema para
todos los filtros de esquema y referencias FK. Es un parametro obligatorio:

```sql
SET @cb2_schema = _utf8mb4'u611730801_Plataforma';
```

No se obtiene de DATABASE(), no tiene fallback y no se reinicializa en los scripts.
Si falta o apunta a un esquema de sistema, entorno falla: no puede producir CLEAN.
Se conserva CONVERT(... USING utf8mb4) COLLATE utf8mb4_bin en ambos operandos,
todas las dimensiones numericas, tipos, longitudes, nullability, EXTRA, CHECK,
generacion, claves/orden, acciones FK, conteos 86/34/18/26 y checks de entorno.
Los cuatro contratos canonicos siguen identicos. No se fuerza CLEAN.

Migracion y datos de postcheck usan nombres de tabla sin calificar. Por seguridad,
se agrega una guardia de igualdad binaria DATABASE()=@cb2_schema ANTES del bloque
DDL o de las lecturas de datos respectivamente. Si difieren, migracion emite el
error de guardia y postcheck no ejecuta el bloque de datos ni certifica FINAL.
Estas guardias solo rechazan un contexto incorrecto: la metadata ya no depende
de DATABASE(). La migracion queda reservada para un cliente de conexion unica,
sin reseleccion automatica y detenido al primer error, tras autorizacion separada.
No ejecutar migrate desde este procedimiento de phpMyAdmin.

## innodb_strict_mode por sesion

[MariaDB documenta](https://mariadb.com/docs/server/server-usage/storage-engines/innodb/innodb-strict-mode)
SET SESSION innodb_strict_mode=ON. La variable es dinamica con alcance Global y
Session; SQL estricto e InnoDB estricto son requisitos independientes.
El generador guarda ambos valores, activa STRICT_ALL_TABLES preservando los otros
modos y activa innodb_strict_mode SOLO por sesion. Luego restaura ambos.
No usa SET GLOBAL ni modifica Hostinger. El contrato sigue exigiendo
@@innodb_strict_mode=1. Si SET SESSION es rechazado o la lectura no confirma 1,
el resultado queda SIN CERTIFICAR, sin quitar esa comprobacion.

## Procedimiento manual nuevo: sin escrituras persistentes

Solo tras autorizacion explicita del operador; estos comandos locales no ejecutan
SQL ni conectan a Hostinger. Desde la raiz de la rama actual del PR:

```powershell
node scripts/ci/combustibles-pr2-lab/build-session-preflight.mjs --output "$env:TEMP\cb2-preflight-sesion.sql"
if ($LASTEXITCODE -ne 0) { throw 'Error al generar' }
node scripts/ci/combustibles-pr2-lab/build-session-preflight.mjs --check "$env:TEMP\cb2-preflight-sesion.sql"
if ($LASTEXITCODE -ne 0) { throw 'Archivo no verificado' }
```

No usar Set-Content, Out-File ni > para producirlo. Node escribe UTF-8 sin BOM,
con SELECT como primeros seis bytes (53-45-4C-45-43-54). La prueba de codificacion
sigue rechazando BOM, UTF-16LE, bytes invalidos, comentarios iniciales y truncamiento.
--check exige tambien el lote completo identico al generador y preflight actuales.

Revisar el archivo y enviar TODO en una sola ejecucion SQL de phpMyAdmin, con
u611730801_Plataforma seleccionada y parada ante el primer error. No enviar el
SET separado del contrato. No reanudar/fragmentar importaciones ni omitir
sentencias. El lote solo contiene lecturas, USE y cambios de sesion; no crea ni
modifica tablas. Guardar todas las salidas, no solo la ultima.

Criterios para interpretar la nueva evidencia:

- ANTES registra contexto y los dos modos previos.
- PREFLIGHT_INICIO y PREFLIGHT_FIN deben mostrar esquema_objetivo exacto
  u611730801_Plataforma, esquema_correcto=1 (ahora valida el objetivo explicito),
  estricto=1 e innodb_strict_mode=1. El FIN debe mostrar misma_conexion=1.
- esquema_actual es diagnostico. Puede ser information_schema al final: ya no
  invalida por si solo la metadata ni cambia el objetivo de los filtros.
- Exigir TODAS las verificaciones BASE en 1 y base_compatible=1. Con cero tablas
  CB2 corresponde CLEAN; cualquier otra divergencia conserva su significado.
  Si quedan objetos BASE en cero, revisar sus metadatos, sin atribuirlos al contexto.
- RESTAURADO debe coincidir con los dos modos originales; en este caso se espera
  innodb_strict_mode=0 de nuevo. Ante error, detenerse y cerrar la conexion de BD,
  sin depender de un futuro envio para restaurar estado.

La misma conexion no garantiza esquema constante, pero sigue siendo necesaria
para conservar @cb2_schema y los ajustes SESSION. Si se pierde el parametro o
cualquiera de las evidencias, queda SIN CERTIFICAR. Las cookies o conexiones
persistentes de phpMyAdmin no garantizan estado entre envios:
[mysqli documenta limpieza de variables](https://www.php.net/manual/en/mysqli.persistconns.php).
No es necesario hacer otra sonda ni cambiar phpMyAdmin para la nueva prueba.

## Migracion/postcheck futuros: NO autorizados por esta auditoria

En cada ejecucion independiente, cliente MariaDB de conexion unica con DELIMITER,
sin --force: USE del esquema, SET @cb2_schema explicito, guardar los dos modos,
SET SESSION sql_mode agregando STRICT_ALL_TABLES sin borrar los existentes y
SET SESSION innodb_strict_mode=ON; confirmar los valores y ejecutar el script
completo autorizado. Restaurar ambos solo al terminar las comprobaciones.
No heredar sesion del preflight, no prometer rollback global de DDL y no reintentar
un parcial. Las guardias nuevas impiden operar en otro esquema seleccionado.

## Pruebas y limites

Ejecutadas localmente: node --test del generador; self-test del arnes;
node --check de los JS modificados; git diff --check. Las pruebas estaticas
exigen cuatro contratos iguales, ausencia de DATABASE() dentro del contrato,
los 16 cruces de esquema explicito, controles estrictos y guardias del DDL/datos.
Los casos negativos rechazan reintroducir DATABASE() o quitar InnoDB estricto.
La regresion de codificacion verifica bytes, stdout y preflight literal completo.

El arnes de laboratorio recibe @cb2_schema='cb2_lab' por conexion y agrega casos
para contexto information_schema (debe CLEAN), objetivo NULL (DIVERGENTE) e
InnoDB no estricto (DIVERGENTE). Esos escenarios de motor se agregaron pero NO
se ejecutaron: requieren laboratorio MariaDB autorizado. Las pruebas estaticas
no demuestran el resultado real de SQL ni reproducen phpMyAdmin.
No hubo SQL de produccion, Docker, workflows, migraciones ni merge.
