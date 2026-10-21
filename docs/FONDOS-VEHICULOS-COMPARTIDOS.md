# Solicitudes de fondo y Gastos: vehículos compartidos

Estado: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE** (tsc, eslint, pruebas unitarias, build). **No probado** contra base real ni en navegador. **Requiere migración SQL manual antes del despliegue** (ver abajo).

## Problema

En `/e/[slug]/fondos` (y en Gastos operativos, que usa el mismo catálogo) el selector «Unidad» solo ofrecía vehículos de la empresa activa:

```sql
SELECT id, placa, marca, modelo FROM flota_vehiculos WHERE empresa_id = ? AND activo = 1 ...
```

Una unidad compartida con la empresa (p. ej. **C-091BXF** de Frescofresh, compartida con Mónaco vía `flota_vehiculo_acceso`) no aparecía, y el backend (`resolverSnapshotLineaTx` en `src/lib/tms/fondos.ts`) validaba `WHERE id = ? AND empresa_id = ?`, por lo que la rechazaba aunque se enviara el id a mano. Flota sí la mostraba y la dejaba editar.

## Regla de acceso (única, la de Flota)

Un vehículo es accesible desde la empresa X si `v.empresa_id = X` **o** existe una fila `(vehiculo_id, empresa_id = X)` en `flota_vehiculo_acceso`.

Esa condición vive ahora en **un solo lugar**, `src/lib/flota/acceso.ts`:

| Pieza | Uso |
|---|---|
| `predicadoVehiculoAccesible(alias, empresaExpr)` | fragmento SQL; lo usan `obtenerVehiculoAccesible`, `listarVehiculosAccesibles`, `obtenerVehiculoAccesibleTx`, el JOIN del catálogo de planes, el listado de Gastos y dos reportes de Gastos |
| `obtenerVehiculoAccesible` / `listarVehiculosAccesibles` | sin cambio de comportamiento (se refactorizó su SQL para usar el predicado) |
| `obtenerVehiculoAccesibleTx(conn, empresaId, vehiculoId)` | **nuevo**: la misma regla dentro de la transacción del llamador (Fondos/Gastos validan y escriben atómicamente) |

No hay lógica paralela.

## Cambios

- **Catálogo** `/api/empresas/[slug]/tms/gastos/catalogos`: `vehiculos` = `listarVehiculosAccesibles(empresa de la sesión)` filtrado a **activos**, sin duplicados. Campos nuevos **aditivos**: `compartido`, `empresaDuenaId`, `empresaDuenaNombre` (los consumidores anteriores solo leían `id/placa/marca/modelo`).
- **Catálogo de planes** (misma ruta): el JOIN `fv.empresa_id = p.empresa_id` pasa a `predicadoVehiculoAccesible("fv", "p.empresa_id")`. La condición de fondo sigue siendo `p.empresa_id = ?` (solo planes de la empresa activa): no se amplía el acceso a planes de otras empresas, solo se resuelve la placa de una unidad compartida usada por un plan propio.
- **Fondos** (`resolverSnapshotLineaTx`) y **Gastos** (`validarReferenciasGastoTx`, `resolverSnapshotLineaGastoTx`): validan con `obtenerVehiculoAccesibleTx`. Mensaje de error sin cambios («El vehículo indicado no pertenece a esta empresa.»).
- **Gastos**: JOIN de listado y de dos reportes (`reportes-gastos.ts`) usan el predicado para que la placa de una unidad compartida no salga vacía.
- **UI** (`fondos/page.tsx`, `gastos/page.tsx`): la placa sigue siendo la etiqueta; el detalle agrega «· Empresa dueña · Compartido» para unidades compartidas (`src/lib/tms/vehiculo-detalle.ts`).
- Snapshot: `vehiculo_id` real + `placa` congelada, igual que antes. **No** se modifica propiedad ni `flota_vehiculo_acceso`.
- **No** se cambió: montos, autorización, estados, permisos de Flota, PR #412.

## Reglas de seguridad (resumen)

