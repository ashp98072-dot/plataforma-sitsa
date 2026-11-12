# PRICESMART-API-13 — resiliencia operativa y trazabilidad (laboratorio local)

**Estado: IMPLEMENTADO y PROBADO en laboratorio local (MariaDB 11.8.9 real + `next dev`, datos ficticios). NO aprobado para producción: el runtime productivo sigue cerrado (503 `DISABLED`) y todo lo nuevo vive bajo la composición de laboratorio.** D02/D06/D08/D09/D12 siguen pendientes.

## Qué cambia
| Pieza | Dónde |
|---|---|
| Reintentos: cola `ps_api13_link_jobs` + registro de eventos inmutables `ps_api13_link_attempts` (cada intento = un evento `STARTED` y un evento `FINISHED`, solo INSERT; un intento interrumpido queda con `STARTED` sin `FINISHED`, sin inventar resultado; un trabajador con lease vencido que termina tarde registra `FINISHED` con `LEASE_LOST`); descubrimiento por barrido (no depende de que PriceSmart reenvíe); lease y fencing con la hora de la BD; retroceso exponencial y máximo de intentos | `lab-demo/link-retry.ts`, `api13/staging-link-retry.sql.in` |
| Identidad del vínculo: `solicitud_id` se escribe **en la misma transacción** que la solicitud (gancho opcional `dentroDeTransaccion` de `crearSolicitudCliente`, cambio retrocompatible y justificado: elimina la ventana de caída entre ambas escrituras). El token en `observaciones` queda solo como trazabilidad/compatibilidad con reclamos pendientes de API-12 | `lab-demo/tms-link.ts`, `src/lib/tms/solicitudes-cliente.ts` |
| Operaciones: en la bandeja existente, insignia **PriceSmart**, insignia **Cancelación solicitada** (mientras la solicitud siga abierta) y panel de vinculaciones pendientes/fallidas con **Reconocer** (solo constancia + auditoría) | `solicitudes-clientes-bandeja.tsx`, rutas `.../solicitudes-clientes/pricesmart[/reconocer]`, `lab-demo/ops-view.ts` |

Clasificación: éxito → `DONE`; rechazo del TMS, ambigüedad u orden cancelada antes de vincular → `BLOCKED` (requiere a una persona, sin reintentos); sin mapeo, bloqueo ocupado o excepción → reintento con retroceso hasta `EXHAUSTED`. Los errores se guardan como código corto, nunca el mensaje crudo.

## Pruebas (`node scripts/ci/pricesmart-demo/demo.mjs up | e2e [archivo] | restart-app --worker-ms=3000 | down`)
`demo.e2e.ts` (regresión API-12, 13 casos) · `api13.e2e.ts` (13 casos: éxito, caída antes/después de crear, recuperación sin reenvío, reinicio con lease vencido, 3 trabajadores concurrentes, colisiones entre integraciones y empresas, límites, visibilidad/reconocer, cancelación visible, barrido, orden cancelada) · `api13-worker.e2e.ts` (trabajador dentro de la app tras reiniciarla). Unitarias de política de reintentos y de `RELEASE_LOCK`.

## Bloqueos y límites reales
- **Prueba criptográfica de pertenencia**: sin una columna de origen inmutable en `tms_solicitudes_cliente` no se puede probar la pertenencia solo con datos del TMS; se resolvió con atomicidad (vínculo en la misma transacción), no con una migración del TMS. Una columna de origen externo sería la solución definitiva y requiere decisión/migración.
- Trabajos **sin mapeo** no tienen empresa conocida (D04 pendiente): no aparecen en la bandeja de ninguna empresa; solo en el registro de intentos.
- Sin runner de producción: el trabajador periódico solo arranca en laboratorio con `PRICESMART_LAB_WORKER_MS`. Reloj de la BD, KMS, TLS/gateway y cuenta de ejecución real siguen pendientes.
- La cancelación solicitada se muestra, pero **no** se cancela nada solo; la decisión es de Operaciones.
