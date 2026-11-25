# Instalación controlada de la simplificación de Canecas (#688)

Estado: **IMPLEMENTADO Y PROBADO EN LABORATORIO (MariaDB 11.8.9)**. No está aprobado para producción: la ejecución en Hostinger
requiere respaldo verificado y autorización expresa del propietario. Este documento no ejecuta nada.

## Qué instala
`sql/migrate-2026-11-canecas-simplificacion-wip.sql` (solo agrega objetos; no borra ni modifica filas):

| Paso | Objeto | Para qué |
|---|---|---|
| 1 | `CREATE TABLE canecas_secuencias` | Números `COMP-`, `VTA-` y códigos `CAN-` generados en el servidor sin duplicados |
| 2 | `canecas_ventas.direccion_entrega` + `chk_can_venta_direccion` | Dirección de entrega histórica por venta (NULL en ventas anteriores) |
| 3 | `canecas_productos.activo_unico` (virtual) + `uq_can_producto_activo_unico` | La base impide dos canecas activas en la misma empresa |
| 4 | `CREATE OR REPLACE TRIGGER trg_can_venta_bu` | Atómico (nunca queda sin trigger); ahora también protege `direccion_entrega` |

## Orden de despliegue
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
**ventas anterior**; ejecuta el preflight (`sql/preflight-2026-11-canecas-simplificacion-wip.sql`, 12 comprobaciones); instala; ejecuta el
postcheck (`sql/postcheck-2026-11-canecas-simplificacion-wip.sql`, 10 comprobaciones); comprueba que los recuentos no cambiaron y que no se
inventaron direcciones; y verifica el contrato nuevo (`scripts/ci/canecas/contrato-simplificacion-mariadb-11.8.9.json`).

Es idempotente: con la instalación completa y el contrato exacto responde «ya instalada». Con un estado parcial se detiene.
El instalador anterior de ventas **no** acepta el esquema nuevo (su contrato no se relaja).

## Si algo falla
No reintentar a ciegas. Ejecutar `sql/recuperacion-canecas-simplificacion-solo-lectura.sql` (solo lectura) y seguir los casos A/B/C de su
encabezado, siempre con autorización y respaldo. Un `CREATE OR REPLACE TRIGGER` fallido no deja la tabla sin trigger.

## Decisión previa a instalar
El índice único falla si alguna empresa tiene más de una caneca activa (el preflight lo detecta y se detiene antes del DDL). Resolverlo es
una decisión de negocio; no se elige una caneca por el usuario.
