# Instalación manual por etapas (phpMyAdmin) de la simplificación de Canecas (#688)

Estado: **PREPARADA Y PROBADA EN MARIADB 11.8.9 DESECHABLE. NO EJECUTADA EN PRODUCCIÓN.** Requiere respaldo restaurable verificado, Canecas sin escrituras y
**autorización expresa del propietario**. Solo el propietario ejecuta SQL en Hostinger y hace el merge a `main`.

Equivale exactamente a `sql/migrate-2026-11-canecas-simplificacion-wip.sql` del SHA `8361a1f` (la misma que instala `scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs`),
partida en 6 etapas de escritura auditables, con 8 verificaciones de solo lectura, una prueba previa del cliente (00) y un diagnóstico de recuperación (15). Los archivos están en `sql/instalacion-manual-phpmyadmin/` y se **generan** con
`node scripts/ci/canecas/generar-instalacion-phpmyadmin.mjs` a partir de las fuentes auditadas (una prueba falla si difieren).

## Orden obligatorio (Hostinger despliega automáticamente tras el merge)
1. Respaldo completo restaurable de `u611730801_Plataforma` y detener las escrituras de Canecas.
1b. Ejecutar **una vez** `00-prueba-comportamiento-errores-solo-lectura.sql` (solo lectura, sin DDL) para saber si phpMyAdmin se detiene o continúa tras un error (ver «Guardas»).
2. Ejecutar los archivos 01 a 14 **en orden**, uno por uno (tabla abajo). Cada verificación debe terminar sin ninguna fila `DETENER`. **Ante cualquier error, detenerse**: no continuar con otra etapa y usar `15-recuperacion-solo-lectura.sql`.
3. Solo con `14-verificar-final.sql` completamente `OK`: el propietario hace el merge del PR #689 (el código nuevo necesita este esquema desde el primer momento).
**Nunca** hacer el merge antes de terminar estas etapas.

## Cómo ejecutar cada archivo en phpMyAdmin
- Seleccione la base `u611730801_Plataforma` → pestaña **SQL** → pegue **todo** el contenido del archivo → **Continuar** (o use *Importar*). Los archivos **no dependen** de la base
  seleccionada ni de `USE`: todas las tablas llevan `` `u611730801_Plataforma`.tabla `` y los metadatos filtran por ese esquema.
- Deje activada la casilla **Habilitar comprobación de claves foráneas** (los archivos no la desactivan) y **no** marque «Ignorar errores». No use «Deshacer cambios al finalizar» (el DDL de MariaDB confirma solo).
- **Etapa 6 (`12-…`)**: antes de ejecutar, escriba `//` en el campo **Delimitador** de la pestaña SQL (el cuerpo del trigger contiene `;`).
- **Pegue y ejecute TODO el archivo en una sola petición.** Cada etapa de escritura fija y verifica sus modos de sesión dentro del mismo archivo (ver «Modos estrictos»); ejecutar un `SET` en otra petición no sirve porque phpMyAdmin puede abrir otra conexión.
- Tras cada etapa de escritura, el resultado de `SHOW WARNINGS` debe estar **vacío** (cero advertencias, como exige el instalador oficial).
- Si una sentencia da error: **deténgase**, no continúe y use `15-recuperacion-solo-lectura.sql` (solo lectura, esquema explícito: funciona aunque phpMyAdmin tenga seleccionada `information_schema`). Mapa etapa → reversión en el propio archivo. Nunca avance tras un error.

