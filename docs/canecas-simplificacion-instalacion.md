# Instalación controlada de la simplificación de Canecas (#688)

Estado: **IMPLEMENTADO Y PROBADO EN LABORATORIO (MariaDB 11.8.9)**. No está aprobado para producción: la ejecución en Hostinger
requiere respaldo verificado y autorización expresa del propietario. Este documento no ejecuta nada.

## Qué instala
`sql/migrate-2026-11-canecas-simplificacion-wip.sql` (solo agrega objetos; no borra ni modifica filas):

| Paso | Objeto | Para qué |
|---|---|---|
| 1 | `CREATE TABLE canecas_secuencias` + siembra | Números `COMP-`, `VTA-` y códigos `CAN-` generados en el servidor sin duplicados; los contadores se siembran con el máximo histórico de cada empresa (ver «Numeración») |
| 2 | `canecas_ventas.direccion_entrega` + `chk_can_venta_direccion` | Dirección de entrega histórica por venta (NULL en ventas anteriores) |
| 3 | `canecas_productos.activo_unico` (virtual) + `uq_can_producto_activo_unico` | La base impide dos canecas activas en la misma empresa |
| 3b | `canecas_compras.ref_auto` y `canecas_ventas.doc_auto` (virtuales) + `uq_can_compra_ref_auto` / `uq_can_venta_doc_auto` | La base impide repetir un `COMP-######` / `VTA-######` por empresa, también frente a referencias manuales de las APIs históricas y en concurrencia (solo para ese formato; el texto libre sigue admitiendo duplicados) |
| 4 | `CREATE OR REPLACE TRIGGER trg_can_venta_bu` | Atómico (nunca queda sin trigger); ahora también protege `direccion_entrega` |

## Numeración automática frente a documentos históricos
Los documentos anteriores son texto libre (`canecas_compras.referencia`, `canecas_ventas.documento`, `canecas_productos.codigo`) y **no tienen
índice único**; por eso la migración no puede dar por hecho que `COMP-000001` o `VTA-000001` estén libres.

Política (ejecutada por la migración, el preflight, el postcheck y el servidor):
- **Se reconoce** `PREFIJO[ _-]?DÍGITOS` (1 a 15 dígitos), sin distinguir mayúsculas ni espacios exteriores: `COMP-000007`, `comp-12`, `COMP 000020`, `COMP000030`, `COMP_5`…
  Lo demás (`FAC-9999`, `COMP-00005X`, `PRECOMP-000099`) no cuenta.
- **Siembra**: el contador de cada empresa y tipo arranca en el **mayor número histórico de esa empresa** (0 si no tiene). El primer número nuevo es máximo+1.
  Los huecos **no se rellenan**, ningún número histórico se reutiliza y **no se renumera ni modifica ningún documento existente**.
- **Preflight (solo lectura)**: detiene la instalación si hay un sufijo de más de 15 dígitos (no se puede conciliar; lo resuelve el propietario) e informa,
  por prefijo, el máximo histórico por empresa y cuántos documentos tienen un formato distinto de `PREFIJO-######`.
- **Postcheck**: ningún contador queda por debajo de su máximo histórico, todas las empresas tienen sus tres contadores y el siguiente número no coincide con ningún documento.
- **Carrera con referencias manuales** (APIs históricas): `uq_can_compra_ref_auto` / `uq_can_venta_doc_auto` hacen que la base rechace un duplicado del formato generado; la compra o venta automática que pierde la carrera reintenta con el siguiente número (hasta 8 intentos). Los demás formatos de referencia siguen siendo texto libre sin unicidad.
- **En operación**: si un número candidato ya lo usa un documento de la empresa (p. ej. escrito a mano con la API histórica después de migrar) se salta al siguiente.
  Una empresa sin contadores (creada después) se siembra desde su propio historial al primer uso. `INSERT IGNORE` solo resuelve la carrera entre dos siembras simultáneas; el valor insertado es siempre el máximo histórico.
