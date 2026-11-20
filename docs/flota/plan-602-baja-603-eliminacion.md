# Plan para revisión: #602 (baja reversible) y #603 (eliminación controlada)

Estado: **PROPUESTA para aprobación. Nada se ejecuta** (ni `DELETE`, ni `UPDATE`, ni migraciones, ni merge, ni despliegue). Se conserva el modelo multiempresa, los permisos, `empresa_id`, todas las claves foráneas y las fichas correctas #1296 y #1297. No se modifica ninguna referencia financiera histórica y **no se asume identidad física por la placa** (las cuatro fichas tienen chasis `NULL`).

Scripts de lectura (todos con solo `SELECT`):
[`diagnostico-…-602-603-eliminacion.sql`](../../sql/diagnostico-2026-11-flota-602-603-eliminacion.sql) (ya ejecutado) ·
[`preflight-…-ficha-603.sql`](../../sql/preflight-2026-11-flota-ficha-603.sql) ·
[`postcheck-…-fichas-602-603.sql`](../../sql/postcheck-2026-11-flota-fichas-602-603.sql).

## 1. Qué mostró el diagnóstico en producción
| Ficha | Empresa | Dependencias | Lectura |
|---|---|---|---|
| **#602** C-034BXR | Fresco Fresh (4) | 2 líneas de combustible de **FONDO-000135** (Liquidada, solicitada por Mónaco), 3 filtros, 1 acceso compartido; sin viajes, lecturas, servicios, documentos ni cargas | **Sí se usó**: es historia financiera liquidada. **No se elimina ni se reasigna.** |
| **#603** C-035BXR | Fresco Fresh (4) | 1 acceso compartido; todo lo demás en 0 | Sin historia propia: candidata a eliminación controlada. |
| **#1296** C-034BXR | Mónaco (1) | 14 líneas de fondo (13 Autorizada, 1 Liquidada), 14 líneas de compras, unidad TMS 398 con 18 planes Programado | Ficha operativa correcta. |
| **#1297** C-035BXR | Mónaco (1) | 14 líneas de fondo (12 Autorizada, 2 Liquidada), 1 línea de compras, unidad TMS 59 con 3 planes Programado | Ficha operativa correcta. |

Ninguna de las cuatro tiene viajes, lecturas, servicios ni cargas de Flota: la actividad está en fondos, TMS y compras. Chasis `NULL` en las cuatro: **la identidad física no está acreditada**.

## 2. Parte A — #602: baja reversible (no se elimina)
**Qué es:** «Dar de baja» desde la aplicación (Flota → Vehículos → Dar de baja), con la empresa **Fresco Fresh** activa (la propietaria) y un usuario con permiso de edición. Cambia una sola fila (`activo = 0`, `estado = 'Inactivo'`); no toca claves foráneas, `empresa_id`, accesos, filtros ni FONDO-000135. Se revierte con «Reactivar».

**Efecto verificado en el código (`origin/main`):** una ficha inactiva deja de ofrecerse en los catálogos de operaciones nuevas:
- Combustibles: el catálogo de Staff y del importador Shell (`catalogosCombustible`, `v.activo = 1`) y la validación de vehículos del importador CB2 (solo `Activo`).
- Fondos, gastos, compras, viáticos y rutas (`listarVehiculosActivosAccesibles`, solo activos).
- Selectores de Flota (viaje, servicio, lectura): usan solo las activas.
Lo histórico no cambia: las líneas de fondo conservan la ficha y la placa guardada.

**Qué sigue visible:** #602 aparece solo en la tabla de Vehículos si el filtro es «Todos» o «Inactivos» (atenuada). El aviso de «placas con varios registros» puede seguir contándola.

**Riesgos:** (1) nadie podrá elegir #602 en operaciones nuevas (es lo buscado; deben usar #1296); (2) la baja de la aplicación **no deja registro de auditoría**: anotar fecha, usuario y las huellas H1–H3 en la bitácora del cambio; (3) no acredita identidad con #1296 y no la sustituye.