## Archivos
| # | Archivo | Tipo | Qué hace / comprueba |
|---|---|---|---|
| 00 | `00-prueba-comportamiento-errores-solo-lectura.sql` | solo lectura | Prueba controlada **sin DDL**: falla a propósito en la 2.ª sentencia. Si aparece la fila «DESPUES DEL ERROR», phpMyAdmin continúa tras un error. |
| 01 | `01-verificar-previo.sql` | solo lectura | Preflight de **22 comprobaciones** (versión, estado previo, caneca activa única, numeración histórica, duplicados exactos `COMP-######`/`VTA-######`, recuentos). Anote los recuentos. |
| 02 | `02-etapa1-crear-secuencias.sql` | **escribe** | Guarda + `CREATE TABLE canecas_secuencias` (vacía). |
| 03 | `03-verificar-etapa1.sql` | solo lectura | Huella exacta del contrato de `canecas_secuencias` (tablas, columnas, índices, FK, CHECK) y vacía. |
| 04 | `04-etapa2-sembrar-contadores.sql` | **escribe** | Guarda + siembra (INSERT solo en la tabla nueva) con el **máximo histórico** por empresa y tipo; no renumera ni rellena huecos. |
| 05 | `05-verificar-etapa2.sql` | solo lectura | Cada contador = máximo histórico; una fila por empresa y tipo; recuentos. |
| 06 | `06-etapa3-alterar-ventas.sql` | **escribe** | Guarda + un `ALTER TABLE canecas_ventas` (`direccion_entrega`, CHECK, `doc_auto`, UNIQUE). |
| 07 | `07-verificar-etapa3.sql` | solo lectura | Huella exacta de `canecas_ventas`; ventas históricas sin dirección; recuentos iguales al preflight. |
| 08 | `08-etapa4-alterar-productos.sql` | **escribe** | Guarda + `ALTER TABLE canecas_productos` (`activo_unico` virtual + UNIQUE). Falla sola, sin cambios, si una empresa tiene más de una caneca activa (MariaDB lo informa como error 1062 o 1834). |
| 09 | `09-verificar-etapa4.sql` | solo lectura | Huella exacta de `canecas_productos`; recuentos. |
| 10 | `10-etapa5-alterar-compras.sql` | **escribe** | Guarda + `ALTER TABLE canecas_compras` (`ref_auto` virtual + UNIQUE). Falla sola, sin cambios, si hay `COMP-######` repetido en una empresa. |
| 11 | `11-verificar-etapa5.sql` | solo lectura | Huella exacta de `canecas_compras`; recuentos. |
| 12 | `12-etapa6-reemplazar-trigger.sql` | **escribe** | Guarda + `CREATE OR REPLACE TRIGGER trg_can_venta_bu` (atómico: nunca queda sin trigger). **Delimitador `//`.** |
| 13 | `13-verificar-etapa6.sql` | solo lectura | Triggers `trg_can_venta_bu` y `trg_can_venta_bd` exactos (tiempo, evento, tabla y cuerpo normalizado). |
| 14 | `14-verificar-final.sql` | solo lectura | Postcheck de **15 comprobaciones** + huellas exactas del contrato de las 4 tablas (20) + los 2 triggers. «empresas sin contador completo» y «siguientes números ya en uso» deben ser `0`. |
| 15 | `15-recuperacion-solo-lectura.sql` | solo lectura | Estado por etapa (1 y 3–6; la 2 se consulta al final), triggers, estructura nueva, recuentos y mapa de reversión; **todo con el esquema explícito**. |

## Cómo funcionan los modos, las guardas y las verificaciones
### Modos estrictos (mismos que el instalador oficial)
Hostinger abre la sesión de phpMyAdmin con `sql_mode=NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION` e `innodb_strict_mode=0`. Cada etapa de escritura, **en su misma sesión**:
1. guarda los valores previos en variables de sesión;
2. **añade** `STRICT_TRANS_TABLES` al `sql_mode` (sin quitar ninguno, como el instalador) y fija `innodb_strict_mode=1`;
3. exige en la propia condición de la DDL que `STRICT_*`, `innodb_strict_mode=1`, `foreign_key_checks=1` y `check_constraint_checks=1` estén activos (los archivos **nunca** desactivan claves foráneas ni CHECK: si la sesión los trae desactivados, la DDL no se ejecuta);
4. ejecuta la DDL, muestra `SHOW WARNINGS` (debe estar vacío) y **restaura** `sql_mode` e `innodb_strict_mode` a sus valores previos.
La sesión de phpMyAdmin termina con la petición; si una etapa falla antes del final, los valores se restauran igualmente al cerrarse la conexión.

