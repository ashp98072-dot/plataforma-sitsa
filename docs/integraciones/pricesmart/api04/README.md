# API-04 — transporte HTTP aislado, no expuesto

Fecha: 2026-11-02 (America/Guatemala). Base obligatoria `e05afa76` de origin/main, merge #549/API-03. Rama independiente `feature/pricesmart-api04`. D01–D16 siguen PENDIENTES. Ninguna ruta, método, código, cabecera, cuota o mecanismo M2M se ratifica con esta entrega.

`createIsolatedHttpTransport` es una fábrica sin composición por defecto: recibe puertos confiables, OrderRepository, AbusePolicy y límites explícitos, y devuelve una función `(Request) => Promise<Response>`. No abre sockets, registra rutas, escucha tráfico ni se importa desde src/app. No hay Next route.ts, middleware, servidor de pruebas, worker, temporizador periódico o bandera de entorno habilitante. El helper histórico disabledHttpContract continúa DISABLED/503. El único timer nuevo es el deadline de cada invocación y se elimina al finalizar.

Archivos: [manejador](../../../../src/lib/integrations/pricesmart/http-transport.ts), [pruebas de protocolo](../../../../src/lib/integrations/pricesmart/http-transport.test.ts), [comprobaciones de documento](../../../../src/lib/integrations/pricesmart/http-contract.test.ts), [matrices HTTP y amenazas](MATRICES-HTTP.md), [OpenAPI no ejecutable](openapi.draft.json) y [evidencia](EVIDENCIA.md). El OpenAPI histórico API-01 permanece intacto; API-04 describe separadamente tres candidatos sólo para ensayos en proceso, sin servers ni securitySchemes definidos. Ausencia de securitySchemes NO permite acceso anónimo.

## Auditoría y dependencias

| Fuente revisada | Implicación para API-04 |
|---|---|
| API-01 contracts.ts, ports.ts, service.ts, transport.ts | DTO estricto/UTF-8/BOM/duplicados, Principal sandbox y club único, IdentityPort fresco, aplicación concreta, snapshots inmutables y resultado Committed. Reutilizados sin debilitar validadores ni alterar el contrato de dominio |
| OpenAPI API-01 | POST/GET provisionales, cancelación no ratificada, errores/cotas candidatos, no ejecutable. No convertir un candidato de método en acuerdo PriceSmart |
| API-02 mariadb-repository.ts y documentos | OrderRepository inyectado, COMMIT antes de DURABLE, transacción scoped, replay por UNIQUE y CAS; COMMIT incierto se rechaza. Sin pool/driver/credenciales conectados en API-04 |
| API-03 m2m-security.ts y security-contracts.ts | Verificador confiable y catálogo/revocación/reloj, autorización e intersección de scopes, contador/nonce como puertos, assurance SIMULATED/PORT_ATTESTED. Crear motor concreto dentro de cada solicitud, no aceptar Principal ni motor de autorización falso como argumento HTTP |
| S02 sandbox-db.ts / sandbox-config.mjs / preflight de auditoría | Origen controlado del pool y marcador por operación, manifiesto/aislamiento. Se preservan; API-04 no consulta DB ni omite esas guardas en el repositorio futuro |
| S03–S05 y s06a/README.md / PREFLIGHT-Y-GATES.md | Red denegada, cuenta S04 bloqueada/SELECT, artefacto privado y gates sin autorización operativa. No resolver pendientes habilitando permisos/red. Regresión offline heredada preservada |
| Decisiones API-01/API-03 y guía Next local data-security.md | Auth, datos, errores y exposición no ratificados; frontera interna y DTO mínimo. No integración Next implícita |

La única extensión API-03 es `resourceTarget`: acepta únicamente un handle de identidad verificada de esa instancia, vuelve a consultar catálogo/revocación y deriva environment/tenant/client/integration. Valida club e ID externo y rechaza remapeo del namespace. No autoriza una operación por sí sola, ni acepta un Principal fabricado. Evita introducir un resolver de tenant basado en headers o body. Sus negativos se prueban junto con el transporte.

Faltan implementaciones operativas de HttpEvidencePort (extracción con procedencia confiable), EvidenceVerifier OAuth/mTLS u otro perfil ratificado, catálogo/revocación autoritativos, reloj operativo, contador distribuido y replay durable. API-02 también requiere instancia nueva, perfil/DDL aprobado, cifrado/retención y pruebas reales. No se crean implementaciones de reemplazo permisivas.

## Composición y cadena comprobable

