# Usabilidad CB2

- Base: main posterior a #587. Admin dispone de «Placas duplicadas»; cada ID conserva identidad, características y referencias. Sucursal ausente se muestra como no registrada.
- Desactivar exige dos IDs propios de placa comparable, revisión vigente, otro ID activo, motivo y confirmación. Se revalidan permisos y referencias bajo bloqueo; cualquier vínculo detectado (incluso histórico), taller, motor incompatible o consulta incompleta bloquea. Se examinan FK, columnas de vehículo/unidad recurrente y snapshots CB2. No se fusionan IDs, transfieren relaciones ni borran registros/archivos. Los escritores externos al sistema no quedan certificados por esta revisión.
- Confirmación identifica vales problemáticos, placa y causas; «Ir a corregir» abre su fila aunque esté en otra página y limpia filtros. «Solo problemas» conserva las selecciones.
- Tercerizados tiene pestaña propia y pasos de alta/verificación/reconocimiento. D2 continúa cerrada por defecto; no cambian permisos, reconocimiento ni reglas D3. D1–D5 no se aprueban con este cambio.
- Sin migración ni SQL de aplicación requerido. Validaciones con fixtures/mocks; sin conexiones a bases reales ni despliegue.
