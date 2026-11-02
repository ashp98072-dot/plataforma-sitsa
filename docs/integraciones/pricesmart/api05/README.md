# API-05 — adaptación TMS y circuito integral sintético

Fecha: 2026-11-02 (America/Guatemala). Base `c8b3cf57` de origin/main, merge #550/API-04. Rama independiente `feature/pricesmart-api05`. D01–D16 PENDIENTES. Sólo archivos nuevos; sin cambios a dominio, repositorio, M2M, transporte API-01–API-04 o reglas del TMS.

Entrega: [inventario TMS auditado](TMS-AUDITORIA.md), [contratos](../../../../src/lib/integrations/pricesmart/tms-adaptation-contracts.ts), [adaptador puro](../../../../src/lib/integrations/pricesmart/tms-adaptation.ts), [estados y vínculos](ESTADOS-Y-VINCULOS.md), [circuito de prueba](../../../../src/lib/integrations/pricesmart/tms-synthetic-circuit.test.ts) y [evidencia](EVIDENCIA.md). No se añade operación logística al OpenAPI ni se modifica la respuesta OrderView de API-04: el estado logístico se consulta por un puerto interno aislado y separado.

## Alcance y frontera

El adaptador recibe un contexto completo de sandbox/empresa/cliente/integración/club y una orden validada desde SourceOrderPort. El contexto es una entrada interna que deberá proceder de autoridad verificada; no autentica por sí solo a un caller ni se acepta desde una ruta pública. Cada carga/vínculo/resolución comprueba scope e identidad de orden y club. Los identificadores no se normalizan y conservan mayúsculas/minúsculas.

Los puertos no tienen implementación operativa: SourceOrderPort consulta un snapshot sintético; CandidateResolutionPort resuelve de forma pura/idempotente una referencia de candidata ficticia; AdaptationRepository exige unidad atómica scoped para trabajos, vínculos, versiones y trazas. El único repositorio entregado es un doble en __tests__. Todos los snapshots/resultados del contrato exigen assurance=SIMULATED. No hay modo DURABLE, variable para habilitarlo, consumidor outbox, loop, timer, cliente SQL/HTTP, import de servicio TMS o escritura operativa.

La candidata separa UUID interno de orden, externalOrderId, empresa/cliente/integración/club y candidateId determinista. Materializable=false, readiness=CONTRACT_PENDING, commercialData=null, requestedDate=null y tmsActor=null. No fabrica direcciones, destinatarios, artículos, fechas solicitadas, paradas o usuario de portal. requestReference sólo identifica una resolución ficticia; tmsRequestId SIEMPRE null. No crea filas de solicitud, viaje, ruta, paradas, vehículo, piloto o evidencia.

## Circuito sintético: por qué no hay un 202

1. Request nativo sintético con OrderInput API-01 válido, sin servidor o socket.
2. Extractor/verificador, catálogo, revocación y antiabuso falsos explícitos para recorrer la cadena API-03/API-04. Sus attestations distribuidas son declaraciones del test, no garantías reales.
3. API-04 invoca OrderApplication contra ModelRepository original, que conserva durability=SIMULATED. El modelo registra orden, evento, auditoría y outbox de forma simulada.
4. API-04 RECHAZA el acuse con 503/UNAVAILABLE. No se altera ese control ni se convierte SIMULATED en DURABLE. GET y solicitud de cancelación también siguen sin éxito HTTP cuando se requiere confirmar persistencia simulada.
5. El test inspecciona explícitamente el modelo después del 503, toma una copia del evento pendiente y llama manualmente al adaptador. No es una recepción operativa aceptada, un worker o un acuse de cola.
6. Se resuelve una candidata ficticia, se representan observaciones Programado/En ruta/Cerrado y se consulta su proyección local. Cerrado produce DELIVERY_UNCONFIRMED, externalPriceSmartStatus=null. La orden API-01 conserva su estado propio.
7. GET por HTTP vuelve a dar 503; la consulta directa al servicio y la consulta logística interna se identifican como SIMULATED.
8. La solicitud provisional de cancelación registra CANCELLATION_REQUESTED en el modelo y un segundo evento pendiente, pero HTTP permanece 503. El adaptador retiene CANCELLATION_REVIEW; no cancela TMS ni declara cancelación final.
9. Fallo de resolución -> diario RETRYABLE + traza FAILED; nuevo intento explícito -> misma identidad de candidata, sin perder evento fuente ni duplicar vínculo. Un motivo conflictivo o evento con contenido cambiado se rechaza.
10. Empresa/cliente/integración/club ajenos fallan por scope; no acceden a orden/vínculo de otro contexto. Duplicados de recepción concurrentes sólo se prueban en modelo serializado, nunca como concurrencia SQL.

