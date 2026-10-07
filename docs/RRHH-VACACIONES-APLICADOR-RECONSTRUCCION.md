# RRHH Vacaciones — aplicador controlado de la reconstrucción (preservando evidencias)

Estado: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE** con una BD en memoria sobre el código real. **No se ejecutó SQL, no se tocó producción, el aplicador NO está expuesto en ninguna ruta ni botón** (solo el dry-run, de solo lectura). Continuación de #418 (vista previa) y #419 (export + reset preparado).

## 1. Objetivo y límites
Reconstruir el dominio de Vacaciones desde el historial validado (31 vacaciones en producción, `completo = true`) **sin perder las 13 evidencias** (13 incidencias distintas, 1 evidencia cada una). El PR deja el mecanismo **listo y probado**; ejecutarlo contra producción es un paso posterior, autorizado por escrito.

Prohibido (y verificado): `TRUNCATE`, `FOREIGN_KEY_CHECKS=0`, `DELETE` global, tocar incidencias de otros tipos, empleados o solicitudes, borrar/mover archivos físicos, tocar `backup_saldos_vacaciones_20261006`, un botón/ruta de ejecución libre.

## 2. Evidencias: estructura y el problema del CASCADE
`evidencias_incidencias(id PK, empresa_id, incidencia_id NOT NULL, ruta_archivo NOT NULL, nombre_original, subido_en, subido_por)` con `fk_ev_inc: incidencia_id → incidencias.id ON DELETE CASCADE`. **Borrar una incidencia borra su fila de evidencia automáticamente.** El aplicador no confía en conservar las filas actuales: las captura **antes** de cualquier DELETE y las recrea después.

### Archivos físicos (investigación)
- **Dónde viven:** `<raíz de uploads>/empresas/<empresaId>/evidencias/inc<id_viejo>-<sello>-<nombre>`; `ruta_archivo` guarda la ruta **relativa** a esa raíz (`getUploadsRoot()` en `src/lib/uploads.ts`: `UPLOAD_DIR` o `.builds/uploads`). Se suben con `guardarUpload(empresaId, "evidencias", "inc<id>", file)` desde `POST /api/empresas/[slug]/rrhh/vacaciones/[id]/evidencias`. El prefijo `inc<id_viejo>` queda en el nombre del archivo; **no importa** (la fila apunta por `ruta_archivo`, que no cambia).
- **Qué podría borrarlos hoy:** (1) `eliminarEvidencia()` en `src/lib/rrhh/evidencias.ts` → `borrarUpload(ruta)` (ruta `DELETE /rrhh/vacaciones/evidencias/[evId]`); (2) `borrarUpload()` en `src/lib/uploads.ts` (`unlinkSync`); (3) `borrarArchivosFisicos()` en `src/lib/admin/limpiar-archivos.ts` (`unlink`, tras el COMMIT de una limpieza de módulo, rutas recolectadas con `recolectarRutasArchivo`); (4) la limpieza administrativa `limpiarVacacionesRrhh` de `src/lib/admin/limpiar-modulo.ts` (borra filas de evidencias y luego los archivos). `eliminarRegistroVacaciones()` (`vacaciones-eliminar.ts`) **bloquea** si hay evidencias.
- **El aplicador no usa ninguno:** no importa `fs`, `@/lib/uploads` ni `limpiar-archivos`, no llama a `borrarUpload`/`borrarArchivosFisicos`/`unlink`, no modifica ni mueve archivos. Un test lo comprueba (escaneo estático + helpers espiados). Solo opera sobre la **fila**.

## 3. Diseño del aplicador (`vacaciones-reconstruccion-aplicador.ts`)
**Todo-o-nada.** Módulos: `-plan.ts` (fuente + planificador puro), `-decisiones.ts` (resoluciones auditables), `-aplicador.ts`, motor `vacaciones-reconstruccion.ts` (con reparto manual opcional).

