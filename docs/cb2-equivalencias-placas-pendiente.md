# Equivalencias de placas CB2: trabajo pendiente

La selección manual existente requiere un motivo de al menos diez caracteres cuando la placa no coincide. La validación se repite en el servidor durante la importación y la placa original se guarda por separado. La indicación añadida en la revisión muestra el valor reportado, el vehículo seleccionado y que la selección aún es provisional.

Este cambio **no implementa equivalencias de placas**. Las equivalencias de pilotos existentes se restringen por empresa y nombre, pero no por proveedor y vehículo, por lo que no deben reutilizarse como si ofrecieran ese aislamiento. El reconocimiento de placas existente tampoco representa una confirmación humana de una equivalencia.

Para completar la función se necesita diseñar y validar almacenamiento por empresa, proveedor y placa normalizada; escritura junto con la importación bajo el bloqueo y la auditoría existentes; propuestas que exijan aceptación explícita; detección de conflictos y vehículos no autorizados; administración y revocación trazable. También faltan las pruebas de transacciones, concurrencia, reintentos y ambos formatos en MariaDB aislada. No se ha preparado ni ejecutado una migración.

Operaciones puede seguir usando la selección manual justificada actual, revisando todos los demás requisitos antes de confirmar. Esta selección no se recuerda para futuras importaciones.
