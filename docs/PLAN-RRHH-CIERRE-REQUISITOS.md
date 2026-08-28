# Cierre gradual de requisitos RRHH

Regla: cambios aditivos, por fase, sin retirar funciones existentes ni ejecutar
migraciones o modificar datos productivos como parte de las pruebas.

## Fase 1 — Indicadores mensuales (implementada; pendiente validación operativa)

- Conservar asistencia, altas, bajas, bitácora y accesos existentes.
- Neto a pagar: suma del neto de períodos Cerrada/Pagada por mes de inicio.
- Costo registrado: sueldo del período + bonos + otros ingresos + IGSS patronal.
  No representa costo empresarial total ni incorpora provisiones o pagos externos.
- Conservar `costoNomina` como alias histórico del neto para compatibilidad del API.
- Mostrar consulta fallida como No disponible; diferenciarla de un mes en cero.
- Usar el mes de Guatemala y advertir que el actual es parcial.
- Verificar con una empresa de prueba: generada excluida, cerrada incluida,
  pagada sin duplicación, cancelada excluida y otra empresa aislada.
- Las pruebas automáticas usan consultas simuladas: falta comprobación SQL con
  datos controlados y revisión de la pantalla en un ambiente de prueba.

## Fase 2 — Solicitudes de vacaciones del equipo (implementada; pendiente validación operativa)

- Reutilizar solicitudes y relaciones de supervisión existentes.
- Agregar solicitud por subordinado sin cambiar el autoservicio del colaborador.
- Autorizar en servidor por empresa/equipo; guardar solicitante y beneficiario.
- Mantener aprobación/rechazo separados y comprobación de saldo al aprobar.
- Conservar boletas, historial y permisos actuales.
- Acceso desde Portal → Vacaciones → Solicitar vacaciones para mi equipo.
- Revalidar equipo activo de la misma empresa bajo bloqueo antes del INSERT.
- Guardar autor y beneficiario en auditoría transaccional; identificar al supervisor
  en el comentario existente. No requiere tablas ni migración.
- Probar en ambiente controlado el flujo supervisor → pendiente → aprobación RRHH;
  las pruebas automáticas simulan la base de datos y no sustituyen esa validación.

## Fase 3 — Resumen mensual y conceptos (pendiente)

- Agregar resumen mensual sin sustituir las boletas por período.
- Separar salario, pagos adicionales y viáticos operativos sin duplicar importes.
- Mostrar si cada concepto está pendiente, entregado o aplicado.
- Antes de automatizar conceptos afectos/no afectos o festivos, acordar reglas
  con RRHH/Contabilidad; no inferir clasificación a partir del nombre del bono.

## Fase 4 — Casos legales (pendiente)

- Agregar expediente/caso, responsable, estado e historial de seguimientos.
- Conservar registros históricos y recordatorios; no reescribir sus hechos.
- Aislar por empresa y permisos; registrar autor y fecha de cada actualización.

Cada fase requiere pruebas dirigidas, TypeScript, ESLint de los archivos tocados,
revisión del diff y autorización de publicación/fusión. No fusionar pendientes
ajenos ni avanzar con una migración sin revisión previa.