**Pasos:**
1. **Preflight/huella (lectura):** ejecutar el [postcheck](../../sql/postcheck-2026-11-flota-fichas-602-603.sql) **antes** y guardar H1–H5 (en especial la huella de FONDO-000135 y las líneas de #1296/#1297).
2. **Baja** de #602 desde la aplicación.
3. **Postcheck:** repetir H1–H5. H1, H3, H4 y H5 deben ser **idénticos**; H2 cambia solo en #602 (`activo 1 → 0`, `Inactivo`).
4. **Prueba de humo:** Combustibles (Staff y Shell) debe ofrecer **solo #1296** para C-034BXR; Fondos debe seguir mostrando FONDO-000135 intacto.
5. **Recuperación:** «Reactivar» #602 y repetir el postcheck.

**Alternativa sin tocar el dato (no recomendada):** filtrar por código (ya preparado en local, sin publicar) para ocultar duplicadas compartidas en la tabla de Flota. No resuelve Combustibles y ocultar en selectores podría impedir elegir una unidad en operaciones existentes.

## 3. Parte B — #603: eliminación controlada
**Alcance exacto (según el diagnóstico):** 2 filas: `flota_vehiculo_acceso (603, empresa 1)` y `flota_vehiculos id = 603`. Cualquier otra fila encontrada por el preflight = **NO-GO**.

**GO / NO-GO (preflight, lectura):**
- P2: el inventario de claves foráneas hacia `flota_vehiculos` coincide con el esperado (sin tablas nuevas).
- P3: el generador de conteos devuelve 0 en **todas** las columnas, salvo `flota_vehiculo_acceso` = 1.
- P4: sin referencias en datos JSON de CB2. P5: sin disparadores que bloqueen. P6: sin viajes abiertos, planes vigentes ni unidad TMS.
- P7: datos descriptivos de #603 que #1297 no tiene (p. ej. kilometraje, medida de llanta, aceite): quedan en el respaldo; copiarlos a #1297 sería un cambio aparte que requiere aprobación.

**Respaldo (antes de cualquier cambio, a cargo del propietario):**
1. Exportación **completa** de la base con su suma SHA-256.
2. Exportación de las **filas exactas** (resultados de P1 como SQL) con su hash.
3. Resultados guardados de H1–H5.

**Ejecución (una sola, con aprobación expresa):** preferible desde la aplicación («Eliminar», Fresco Fresh activa), que usa su propia transacción y bloquea si hay viaje abierto o multas; **deja sin auditoría**, así que se registra a mano. Alternativa en SQL (borrador, **no ejecutar**):
```sql
START TRANSACTION;
-- Guardas: ficha_ok = 1, accesos = 1, otras_referencias = 0; si no, ROLLBACK y detenerse.
SELECT (SELECT COUNT(*) FROM flota_vehiculos WHERE id = 603 AND empresa_id = 4 AND placa = 'C-035BXR') AS ficha_ok,
       (SELECT COUNT(*) FROM flota_vehiculo_acceso WHERE vehiculo_id = 603 AND empresa_id = 1) AS accesos,
       (SELECT COUNT(*) FROM tms_solicitud_fondo_lineas WHERE vehiculo_id = 603) + (SELECT COUNT(*) FROM flota_vehiculo_filtros WHERE vehiculo_id = 603)
       + (SELECT COUNT(*) FROM flota_vehiculo_documentos WHERE vehiculo_id = 603) + (SELECT COUNT(*) FROM flota_combustible_cargas WHERE vehiculo_id = 603) AS otras_referencias;
DELETE FROM flota_vehiculo_acceso WHERE vehiculo_id = 603 AND empresa_id = 1;      -- debe afectar 1 fila
DELETE FROM flota_vehiculos WHERE id = 603 AND empresa_id = 4 AND placa = 'C-035BXR'; -- debe afectar 1 fila; si una clave foránea lo impide, falla y no cambia nada
-- Verificar «filas afectadas» y el postcheck; solo entonces COMMIT (o ROLLBACK).
```
No se desactivan claves foráneas, no se cambia `empresa_id` y no se reasigna nada.

**Postcheck (lectura):** H6 todo en 0; H1, H4 y H5 idénticos a la huella previa (el conteo de claves foráneas no cambia); H7 ya no muestra C-035BXR duplicada; prueba de humo en Combustibles y Fondos.

**Recuperación:** restaurar las 2 filas desde la exportación de P1 con sus IDs originales (primero `flota_vehiculos`, después `flota_vehiculo_acceso`), sin desactivar claves foráneas, y repetir H2 y H6; si hay cualquier duda, restauración completa del respaldo.

## 4. Orden y autorizaciones necesarias
1. Aprobar la **baja de #602** (Parte A) y quién la ejecuta; guardar la huella previa.
2. Ejecutar el **preflight de #603** y compartir P2, P3, P4, P5, P6 y P7 para decidir GO/NO-GO.
3. Aprobar la **eliminación de #603** (vía aplicación o SQL) con respaldo hecho y ventana definida.
4. Después, y por separado: obtener el **chasis real** de las fichas para decidir si se vinculan por identidad física, y evaluar la tabla de **autorizaciones por empresa** (arquitectura multiempresa) para que Mónaco opere unidades de otras empresas sin fichas duplicadas.
