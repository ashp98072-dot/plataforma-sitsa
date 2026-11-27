# Equivalencias de placas CB2

En una importación, selecciona la unidad interna, compara su placa con la original y documenta la diferencia con al menos diez caracteres. Marca «Recordar esta equivalencia» y confirma el procesamiento. La equivalencia se guarda en la misma transacción que el consumo; el Excel y la placa original se conservan. El proveedor seleccionado delimita la equivalencia, independientemente del formato SHELL o HALEL.

En una importación posterior, una sugerencia vigente aparece identificada como equivalencia guardada. Elige «Usar sugerencia guardada», revisa la evidencia y proporciona una justificación. El servidor vuelve a verificar la vigencia, acceso y conflictos al confirmar. El piloto y combustible siguen sujetos a sus propias comprobaciones.

En la pestaña Pilotos se muestran las equivalencias de placas. Un administrador puede revocar una equivalencia; esta permanece en el historial y deja de sugerirse, sin alterar consumos anteriores. Una equivalencia revocada o contradictoria no se reemplaza automáticamente; requiere revisión administrativa. Se muestran hasta 1000 registros recientes.

Las altas y los cambios de placa de Flota comparten un bloqueo transaccional de la empresa con el registro de equivalencias. Si una placa real entraría en conflicto con una equivalencia vigente, la operación de Flota pide revisarla y revocarla antes de continuar. La misma comprobación se aplica al compartir un vehículo con otra empresa. Los escritores SQL externos que no utilicen este protocolo no quedan cubiertos; las sugerencias se vuelven a comprobar antes de confirmar.

## Instalación manual pendiente de autorización

Primero selecciona explícitamente la base de datos correcta en phpMyAdmin y ejecuta `sql/preflight-2026-11-cb2-equivalencias-placas.sql` en modo de lectura. Verifica que la tabla nueva no exista, que las tablas requeridas usen InnoDB, que los ID sean INT con el mismo signo, que el proveedor tenga índice único completo `(empresa_id,id)` y que los nombres de restricciones estén libres. No continúes si las condiciones no se cumplen. Solo tras revisión y autorización, un operador ejecuta `sql/migrate-2026-11-cb2-equivalencias-placas.sql`; después ejecuta `sql/postcheck-2026-11-cb2-equivalencias-placas.sql` y verifica motor, columnas, clave primaria, referencias y restricciones. Ninguno de estos pasos se ejecuta automáticamente en producción.