### Guardas
- **Etapas 1–5 (guarda intrínseca):** la DDL va **dentro de un `PREPARE` condicionado** (`SET @etapa_sql = IF(<modos y prerequisitos>, '<DDL>', 'SELECT <subconsulta que falla>')`). Si la condición es falsa, lo que se ejecuta es una subconsulta que provoca el error 1242 (o 1146 si cita una tabla aún inexistente) y **la DDL no existe en ese momento**: no depende de que phpMyAdmin se detenga tras un error. Probado también con un cliente que continúa tras errores (`--force`): ninguna etapa 1–5 fuera de orden o repetida cambia nada.
- **Etapa 6 (trigger):** MariaDB 11.8.9 admite `CREATE OR REPLACE TRIGGER` dentro de `PREPARE`/`EXECUTE` (probado), así que también lleva guarda intrínseca: si falta un prerrequisito o un modo de sesión, se ejecuta una subconsulta que falla (1242) y el trigger NO se reemplaza, aunque el cliente continúe tras el error. Recuerde el delimitador `//`.
- **Nunca** se autoriza seguir tras un error, con independencia de lo que haga el cliente.

### Verificaciones
- Comparan, sobre `information_schema`, cada tabla contra el **contrato versionado** (`contrato-simplificacion-mariadb-11.8.9.json`, generado en MariaDB 11.8.9 y verificado en CI). **Sin `GROUP_CONCAT`**: la huella es `conteo:suma1:suma2`, con dos sumas exactas de 64 bits del MD5 de cada fila; no depende de `group_concat_max_len` y no puede truncarse. Si una columna, índice, FK, CHECK o columna virtual difiere, la fila dice `DETENER`.
- Los únicos `GROUP_CONCAT` que quedan son informativos (lista «máximo histórico por empresa» del preflight original en `01-…`); ese archivo fija `group_concat_max_len=1048576` en su sesión y lo exige en una fila `OK`/`DETENER`.
- Los triggers se comparan por su cuerpo con espacios normalizados (los saltos CRLF del navegador no importan).
- Ninguna etapa usa `DROP`, `TRUNCATE`, `DELETE`, ni asigna `foreign_key_checks`/`check_constraint_checks`. Todo el texto es ASCII.

## Probado (MariaDB 11.8.9 desechable, base llamada `u611730801_Plataforma`)
`src/lib/canecas/instalacion-phpmyadmin.db.test.ts` ejecuta estos archivos con el cliente real de MariaDB:
- **Sesión estilo Hostinger** (sin modo estricto): las 14 etapas con distinta base seleccionada (ninguna, `information_schema`, `mysql`), CRLF, verificaciones bajo `READ ONLY`, **cero advertencias**, modos restaurados al terminar y resultado idéntico a la instalación oficial (contratos y contadores iguales, datos intactos, numeración `COMP-000031`/`VTA-000021` y trigger funcionando).
- **Modos estrictos:** sin el prólogo, o con `foreign_key_checks`/`check_constraint_checks` desactivados, la DDL no se ejecuta; con sesión estricta también funciona.
- **Guardas:** las seis etapas de escritura, fuera de orden o repetidas, no cambian nada ni con `--force` (guarda intrínseca, incluida la del trigger); la prueba `00` distingue clientes que paran o continúan.
- **Recuperación:** `15-…` funciona sin base por defecto y con `information_schema`/`mysql`; el diagnóstico original falla en ese contexto (control negativo); el estado por etapa avanza exactamente un paso por archivo.
- **GROUP_CONCAT:** con `group_concat_max_len=1` el preflight no se trunca ni da advertencias y las huellas siguen `OK`; sin el `SET` del archivo el truncamiento se detecta.
- Alteraciones detectadas (columna extra, trigger ausente o modificado), bloqueos del preflight y fallo atómico del `ALTER` de productos con dos canecas activas (error 1062 o 1834, sin cambios).
`src/lib/canecas/instalacion-phpmyadmin.test.ts` comprueba la fidelidad con la migración auditada, el esquema explícito, los modos y guardas, la ausencia de `GROUP_CONCAT` en las huellas, la ausencia de sentencias peligrosas y que los archivos no se desvíen de su generador.

## Límites
No valida el respaldo ni la ventana sin escrituras; no sustituye la autorización del propietario. Las 6 etapas **no** son una transacción: si falla una, se queda lo ya aplicado y se continúa o revierte
con el procedimiento de recuperación. El diagnóstico previo de solo lectura (`docs/canecas-diagnostico-previo-produccion.md`) usa Node y MySQL remoto; este procedimiento solo necesita phpMyAdmin.
