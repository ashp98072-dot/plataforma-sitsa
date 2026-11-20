# Canecas llenas: diseño pendiente de integración de costos

Este documento describe decisiones técnicas propuestas para el Draft; no afirma que estén implementadas ni autoriza una instalación.

## Recepción y capas

- La compra tiene precio unitario y gastos atribuibles expresados en centavos exactos, con moneda explícita. Un importe desconocido es NULL, no cero. Un precio de venta de referencia pertenece al catálogo y no modifica operaciones anteriores.
- Cada recepción confirmada genera una o más capas FIFO, cada una con empresa, producto, ubicación, recepción, cantidad, costo y orden estable de entrada. Varias capas de una recepción permiten repartir centavos sin pérdida; la suma de sus cantidades debe coincidir con la recepción.
- La confirmación debe conservar el orden de bloqueo existente: compra, recepción y saldo; dentro de esa misma transacción valida las cantidades, calcula el desplazamiento de unidades ya recibidas, registra capas, movimiento y saldo, y confirma la recepción. Un error revierte todo. La unicidad por recepción y segmento evita duplicados; el reintento confirmado no inserta otra capa ni otro movimiento.
- El cálculo proporcional requiere que el gasto conocido esté fijado antes de las recepciones para que distintas particiones recibidas produzcan el mismo total. Cambiarlo después no debe modificar silenciosamente las capas históricas.

## Existencias sin costo histórico

- La migración no debe inventar costos ni crear capas retrospectivas suponiendo la composición de existencias. Hasta una conciliación aprobada, el saldo no asignado a capas permanece explícitamente pendiente de valoración y no puede presentarse como costo cero.
- Antes de incorporar inventario inicial se debe suspender la escritura para el alcance conciliado y comparar por empresa, producto y ubicación el físico, reservado y capas ya existentes. Cualquier diferencia o traslado en tránsito requiere revisión; no repetir la inicialización si ya se registró.
- La valoración inicial debe conservar responsable, fecha, fuente y justificación, con un asiento y clave idempotente. El método FIFO para existencias iniciales no puede reconstruir el orden histórico inexistente: debe identificarse como saldo inicial y requerir un criterio aprobado para su prioridad.

## Gastos posteriores y compatibilidad

- Los gastos tardíos y rectificaciones deben ser eventos adicionales identificables, con responsable, motivo y documento, nunca una edición silenciosa de la recepción. La política de distribuirlos entre existencias, tránsito y salidas ya consumidas queda pendiente de aprobación; no automatizarla antes de implementar conciliación e historial de consumo.
- El traslado del PR #650 descuenta saldos pero aún no transporta capas. Debe permanecer separado; antes de habilitar ambos flujos se necesita preservar la identidad de la capa y sus costos en tránsito, recepción parcial y faltantes. Una salida sin asignación de capas impediría calcular FIFO correctamente.
- Las futuras ventas deberán consumir capas disponibles bajo bloqueo, registrar las asignaciones y proteger reintentos. Reservas y tránsito no equivalen a consumo ni a costo de ventas.

## Controles pendientes

La implementación debe comprobar aislamiento por empresa en todas las claves y consultas, permisos para compras, confirmaciones y valoración, y reintentos con huella de operación. Los scripts deben verificar motor, columnas, índices, permisos y estado parcial; el DDL de MySQL/MariaDB no es transaccional. Con datos registrados, recuperación y conciliación requieren un plan específico: no borrar tablas o capas automáticamente.