Flujo de `aplicarReconstruccion`:
1. **Confirmación fuerte:** frase exacta `RECONSTRUIR VACACIONES EMPRESA <id>`, empresa, `huellaFuente` del dry-run revisado, sello `AAAAMMDDHHMM` y usuario. Sin ella no se hace nada.
2. **Re-validación** (mismo plan del dry-run): historial **lossless** (`completo`), sin duplicados/futuras/superpuestas/bloqueantes, **sin decisiones pendientes**, relink posible, sin solicitudes ligadas ni FIFO ajeno, huella idéntica.
3. **Respaldos** `bk_reset_<sello>_{vacaciones,incidencias_vacaciones,detalle_consumo_vacaciones,saldos_vacaciones,solicitudes_vacaciones,evidencias_incidencias}`: nunca se sobrescriben (si existe alguna, se aborta), con verificación de conteos; el de evidencias incluye `id`, `empresa_id`, `incidencia_id`, `id_empleado`, `tipo`, `fecha_inicio`, `fecha_fin`, `dias_habiles`, `ruta_archivo`, `nombre_original`, `subido_en`, `subido_por` (LEFT JOIN: conserva incluso huérfanas). Es DDL → antes de la transacción y **permanece aunque luego haya ROLLBACK** (deseado). `backup_saldos_vacaciones_20261006` no se toca (se verifica su conteo antes/después).
4. **`BEGIN`** → `SELECT … FOR UPDATE` de incidencias de vacaciones, vacaciones, saldos y evidencias de la empresa → **relee todo y vuelve a planificar**; si la huella cambió, aborta.
5. **Staging:** copia profunda en memoria de las evidencias (todos los campos + identidad lógica), comprobada contra el respaldo en BD, **antes** del primer DELETE.
6. **Eliminación** (siempre `empresa_id` y solo ids del conjunto objetivo): detalle FIFO → incidencias de vacaciones → vacaciones → saldos de los empleados a reconstruir (solo si el detalle restante sobre ellos es 0).
7. **Reconstrucción:** períodos desde `fecha_alta` (motor de #418), luego las vacaciones cronológicamente por empleado: incidencia + fila espejo en `vacaciones` + detalle FIFO nuevo.
8. **Relink** (ver §4).
9. **Verificación** (cualquier diferencia → ROLLBACK): vacaciones e incidencias = esperadas; detalle FIFO (líneas y suma por incidencia = días − faltante aprobado); saldos por empleado = períodos esperados y ninguno negativo; **evidencias: n antes = n después, campos idénticos, ninguna huérfana, ninguna incidencia con evidencias de más**; incidencias de otros tipos, empleados y solicitudes sin cambio; respaldo histórico intacto.
10. **Auditoría** (misma transacción): `RECONSTRUCCION_VACACIONES` + una fila `RECONSTRUCCION_VACACIONES_DECISION` por cada decisión aplicada. 11. **`COMMIT`**.

### Relink: mecanismo exacto
Identidad lógica (**nunca el ID viejo**): `empresa + empleado + tipo + fecha_inicio + fecha_fin + dias_habiles`. `resolverRelinks()` exige **exactamente UNA** incidencia nueva compatible por evidencia; **0 o >1 = HARD ERROR** → el plan no es aplicable (y, si ocurriera bajo bloqueo, ROLLBACK completo). Como el CASCADE ya eliminó las filas, cada evidencia del staging se **recrea con su mismo `id` y todos sus campos** (`empresa_id`, `ruta_archivo`, `nombre_original`, `subido_en`, `subido_por`), con `incidencia_id` = la incidencia nueva. `subido_en` se lee y se escribe como texto `YYYY-MM-DD HH:MM:SS` (sin conversión de zona horaria) para que sea idéntico.

### Alcance de saldos (decisión a confirmar)
Se reconstruyen los empleados **con fecha de alta válida** que hoy tienen saldos o vacaciones; se borran y regeneran **sus** saldos. Los empleados con fecha inválida (**Elisa**) **se omiten**: sus saldos no se tocan y no se repara su fecha. Si un empleado bloqueado tuviera vacaciones en el historial, el plan no es aplicable.

## 4. Decisiones pendientes (Álvaro)
El aplicador **no puede ejecutarse** mientras exista una `DECISION` del motor. Álvaro Antonio León Pinto, 2025-10-20 → 2025-11-05, 15 días, cruza el aniversario 2025-10-30: el dry-run la lista con la distribución **provisional** por tramos y su `huella`. No se inventa la distribución definitiva. Para resolverla se registra una resolución **explícita y auditable**:

```json
{ "clave": "VACACION_CRUZA_ANIVERSARIO|<codigo>|2025-10-20|2025-11-05|15.00",
  "tipo": "ACEPTAR_PROPUESTA",
  "huella": "<sha256 de la propuesta que se aprobó, tal como la mostró el dry-run>",
  "resueltoPor": "<quién resuelve>", "resueltoEn": "<fecha ISO>", "motivo": "<≥ 10 caracteres>" }
```
- `ACEPTAR_PROPUESTA`: se aplica tal cual la propuesta; la **huella ata la aprobación al texto exacto** (si cambian los datos, deja de valer).
- `REPARTO_MANUAL` (solo cruces de aniversario): `"reparto": [{ "anioLaboral": 2, "dias": 10 }, { "anioLaboral": 3, "dias": 5 }]`; debe sumar los días de la vacación; el motor consume exactamente eso (si un año no alcanza, aparece `SALDO_INSUFICIENTE`, otra decisión).
- Una resolución que no corresponde a ninguna decisión pendiente (obsoleta o mal escrita) es un **error** que bloquea. Las resoluciones se pasan al dry-run (`POST …/reconstruccion/dry-run`, cuerpo `{ "decisiones": [...] }`) y al aplicador; quedan en la auditoría de la transacción.

## 5. Dry-run (solo lectura)
`POST /api/empresas/[slug]/rrhh/vacaciones/reconstruccion/dry-run` (permiso Vacaciones·editar; empresa de la sesión) y el panel «Simular reconstrucción» dentro de «Exportar historial actual». Muestra: vacaciones a reconstruir (31 en producción), incidencias nuevas esperadas, líneas de FIFO esperadas, evidencias a relinkear (13) y relinkeables, errores de relink, saldo final por empleado (otorgado/consumido/saldo), decisiones pendientes con su plantilla, empleados omitidos, `huellaFuente` y `puedeAplicarse`. No existe ninguna ruta que aplique.

## 6. Rollback
Cualquier error → `ROLLBACK` completo y se relanza un `ErrorAplicacion` (código + fase). Probado con fallos inyectados en: eliminación del FIFO, eliminación de incidencias y de saldos, inserción de períodos, de incidencias, del FIFO nuevo, del relink de evidencias, de la auditoría, y con verificaciones que detectan una evidencia alterada o perdida: en todos los casos el estado de datos queda **idéntico** al inicial (los respaldos DDL permanecen). Nunca queda una reconstrucción parcial.

## 7. Pruebas
`vacaciones-reconstruccion-aplicador.test.ts` (BD en memoria con transacciones, FK y CASCADE emulados): dry-run sin escrituras; 13 evidencias / 13 incidencias; campos conservados; sin huérfanas; el CASCADE borra y el staging recupera; sin evidencias; otros tipos intactos; sin archivos físicos; respaldos; rollback en cada fase; confirmaciones; fuente cambiada; export no lossless; futuras/superpuestas; solicitudes; FIFO ajeno; 0 y 2 coincidencias de relink; identidad ≠ ID viejo; Álvaro (pendiente → no aplicable; aceptar con huella; huella distinta; manual); multiempresa. Además decisiones, motor (reparto manual), ruta de dry-run y contrato SQL.

## 8. Decisiones abiertas / riesgos
1. La distribución definitiva de Álvaro (RRHH).
2. Alcance de saldos: empleados con fecha válida que hoy tienen saldos o vacaciones (se regeneran también los de empleados sin vacaciones).
3. `creado_en` de incidencias/vacaciones nuevas será el momento de la reconstrucción (las filas se recrean).
4. Los respaldos son copias completas de las tablas (todas las empresas), como en el resto de las propuestas.
5. Exponer el aplicador (ruta/script con la confirmación fuerte) es un paso posterior y autorizado; no está en este PR.
