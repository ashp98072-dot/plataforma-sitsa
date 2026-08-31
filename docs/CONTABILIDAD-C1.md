# C1 — permisos y altas contables

Entrega acotada: corrige escritura de Contabilidad para usuarios con solo lectura
efectiva, sin recuperar ese permiso por el nombre de su rol. Admin conserva el
acceso; crear O editar sigue habilitando el contrato de escritura existente.
No cambia la autorización de otros módulos ni la obtención/caché de permisos.

Cuentas, CxC y CxP mantienen rutas, respuestas y tablas actuales. Sus altas ahora
validan longitudes, espacios vacíos, niveles positivos, fechas reales, vencimiento
no anterior a emisión e importes DECIMAL(14,2) sin redondeo silencioso. Se mantiene
el monto cero por compatibilidad. Documento/vencimiento opcionales se conservan.

INSERT y auditoría obligatoria comparten conexión y transacción: un fallo revierte
la operación. Empresa y actor proceden del guard, no del cuerpo. JSON inválido
devuelve 400; duplicados/locks, 409; fallos inesperados, 500 controlado. Ante error
incierto al confirmar, consultar listado antes de reintentar. CxC/CxP aún no tienen
idempotencia documental: no se afirma que dos solicitudes válidas sean un duplicado.

Sin migración ni SQL ejecutado sobre bases reales. No reasigna registros a KT o
Mónaco; no implementa pagos, períodos, reversos ni importación. No cambia la
pantalla de demostración ni el límite de listados de la fase anterior.

Pruebas: guard real con dependencias de sesión/permisos simuladas; servicios con
conexión simulada; endpoints con validación real y DB simulada; regresión de
asientos y entidades. Pendiente prueba de integración en MariaDB y UI con usuarios
reales de prueba. Las pruebas unitarias no certifican producción.
