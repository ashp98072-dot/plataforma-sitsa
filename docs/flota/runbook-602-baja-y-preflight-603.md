# Runbook: baja de #602 y preflight de #603 (solo lectura salvo la baja por la aplicación)

Estado: **la baja de #602 está PENDIENTE** (la ejecuta el propietario desde la aplicación; no se ha efectuado). **#603 NO se elimina** ni se modifican sus referencias. No se restaura ni se importa ningún respaldo en producción. Sin migraciones, merge ni despliegue.

## 0. Respaldo
El respaldo SQL de producción del 20/11/2026 (SHA-256 `b30093c9…0e9f`) es **solo una copia de seguridad**: no se restaura ni se importa en producción. Guardarlo fuera de línea y volver a comprobar su suma SHA-256 tras copiarlo. Cualquier restauración (aunque sea de filas) requiere una autorización nueva, y se ensaya primero en una base de pruebas.

## 1. HUELLA de ANTES (lectura)
1. phpMyAdmin → seleccionar la **base de producción** → pestaña **SQL**.
2. Pegar el contenido de [`huella-2026-11-flota-fichas-602-603.sql`](../../sql/huella-2026-11-flota-fichas-602-603.sql) (una sola sentencia) → **Continuar**.
3. Guardar la **fila completa** (captura o «Operaciones sobre los resultados → Exportar → CSV») con el nombre `huella-ANTES.csv`.
4. (Opcional, detalle) ejecutar de nuevo el [postcheck](../../sql/postcheck-2026-11-flota-fichas-602-603.sql), secciones **H1–H5**, y guardar los resultados. H6 solo aplica tras eliminar #603.

## 2. Baja de #602 (solo #602, sin eliminar)
> Verifica SIEMPRE la ficha: **Registro #602 · placa C-034BXR · propietario Frescofresh**. No es #1296 (Mónaco/Kuiqtrans).

**Vía 1 (preferida): como empresa propietaria.**
1. Entrar con **Frescofresh** como empresa activa (usuario con permiso de edición de Flota). Si Frescofresh no tiene el módulo Flota, usar la Vía 2.
2. Flota → Vehículos → buscar `C-034BXR`.
3. En la fila de **#602** pulsar **«Dar de baja»**. **No** pulsar «Eliminar».
4. Anotar fecha, hora y usuario: esta acción **no deja auditoría**.

**Vía 2 (solo si la Vía 1 no está disponible): desde Mónaco con el permiso de edición de otras empresas.**
1. Con Mónaco/Kuiqtrans activa: Flota → Vehículos → mostrar la ficha compartida #602 → **Editar**.
2. Cambiar **solo** el campo **Estado** a **Inactivo** → **Guardar cambios**. No tocar ningún otro campo. (Esta vía sí deja un registro de auditoría de edición transversal.)
3. Si el campo Estado no se puede cambiar, **detenerse** y avisar; no usar ninguna otra vía.

**Efecto esperado (una sola fila):** #602 pasa a `activo = 0` / `Inactivo`. No cambia ninguna clave foránea, `empresa_id`, acceso, filtro ni FONDO-000135.

## 3. HUELLA de DESPUÉS y comparación
Ejecutar **la misma** sentencia de huella y guardar `huella-DESPUES.csv`. Comparar:

| Columna de la huella | Debe ser | Si no coincide |
|---|---|---|
| `huella_inmutable` | **IDÉNTICA** a ANTES | **DETENERSE** → «Reactivar» #602 y avisar |
| `estado_fichas` | Cambia **solo** `602:1/Activo` → `602:0/Inactivo`; `603`, `1296`, `1297` siguen `1/Activo` | DETENERSE |
| `h1_solicitud`, `h1_lineas_fondo` (FONDO-000135) | Idénticas | DETENERSE |
| `h3_602_filtros_accesos_lineas` | Idéntica (3/1/2) | DETENERSE |
| `h4_1296`, `h4_1297` (líneas de fondo / suma / compras / unidad TMS / planes) | Idénticas a ANTES y coherentes con el diagnóstico | DETENERSE |
| `h5_claves_foraneas`, `h5_fichas_por_empresa` | Idénticas | DETENERSE |
| `fila_603`, `fila_1296`, `fila_1297`, `fila_602_sin_estado` | Idénticas | DETENERSE |

`huella_inmutable` es un resumen de todas las filas anteriores: si es idéntica, ninguna de ellas cambió.

**Prueba de humo (aplicación):** Combustibles (Staff e importador Shell) debe ofrecer **solo #1296** para C-034BXR; Fondos debe seguir mostrando FONDO-000135 intacto; Flota → Vehículos muestra #602 atenuada solo con el filtro «Todos» o «Inactivos».

**Recuperación de la baja:** «Reactivar» #602 (Vía 1) o Estado **Activo** (Vía 2) y repetir la huella: debe volver a ser idéntica a ANTES.

## 4. Preflight de #603 (solo lectura)
Abrir [`preflight-2026-11-flota-ficha-603.sql`](../../sql/preflight-2026-11-flota-ficha-603.sql) y ejecutar **sentencia por sentencia** (pestaña SQL, base de producción):

| Sentencia | Qué hacer | Esperado / criterio |
|---|---|---|
| **P1** (2 SELECT) | Ejecutar; en cada resultado «Operaciones sobre los resultados → Exportar → SQL» y guardar con su SHA-256 (`respaldo-603-flota_vehiculos.sql`, `respaldo-603-acceso.sql`) | 1 fila de la ficha y 1 de acceso. Esto es una **exportación**, no una escritura. |
| **P2** | Ejecutar y compartir la tabla | Lista de claves foráneas hacia `flota_vehiculos` igual a la esperada (sin tablas nuevas). |
| **P3b** | Ejecutar; copiar la celda `ejecutar_todo`, pegarla en la pestaña SQL y ejecutarla (una tabla). Alternativa: P3 devuelve una sentencia por fila | **0 en todas las filas salvo `flota_vehiculo_acceso.vehiculo_id` = 1.** Cualquier otra fila ≠ 0 → **NO-GO**. |
| **P4** | Ejecutar (si una tabla CB2 no existe, ignorar el error) | 0 |
| **P5** | Ejecutar y compartir | Sin disparadores de borrado que bloqueen (los de M1 son de inserción/actualización). |
| **P6** (3 SELECT) | Ejecutar | 0 viajes abiertos, 0 planes vigentes, 0 unidades TMS. |
| **P7** | Ejecutar y compartir | Datos de #603 que #1297 no tiene (p. ej. kilometraje, medida de llanta, aceite): quedan en el respaldo. Copiarlos a #1297 sería un cambio aparte. |

**Devolver:** P2, P3b (tabla completa), P4, P5, P6 y P7 (P1 solo confirmar que se exportó y su hash).

**GO/NO-GO:** GO solo si P3b da 0 en todo salvo el acceso (1), P2 no trae tablas inesperadas, y P4–P6 están en 0/sin bloqueos. Con GO se pide la **autorización expresa** de la eliminación de #603 (vía aplicación o SQL del plan); hasta entonces **no se elimina nada**.

## 5. Qué NO se hace
Restaurar o importar el respaldo en producción · `DELETE`/`UPDATE`/migraciones en producción · eliminar #602 o #603 · desactivar claves foráneas · tocar `empresa_id` · reasignar o modificar referencias financieras (FONDO-000135 y las líneas de #1296/#1297) · merge o despliegue.
