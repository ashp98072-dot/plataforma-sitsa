# Instalación manual por etapas (phpMyAdmin) de la simplificación de Canecas (#688)

Estado: **PREPARADA Y PROBADA EN MARIADB 11.8.9 DESECHABLE. NO EJECUTADA EN PRODUCCIÓN.** Requiere respaldo restaurable verificado, Canecas sin escrituras y
**autorización expresa del propietario**. Solo el propietario ejecuta SQL en Hostinger y hace el merge a `main`.

Equivale exactamente a `sql/migrate-2026-11-canecas-simplificacion-wip.sql` del SHA `8361a1f` (la misma que instala `scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs`),
partida en 6 etapas de escritura auditables, con 8 verificaciones de solo lectura. Los archivos están en `sql/instalacion-manual-phpmyadmin/` y se **generan** con
`node scripts/ci/canecas/generar-instalacion-phpmyadmin.mjs` a partir de las fuentes auditadas (una prueba falla si difieren).

## Orden obligatorio (Hostinger despliega automáticamente tras el merge)
1. Respaldo completo restaurable de `u611730801_Plataforma` y detener las escrituras de Canecas.
2. Ejecutar los 14 archivos **en orden**, uno por uno (tabla abajo). Cada verificación debe terminar sin ninguna fila `DETENER`.
3. Solo con `14-verificar-final.sql` completamente `OK`: el propietario hace el merge del PR #689 (el código nuevo necesita este esquema desde el primer momento).
**Nunca** hacer el merge antes de terminar estas etapas.

## Cómo ejecutar cada archivo en phpMyAdmin
- Seleccione la base `u611730801_Plataforma` → pestaña **SQL** → pegue **todo** el contenido del archivo → **Continuar** (o use *Importar*). Los archivos **no dependen** de la base
  seleccionada ni de `USE`: todas las tablas llevan `` `u611730801_Plataforma`.tabla `` y los metadatos filtran por ese esquema.
- Deje activada la casilla **Habilitar comprobación de claves foráneas** (los archivos no la desactivan) y **no** marque «Ignorar errores». No use «Deshacer cambios al finalizar» (el DDL de MariaDB confirma solo).
- **Etapa 6 (`12-…`)**: antes de ejecutar, escriba `//` en el campo **Delimitador** de la pestaña SQL (el cuerpo del trigger contiene `;`).
- Si una sentencia da error: **deténgase**, no continúe, y use `sql/recuperacion-canecas-simplificacion-solo-lectura.sql` (solo lectura) y los casos A/B/C de su encabezado.

