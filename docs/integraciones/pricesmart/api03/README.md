# API-03 — arquitectura M2M provisional, sin exposición

Fecha: 2026-11-02 (America/Guatemala). Base `187e84b5` de origin/main, merge de #548/API-02. Rama independiente `feature/pricesmart-api03`. D01–D16 siguen PENDIENTES; este trabajo no ratifica D02 ni elige OAuth, mTLS u otro mecanismo.

Entrega aislada: [puertos y validadores](../../../../src/lib/integrations/pricesmart/security-contracts.ts), [motor](../../../../src/lib/integrations/pricesmart/m2m-security.ts), [catálogo propuesto](CATALOGO.md), [amenazas](AMENAZAS.md) y [evidencia](EVIDENCIA.md). Sin implementación de proveedor/credenciales/almacén, rutas, conexiones, SQL, worker, TMS, despliegue o activación por variable. IdentityPort API-01 y repositorio API-02 siguen desconectados. S04, sus permisos y #541 no cambian.

## Auditoría previa

| Fuente revisada | Hallazgo y decisión API-03 |
|---|---|
| API-01 contracts.ts / ports.ts / service.ts | IdentityPort es una frontera confiable sin verificador real; Zod valida forma, no autentica. Scope sandbox+empresa+cliente+integración, club y scopes por operación; resolver de nuevo por llamada. Conservar DTO y contrato |
| API-01 transport.ts / openapi.draft.json | Siempre DISABLED; x-executable=false, x-default-enabled=false, M2M requerido y UNRESOLVED_D02. securitySchemes ausente no autoriza anonimato. No añadir bearer/OAuth/mTLS ni paths por inferencia |
| API-01 SEGURIDAD-Y-DECISIONES.md | D01–D16 sin ratificar; idempotencia de órdenes no es autenticación ni rate limit |
| API-02 mariadb-repository.ts y README | Pool inyectado con procedencia S02, base/cuenta verificadas, scope en SQL, UNIQUE binario, CAS, commit incierto. No componer automáticamente con identidad nueva; pruebas físicas siguen pendientes |
| sandbox-db.ts / sandbox-config.mjs y documentos S02 | Manifiesto privado, namespace de secretos sintéticos, loopback, marcador por operación sobre la misma conexión; no reemplazar por validación de token. Sin acceso SQL aquí |
| S03-INFRAESTRUCTURA-PRIVADA.md | Plantillas de red denegada/UID/privilegios, sin instancia física; no confiar en proxy headers sin cadena TLS/proxy aprobada |
| s04/README.md | ACCOUNT LOCK y grants SELECT por tabla; incluso una lectura API-01 audita y no corresponde a S04. Sin desbloqueos ni cambios |
| s05/README.md, setup sandbox-no-network.ts | Artefacto aislado y guard de red en pruebas, sin prueba Linux real; tests/fixtures no deben llegar a runtime. Reutilizar regresión sin modificar allowlist |
| s06a/PREFLIGHT-Y-GATES.md | Gates humanos separados, pruebas Linux/DB/HTTP pendientes; un PASS documental no autoriza operar |
| session.ts / auth.ts / password.ts / tenant.ts | Firma de sesión humana, expiración y estado/permisos frescos; login puede escribir hash. Roles Admin/accesoTodas no se trasladan a M2M; no importar sesiones/cookies/login/DB |
| tms/cliente-portal-guard.ts | Firma histórica no basta: comprobar vigencia y pertenencia actual. Reutilizar principio de autorización fresca, no cookies ni usuarios portal |
| Guía Next local data-security.md | Frontera interna server-side y DTO mínimo; módulos aislados sin imports de UI/rutas, sin serializar credenciales |

## Fronteras de confianza

```text
Evidencia opaca no confiable (nunca tenant del body/header)
 -> EvidenceVerifier futuro aprobado: criptografía y vínculo de sujeto/prueba
 -> assertionSchema: forma y cotas del RESULTADO del verificador
 -> IntegrationCatalog + RevocationPort + TrustedClock frescos
 -> handle opaco con procedencia local (WeakMap privado)
 -> authorize: operación + recurso comparados con catálogo actual
 -> admit: tamaño + prueba vinculada + contador atómico + claim atómico
 -> revalidación de autorización/revocación/vigencia
 -> Principal mínimo + correlación generada + assurance
 -> frontera futura IdentityPort / aplicación / API-02 (NO CONECTADA)
```

`EvidenceVerifier.verify` recibe sólo bytes opacos; no hay parser JWT que acepte tokens por estructura, emisor ficticio, contraseña QA ni verificador por defecto. Debe verificar, según el mecanismo que finalmente se apruebe, firma/cadena o introspección, algoritmo permitido, trust anchor/emisor, audience y entorno sandbox, vigencia, vinculación de sujeto a referencia de credencial y a cualquier prueba por solicitud. Rechazar alg=none, emisor/audience ambiguos, confusión de claves/algoritmos, certificado ajeno y mezcla de token de una identidad con prueba de otra. No hacer descubrimiento/JWKS/OCSP/HTTP automático: proveedores, red y políticas de caché/rotación requieren otra revisión.