| Caso | Resultado |
|---|---|
| Vehículo propio de la empresa activa | válido |
| Vehículo de otra empresa **compartido** con la activa | válido |
| Vehículo de otra empresa **no compartido** | rechazado (rollback, nada se inserta) |
| Vehículo de otro tenant / id manipulado / inexistente | rechazado |
| Inactivo | no aparece en el catálogo (nuevas solicitudes). El backend **no** valida `activo` (igual que antes), para no romper la edición de solicitudes históricas |

## ⚠️ Migración SQL requerida (NO ejecutada)

`tms_solicitud_fondo_lineas` y `tms_gastos_operativos` tienen una **FK compuesta** `(empresa_id, vehiculo_id) → flota_vehiculos (empresa_id, id)` (`fk_fondolin_vehiculo_ambito`, `fk_gasto_vehiculo_ambito`) que obliga a que el vehículo sea de la **misma** empresa. Sin cambiarla, el `INSERT` de una unidad compartida falla en base de datos aunque la aplicación ya la acepte.

Archivos (propuesta, para revisión; el responsable los aplica):

1. `sql/preflight-2026-10-fondos-vehiculos-compartidos.sql` — solo lectura (FK vigentes, huérfanos, filas con vehículo de otra empresa, unidades compartidas).
2. `sql/migrate-2026-10-fondos-vehiculos-compartidos.sql` — idempotente: agrega índice `vehiculo_id`, agrega la FK simple `vehiculo_id → flota_vehiculos(id)` (`fk_fondolin_vehiculo`, `fk_gasto_vehiculo`, `ON DELETE RESTRICT`) y **después** elimina la compuesta. Incluye rollback comentado.
3. `sql/schema.sql` actualizado para instalaciones nuevas.

**Trade-off a confirmar:** la garantía «solo propio o compartido» deja de estar en la FK (la FK simple solo garantiza que el vehículo exista) y queda en la aplicación (`obtenerVehiculoAccesibleTx`), igual que el resto de Flota con acceso compartido. `RESTRICT` se mantiene: no se puede borrar un vehículo referenciado por una solicitud/gasto de otra empresa.

Orden de despliegue: **1) preflight → 2) migración → 3) deploy del PR**. Desplegar el código sin migrar solo cambia que el selector muestra las unidades compartidas y el guardado de una unidad compartida falla con error de base (las propias siguen funcionando).

## Fuera de alcance (reportado, no modificado)

- `tms/catalogos` (otro endpoint), compras y multas siguen listando solo vehículos propios.
- `sql/propuesta-2026-09-gastos-multiples-lineas.sql` (sin aplicar) define `fk_gastolin_vehiculo_ambito` compuesta: si se implementa «múltiples líneas» de Gastos, debe usar la FK simple.

## Prueba manual sugerida (tras migrar y desplegar)

1. Con Mónaco activa, `/e/[slug]/fondos` → nueva solicitud → línea con Unidad: aparece **C-091BXF · Volvo… · Frescofresh · Compartido**.
2. Guardar → la línea conserva el vehículo; editar la solicitud Pendiente la vuelve a mostrar con la unidad seleccionada.
3. Una unidad de Frescofresh **no** compartida no aparece ni se acepta.
4. En Flota la propiedad y los accesos de C-091BXF no cambian.

## Pruebas

- `src/lib/tms/fondos-vehiculos-compartidos.test.ts` — propio / compartido válidos (id real + placa congelada), no compartido, otro tenant, id manipulado, consulta de acceso con `[empresa, vehículo, empresa, empresa]`, sin escrituras sobre flota, edición de Pendiente conserva vehículo y placa, Gastos con la misma regla, `obtenerVehiculoAccesibleTx`.
- `src/app/api/empresas/[slug]/tms/gastos/catalogos/route.test.ts` — propios + compartidos, inactivos fuera, sin duplicados, campos aditivos, JOIN de planes.
- `src/lib/tms/vehiculo-detalle.test.ts` — etiqueta «Compartido».
- `fondos.test.ts` / `gastos.test.ts` existentes (aislamiento multiempresa) siguen pasando; `gastos.test.ts` actualiza la aserción del JOIN de listado.
