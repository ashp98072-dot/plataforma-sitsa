# Limpieza temporal de datos de prueba

Solo Admin. No se ejecutó ninguna limpieza durante el desarrollo. Sin migración.
Respaldar la base antes: tras confirmar la transacción no existe deshacer desde la UI.
Ejecutar sin otros usuarios generando planillas o registrando viajes/pagos.

## Descuentos individuales

RRHH → Descuentos → seleccionar descuento → Eliminar descuento (pruebas).
Exige escribir `ELIMINAR DESCUENTO ID`. Borra ese maestro, cuotas y abonos.
Conserva entrega y movimientos de inventario, pero desvincula el descuento.
No toca descuentos heredados, empleados ni archivos físicos.
Si está vinculado a multas, usar la limpieza conjunta. Si tiene cuotas reservadas
o aplicadas en planillas, limpiar primero Planillas/nómina (libera las cuotas).

## Administración → Limpiar módulo

Las opciones normales conservan sus restricciones. Las nuevas opciones PRUEBAS
requieren seleccionar empresa y escribir una confirmación diferente:

- PRUEBAS · Programación/TMS: planes y viajes asociados incluso abiertos, paradas,
  evidencia registrada, lecturas del viaje y viáticos incluso autorizados/pagados.
  Conserva vehículos, kilometraje actual, rutas, clientes y viajes independientes.
- PRUEBAS · Viáticos: todos los estados, sin borrar viajes. No revierte transferencias.
- PRUEBAS · Multas + descuentos vinculados: multas incluso pagadas/resueltas,
  revisiones mensuales y documentos registrados, junto con sus descuentos de RRHH,
  cuotas y abonos. Desaparecen también de la bandeja de multas de RRHH, que consulta
  los mismos expedientes. Conserva descuentos no vinculados a multas.

Ejemplo: `KT LIMPIAR PRUEBAS_MULTAS` (usar el código real mostrado en pantalla).
Conserva archivos físicos y auditoría; solo elimina sus registros dentro del alcance.
Referencias externas, cruces entre empresas o cuotas vinculadas a planilla bloquean
la limpieza. No desactiva FKs, no usa TRUNCATE, no borra catálogos por cascada.
Todo en una conexión/transacción; un error, incluso de auditoría, revierte todo.

## Retirada al finalizar pruebas

Retirar los tres códigos `pruebas_*` de limpieza, el DELETE temporal de descuentos
y su botón/flag `puedeEliminarPrueba`. Conservar las funciones normales, sus guards
y la comprobación correcta de FKs compuestas. No borrar el historial de auditoría.

Validación automatizada con base simulada. Pendiente comprobar con copia controlada
del esquema real y respaldo: no se han ejecutado borrados en producción.
