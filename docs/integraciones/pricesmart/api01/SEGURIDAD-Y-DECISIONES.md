# API-01 — seguridad y preguntas por ratificar

Todas las decisiones D01–D16 siguientes siguen **PENDIENTES**. Se preservan las preguntas de antecedentes F1 locales; API-01 sólo propone un perfil técnico sintético. Ni pruebas, OpenAPI, DDL ni merge ratifican contratos. Prioridad diciembre 2026 solicitada no constituye fecha de operación comprometida.

## Matriz de seguridad

| Control | Implementado en API-01 | Pendiente antes de tráfico real |
|---|---|---|
| Sin exposición | Cero rutas Next, cero imports desde app, límite HTTP aislado siempre DISABLED/503 sin flag de activación | Revisión independiente/auth/persistencia/gates; no asumir que un build habilita módulos no conectados |
| Identidad M2M | IdentityPort sin implementación; valida forma/scopes/entorno sandbox de su resultado, resuelve cada operación | Mecanismo real D02: emisor/audience, firma o verificación de secreto, expiración/revocación/rotación, mTLS u OAuth según contrato. Ninguna cabecera de tenant/principal equivale a auth |
| Multiempresa/cliente/club | Scope desde principal confiable, payload strict sin IDs internos, club comparado con club verificado; todos los puertos de repositorio reciben scope | Catálogo versionado y autorizado, baja/revocación efectiva y SQL con scope en cada sentencia; ni host/slug/cookie humana/body decide tenant |
| IDOR | GET/cancel de club/tenant ajeno y desconocido mismo NOT_FOUND en aplicación | Verificación real con SQL y HTTP; no presentar dobles como acceso denegado por motor |
| Validación/límites | DTO mínimo versionado, strict, ASCII/cotas, 64 KiB, JSON duplicado/UTF-8/BOM inválido rechazados; proyección de respuesta sin payload ni IDs internos | Streaming y Content-Type/content-encoding en gateway; cotas comerciales y carga D06/D11 |
| Replay/idempotencia | Identidad estable + hash normalizado, replay snapshot, conflicto, transacción/UNIQUE requeridos por puerto y DDL | No autentica replays ni limita abuso. Idempotency-Key, firmas/timestamps/nonces/ventana, reloj/tolerancias, retención y rate limit distribuido D02/D10/D11 sin ratificar |
| Atomicidad | Puerto exige commit confirmado con orden/evento/audit/outbox; aplicación espera promesa, simulado no se declara DURABLE | Repositorio real, InnoDB/locks/CAS, disco/fsync, caídas y commit desconocido probados en laboratorio nuevo |
| Privacidad | Sólo referencias técnicas ficticias en tests, proyección cerrada y errores por código. Sin logging de body/auth/errores SQL | Referencias externas también pueden ser personales: cifrado autenticado, custodia, política legal y borrado/retención de índices, snapshots y backups D14; no datos reales todavía |
| Auditoría | Operación/resultado enumerados, UUID/correlación/scope, eventos y motivo de cancelación; fallo invalida transacción | Registro gateway de errores/auth/rechazos, almacenamiento protegido, revisión de accesos y sanitización de HTTP/proxy. No exponer raw paths que incluyan IDs externos |
| TMS | Ninguna importación ni escritura TMS, `tms_linked=0` en DDL propuesto; no programas/recursos/entregas | Actor máquina y adaptador Tx, cardinalidades y locks con todos los escritores por aprobar |
| Aislamiento | S02–S06-A intactos; no driver/endpoints/worker/red nuevos, pruebas con guard de red heredado | Linux/MariaDB/firewall/TLS/browser reales NO EJECUTADOS, autorización expresa posterior |
| S04 | Cuenta bloqueada y SELECT intactos | Ninguna activación/escritura se permite con ese perfil. Proponer otro perfil futuro separado requiere revisión, nunca desbloquear para pasar tests |

El resultado del IdentityPort se confía **sólo porque un adaptador M2M futuro verificado lo producirá**. La validación Zod no autentica a nadie y un objeto Principal fabricado no es una credencial. Los tests inyectan dobles explícitos; no existe una cabecera QA que sirva para autenticación de producción.

OpenAPI omite `securitySchemes` porque elegir bearer/OAuth/mTLS inventaría D02; indica `x-m2m-required:true`, perfil UNRESOLVED y no ejecutable. Esa omisión es un límite del borrador, **no permiso de acceso anónimo**. No servir Swagger UI interactiva ni generar un cliente listo para usar antes de ratificar seguridad y actualizar el documento.

## D01–D16 y preguntas técnicas para PriceSmart

