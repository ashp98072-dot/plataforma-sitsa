# API-04 — matriz HTTP provisional y amenazas

Sólo perfil de Request/Response sintético en proceso. Todos los paths, métodos, estados y cabeceras necesitan ratificación aplicable (especialmente D02–D04, D09–D12); no hay endpoints instalados ni listeners. No generar clientes operativos de este borrador.

## Solicitudes candidatas

| Solicitud | Cuerpo / identidad | Resultado candidato |
|---|---|---|
| POST /api/integrations/pricesmart/v1/orders | OrderInput API-01; club igual a composición explícita y autorizado por catálogo; orders:create | 202, snapshot original RECEIVED/PENDING/version=1 sólo tras resultado DURABLE |
| GET /api/integrations/pricesmart/v1/orders/{externalOrderId} | Sin body/query; club de composición autorizado; orders:read | 200, proyección del estado actual tras auditoría confirmada |
| POST /api/integrations/pricesmart/v1/orders/{externalOrderId}/cancellation-requests | CancellationInput API-01; orders:cancel | 202, snapshot CANCELLATION_REQUESTED/PAUSED/version>=2; no cancelación final/TMS |

La selección POST para cancelación es un candidato de ensayo, no ratificación de D09 ni reemplazo del null histórico API-01. Replay de orden o cancelación con contenido igual y NUEVA prueba de solicitud retorna el snapshot original; proofId reutilizado se rechaza antes del dominio. Idempotency-Key HTTP no se implementa ni se interpreta (D10).

Formato cerrado de éxito: `{externalOrderId, provisionalStatus, processingStatus, version, correlationId}`. Formato cerrado de error: `{code, correlationId}`. La correlación del recibo proviene del dominio y permanece inmutable en replay; X-Correlation-Id es nuevo por intento, generado por servidor. Nunca se refleja la correlación enviada por el cliente ni credenciales, headers sensibles o cuerpo.

## Matriz de rechazo

