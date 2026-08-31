# C3B — consulta de partidas

Continúa C3A con detalle de partidas y totales por partida en el listado.
No completa toda C3 ni la integración Milenium. No importa ni modifica clientes,
movimientos o archivos del sistema de origen. Sin migración ni SQL ejecutado.

## Disponible

- Consulta de las últimas 100 partidas: número, fecha, glosa, Debe y Haber.
- Ver detalle: cabecera, estado, autor, cuentas, líneas, totales y diferencia.
- Usuarios de lectura pueden consultar; no se agregan acciones de escritura.
- El detalle conserva cuentas inactivas y avisa si faltan cuentas o líneas.
- Los totales del listado son de cada partida, no un balance completo del libro.

## Seguridad y consistencia

GET asientos mantiene su respuesta de listado y acepta id para el detalle.
Exige guard de módulo y acceso a la entidad en la misma conexión/transacción.
Cabecera y líneas filtradas por empresa + entidad + partida; unión de cuentas
también por ámbito. Partida ausente/ajena devuelve 404; acceso revocado, 403.
Respuesta private/no-store. Sin UPDATE, DELETE ni inserciones.
Reutiliza el bloqueo de empresa/entidad que coordina con captura y limpieza.
Totales SQL DECIMAL en listado y BigInt en centavos para detalle.
Al cambiar de entidad se desmonta la consulta; peticiones anteriores se cancelan.

## Validación y límites

Pruebas de lectura, aislamiento SQL, permisos, ids, rollback, precisión y render
estático; TypeScript, ESLint y diff check. No sustituye una prueba interactiva
autenticada ni concurrencia real en MariaDB.

## Siguiente entrega

Aprobar reglas de ejercicio/períodos, numeración, apertura/cierre y reapertura.
Después preparar migración manual y bloqueo concurrente; luego reversos con
motivo, vínculo, idempotencia y protección de limpieza. C4–C7 siguen pendientes.