| ID / estado | Pregunta que debe resolverse con evidencia | Responsable / bloqueo |
|---|---|---|
| D01 PENDIENTE | ¿Push a Mónaco, polling desde Mónaco, quién consulta estados y secuencias de acuse? | PriceSmart + Arquitectura; dirección de integración |
| D02 PENDIENTE | ¿OAuth client credentials, mTLS, bearer u otro perfil? Emisor/audience, caducidad, revocación, rotación, scopes y custodia | Seguridad + PriceSmart; toda autenticación real y OpenAPI de seguridad |
| D03 PENDIENTE | ¿Unicidad de externalOrderId por cuenta/país/club, case, longitud y reutilización tras cancelar? Ejemplos de colisiones entre clubes | PriceSmart; namespace/UNIQUE y path GET/cancel. Cambiar antes de persistir datos reales |
| D04 PENDIENTE | ¿Empresas/clientes/países/clubes permitidos y catálogo versionado, dueño, bajas? | Mónaco Operaciones + PriceSmart; autorización y mapeos, no cont_entidades |
| D05 PENDIENTE | ¿Una o múltiples entregas/unidades, parciales, reintentos y viajes compartidos? | Operaciones + PriceSmart; adaptación, vínculos y estado de entrega |
| D06 PENDIENTE | ¿Diccionario de campos obligatorios/tipos/cotas: destinatario, dirección, contacto, coordenadas, ítems, peso/bultos? Ejemplos ficticios ratificados | PriceSmart + Operaciones + Privacidad; DTO comercial ausente en API-01 |
| D07 PENDIENTE | ¿Zona IANA/offset, ventanas originales, medianoche/DST, cambios de fecha/reprogramación y tolerancias? | Operaciones + PriceSmart; fechas del adaptador/KPI, sin defaults inventados |
| D08 PENDIENTE | ¿Estados y transiciones oficiales, rechazo/unknown y prueba suficiente de entrega? | PriceSmart + Operaciones; mapping externo. Los cuatro estados API-01 son locales |
| D09 PENDIENTE | ¿Quién cancela, cuándo, motivo, compensaciones y caso de orden en viaje compartido/en ejecución? ¿Método HTTP y path exactos? | PriceSmart + Operaciones; cancelación sólo propuesta, no DELETE/POST acordado |
| D10 PENDIENTE | ¿Clave HTTP obligatoria u opcional, formato, alcance, plazo de replay, reintentos/timeout, orden de mensajes y cambios de contenido? | PriceSmart + Arquitectura; no confundir key HTTP con identidad permanente de orden |
| D11 PENDIENTE | ¿RPS/promedios/picos, pedidos diarios, ráfagas, cuerpo máximo, latencia/SLA y cuotas por cuenta/IP? | PriceSmart + Operaciones/SRE; 64 KiB es cota provisional, no capacidad prometida |
| D12 PENDIENTE | ¿GET suficiente, callbacks, acuses y códigos de error/Retry-After? ¿Acuse de cancelación síncrono o solicitud durable? | PriceSmart; no callbacks salientes ni método de cancelación activado |
| D13 PENDIENTE | ¿POD, actor autorizado, hora offline, unidad/intento, parciales, evidencia mínima y correcciones? | PriceSmart + Operaciones + Privacidad; entrega contractual futura, no llegada de viaje |
| D14 PENDIENTE | ¿PII, residencia, cifrado, retención/supresión, legal hold, backups y conservación de deduplicación sin retener PII innecesaria? | Privacidad/Legal + Seguridad + PriceSmart; cualquier dato real/producción |
| D15 PENDIENTE | ¿Entornos, acceso privado, credenciales sintéticas, responsables y criterios de aceptación/autorización? | Arquitectura + Seguridad + PriceSmart; conexión real y todos los gates S06-A |
| D16 PENDIENTE | ¿Fórmula de puntualidad, reloj/evento fuente, exclusiones, reintentos y denominadores oficiales? | PriceSmart + equipo KPI; OTD NO DEFINIDO, trabajo separado |

Evidencia de resolución futura: contrato/diccionario y fixtures anonimizadas ratificados, aprobador/fecha/versiones; actualizar DTO/OpenAPI/constraints/adaptador/tests en el mismo cambio compatible. No tratar una propuesta técnica, correo sin acuerdo o fixture como ratificación. No se enviaron estas preguntas ni datos a PriceSmart.

## Gates de activación pendientes

1. Contrato y namespace/campos/seguridad ratificados; revisión independiente de este borrador y cambios derivados.
2. Perfil de escritura nuevo autorizado y físico aislado, sin tocar S04; repositorio/cifrado/atomicidad con pruebas MariaDB reales y recuperación.
3. M2M, antiabuso/replay/retención, logs sanitizados y TLS/origen, en infraestructura S06-A aprobada.
4. Transporte HTTP explícito en PR separado, apagado por defecto y habilitado sólo mediante autorización; tráfico sintético primero. Ningún acceso público implícito.
5. Actor/adaptador TMS, worker y eventos de entrega en fases separadas, sin cambios productivos/API PriceSmart hasta autorización independiente.

Hasta entonces: ningún endpoint, solicitud de credenciales, worker, SQL aplicado, desbloqueo S04, cambio Hostinger/DNS/firewall, merge o despliegue.
