# Canecas FIFO: evidencia comunicada del servidor previsto

Evidencia proporcionada por el operador, no observada directamente desde este entorno. El diagnóstico fue de solo lectura; ninguna entrada autoriza instalación o merge.

| Comprobación | Evidencia | Interpretación |
| --- | --- | --- |
| Versión | `11.8.9-MariaDB-log` | Coincide con el patrón de versión del preflight; no prueba compatibilidad completa del contrato. |
| Motor | InnoDB predeterminado; tablas base comunicadas InnoDB | Alineado con las FK y transacciones; comprobar las ocho tablas exigidas y sus columnas e índices. |
| Integridad | `foreign_key_checks=ON`, `check_constraint_checks=ON` | Alineado si esos valores corresponden a la sesión del instalador. |
| Modo SQL | `NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION` | El instalador agrega `STRICT_TRANS_TABLES` solo en su conexión si falta un modo estricto, conserva los modos previos, verifica el resultado y restaura el modo original al terminar. Se ensayó en laboratorio; la sesión real debe verificarse por separado. |
| InnoDB estricto | `OFF` | No es lo mismo que SQL estricto. El instalador de esta rama intenta activarlo únicamente en su sesión y se detiene antes del DDL si falla. Lo restaura al finalizar y no cambia la configuración global. |
| Charset y collation | `utf8mb4`; Canecas `utf8mb4_unicode_ci`; empresas/usuarios `utf8mb4_uca1400_ai_ci` | Las FK nuevas declaradas usan columnas numéricas, por lo que el cotejamiento de tabla no decide su compatibilidad. Deben comprobarse tipos, signos e índices reales; comparaciones de texto requieren revisión específica. |
| Objetos FIFO | Tablas y triggers nuevos reportados ausentes | Compatible con una instalación nueva solo si la visibilidad es completa y no existen columnas u otros objetos parciales. |
| Metadatos | Operador confirma 8 tablas, 70 columnas, 63 entradas de índices y 28 filas de FK | Visibilidad confirmada por el operador; compatibilidad de tipos aún parcial. Comparar signos, tipos, índices y referencias columna por columna con el preflight. |
| Permisos | phpMyAdmin muestra ALL PRIVILEGES sobre la base | Aplica a esa cuenta efectiva; no demuestra permisos de la conexión del instalador ni de la aplicación. No compartir credenciales. |

El archivo `sql/diagnostico-canecas-metadatos-auxiliar.sql` permite contrastar identidad de sesión, `DATABASE()`, conteos sin filtrar tablas, filtro binario exacto, y `SHOW CREATE TABLE`. Ejecutar los bloques de forma individual en la misma conexión, sin pegar credenciales ni información de cuentas sin redactar. Que `SHOW CREATE TABLE` funcione y `information_schema` siga vacío debe tratarse como anomalía de visibilidad o filtrado pendiente de diagnóstico, no como prueba de que faltan objetos.

El usuario de aplicación puede identificarse de forma segura desde la configuración de despliegue o mediante `USER()` y `CURRENT_USER()` en una sesión de lectura autenticada como esa cuenta; no exponer la contraseña. Una consulta desde phpMyAdmin identifica exclusivamente su propia conexión. Comparar también la cuenta del instalador, que puede ser distinta de ambas.

**NO APTO PARA MERGE ni instalación:** faltan completar la comparación de tipos e índices reales, comprobar que la cuenta real pueda aplicar y mantener el modo de sesión y que sus permisos sean efectivos, validar el contrato y revisar el impacto de InnoDB estricto. Hostinger despliega automáticamente al fusionar; merge y despliegue siguen sin autorización.

El ensayo reproducible `node scripts/ci/canecas/run-costos-lab-wip.mjs --run-hostinger-tls` inicia MariaDB 11.8.9 desechable con modo global comunicado e `innodb_strict_mode=0`. La CLI instaló mediante TLS con una cuenta restringida, y una conexión distinta y el modo global no cambiaron. Otra prueba deshabilitó FK y CHECK, cada uno por separado y solo en su sesión de laboratorio: el preflight rechazó la instalación, no agregó columnas y restauró el modo SQL inicial. El cliente puede agregar `IGNORE_SPACE` a la sesión; el instalador conserva los modos efectivos existentes. Las doce operaciones DDL se ejecutan por separado y se consulta `SHOW WARNINGS` inmediatamente después de cada una; cualquier advertencia detiene el proceso. La prueba de advertencia es sintética, inyectada sobre una conexión real, y deja deliberadamente el primer ALTER aplicado para verificar que el reintento se bloquea.

## Bloqueo de instalación y recuperación

El instalador se detiene antes del primer DDL: está pendiente un contrato completo del esquema base real y una comparación automática contra metadatos visibles en la misma conexión. El contrato de objetos posteriores generado en MariaDB de laboratorio no acredita el estado de Hostinger. Para habilitar la instalación se requiere evidencia revisada y comparación de motores, columnas (tipos, signo, nulabilidad, valores predeterminados, charset y collation), claves primarias e índices completos y ordenados, FK y sus acciones, y CHECK. La evidencia incompleta o sin visibilidad suficiente no permite concluir compatibilidad.

Se activan temporalmente SQL estricto e `innodb_strict_mode` en la sesión del instalador; se comprueban y se restauran sus valores originales al finalizar, incluso cuando el preflight falla. También se libera el bloqueo cooperativo. Es necesario verificar permisos y comportamiento de la cuenta real; el bloqueo no impide DDL de otros clientes.

