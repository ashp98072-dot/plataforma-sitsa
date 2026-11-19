# Consolidación de vehículos por alias — alcance del PR #647 y dependencia de la migración v2 de guardas

**Estado: IMPLEMENTADO y VERIFICADO TÉCNICAMENTE en MariaDB desechable. No probado en navegador ni aprobado para producción. No se ejecutó ninguna fusión real, no se habilitó `FLOTA_FUSIONES_APROBADAS` y no se tocó producción.**

Complementa `docs/flota/consolidacion-vehiculos-duplicados-impacto-y-diseno.md` (#643).

## 1. Qué hace este PR (código)
Reutiliza el mecanismo existente (`flota_vehiculos_fusiones`, `fusionarVehiculos`, `resolverUnidadCanonica`, `catalogoSinAlias`); no hay sistema paralelo, no se eliminan vehículos, no se renumeran IDs y no se mueve historia.

1. **Fusión**: `tms_solicitud_fondo_lineas` y `tms_unidades` se admiten como historia, con verificaciones (bloquea solicitudes de fondo **Pendientes** con el absorbido y dos unidades TMS propias). Gastos operativos y cualquier otra tabla siguen bloqueando.
2. **Inventario de referencias**: una columna con nombre de vehículo pero FK a **otra** tabla (`vehiculo_solicitado_perfil_id` → perfil de costeo) ya no cuenta como vehículo.
3. **Reportes** de solicitudes de fondo y detalle de gastos: filtrar por vehículo incluye todos los IDs de la unidad.
4. **Operaciones nuevas** (catálogo de planes, fondos y gastos): se asocian al ID canónico.

## 2. Fuera del alcance de este PR (explícito)
| Tema | Estado |
|---|---|
| **Reporte agregado «gastos por unidad»** (`tipo=unidad`, y los agregados por viaje/cliente/categoría/período) | **Sin cambios.** Agrupa por `vehiculo_id` exacto: el absorbido y el canónico siguen apareciendo por separado. Unificarlos cambia la semántica del agregado y requiere decisión propia. |
| **Importación Excel de Shell (CB2)** | **No se modifica ni se re-verifica aquí.** El código existente ya resuelve cada selección al canónico (`cb2/service.ts`, `catalogoSinAlias`) y no se toca. La prueba de punta a punta de la importación con unidades fusionadas es trabajo aparte. |
| Gastos operativos y Compras como historia admisible de una fusión | Siguen bloqueando la fusión. |
| Cualquier fusión real (incluida 558 BSJ) | **No se ejecuta.** |

## 3. Caso 558 BSJ — decisión pendiente del propietario
- **ID 2 es solo un CANDIDATO a identidad canónica** (el informe #643 recomienda el vehículo con más historia, sin asumir un «ID 6»). No se decide ni se ejecuta nada en este PR.
- Pendiente: confirmar el canónico con los datos reales (discovery de solo lectura `sql/discovery-2026-11-flota-vehiculos-duplicados.sql`, a cargo del propietario), la activación de la migración de fusiones y de `FLOTA_FUSIONES_APROBADAS` en producción.

## 4. Migración SQL v2 de las guardas — propuesta separada, con su propio proceso de aprobación
Archivos (no ejecutados en ningún entorno real):
- `sql/preflight-2026-11-flota-fusiones-guardas-v2.sql` (solo lectura)
- `sql/migrate-2026-11-flota-fusiones-guardas-v2.sql`
- `sql/postcheck-2026-11-flota-fusiones-guardas-v2.sql` (solo lectura; **sustituye** al postcheck original tras aplicar v2, que contaría como «guardas faltantes» las que v2 retira a propósito)
- `sql/rollback-2026-11-flota-fusiones-guardas-v2.sql`

**Qué corrige:** los triggers `ffi_*`/`ffu_*` de `sql/migrate-2026-11-flota-fusiones.sql` (migración histórica, **no modificada**) protegen toda columna que cumpla `/(^|_)vehiculo(_.*)?_id$/`. Eso alcanza a `tms_planes_viaje.vehiculo_solicitado_perfil_id`, que apunta a un perfil de costeo: si su valor coincide con el ID de un vehículo fusionado, el INSERT/UPDATE del plan falla con «Seleccione la unidad principal: ID fusionado».

**Qué hace v2:** retira únicamente las guardas de columnas que (a) coinciden con la regex, (b) tienen FK a una tabla distinta de `flota_vehiculos`, (c) no tienen FK a `flota_vehiculos(id)` y no son `vehiculo_id`/`unidad_recurrente_id`. Antes de eliminar cada trigger guarda su definición exacta en `flota_fusion_guardas_v2_respaldo`. No toca otras guardas, datos ni los triggers de las tablas de fusión.

**Respaldo verificado antes de cada `DROP TRIGGER` (sin `INSERT IGNORE`):** la definición se copia con un `INSERT` normal (cualquier error aborta) y, justo antes de eliminar cada trigger, se comprueba byte a byte que existe exactamente una fila de respaldo con la misma tabla, campo, momento, evento y definición. Si el respaldo falta o difiere —incluido un respaldo previo distinto para el mismo nombre— la migración **aborta sin eliminar ese trigger** y sin sobrescribir el respaldo. Se respaldan y verifican las dos guardas de una columna antes de eliminar cualquiera. Ante una interrupción parcial, reejecutar continúa sin duplicar: con respaldo ya hecho y trigger vigente igual, completa; con ffi ya eliminada (y su respaldo conservado), respalda y retira ffu.

**Reversible e idempotente:** el rollback recrea las guardas desde el respaldo con la misma definición y elimina la tabla. Probado en MariaDB 11.8.9 desechable (`src/lib/flota/vehiculo-canonico.db.test.ts`): permite perfiles legítimos, sigue bloqueando referencias nuevas a absorbidos (fondos, planes por `tc_vehiculo_id`, gastos y sus líneas), reaplicar no duplica el respaldo, el rollback restaura la definición idéntica y se puede reaplicar.

**Orden de ejecución en un entorno real (a cargo del propietario, tras aprobación independiente):** preflight → v2 → postcheck v2. Opera sobre `DATABASE()`: seleccionar la base antes (en phpMyAdmin, elegirla en el panel izquierdo).

**Dependencia con el PR #647:** el código del PR funciona **sin** v2 (el inventario de referencias de la aplicación ya excluye el falso positivo). v2 corrige únicamente el trigger SQL y **debe aprobarse y aplicarse por separado antes de depender de fusiones** en una base donde un ID de perfil pueda coincidir con el de un vehículo fusionado. Sin v2, esa limitación sigue vigente y está documentada en las pruebas.

## 5. Hallazgo menor (preexistente, no corregido)
`resolverUnidadCanonica` devuelve en `idsHistoricos` todos los IDs del grupo de alias, incluso los de vehículos de otra empresa que la empresa consultante no puede ver (solo IDs, sin datos). Los reportes de este PR **no filtran datos ajenos** porque sus consultas siempre llevan `empresa_id = ?` (comprobado en MariaDB desechable con una empresa con acceso compartido al canónico). Si se quiere ocultar también esos IDs en el endpoint de historial, es un cambio aparte.