## Archivos
| # | Archivo | Tipo | Qué hace / comprueba |
|---|---|---|---|
| 01 | `01-verificar-previo.sql` | solo lectura | Preflight de **22 comprobaciones** (versión, estado previo, caneca activa única, numeración histórica, duplicados exactos `COMP-######`/`VTA-######`, recuentos). Anote los recuentos. |
| 02 | `02-etapa1-crear-secuencias.sql` | **escribe** | Guarda + `CREATE TABLE canecas_secuencias` (vacía). |
| 03 | `03-verificar-etapa1.sql` | solo lectura | Huella exacta del contrato de `canecas_secuencias` (tablas, columnas, índices, FK, CHECK) y vacía. |
| 04 | `04-etapa2-sembrar-contadores.sql` | **escribe** | Guarda + siembra (INSERT solo en la tabla nueva) con el **máximo histórico** por empresa y tipo; no renumera ni rellena huecos. |
| 05 | `05-verificar-etapa2.sql` | solo lectura | Cada contador = máximo histórico; una fila por empresa y tipo; recuentos. |
| 06 | `06-etapa3-alterar-ventas.sql` | **escribe** | Guarda + un `ALTER TABLE canecas_ventas` (`direccion_entrega`, CHECK, `doc_auto`, UNIQUE). |
| 07 | `07-verificar-etapa3.sql` | solo lectura | Huella exacta de `canecas_ventas`; ventas históricas sin dirección; recuentos iguales al preflight. |
| 08 | `08-etapa4-alterar-productos.sql` | **escribe** | Guarda + `ALTER TABLE canecas_productos` (`activo_unico` virtual + UNIQUE). Falla sola, sin cambios, si una empresa tiene más de una caneca activa. |
| 09 | `09-verificar-etapa4.sql` | solo lectura | Huella exacta de `canecas_productos`; recuentos. |
| 10 | `10-etapa5-alterar-compras.sql` | **escribe** | Guarda + `ALTER TABLE canecas_compras` (`ref_auto` virtual + UNIQUE). Falla sola, sin cambios, si hay `COMP-######` repetido en una empresa. |
| 11 | `11-verificar-etapa5.sql` | solo lectura | Huella exacta de `canecas_compras`; recuentos. |
| 12 | `12-etapa6-reemplazar-trigger.sql` | **escribe** | Guarda + `CREATE OR REPLACE TRIGGER trg_can_venta_bu` (atómico: nunca queda sin trigger). **Delimitador `//`.** |
| 13 | `13-verificar-etapa6.sql` | solo lectura | Triggers `trg_can_venta_bu` y `trg_can_venta_bd` exactos (tiempo, evento, tabla y cuerpo normalizado). |
| 14 | `14-verificar-final.sql` | solo lectura | Postcheck de **15 comprobaciones** + huellas exactas del contrato de las 4 tablas (20) + los 2 triggers. «empresas sin contador completo» y «siguientes números ya en uso» deben ser `0`. |

## Cómo funcionan las guardas y las verificaciones
- Cada etapa de escritura empieza con una sentencia `SELECT CASE WHEN <prerequisitos> … ELSE (subconsulta de 2 filas)` que **provoca el error 1242** si la etapa anterior no está completa
  (o si la etapa ya se aplicó). phpMyAdmin se detiene en el primer error: no se ejecuta nada de la etapa. Esto impide saltarse etapas o repetirlas.
- Las verificaciones comparan, con MD5 sobre los metadatos de `information_schema`, cada tabla contra el **contrato versionado** (`contrato-simplificacion-mariadb-11.8.9.json`, generado en MariaDB 11.8.9 y verificado en CI):
  si una columna, índice, FK, CHECK o columna virtual difiere en lo más mínimo, la fila dice `DETENER`. Los triggers se comparan por su cuerpo con espacios normalizados (los saltos de línea CRLF del navegador no importan).
- Ninguna etapa usa `DROP`, `TRUNCATE`, `DELETE`, ni desactiva `foreign_key_checks`/`check_constraint_checks`. Todo el texto es ASCII (sin problemas de codificación).

## Probado (MariaDB 11.8.9 desechable, base llamada `u611730801_Plataforma`)
`src/lib/canecas/instalacion-phpmyadmin.db.test.ts` ejecuta estos mismos archivos con el cliente real de MariaDB: sin base por defecto y con `information_schema`/`mysql` seleccionadas, con CRLF, las
verificaciones bajo `READ ONLY`, y compara el resultado con la instalación oficial (estructura idéntica, contratos iguales, mismos contadores). También prueba las guardas (etapas fuera de orden o repetidas →
error 1242 sin cambios), la detección de alteraciones (columna extra, trigger ausente o modificado) y bloqueos del preflight, y que la numeración y la venta POS funcionan sobre lo instalado a mano.
`src/lib/canecas/instalacion-phpmyadmin.test.ts` comprueba la fidelidad con la migración auditada, el esquema explícito, la ausencia de sentencias peligrosas y que los archivos no se desvían de su generador.

## Límites
No valida el respaldo ni la ventana sin escrituras; no sustituye la autorización del propietario. Las 6 etapas **no** son una transacción: si falla una, se queda lo ya aplicado y se continúa o revierte
con el procedimiento de recuperación. El diagnóstico previo de solo lectura (`docs/canecas-diagnostico-previo-produccion.md`) usa Node y MySQL remoto; este procedimiento solo necesita phpMyAdmin.
