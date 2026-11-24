# Canecas — proveedores y clientes exclusivos (borrador)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (pruebas en MariaDB 11.8.9 mediante GitHub Actions). **NO PROBADO en producción. NO APROBADO PARA PRODUCCIÓN.** Nada de esto se ha ejecutado en Hostinger.

## Independencia respecto de Operaciones y Compras
- `canecas_proveedores` y `canecas_clientes` son tablas propias del módulo, aisladas por `empresa_id`. Sus únicas claves foráneas apuntan a `empresas` y `usuarios`.
- El código de Canecas (API, biblioteca e interfaz) ya no consulta `compras_proveedores` ni los clientes de Operaciones/TMS/Facturación, ni importa sus módulos (lo comprueba `catalogos.test.ts`). Crear o editar en Canecas no escribe en esas tablas (comprobado en `catalogos.db.test.ts` y `flujo.db.test.ts`).
- La empresa y el usuario salen siempre de la sesión; los campos `empresa_id`, `creado_por` o `moneda` enviados por el cliente se rechazan (esquema estricto).
- Permisos: lectura con `canecas`; crear, editar, activar/desactivar y mapear con `canecas_catalogo` (su etiqueta ahora incluye clientes).

## Datos y reglas
Nombre comercial (obligatorio), NIT, teléfono y dirección (opcionales), estado activo/inactivo, creación (fecha y usuario) y última edición. Unicidad por empresa del nombre normalizado (sin acentos, mayúsculas ni espacios repetidos) y del NIT normalizado (sin separadores); los NIT vacíos no chocan. La base de datos refuerza ambas unicidades ante carreras. Los inactivos se listan pero no se ofrecen en formularios ni pueden usarse en compras nuevas.

## Transición de `canecas_compras.proveedor_id` (migración aditiva)
`sql/migrate-2026-11-canecas-catalogos-wip.sql` no borra, reasigna ni reescribe nada:
1. Agrega `canecas_proveedor_id` (con FK compuesta a `canecas_proveedores`).
2. `proveedor_id` pasa a admitir NULL para que las compras nuevas no dependan de un proveedor de Compras. Las compras históricas conservan su `proveedor_id` y su FK a `compras_proveedores` intactos.
3. `chk_can_compra_proveedor`: toda compra conserva al menos un proveedor.

**Si existen compras históricas** (no se asume que la tabla esté vacía): permanecen como están, sin proveedor de Canecas, y la interfaz las muestra como «Proveedor anterior sin mapear». El instalador informa cuántas son. El mapeo es manual y por compra:
1. Diagnóstico de solo lectura: `sql/diagnostico-canecas-proveedores-historicos-solo-lectura.sql` (qué proveedores de Compras usan las compras históricas).
2. Crear en Canecas los proveedores necesarios.
3. Mapear cada compra con `POST …/canecas/mapeo_proveedor_compra` (`compra_id`, `proveedor_id`): solo completa `canecas_proveedor_id` si está vacío, con un proveedor activo de la misma empresa; nunca modifica `proveedor_id` ni los costos.
`verificarMapeoProveedoresCompleto` (scripts/ci/canecas/contrato-catalogos.mjs) es la compuerta que debe ejecutar cualquier migración futura que contraiga la relación (retirar la FK o exigir `canecas_proveedor_id`): se detiene mientras haya compras sin mapear. Esa contracción **no** se incluye ahora.

## Instalación controlada (no ejecutar sin respaldo, contrato revisado y autorización)
Orden: fase 1 → costos → salidas → redistribución → catálogos. El código de esta rama **requiere** las tablas de catálogos: instalar la migración antes de desplegar (o junto con) el código.
```sh
node scripts/ci/canecas/ejecutar-catalogos-controlado.mjs --ejecutar
```
Comprueba versión 11.8.9 y privilegios (SELECT, CREATE, ALTER, INDEX, REFERENCES), toma el bloqueo cooperativo, activa modos estrictos, verifica el estado previo (contrato de redistribución y forma de `proveedor_id`), ejecuta 3 DDL por separado deteniéndose ante cualquier advertencia, compara el contrato posterior (`contrato-catalogos-mariadb-11.8.9.json`, generado en MariaDB 11.8.9) y comprueba que no cambió el número de compras. Idempotente: si ya está instalado y coincide, no cambia nada. Ante error queda una instalación parcial: no reintentar; ejecutar `sql/recuperacion-canecas-catalogos-solo-lectura.sql` y restaurar el respaldo.

## Moneda
La moneda es GTQ: la interfaz muestra «Q» y ya no pide el código; la API asume GTQ. Con precio de compra conocido y sin gastos indicados, los gastos adicionales quedan en Q0; un precio vacío sigue siendo costo desconocido (NULL), distinto de Q0. Los gastos atribuibles ya no aparecen en el formulario principal (la API los sigue aceptando).

## Decisiones pendientes
1. Mostrar o no, solo para lectura, el nombre del proveedor anterior en compras históricas (hoy se omite para no leer `compras_proveedores`).
2. Interfaz para el mapeo manual (hoy solo API y diagnóstico SQL).
3. Migración de contracción de la relación anterior (tras mapear todo).
4. Las ventas y los reportes quedan para la siguiente fase.
