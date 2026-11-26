# Auditoría preliminar — Combustibles

Base examinada: main ab2dacae57849a5c6d33a415cc7563483a4656fb. Esta revisión es parcial y no autoriza todavía una implementación: falta completar el análisis de importaciones, conciliaciones, consultas y dependencias, y verificar los reportes con datos de prueba.

- `src/components/flota/cb2/panel.tsx` presenta ocho vistas principales: piloto, consumos, importar, facturas, conciliación, historial, tercerizados y placas duplicadas. Importar se restringe por `canWrite` y placas duplicadas por `admin`. Conserva componentes montados con `hidden`, con activación explícita en varias consultas.
- `src/components/flota/combustibles-client.tsx` agrega enlaces a importaciones históricas, registro de vales y estaciones, y un panel independiente de revisión de vales. No debe confundirse ese circuito con CB2.
- `src/components/flota/cb2/historial.tsx` es historial de importaciones y permite consultar trazabilidad y reanudar candidatos; no equivale a una consulta cronológica de consumos.
- `src/components/flota/cb2/pilotos-reporte.tsx` ya ofrece filtros por fecha, nombre, identificadores y proveedor y exportación CSV. Advierte que el nombre reportado no acredita identidad. El servicio `src/lib/flota/cb2/pilotos-reporte.ts` filtra por empresa y suma galones y monto de consumos separados por moneda y producto; no suma facturas ni demuestra pagos. La consulta pagina por ID y los totales actuales no están agrupados por piloto o período.
- `src/components/flota/cb2/tabla-consumos.tsx` muestra fecha, vale, placa, proveedor, galones, precio, monto, factura, empleado y combustible. Los originales se muestran en detalles y la presentación redondea; hay referencias a importación y factura. Conviene reutilizar esta evidencia sin tratar el monto de consumo como pago.
- La asociación de factura del lote en `src/components/flota/cb2/consumos.tsx` se describe como documental y no registra pagos. Evitar sumar el total documental junto al importe de consumo.
- `src/components/flota/cb2/terceros.tsx` incluye gestión y verificación de identidades, no únicamente un reporte. `duplicados.tsx` contiene revisión administrativa y controles de identidad canónica; deben mantenerse sus permisos y comportamiento.

Pendiente: inventario y comprobación completa de rutas, filtros, permisos, HALEL/SHELL y dependencias; estrategia de navegación y estado; pruebas de regresión de escrituras, aislamiento por empresa y totales; verificación visual en móvil y escritorio. Ninguna funcionalidad se ha eliminado ni se han cambiado cálculos, datos, SQL o esquemas.