- Limitación conocida: la comparación es por texto exacto (con la intercalación de la tabla); un documento histórico `COMP-5` no bloquea `COMP-000005` en operación, pero **sí** se cuenta en el máximo al sembrar.

## Diagnóstico previo de solo lectura (antes de cualquier instalación)
`scripts/ci/canecas/diagnostico-previo-simplificacion.mjs --solo-lectura` comprueba el esquema de producción **sin escribir nada** (la sesión se
fuerza a `READ ONLY` y se detiene si el servidor no lo confirma) reutilizando los verificadores de los instaladores: contratos de redistribución,
criterio FIFO, catálogos y ventas anterior, las 17 tablas de las migraciones previas, privilegios, versión 11.8.9 y el preflight de la
simplificación. Procedimiento exacto y cómo interpretar la salida: [`docs/canecas-diagnostico-previo-produccion.md`](canecas-diagnostico-previo-produccion.md).

## Orden de despliegue
0. Diagnóstico previo de solo lectura (arriba): debe terminar en «SIN BLOQUEOS».
1. Respaldo completo restaurable (verificar restauración en una base temporal o con el procedimiento acordado).
2. Detener escrituras y DDL de Canecas (el DDL de MariaDB no es transaccional).
3. Ejecutar el instalador (abajo). **Solo después** desplegar el código de #689: las ventas y compras nuevas dependen de lo instalado.
4. El código anterior de ventas (sin dirección) sigue funcionando antes y después de la migración.

## Ejecución (la hace el propietario; credenciales solo por variables de entorno, nunca en Git)
```bash
export CANECAS_SQL_HOST=... CANECAS_SQL_PORT=3306 CANECAS_SQL_DATABASE=... CANECAS_SQL_USER=... CANECAS_SQL_CA=<ruta/ca.pem>
read -rs CANECAS_SQL_PASSWORD && export CANECAS_SQL_PASSWORD
node scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs --ejecutar
```
El instalador, en este orden: valida versión 11.8.9 y privilegios (SELECT, CREATE, ALTER, INDEX, REFERENCES, TRIGGER); toma el bloqueo; exige
SQL estricto y `foreign_key_checks`/`check_constraint_checks` activos; verifica contra sus contratos redistribución, FIFO, catálogos y
**ventas anterior**; ejecuta el preflight (`sql/preflight-2026-11-canecas-simplificacion-wip.sql`, **22 comprobaciones**: 11 de estado previo, 7 de numeración histórica —3 sufijos de más de 15 dígitos que detienen, 3 máximos por prefijo y 1 de formatos mixtos, estas últimas informativas—, 2 de duplicados exactos `COMP-######`/`VTA-######` y 2 recuentos); instala; ejecuta el
postcheck (`sql/postcheck-2026-11-canecas-simplificacion-wip.sql`, **15 comprobaciones**: objetos instalados, contadores no menores que el máximo histórico, empresas sin contador y números siguientes en uso —estas dos deben ser 0—, ausencia de duplicados del formato generado y recuentos); comprueba que los recuentos no cambiaron y que no se
inventaron direcciones; y verifica el contrato nuevo (`scripts/ci/canecas/contrato-simplificacion-mariadb-11.8.9.json`).

Es idempotente: con la instalación completa y el contrato exacto responde «ya instalada». Con un estado parcial se detiene.
El instalador anterior de ventas **no** acepta el esquema nuevo (su contrato no se relaja).

## Si algo falla
No reintentar a ciegas. Ejecutar `sql/recuperacion-canecas-simplificacion-solo-lectura.sql` (solo lectura) y seguir los casos A/B/C de su
encabezado, siempre con autorización y respaldo. Un `CREATE OR REPLACE TRIGGER` fallido no deja la tabla sin trigger.

## Decisión previa a instalar
El índice único falla si alguna empresa tiene más de una caneca activa (el preflight lo detecta y se detiene antes del DDL). Resolverlo es
una decisión de negocio; no se elige una caneca por el usuario.