| HTTP propuesto | code | Condición |
|---|---|---|
| 400 | INVALID_INPUT | DTO/JSON/UTF-8/BOM/duplicados/campos no permitidos, identificador manipulado, query/fragment, longitud ambigua o distinta de bytes, body consumido/stream roto o body en GET |
| 401 | UNAUTHENTICATED | Evidencia ausente/inválida/expirada/revocada/desconocida durante autenticación; sin detalles de cuál condición |
| 403 | FORBIDDEN | Falta de scope, club no autorizado, target/proof fuera de autorización o identidad que deja de ser válida en fases posteriores |
| 404 | NOT_FOUND | Ruta no candidata u orden inexistente/ajena a tenant/club: misma estructura, sin payload |
| 405 | METHOD_NOT_ALLOWED | Método distinto al candidato de ese path; Allow sólo GET o POST correspondiente |
| 406 | NOT_ACCEPTABLE | Accept presente fuera del perfil estricto application/json o */* |
| 408 | REQUEST_TIMEOUT | Deadline/abort durante transporte o lectura de body |
| 409 | CONFLICT / REPLAY_REJECTED | Modificación conflictiva según dominio, o claim REUSED/COLLISION; no distinguir contenido de nonce anterior |
| 413 | TOO_LARGE | Cuerpo real/declarado/evidencia o número de chunks por encima del límite propuesto |
| 414 | INVALID_INPUT | Presupuesto de bytes de URL excedido |
| 415 | UNSUPPORTED_FORMAT | POST no application/json UTF-8, content encoding o transfer encoding presentes |
| 429 | LIMITED | Cuota de identidad verificada excedida; no se retorna Retry-After inventado |
| 431 | INVALID_INPUT | Presupuesto de bytes/conteo de cabeceras excedido |
| 503 | UNAVAILABLE | Fallo/timeout de dependencia, COMMIT incierto, assurance SIMULATED, envelope no DURABLE o proyección incompleta/inesperada |

Las denegaciones de autenticación y autorización se distinguen sólo por fase; SecurityFailure DENIED no permite diagnosticar expiración frente a scope con precisión. El gateway definitivo debe ratificar 401/403/404, latencia uniforme y estrategia antienumeración (D02/D12). La API de dominio ya da NOT_FOUND para orden ajena/desconocida. No se incluyen mensajes de Zod/driver/proveedor ni WWW-Authenticate ficticio, Retry-After, Location, cookies o CORS habilitante. No son promesas de códigos en un servicio real.

Cabeceras en toda respuesta sintética: Content-Type application/json; charset=utf-8, Cache-Control no-store, private, Pragma no-cache, X-Content-Type-Options nosniff y X-Correlation-Id UUID generado. D12 debe aprobar estructura, códigos y cabeceras contractuales. No-store protege el perfil de respuesta; proxy/CDN/cache efectivos siguen sin probar.

POST acepta únicamente application/json, opcionalmente `; charset=utf-8` sin comillas, case-insensitive. No otras opciones/charsets/compresión; JSON inválido no se corrige. IDs ASCII de API-01, sin trim/normalización/percent-decoding. Query, fragmentos, slash extra, rutas alternas y métodos no candidatos se rechazan. Content-Length, si presente, debe ser decimal canónico y coincidir con bytes reales. Se rechaza Transfer-Encoding en este perfil para no simular soporte de framing de un servidor real. La política final de streaming/chunked y gateway debe ratificarse, no inferirse de estos ensayos.

## Amenazas HTTP y mitigación

| Amenaza | Control comprobable de código | Pendiente operativo |
|---|---|---|
| Body grande, chunks vacíos infinitos, lectura lenta | Bytes/conteo/deadline acotados, validación de longitud, cancelación de reader/body | Cota previa a Request, buffers de proxy, decompresión, conexiones y slowloris reales |
| Ambigüedad de métodos/path/URL/framing/headers | Lista cerrada, no query/fragment/IDs codificados, formatos estrictos, presupuestos | Normalización de URL y raw headers perdidos en Request, HTTP smuggling/TLS/gateway reales |
| JSON ambiguo/Unicode/campos adicionales | Validadores API-01, rechazo UTF-8/BOM/duplicados/extra | DTO comercial D06 y aceptación externa |
| Tenant/club/Principal de headers/body | namespace desde handle+catálogo; club explícito autorizado, IdentityPort fresco y scope SQL del repositorio | Catálogo/proveedor/SQL reales y auditoría de composición |
| Credenciales ficticias o confusión de mTLS/proxy | Sin extractor/verificador por defecto; bytes opacos siempre pasan puerto criptográfico | Mecanismo D02, origen de certificados y firma/audience/revocación reales |
| Replay / evadir cuota / carrera | API-03 admit antes de aplicación, rechazo SIMULATED, claves estables y claim, dominio idempotente | Redis/almacén durable/multiproceso/failover/capacidad reales |
| Acuse temprano o garantía falsa | Esperar repositorio, envelope DURABLE y proyección estrictos; rechazar simulados | El literal no demuestra disco/fsync: sólo composición API-02 auditada tras pruebas físicas permite activación |
| Timeout con trabajo tardío | Guardas antes/después de puertos y métodos Tx; 408/503, sin recibo ni retries automáticos | No se puede anular COMMIT ya enviado; conciliación y crash recovery reales |
| Enumeración/filtración de datos | NOT_FOUND uniforme ajeno/inexistente; respuestas cerradas, errores genéricos, no logs sensibles | Latencias/abuso distribuidos y respuestas de gateway end-to-end |
| Reflejar secreto/correlación o cachear datos | UUID propio, no eco de headers/payload/SQL, no-store/private/nosniff | Configuración efectiva de logging/proxy/cache/TLS y D14 |
| Activación accidental | Función aislada sin src/app/api, red, variable habilitante, worker ni composición por defecto | Auditoría específica de futura exposición y gates S06-A |

Ninguna prueba con dobles de este PR acredita HTTP de red, TLS, gateway, revocación linealizable, rate limiting distribuido o durabilidad física. Los pendientes API-01–API-03, S02–S06-A y D01–D16 continúan pendientes.
