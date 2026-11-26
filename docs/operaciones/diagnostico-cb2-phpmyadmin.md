# Diagnóstico del resumen CB2 en phpMyAdmin

Estas instrucciones preparan consultas de lectura para una persona autorizada; no ejecutan ninguna consulta automáticamente. Selecciona en phpMyAdmin la base correspondiente al sitio y comprueba su nombre antes de continuar. Usa una cuenta de solo lectura. No pegues contraseñas, tokens, nombres de pilotos ni datos de vales en el reporte.

1. Abre `sql/diagnostico-cb2-resumen-lectura.sql` y copia **una sentencia completa a la vez** en la pestaña SQL. Las sentencias de `information_schema` no requieren sustituciones. Revisa que cada sentencia comience por `SELECT` o `EXPLAIN SELECT` antes de ejecutarla.
2. phpMyAdmin no sustituye automáticamente los signos `?`. Para los cuatro `EXPLAIN`, identifica primero el ID numérico de la empresa en una fuente autorizada; no lo infieras del slug ni utilices un valor de ejemplo como si fuera real. Sustituye cada `?` por un literal: el ID como entero positivo sin comillas; el inicio y el fin exclusivo como fechas entre comillas simples, en formato `AAAA-MM-DD`.
3. Para noviembre de 2026, el inicio es `'2026-11-01'` y el fin exclusivo es `'2026-12-01'`. Si, **solo como ejemplo**, el ID verificado fuera `123`, una condición con tres parámetros quedaría así:

```sql
c.empresa_id=123 AND c.creado_at>='2026-11-01' AND c.creado_at<'2026-12-01'
```

4. Sustituye en orden de aparición, sin dejar signos `?`:

| Sentencia | Orden de sustitución |
| --- | --- |
| Resumen histórico agrupado | ID, inicio, fin |
| Consulta integrada anterior con `OR` | ID, inicio, fin, inicio, fin |
| Consulta integrada propuesta | ID, inicio, fin |
| Consumos CB2 | ID, inicio, fin |

No copies valores proporcionados por terceros sin verificarlos como entero positivo o fecha válida. No incluyas el prefijo `EXPLAIN` en la sustitución: debe permanecer al comienzo de cada consulta. No ejecutes directamente los `SELECT` contenidos dentro de `EXPLAIN`; el objetivo es obtener planes, no datos de consumos.

5. Guarda los resultados de tablas/columnas/índices y los planes (`key`, `rows`, `Extra`) para compararlos. El contador de `information_schema.INNODB_LOCK_WAITS` es opcional y puede requerir permisos; una denegación no demuestra ausencia de esperas. No ejecutes `EXPLAIN ANALYZE`, cambios de índices, migraciones ni sentencias de escritura.

Correlaciona estos resultados con los registros de la aplicación y el momento de la incidencia. Los planes y metadatos por sí solos no demuestran qué consulta falló ni si hubo un bloqueo o límite de recursos. Comparte únicamente el resultado necesario, revisado para excluir información sensible.