Los eventos de ModelRepository.outbox permanecen en su colección: el circuito NO hace pop, DELETE ni marca DONE el outbox API-01. DONE en el diario API-05 significa únicamente que se registró una propuesta/observación sintética, nunca que se entregó una orden al TMS. tmsLinked de API-01 permanece false. No se asigna durabilidad falsa para conseguir una respuesta 2xx.

## Intentos, idempotencia y concurrencia propuesta

Clave de namespace: environment+tenantId+clientId+integrationId; club se comprueba además como atributo obligatorio. Trabajo de fuente: namespace+orderId+sourceVersion; observación: namespace+orderId+eventId. SHA256 canónico del comando validado (sin correlación de intento) detecta contenido conflictivo bajo la misma clave. Una correlación nueva no crea otro trabajo. El resultado DONE queda inmutable para replay; get devuelve la proyección actual separadamente.

Claim, resultado, vínculo y trazas se gestionan mediante transacciones explícitas del puerto. Primer claim confirma PROCESSING + intento STARTED y lease. Resolver fuera de esa unidad sólo puede resolver la candidata, sin crear TMS. Finalización comprueba ticket/versión/lease y CAS del vínculo; guarda vínculo, traza SUCCEEDED y resultado DONE en la misma unidad. Los resultados de puertos, jobs y vínculos se validan y los errores se sanitizan a códigos cerrados.

Un fallo se registra en OTRA unidad atómica para no revertir el intento ya iniciado: dependencia -> RETRYABLE; conflicto/referencia ajena -> REVIEW_REQUIRED. No hay reintento automático, límite que descarte trabajo o borrado de historial. Una observación con CAS obsoleto exige conciliación/evento nuevo; no modificar el contenido del eventId anterior para sortear el conflicto. REVIEW_REQUIRED conserva trabajo y trazas; su reintento sólo se invoca expresamente después de resolver la causa.

Si también falla el diario de error, queda PROCESSING con lease y traza inicial; una llamada explícita posterior puede reclamarlo al vencer con versión mayor y LEASE_RECLAIMED. Un resolver antiguo no puede sobreescribir el resultado del nuevo ticket. La implementación del puerto debe imponer UNIQUE/CAS/aislamiento reales; el Map/mutex del test NO lo garantiza entre procesos, reinicios o discos. No se prueba recuperación de caídas reales ni ausencia de pérdida durable en esta fase.

Antes de finalizar se vuelve a cargar la fuente: si se solicitó cancelación durante la resolución, la candidata se retiene sin adjuntar una referencia nueva. Las observaciones posteriores nunca levantan una retención de cancelación; get también refleja una cancelación fuente aún no procesada por el diario. Fuente que retrocede de versión se rechaza. Lectura de fuente y escritura del diario NO son una única transacción común con TMS/API-02: una futura integración requiere protocolo de locks/epochs/fencing y cola durable compartido con TODOS los escritores antes de prometer cancelación o materialización linealizable.

## Bloqueos para integración real

D01–D16 siguen pendientes: D01 dirección y acuses; D02 identidad M2M real; D03 unicidad/reutilización/case; D04 catálogo empresa/cliente/club; D05 cardinalidad, viajes compartidos, múltiples intentos/entregas parciales; D06 campos comerciales; D07 zonas/ventanas/reprogramación; D08 estados oficiales; D09 cancelación y conflictos; D10 idempotencia/replay/retry; D11 cuotas/capacidad; D12 contrato HTTP; D13 prueba de entrega; D14 cifrado/retención; D15 entornos/autorizaciones; D16 KPI. No se calcula puntualidad ni se infiere POD contractual.

Antes de datos reales: contrato/actor máquina/campos ratificados, catálogo y mapeos autorizados, diseño de materialización con núcleo Tx compatible con TMS y preservación de permisos/disponibilidad, repositorios/jobs/outbox durables con scopes/constraints/leases, cifrado y retención, instancias nuevas autorizadas, M2M/gateway/TLS y validaciones S02–S06-A. Todo requiere PR/autorización y pruebas posteriores. El resolver actual no puede sustituirse silenciosamente por crearSolicitudCliente/programarSolicitud.

No SQL/migraciones, credenciales PriceSmart, solicitudes/viajes/rutas reales, reglas TMS alteradas, Hostinger/producción, desbloqueo/grants S04, infraestructura, #541, HTTP activado, merge o despliegue. Entrega para auditoría de ChatGPT antes de continuar.
