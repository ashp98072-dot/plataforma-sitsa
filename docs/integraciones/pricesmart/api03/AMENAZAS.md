# Amenazas y mitigaciones API-03

Auditoría de código/diseño, no certificación de autenticación real. Todas las pruebas automatizadas nuevas usan puertos SIMULATED. Los controles físicos/criptográficos/distribuidos requieren proveedor e infraestructura aislada autorizados.

| Amenaza | Mitigación en código/política | Límite y validación pendiente |
|---|---|---|
| Token fabricado, JWT sólo decodificado, certificado en header | Sin verificador concreto; sólo puerto criptográfico confiable + validación estricta del resultado; evidencia ausente rechazada | Firma, cadena/issuer/audience/algoritmos y proxy/TLS reales NO EJECUTADOS |
| Suplantación tenant/client/club por body o cabecera | Namespace derivado del catálogo único; target sólo comparación; entorno sandbox; intersección de scopes | Bridge HTTP real y pertenencia SQL por scope siguen pendientes |
| Principal falso/copias y roles humanos | Handle opaco registrado por instancia, rechazo de clones/desconocidos; sin imports de sesión/roles ni bypass Admin | No protege frente a código malicioso que controle los puertos inyectados; éstos son raíz de confianza |
| Credencial desconocida o colisión de binding | Lookup completo con exactamente un resultado, coincidencia issuer/subject/ref y esquema estricto | UNIQUE y administración real del catálogo NO EJECUTADOS |
| Expiración/revocación o reducción de privilegios | Reloj inyectado validado, catálogo y revocación frescos por autorización y después de almacenes | Sin atomicidad con negocio; consistencia/caché, clock drift y carreras reales pendientes |
| Reasignar integración a otro tenant | Handle fija namespace original y lo compara en cada autorización | Administración debe prohibir remapeo/reciclaje de referencias |
| Scope insuficiente / club no autorizado / enumeración | Comparación explícita por operación, club exacto, DENIED uniforme para desconocido/revocado/ajeno | Uniformidad de latencia/códigos HTTP y respuesta de filas desconocidas requiere gateway y DB reales |
| Replay de prueba interceptada | Binding versión+operación+scope+club+orden+cuerpo+tiempos; claim atómico y durable por namespace+nonce | Proveedor debe autenticar binding/nonce/tiempos y sujeto; ni hash ni mTLS/bearer solos acreditan esa prueba |
| Reusar nonce con contenido cambiado | Almacén distingue REUSED/COLLISION internamente; ambos REPLAY_REJECTED | Atomicidad/concurrencia/recuperación de almacén real NO EJECUTADAS |
| Confundir idempotencia con autenticación | Nonce nuevo para nuevo intento autenticado; ID de orden estable para UNIQUE/hash de API-02 | D10 define compatibilidad y semántica, no se recicla nonce para pasar retry |
| Rotación/cambio de club para evadir cuota | Clave de contador/nonce usa identidad estable completa, no referencia rotativa ni club | Sharding/eviction/failover/quota global reales NO EJECUTADOS |
| Abuso de frecuencia y cuerpos grandes | Cotas antes de puertos costosos, contador compartido como puerto obligatorio, rechazo fail closed | No proveedor de contador, ingress anónimo/streaming/descompresión/SLA aún pendientes |
| Fallo/partición de catálogo, revocación, contador o nonce | Sin fallback permisivo/local; excepciones y respuestas incoherentes rechazadas | Disponibilidad y recuperación reales, pérdidas de claims y políticas operativas pendientes |
| Probar políticas con simulador y declarar seguridad real | assurance SIMULATED propagada; PORT_ATTESTED sólo declaración de puertos, no certificación | OAuth/PKI/Redis/MariaDB/HTTP/Linux NO EJECUTADOS |
| Filtración por errores/logs/correlación | Códigos cerrados, excepción nueva sanitizada, UUID generado localmente, sin logging de evidencia/SQL/body | Gateway/proxy/proveedor/auditoría y retención deben revisarse end-to-end |
| Datos de catálogo/nonces/digests retenidos indefinidamente | Diseño de TTL mínimo de validez y custodia/retención pendiente D14 | No persistencia habilitada ni garantía de privacidad real |
| Activación accidental o acceso productivo | Sin rutas/configuración de activación, HTTP heredado DISABLED, sin clientes/red/SQL nuevos; regresión con guard de red | Los tests no sustituyen firewall Linux ni autorización S06-A |

Los errores anteriores no se mandan a PriceSmart ni a servicios externos en esta fase. No se crean credenciales/cuentas reales, infraestructura, grants o secretos. D01–D16 y todos los gates de activación pertinentes permanecen pendientes.
