# CB2: instalación manual y corte para auditoría

Base revisada: `origin/main e0c52d06` (incluye #623, #624 y #627). No se consultó ni modificó producción. Su estado actual de tablas, CHECK y flags sigue sin acreditar; ejecutar manualmente el inventario es requisito, no una tarea realizada.

## Funcionalidad y límites

| Flujo | Resultado en laboratorio / dependencia productiva |
|---|---|
| Alta de piloto/unidad externos sin A/B | Implementada; requiere terceros, política directa e identidades independientes instaladas y flag directo. Shell ahora muestra el alta y conserva la selección externa. |
| Pendiente → Listo → consumo | Validado con piloto/unidad externos, clasificación y empresa correctos. Listo es elegibilidad de vista previa, no un estado contable persistido. El servidor revalida al confirmar. |
| Nombres originales y equivalencias Shell | Conserva texto original; tres tablas nuevas para nombres reportados/equivalencias con empleado. Decisiones explícitas, homónimos no se resuelven automáticamente. |
| Archivos solapados | Corregida reutilización de unidad externa con snapshot independiente; no duplica consumo ni marca falsamente conflicto. |
| Duplicados | Reutilizar referencia estable; elegir ID explícito para homónimos/unidades ambiguas y corregir asignación con auditoría. Vehículos de Flota admiten alias/fusión sin mover históricos, con sus guardas instaladas. **No existe fusión general de pilotos/IDs externos ya duplicados**: la elección explícita resuelve la operación; consolidar todos sus históricos bajo un ID sigue bloqueado. No borrar registros ni actualizar referencias masivamente. |
| Empresa, proveedor, permisos | Aislamiento y revocación revalidados dentro de transacción; FK y CHECK activos. |
| Fondos | Una tabla nueva; vínculo manual idempotente por consumo, diferencias visibles, sin alterar consumo ni generar pago. Una línea puede financiar varios consumos: no es una restricción 1:1. Cambio posterior de asignación requiere revisión del vínculo. |

## Ruta mínima en Hostinger (después de auditoría independiente)

1. Pausar importaciones/altas/conciliación CB2 durante DDL. Identificar el respaldo existente por SHA256 y guardar la captura CHECK privada junto a él. Seleccionar y verificar manualmente base y versión. No reutilizar una sesión con FK/CHECK deshabilitados.
2. Ejecutar `00-capturar-checks-solo-lectura.sql` y `01-inventario-bloqueantes.sql`. Confirmar integridad/visibilidad del inventario con los privilegios del operador. Registrar flags y SHA desplegado desde la configuración del hosting, sin exportar secretos.
3. Ejecutar **por separado** `10-preflight-shell.sql` y `10-preflight-fondos.sql`. Exigir cero faltantes/incompatibilidades/objetos nuevos existentes y FK=CHECK=1. Cualquier objeto parcial exige detener y auditar. Estos archivos no instalan dependencias previas.
4. Importar `20-instalar-shell.sql` (tres CREATE TABLE) y ejecutar `30-postcheck-shell.sql` + `31-integridad-shell.sql`. Exigir cero anomalías y tablas vacías inicialmente; contrastar cuerpos CHECK completos con el instalador.
5. Importar `20-instalar-fondos.sql` (un CREATE TABLE) y ejecutar `30-postcheck-fondos.sql` + `31-integridad-fondos.sql`. Exigir cero anomalías, tabla vacía, tres FK, dos CHECK y reutilización de `uq_fondolin_c2a_empresa_id`; no añadir un índice histórico redundante.
6. Registrar resultados y detenerse para decisión del propietario. No envolver CREATE TABLE en una transacción esperando rollback: MariaDB hace commit implícito. No repetir a ciegas ni usar IF NOT EXISTS. No ejecutar migraciones por arranque de aplicación.

Los cuatro CREATE TABLE son los SQL ya probados sobre el respaldo exportado y coinciden con los migradores actuales; no se repite aquella restauración. El paquete no altera tablas históricas, CHECK existentes ni triggers. No incluye la migración distinta `migrate-2026-11-cb2-piloto-reportado.sql` (singular): esta modifica CHECK y permite nombre reportado en unidad externa. Si falta, esa combinación sigue bloqueada y necesita su propia auditoría; no confundirla con las tres tablas de `pilotos-reportados` (plural).

## Recuperación complementaria del respaldo sin CHECK

- `00` solo lee metadata y genera texto SQL. Exportar **todas** las filas y cláusulas completas con longitud/hash; conservar también `validar_datos` y `restaurar_check` como SQL plano, sin formato CSV. No subir capturas ni respaldo a Git.
- Confirmar que el esquema del respaldo y el capturado corresponden al mismo corte, o reconciliar sus diferencias de DDL antes de dar la recuperación por apta. Una captura actual no prueba cómo eran los CHECK al exportar un respaldo anterior.
- Ante recuperación: restaurar primero el respaldo en una base aislada, con versión compatible y modo SQL/charset/collation de la captura; comparar tablas/columnas y CHECK existentes. Si existe mismo nombre con cuerpo distinto, detener. No borrar ni sustituir restricciones automáticamente.
- Ejecutar allí los `validar_datos`: cada resultado debe ser cero (NULL está permitido por CHECK). Agregar **solo los CHECK ausentes** usando las sentencias `restaurar_check`; no desactivar FK/CHECK. Comparar inventario, cantidad, cuerpos y hashes con la captura; repetir validaciones. Un CHECK que falla impide certificar recuperación: no corregir datos silenciosamente.
- El respaldo conserva los datos exportados; esta captura solo completa restricciones CHECK. No recupera escrituras posteriores al respaldo ni acredita por sí sola triggers, rutinas, archivos privados o consistencia temporal del dump. Para estas migraciones aditivas no restaurar todo el respaldo como rollback normal: si ya hay escrituras nuevas, detener y preservar las tablas/evidencia; cualquier retiro requiere inventariar referencias y plan específico.

## Orden de flags propuesto; ninguno activado

1. Mantener `CB2_TERCEROS_D2_APROBADA` apagado para el flujo solicitado sin A/B. No es requisito encenderlo para altas directas.
2. Solo tras acreditar migraciones `cb2-terceros`, `cb2-terceros-directos`, `cb2-identidades-independientes`, permisos y código corregido aprobado: propietario podrá activar `CB2_TERCEROS_DIRECTOS_APROBADA=1`. Hasta entonces, altas/selección directas bloqueadas en producción.
3. Tres tablas Shell y tabla de fondos **no tienen flag**: la aplicación las detecta. La instalación misma expone esas funciones; mantener la pausa operativa hasta terminar postchecks. No inventar un flag Shell/fondos.
4. `FLOTA_FUSIONES_APROBADAS=1` únicamente con preflight/postcheck de fusiones, triggers y dependencias de identidad física aprobados. Si no se acredita, dejar bloqueada fusión; no impide importación normal ni elegir IDs explícitos.
5. Mantener `CB2_DOCUMENTOS_FASE2` apagado salvo auditoría separada de sus migraciones. No bloquea el consumo/importación/vínculo manual con fondos. Validar `CB2_PUBLIC_ORIGIN` contra el dominio efectivo antes de operar por HTTP.

## Riesgos concretos y punto de parada

DDL parcial de las tres tablas bloquea registro de nombres; exportación sin CHECK pierde guardas; snapshot CHECK de otro corte puede ser incompatible; flags activos con esquema incompleto fallan; fondos no son pagos ni conciliación automática; unidad externa solo puede vincular una línea genérica sin vehículo de Flota incompatible. Las ambigüedades requieren decisión humana y la consolidación general de pilotos externos no está implementada.

No se declara el módulo totalmente cerrado: faltan acreditación del estado productivo y la consolidación general indicada. Entrega para auditoría independiente de ChatGPT; sin SQL productivo, despliegue, activación ni merge.
