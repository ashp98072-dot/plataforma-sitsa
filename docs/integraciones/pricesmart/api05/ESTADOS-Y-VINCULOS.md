# API-05 — vínculos, estados y cancelaciones provisionales

Estados exclusivamente locales de revisión/simulación. externalPriceSmartStatus SIEMPRE null: no existen equivalencias oficiales de PriceSmart ratificadas. No se cambia el estado de la orden API-01 a partir de una observación logística.

## Separación de identidades y eventos

| Campo/entidad | Semántica / límite |
|---|---|
| externalOrderId | Referencia externa case-sensitive; no es solicitud, ruta, viaje o unidad TMS |
| orderId | UUID interno API-01, distinto de referencia externa y de candidateId |
| scope | Sandbox+empresa+cliente+integración de autoridad interna; club además validado con input/registro. Clave de namespace no incluye credencial rotativa |
| candidateId | SHA256 determinista de namespace+club+UUID de orden, prefijo candidate; identifica una PROPUESTA, no registro TMS |
| requestReference | Referencia ficticia resuelta por puerto puro, scoped a candidata/orden; vínculo unívoco sólo en modelo sintético actual. No asumir cardinalidad operativa aprobada |
| tmsRequestId | Null obligatorio. La futura identidad real de solicitud necesita tipo/tabla/actor/FK y aprobación separados |
| sourceState/sourceVersion | Snapshot del dominio API-01; CANCELLATION_REQUESTED no es cancelación final |
| version / expectedLinkVersion | Versión local del vínculo y CAS para observaciones, no versión de plan ni de solicitud TMS |
| job.version / leaseUntilMs | Ticket/fencing del intento de adaptación; no lock de un viaje operativo |
| receivedAt | Fecha de recepción del modelo, no fecha/hora solicitada para transporte |
| observation.occurredAt / trace.recordedAt | Ocurrencia ficticia vs registro por reloj confiable inyectado; UTC explícito. No se calcula SLA/OTD |
| evidenceReference / attemptReference | Referencias opacas sintéticas, sin archivos/URL/PII; no acreditan firma, POD o entrega contractual |
| materializable/readiness | false / CONTRACT_PENDING. CommercialData, requestedDate y actor permanecen null |

Diseño lógico de persistencia futura, NO SQL/migración: UNIQUE binario de trabajo (namespace+orderId+tipo de fuente+sourceVersion/eventId); hash de contenido validado y snapshot inmutable por trabajo DONE; UNIQUE de vínculo (namespace+orderId); candidata estable; referencia sintética de solicitud no compartida entre órdenes en el mismo namespace mientras D05 no ratifique cardinalidad. El doble rechaza una colisión de esa referencia, en vez de habilitar agrupación implícita. FKs scoped entre trabajos/vínculos/trazas y catálogo, control de club y CAS obligatorios. Metadatos deben incluir origen, revisión, correlación, tiempos y error enumerado; no almacenar payload o mensajes SQL en auditoría.

Historia de observaciones en trazas append-only, con último evento en proyección; conservar intentos STARTED/FAILED/SUCCEEDED/REPLAY/LEASE_RECLAIMED. No borrar deduplicación para resolver conflictos, no sobrescribir evento previo con contenido cambiado. Almacén durable, cifrado/retención D14, privilegios por operación, auditoría de acceso y recuperación reales pendientes. No se generan grants ni se comparte S04.

## Matriz de estados locales

| Fuente/observación sintética | Estado local resultante | Lo que NO acredita |
|---|---|---|
| Candidata sin resolución | AWAITING_MAPPING | Solicitud TMS creada |
| Referencia ficticia resuelta / SOLICITADA / EN_REVISION | LOGISTICS_REVIEW | Aceptación operacional por TMS |
| PROGRAMADA / Programado / Cargado | SCHEDULED_UNCONFIRMED | Recursos asignados/aprobados o salida física |
| En ruta | IN_PROGRESS_UNCONFIRMED | Entrega a destinatario |
| Descargado / Cerrado | DELIVERY_UNCONFIRMED | POD, cantidad/unidad, totalidad de orden o cumplimiento contractual |
| Referencia de evidencia / intento UNCONFIRMED | DELIVERY_UNCONFIRMED | Contenido verificado, firma, destinatario, posición o entrega ratificada |
| RECHAZADA / CANCELADA / Cancelado | REVIEW_REQUIRED | Rechazo/cancelación PriceSmart concluidos |
| Viaje compartido, parcial no confirmada, intento FAILED, reprogramación | REVIEW_REQUIRED | Semántica de múltiples unidades/intentos/parciales aprobada |
| Observación tardía (ocurrencia anterior a la última recibida) | REVIEW_REQUIRED | Orden temporal definitivo o corrección de eventos aprobada |
| Estado no reconocido o combinación kind/state inválida | INVALID_INPUT sin transición | Que un estado futuro pueda degradarse silenciosamente a éxito |
| Solicitud de cancelación API-01 / retención previa | CANCELLATION_REVIEW | Cancelación final, liberación de recursos o modificación de plan |

REVIEW_REQUIRED es conservador y persistente: una observación posterior corriente no levanta revisión. CANCELLATION_REVIEW también permanece. No hay comando de aprobación humana que las cierre en esta fase. La matriz representa observaciones, NO impone transiciones operativas del TMS. LastObservation es el último evento recibido, no garantía de cronología perfecta; todos quedan en trazas. Cambios de fecha, pruebas contradictorias y estados fuera de orden deben ratificarse D07/D08/D13.

## Matriz de cancelación y conflictos

| Escenario | Tratamiento sintético | Pendiente |
|---|---|---|
| Fuente solicita cancelar antes de candidata | Retener candidata sin llamar resolver; CANCELLATION_REVIEW, sin referencia real |
| Cancela mientras se espera resolver | Recargar fuente; no adjuntar referencia nueva y retener para revisión | Lock/fencing común con fuente y materialización real |
| Cancelación tras referencia ficticia o programación observada | Registrar solicitud, conservar vínculo/historia y retener | Validar autoridad/estado real, no cancelar plan automáticamente |
| En ruta / evidencia / cierre / parcial / viaje compartido | Retener para revisión, sin tocar recursos ni otros pedidos | D05/D09/D13 y compensaciones/protocolo operativo |
| Repetición del mismo evento/contenido | Snapshot original + traza REPLAY, sin nueva candidata |
| Misma clave con otro motivo/contenido o motivo distinto de fuente | CONFLICT, sin modificar vínculo |
| Versión local obsoleta / referencia ajena | CONFLICT/NOT_FOUND y trabajo REVIEW_REQUIRED, trazabilidad conservada | Conciliación manual o evento nuevo; no modificar identidad de evento anterior |
| Fallo de dependencia | RETRYABLE y FAILED; reintento explícito, nunca descartar ni ACK de outbox |
| Falla también el diario de error | Lease PROCESSING conserva claim; reclamación explícita con ticket mayor al vencer | Durabilidad/caída/failover de almacenamiento real NO EJECUTADOS |

Múltiples entregas, unidades, intentos, viajes compartidos y parciales sólo se representan como señales para revisión. No existe agregación aprobada de cantidades, creación de viajes adicionales, reprogramación automática, cancelación de órdenes hermanas ni cálculo de estados externos. El outbox de origen no se consume; falta una cola/ack transaccional real y protocolo de coordinación con TMS, a diseñar y probar con autorización posterior.