Posibilidades sin elegir: OAuth Client Credentials con validación aprobada del access token y revocación; mTLS con cadena/validez/revocación y sujeto del certificado verificados por un canal confiable; otra prueba por solicitud ratificada. Un header `X-Client-Cert`, JSON decodificado o tenant claim sin criptografía no es evidencia. mTLS por sí solo no produce automáticamente nonces firmados por solicitud. API-03 no implementa esos mecanismos ni afirma resistencia criptográfica real.

El catálogo devuelve exactamente un registro para issuer+subject+credentialReference. Cero, duplicados, campos incompletos, entorno distinto o binding no coincidente producen DENIED, sin distinguir desconocido/revocado/ajeno. La autoridad de empresa/cliente/integración proviene sólo del catálogo administrativo; la assertion no admite esos campos como autoridad. Se valida la intersección de scopes del verificador y catálogo. No hay wildcard ni superadministrador. Clubes distintos se seleccionan explícitamente del conjunto autorizado; API-01 sigue recibiendo un único club por operación.

`authenticate` comprueba criptografía mediante el puerto, vigencia, catálogo y revocación antes de emitir un handle sin campos serializables. `authorize` sólo acepta handles de esa instancia; objetos Principal fabricados, clones o handles de otro motor se rechazan. Vuelve a consultar catálogo/revocación/reloj, verifica sandbox+scope completo+club y niega reasignación de namespace de un handle ya emitido. El WeakMap certifica únicamente procedencia local, no almacena cuotas o nonces ni es control distribuido. Un reinicio invalida handles locales y exige nueva verificación.

## Política explícita por operación

| Operación | Scope necesario en verificador Y catálogo | Recurso |
|---|---|---|
| Recepción | orders:create | Sandbox, empresa/cliente/integración exactos y club permitido; DTO validado aparte en API-01 |
| Consulta | orders:read | Mismo namespace, club y referencia externos; pertenencia real de la orden la comprueba API-01/API-02 |
| Solicitud de cancelación | orders:cancel | Mismo namespace/club; estado, vínculo TMS y CAS siguen siendo controles de dominio API-01/API-02 |

El target es sólo una comparación de recurso, nunca una fuente de autoridad. La aplicación debe seguir filtrando por el Principal derivado del catálogo y comprobar el club real de la orden; una autorización genérica no demuestra que una fila pertenezca al recurso. Un campo de empresa/club en el body no amplía permisos. `authorize` sirve para probar política; no es admisión completa ni debe conectarse directamente como atajo HTTP a IdentityPort. El bridge futuro debe exigir `admit`, rechazar SIMULATED, renovar autorización por operación y no guardar un Principal autorizado indefinidamente. No se suministra tal bridge en este PR.

## Antiabuso y replay

La fábrica exige una AbusePolicy explícita y validada; no hay cuotas/ventanas/códigos HTTP definitivos ni defaults habilitantes. Los números usados en tests son arbitrarios y sintéticos. Cotas técnicas máximas de 64 KiB para cuerpo/evidencia preservan el límite provisional API-01, no prometen capacidad. maxEvidenceBytes y maxBodyBytes pueden reducirse. Gateway futuro deberá imponer cotas de streaming, descompresión, tiempo y conexiones antes de reservar cuerpos o verificar criptografía, más controles de entrada no autenticada para evitar DoS previo al verificador.

`admit` limita bytes, deriva la huella antes de await para evitar mutación del caller, autoriza y exige requestProof criptográficamente vinculado por el verificador. Un access token válido sin requestProof puede pasar authenticate/authorize, pero NO admit. Esto expresa un bloqueo seguro mientras D02/D10 no definan una defensa replay compatible; no prescribe un protocolo nuevo para OAuth/mTLS. No reutilizar el jti de un access token reusable como nonce por solicitud, ni inferir prueba de TLS de un header.

Binding propuesto `api03-request-v1`: SHA256 de JSON ordenado [versión, operación, namespace codificado sin ambigüedad, club, externalOrderId o null, SHA256(bytes exactos del cuerpo)]. El namespace es JSON ['api03',environment,tenantId,clientId,integrationId]. Identificadores conservan case. El proveedor futuro debe autenticar TODO ese digest, el id de prueba y sus tiempos, vinculados a la misma identidad/credencial. El helper de hash no autentica ni firma nada. Parseo/canonicalización comercial e idempotencia normalizada de API-01 son independientes de estos bytes wire.

Prueba: issuedAt no demasiado futuro (futureSkewMs explícito), no demasiado antigua (maxProofAgeMs), expiresAt posterior al presente y a emisión, duración acotada. Se verifica antes y después de esperar los almacenes. TrustedClock debe ser una fuente operativa confiable con desfase/retrocesos monitorizados; no usar timestamp enviado por cliente como hora actual. Los tests no validan sincronización real.