El ciclo preparado ejecuta las doce operaciones individualmente y consulta `SHOW WARNINGS` después de cada una. Una advertencia detiene la ejecución y registra sus detalles; un error conserva operación, código, SQLSTATE disponible y mensaje original. La prueba de advertencia inyectada es sintética y no demuestra que MariaDB haya generado esa advertencia.

El DDL puede confirmar cambios de forma implícita: detenerse no revierte operaciones anteriores ni garantiza que la operación con advertencia no haya quedado aplicada. No reintentar a ciegas; conservar los datos y realizar diagnóstico y recuperación supervisados según el estado real. La instalación exitosa y su restauración en la misma conexión quedan pendientes mientras exista el bloqueo del contrato base.

## Evidencia necesaria para el contrato base

En phpMyAdmin, el operador debe seleccionar la base prevista y ejecutar `sql/contrato-base-canecas-solo-lectura.sql` por bloques en una misma conexión con visibilidad completa. Entregar las cinco salidas completas, incluidos conjuntos vacíos, NULL, orden y nombres de campos, junto con versión y los ocho `SHOW CREATE TABLE` del diagnóstico `sql/diagnostico-canecas-metadatos-auxiliar.sql`. También debe aportar el resultado de sus comprobaciones de visibilidad e identidad de la conexión, y confirmar la correspondencia con la base prevista y la cuenta del instalador. Redactar identidades, hosts y grants antes de compartir; no enviar contraseñas ni filas de negocio. Un conjunto vacío por sí solo no demuestra ausencia de FK o CHECK: contrastar permisos y definiciones `SHOW CREATE`; metadatos ausentes, truncados o invisibles son no concluyentes.

`scripts/ci/canecas/contrato-base.mjs` obtiene las cinco secciones de esas mismas consultas y compara exactamente campos, valores y orden de filas, incluidos los ordinales de índices y FK. Recibe explícitamente un contrato esperado; no incorpora ningún contrato de Hostinger ni interpreta una coincidencia como aprobación. Los nombres de esquema referenciado se comparan literalmente. Antes de usarlo para una decisión se requiere un contrato esperado completo, revisado y trazable al entorno real y una comprobación independiente de visibilidad y de que la captura no cambió; la comparación no prueba permisos completos ni evita cambios concurrentes. El instalador conserva su bloqueo incondicional anterior al DDL, incluso si la comparación coincide.

## Diagnóstico de filtros de metadatos

El operador informó TABLES/COLUMNS/STATISTICS vacíos y 28 FK y 7 CHECK en Hostinger; esa combinación es contradictoria y no demuestra ausencia ni compatibilidad. En MariaDB 11.8.9 de laboratorio, con ocho tablas existentes, los conteos con y sin BINARY fueron iguales: TABLES 8, COLUMNS 70, STATISTICS 63, KEY_COLUMN_USAGE 67 y TABLE_CONSTRAINTS 46 (estos dos últimos incluyen todas las restricciones, no solo FK o CHECK). La anomalía de Hostinger no se reprodujo; no se conoce su causa. No extrapolar este resultado al proveedor.

Ejecutar `sql/diagnostico-canecas-comparacion-solo-select.sql` en phpMyAdmin y en una conexión de solo lectura autenticada como la cuenta prevista para el instalador, en la misma base seleccionada. Las sesiones deben examinarse por separado: la identidad de phpMyAdmin no prueba la del instalador. Redactar cuentas, hosts, nombres de base y otros nombres sensibles antes de compartir, sin alterar indicadores ni bytes HEX pertinentes. El bloque final enumera nombres visibles de tablas de la base; redactar nombres ajenos a Canecas antes de compartir. Entregar todos los resultados, incluso errores y conjuntos vacíos. Una fila ausente o un conteo cero es no concluyente: contrastar con el diagnóstico auxiliar y visibilidad antes de decidir. Las consultas de contrato usan filtros sin BINARY, pero el comparador exige nombres exactos; cualquier discrepancia detiene la comparación.

El comparador rechaza secciones vacías, secuencias incompletas e inconsistencias visibles entre columnas, índices y FK. Un esquema que legítimamente no tenga FK o CHECK también se rechaza por precaución: los metadatos por sí solos no garantizan visibilidad completa. Una comparación coincidente tampoco acredita que la captura sea completa, ni sustituye evidencia independiente del operador y contrato esperado revisado. El instalador sigue bloqueado mientras no exista y coincida el contrato validado.


## Entrada de contrato y bloqueo

El archivo fijo `scripts/ci/canecas/contrato-base-hostinger-validado.json` no est? incluido: ?nicamente debe incorporarse despu?s de revisar la evidencia completa del esquema real. Su formato es `{ "formato": 1, "base": "nombre_exacto", "contrato": { "tablas": [], "columnas": [], "indices": [], "foraneas": [], "checks": [] } }`, con las filas completas y campos de `obtenerContratoBase`. Los arreglos vac?os mostrados son solo una descripci?n de forma y no son un contrato v?lido. El archivo debe corresponder a la base seleccionada en la conexi?n instaladora. No se admite una ruta alternativa suministrada por el llamador.

El instalador lee el contrato, consulta las cinco secciones en la misma conexi?n y las compara antes de la primera operaci?n DDL. Archivo ausente o inv?lido, base distinta, evidencia incompleta, error de consulta o cualquier diferencia detiene la ejecuci?n. La comparaci?n no demuestra que la evidencia de origen sea aut?ntica o completa: la revisi?n del contrato y la visibilidad de la cuenta instaladora siguen siendo requisitos previos. No se considera verificada la compatibilidad real de Hostinger.