1. Validar Request no consumido, URL, ruta/método candidato, presupuesto de cabeceras, Accept, Content-Type/framing/encoding, Content-Length y cuerpo por lector acotado. Cotas reales sobre bytes, cantidad de chunks (incluso vacíos) y deadline; no confiar sólo en longitud declarada. Cancelar lector/cuerpo al rechazar/finalizar. GET no admite cuerpo.
2. Extraer únicamente evidencia opaca mediante HttpEvidencePort y llamar al verificador concreto delegado API-03 con entorno sandbox. No existe parser bearer de prueba, token QA utilizable o credencial por defecto. No autenticar el contenido de una cabecera por su mera presencia.
3. Reutilizar parseBody/orderSchema/cancellationSchema. Derivar el target del catálogo verificado y comprobar integración/empresa/cliente/club/operación. El perfil técnico fija originClubReference explícito en la composición, sin default: identifica el club de este manejador y debe estar en el catálogo. POST debe declarar ese mismo club. No elige tenant y no es un dato ratificado de PriceSmart. Selección multi-club para GET requiere diseño futuro aprobado.
4. Ejecutar authorize y admit de API-03: intersección de scopes, prueba vinculada a operación/namespace/club/recurso/bytes, cuota y claim, revalidación. Rechazar assurance SIMULATED antes de aplicación. PORT_ATTESTED es declaración de puertos, no certificación criptográfica/distribuida.
5. Construir un IdentityPort cerrado a esa solicitud que vuelve a autorizar identidad/target/operación, y una instancia concreta de OrderApplication. No inyectar un objeto Principal desde el caller HTTP ni una función de aplicación que salte seguridad. La identidad se resuelve otra vez antes del repositorio.
6. Esperar la promesa de repositorio y validar envelope estricto con durability=DURABLE. Exigir proyección cerrada, ID solicitado, UUID/versión/estados coherentes; recepción sólo snapshot RECEIVED/PENDING/version=1, cancelación sólo CANCELLATION_REQUESTED/PAUSED/version>=2. SIMULATED, UNKNOWN, resultado ausente, campos extra o proyección incoherente -> 503. También GET requiere la confirmación de su auditoría transaccional.
7. Responder únicamente OrderView o error cerrado con correlación propia y cabeceras ant caché. No devolver payload, scope interno, garantía declarada, SQL, stack, secretos o detalles de proveedor.

Los puertos, política, límites y repositorio son raíces confiables de la composición administrativa, no parámetros del cliente. API-04 comprueba la declaración y espera del contrato DURABLE; ningún literal ni duck typing permite demostrar InnoDB/fsync/disco/custodia. Una futura composición expuesta deberá usar el adaptador API-02 con S02 y un perfil real auditado, sin dobles, y acreditar recuperación/durabilidad antes de habilitar tráfico. Este PR no se presenta como aceptación de órdenes reales.

HttpEvidencePort recibe sólo método, pathname y copia inmutable de headers, no un tenant/Principal confiable ni un peer TLS demostrado. La futura extracción mTLS necesita procedencia real desde un gateway/canal aprobado; un X-Client-Cert o Forwarded enviado por cliente nunca sustituye esa evidencia. La prueba criptográfica debe vincularse a la misma identidad y al binding API-03 de los bytes reales. La dirección/host de Request no se usa para autenticar, decidir tenant o realizar fetch.

## Timeouts, abortos y resultados inciertos

Deadline total por invocación, explícito en límites: mientras transporte/cuerpo -> 408; en dependencias/aplicación -> 503. Un AbortSignal cancelado usa la misma clasificación por fase. No es cancelación de orden ni garantía de que una transacción se revirtió.

Al expirar, cada frontera de puerto y cada método Tx comprueba el deadline antes/después de await. Una respuesta tardía del verificador no puede iniciar consultas nuevas ni aplicación; una conexión obtenida tarde no puede iniciar el callback de negocio; si vence entre escrituras, la siguiente frontera falla y el repositorio debe revertir. No se inicia un reintento automático.

No se puede interrumpir retroactivamente una llamada ya enviada a proveedor/DB ni un COMMIT ya emitido con los contratos actuales. En tal caso la operación podría completar tarde: devolver 503 sin recibo y tratar el desenlace como incierto, preservar estado y conciliar/reintentar mismo externalOrderId/contenido con NUEVA prueba criptográfica. No liberar nonce o devolver cuota, no afirmar rollback ni reenviar automáticamente. El Promise.race observa el rechazo tardío; no genera una nueva respuesta exitosa ni una tarea programada. El puente de transporte no aporta atomicidad entre seguridad y negocio, fencing de revocación o cancelación cooperativa real de driver; éstos requieren diseño/pruebas futuras.

Los límites no certifican protección de un listener: Request ya fue normalizado por su constructor. Cabeceras duplicadas originales pueden quedar coalescidas, URL/segmentos pueden normalizarse, y sockets/TLS/framing/decompresión/rate preauth no se inspeccionan aquí. Un gateway futuro debe imponerlos sobre tráfico real antes de crear Request; pruebas de smuggling, límites de conexiones, slowloris y raw headers NO EJECUTADAS.

## Bloqueos de activación y decisiones

D01–D16 siguen pendientes: D01 dirección del tráfico; D02 mecanismo M2M/trust/audience/rotación/revocación y procedencia de evidencia; D03 IDs/namespace/case; D04 empresa/cliente/club y selección multi-club; D05 entregas; D06 DTO/cotas comerciales; D07 zonas/tiempos; D08 estados; D09 cancelación/método/path; D10 nonce/idempotency-key/replay/retry; D11 cuotas/ventanas/tamaño/SLA; D12 códigos/cabeceras/Retry-After/acuse; D13 pruebas de entrega; D14 privacidad/cifrado/retención; D15 entorno/gates/operación; D16 KPI. No se infieren datos de negocio ni se enviaron consultas a PriceSmart.

Requisitos antes de cualquier exposición: auditoría independiente de API-04; ratificación aplicable; proveedor M2M y almacenes reales probados; catálogo/revocación/rotación y gateway TLS/streaming/origen/abuso aprobados; instancia nueva autorizada, S02–S06-A y perfil API separado de S04; cifrado/retención y durabilidad API-02; revisión específica de rutas/Next/proxy/artefacto en otro PR. Sin autorización por env, merge o salida PASS de tests. No SQL/migraciones, Hostinger/DNS, credenciales PriceSmart, grants S04, infraestructura, workers/TMS, #541, merge ni despliegue en esta entrega.