AtomicCounterPort.consume exige cuota compartida entre procesos por identidad estable, sin referencia de credencial ni club en la clave para evitar elusión por rotación/cambio de club. Contrato propuesto: ventana fija, incremento/decisión/expiración atómicos, reloj autoritativo, resetAt válido, fail closed si almacén falla o devuelve incoherencias. No se provee implementación local/en memoria ni Redis operativo. Ventanas fijas admiten ráfaga entre dos ventanas; su aceptación o cambio a otro algoritmo es D11, no capacidad certificada.

AtomicReplayPort.claim exige set-if-absent durable y atómico por namespace+proofId, asociado a bindingDigest y retención hasta retainUntilMs. Mismo id/mismo digest -> REUSED; mismo id/digest distinto -> COLLISION; ambos rechazan sin exponer la diferencia. replayRetentionMs debe cubrir maxProofAgeMs+futureSkewMs, y la retención empieza al claim. No borrar anticipadamente por reinicio, eviction, failover o error de dominio. Expiración/evicción/restore/replicación reales requieren pruebas y almacenamiento aprobados.

Se consume cuota antes de reclamar nonce: un replay consume presupuesto de identidad. Si después falla replay, revocación o dominio, no devolver cuota ni liberar nonce automáticamente. Un resultado incierto del claim falla cerrado; reintentar el comando con una NUEVA prueba válida y el MISMO externalOrderId/contenido para aprovechar idempotencia durable API-02. Una prueba usada se rechaza aunque la orden fuera idempotente. No hay atomicidad prometida entre los almacenes de seguridad y la transacción de negocio ni exactly-once de solicitudes.

Tras contador y claim, se repite autorización/revocación y tiempos. Esa comprobación reduce la ventana durante esperas; no ofrece revocación linealizable respecto de una escritura concurrente posterior. Si se necesita esa garantía, diseño de epochs/fencing y coordinación con transacción de negocio/gateway será obligatorio antes de activación. El catálogo/revocación debe ser autoritativo, sin caché positiva indefinida; política de TTL/indisponibilidad/rotación pendiente D02/D15.

Resultados assurance: SIMULATED si cualquiera de los almacenes se declara simulado; PORT_ATTESTED sólo significa que los puertos declaran garantías distribuidas/durables. Ese literal tampoco certifica proveedor, criptografía, persistencia o Linux. No existe composición HTTP que pueda usar ninguno de ellos en este PR.

## Errores, correlación y privacidad

SecurityFailure sólo admite DENIED, TOO_LARGE, LIMITED, REPLAY_REJECTED y UNAVAILABLE; son códigos internos, sin status HTTP ni Retry-After ratificados. Denegaciones de identidad/scopes/tenant/club usan DENIED. `safe` reemplaza excepciones de puertos por errores nuevos y sanitizados; `sanitizedSecurityRejection` devuelve sólo código permitido y UUID nuevo generado por el servidor, sin reflejar correlaciones entrantes, SQL, tokens, certificados, secretos, body o stack. No hay logging automático ni publicación de fallos de catálogo.

Diseñar telemetría/auditoría de seguridad aprobada y acotada para gateway/administración: evento, resultado, correlación, tiempo confiable y referencia interna mínima, sin evidencia/token/certificado/body ni mensajes de proveedor. Retención, acceso, cifrado y revisión D14. Las referencias técnicas y hashes pueden ser sensibles; este PR no habilita almacenamiento de datos reales ni declara su seguridad operativa.

## Decisiones pendientes y continuación

Todas PENDIENTES: D01 dirección de integración; D02 mecanismo/trust/audience/revocación/rotación; D03 namespace/reutilización/case; D04 catálogo empresa/cliente/club; D05 unidades/entregas; D06 DTO/cotas; D07 tiempos/zonas; D08 estados; D09 cancelación; D10 prueba/nonce/idempotency-key/retención/retry; D11 algoritmo/cuotas/ventanas/capacidad; D12 errores/códigos/reintentos/Retry-After; D13 evidencia de entrega; D14 privacidad/cifrado/retención; D15 entornos/gates/operación; D16 KPI. Detalle y responsables originales: [matriz API-01](../api01/SEGURIDAD-Y-DECISIONES.md). No se enviaron preguntas ni mensajes a PriceSmart.

Antes de continuar: auditoría independiente de este borrador; ratificación de decisiones aplicables; diseño e implementación de proveedor/PKI/almacenes con pruebas reales de firma/cadena/audience/rotación/revocación/replay/multiproceso/failover; instancia nueva autorizada y gates S02–S06-A; cifrado/retención API-02; revisión del bridge y transporte en PR separado. No ejecutar SQL, desbloquear S04, crear infraestructura, permitir tráfico externo, hacer merge o desplegar con este diseño.
