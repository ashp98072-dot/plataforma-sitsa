# C3A — captura real de partidas

Base: 5e3a231. Retoma C2B (separación funcional KT/Mónaco), cuyas migraciones
el usuario confirmó aplicadas manualmente. No se consultó producción para
certificar el esquema ni se ejecutaron SQL, limpiezas o importaciones.

## Disponible en esta entrega

Tras seleccionar una entidad, un usuario con escritura ve Registrar partida
contable en lugar del botón Asiento demo. Ingresa número manual, fecha y glosa;
selecciona cuentas activas de esa entidad y agrega de 2 a 500 líneas de debe/haber.
Los totales y diferencia se calculan con enteros BigInt en centavos, sin redondear.
Se aceptan punto o coma decimal, no separadores de miles ni notación exponencial.
Cada línea requiere un único lado positivo y la partida debe cuadrar exactamente.

La confirmación indica que el registro es definitivo, no un borrador. Reutiliza
el POST de asientos: guard efectivo, ámbito tenant+entidad, esquema C2B, bloqueo
de cuentas activas, validación server-side, cabecera/detalle/auditoría en una
conexión y rollback si falla. No se cambia este backend ni sus restricciones.
El número sigue siendo único por empresa y entidad, NO por período.

El formulario bloquea envíos simultáneos y conserva una partida registrada hasta
pulsar Nueva partida. En errores conserva los datos. Si la conexión falla con
resultado incierto, se debe consultar el listado y mantener el mismo número al
reintentar: la restricción existente impide duplicarlo, pero no se ha añadido
idempotencia por contenido o una cola de reintentos. Cambiar de entidad desmonta
su libro y descarta la captura local; no se comparte un borrador entre entidades.

No cambia cuentas existentes, CxC/CxP, clientes, Facturación, TMS o RRHH.
No agrega dependencias, tablas, migraciones ni datos de Milenium al repositorio.

## Pendiente de C3, no presentar como terminado

1. Consulta individual del detalle completo de una partida y totales del listado:
   resuelto en C3B, ver CONTABILIDAD-C3B-CONSULTA.md.
2. Aprobar reglas de período/ejercicio, numeración, apertura/cierre y reapertura.
3. Diseñar y aplicar manualmente la migración correspondiente; validar bloqueo
   transaccional para que un cierre y una escritura concurrente no se crucen.
4. Reversos vinculados al original, motivo, permisos e idempotencia; sin borrado
   físico de historia. Proteger también la limpieza administrativa del libro.

C4–C7 (auxiliares e integración con Facturación, bancos/reportes, importador y
operación paralela) siguen pendientes. Esta captura no certifica equivalencia
funcional con Milenium ni habilita por sí sola una puesta en producción contable.

## Validación

Pruebas unitarias: centavos, coma decimal, límites, cuentas no seleccionables,
fecha, glosa, número, cuadre y líneas. Render estático del formulario: campos,
ausencia de demo, estado sin cuentas y bloqueo durante envío. Se ejecuta además
la regresión contable del backend y de limpieza. Estas pruebas no sustituyen
una prueba interactiva autenticada ni concurrencia real en una copia MariaDB.

Resultado local: 31 archivos / 287 pruebas aprobadas (Contabilidad, render de
captura, APIs bajo empresas y limpieza contable); TypeScript y ESLint limpios.
Se corrigió únicamente la búsqueda de ALTER TABLE en la prueba de C2A para
admitir saltos CRLF de Windows y LF, sin modificar la migración.
