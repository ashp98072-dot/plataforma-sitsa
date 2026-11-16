# PriceSmart — paquete de preguntas y decisiones a confirmar (API-27)

> Generado desde `src/lib/integrations/pricesmart/decision-registry.ts`. No editar a mano: una prueba falla si el documento no coincide con el registro.
> Ninguna respuesta se supone. Mientras una decisión esté abierta, el comportamiento permanece **desactivado** (503 DISABLED, ready=false, sin adaptador KMS aprobado).

## Resumen

| Decisión | Estado | Responde | Preguntas |
|---|---|---|---|
| D02 — Autenticación de PriceSmart hacia nuestro servicio | PENDIENTE de PriceSmart | PRICESMART | 6 |
| D05 — Modelo de cumplimiento (1 pedido = 1 solicitud = 1 plan) | APROBADA | SITSA | 1 |
| D06 — Contrato definitivo de la orden (diccionario de datos) | PROPUESTA (no ratificada) | AMBOS | 7 |
| D08 — Estados externos visibles para PriceSmart | PROPUESTA (no ratificada) | AMBOS | 2 |
| D09 — Cancelación pedida por PriceSmart | PROPUESTA (no ratificada) | AMBOS | 5 |
| D13 — Entrega confirmada (evidencia y quién la confirma) | PENDIENTE de PriceSmart | AMBOS | 5 |
| KMS — Cifrado de datos: proveedor KMS/HSM y adaptador revisado | PENDIENTE de PriceSmart | AMBOS | 4 |

## D02 — Autenticación de PriceSmart hacia nuestro servicio

Estado: **PENDIENTE de PriceSmart** · Responde: PRICESMART

**Sigue bloqueado mientras esté abierta:**
- No existe verificador de evidencia externo: `evaluateSandboxExposure` exige `verifier.kind=EXTERNAL` y el verificador sintético HMAC NUNCA se usa para acceso externo
- La decisión D02 no está en `PRICESMART_RATIFIED_DECISIONS`
- Endpoints en 503 DISABLED, ready=false

**Ya implementado sin esperar la respuesta (no es ratificación):**
- Puerto `verifier`/`evidence` inyectable con comprobación de conformidad de puertos
- Revocación inmediata de credenciales (`revokeStatement`), cuotas, anti-reenvío y registro de pruebas por credencial en MariaDB
- Proxy que elimina cabeceras de laboratorio (`x-lab-evidence`)

**Preguntas:**

D02-1. ¿Qué mecanismo de autenticación máquina-a-máquina usará PriceSmart para llamar a nuestro servicio (por ejemplo mTLS, credenciales de cliente OAuth2 con token firmado, firma de cada petición u otro)?
   - Por qué importa: Determina el verificador externo que debemos escribir y revisar; hoy no hay ninguno aprobado.

D02-2. ¿Quién emite la identidad o la evidencia y cuál es el ancla de confianza (autoridad certificadora, URL de claves públicas, clave pública pre-registrada)? ¿Cómo la validamos sin compartir secretos?
   - Por qué importa: Define qué guardamos en el catálogo de integraciones y cómo se verifica sin material secreto de PriceSmart.

D02-3. ¿Cuál es el identificador/audiencia del servicio que PriceSmart incluirá o esperará, y cómo se identifica el club de origen (una credencial por club o un dato dentro de la evidencia)?
   - Por qué importa: Evita que una credencial de un club pueda crear o leer órdenes de otro (aislamiento multiempresa y por club).

D02-4. ¿Qué vigencia máxima tendrán las credenciales, cómo se rotan sin corte (periodo de solapamiento) y cómo nos notifican un compromiso para revocar de inmediato?
   - Por qué importa: Fija la vigencia acotada del registro y el procedimiento de revocación (efecto inmediato ya implementado).

D02-5. ¿Incluirán un identificador único por petición y una marca de tiempo? ¿Qué tolerancia de reloj aceptan?
   - Por qué importa: Necesario para el control anti-reenvío; sin ello no podemos distinguir un reintento legítimo de un reenvío.

D02-6. ¿Llamarán desde direcciones IP fijas que podamos permitir en el proxy? ¿Cuáles y con qué aviso de cambio?
   - Por qué importa: Allowlist de red del sandbox (nginx); hoy es una plantilla sin direcciones.

**Dónde se enchufa la respuesta:**
- `src/lib/integrations/pricesmart/homologation/runtime.ts`
- `src/lib/integrations/pricesmart/guarded-evidence-verifier.ts`
- `src/lib/integrations/pricesmart/homologation-sandbox.ts`
- `src/lib/integrations/pricesmart/runtime-config.ts`

## D05 — Modelo de cumplimiento (1 pedido = 1 solicitud = 1 plan)

Estado: **APROBADA** · Responde: SITSA

**Sigue bloqueado mientras esté abierta:**
- Parciales, reintentos y viaje compartido se retienen para revisión humana (no se automatizan)

**Ya implementado sin esperar la respuesta (no es ratificación):**
- Modelo aprobado por el propietario e implementado en la proyección y el mapeo al TMS

**Preguntas:**

D05-1. Confirmar que PriceSmart acepta que un pedido con varios destinos se represente como UNA solicitud y UN plan con varias entregas (máximo 18) y que lo no soportado (parciales, reintentos, viaje compartido) pase a revisión humana.
   - Por qué importa: Evita prometer al cliente comportamientos que el TMS no soporta.

**Dónde se enchufa la respuesta:**
- `src/lib/integrations/pricesmart/tms-contract-proposal.ts`

## D06 — Contrato definitivo de la orden (diccionario de datos)

Estado: **PROPUESTA (no ratificada)** · Responde: AMBOS

**Sigue bloqueado mientras esté abierta:**
- Solo existe el contrato provisional `lab-demo-1` (laboratorio); ningún diccionario `RATIFIED` es aceptado sin D06 en las decisiones ratificadas

**Ya implementado sin esperar la respuesta (no es ratificación):**
- Compilador de diccionarios declarativos a validador + identidad de contenido (idempotencia) con límites, Unicode, fechas y duplicados probados
- Equivalencia demostrada entre `lab-demo-1` declarativo y el esquema de laboratorio
- Límites del TMS (`TMS_LIMITS`) comprobados contra el código real

**Preguntas:**

D06-1. Entregar el diccionario de datos de la orden: cada campo con nombre, tipo, obligatoriedad, longitud máxima, formato y ejemplo.
   - Por qué importa: Es la entrada del compilador declarativo; con él el contrato definitivo es datos + pruebas, no código nuevo.

D06-2. ¿Cuál es el formato exacto del identificador de la orden y su unicidad (global, por club o por periodo)? ¿Cuántos caracteres?
   - Por qué importa: Determina la clave de idempotencia; hoy exigimos 1–120 caracteres alfanuméricos con . _ : -.

D06-3. ¿Fecha y hora de entrega: solo fecha o fecha-hora, zona horaria, y cuál es la ventana mínima de antelación?
   - Por qué importa: La solicitud del TMS usa fecha calendario; una hora exigiría ampliar el mapeo.

D06-4. ¿Puede una orden traer varias direcciones de entrega? ¿Máximo y orden de visita?
   - Por qué importa: El TMS admite hasta 18 entregas por plan (D05); el diccionario debe declararlo.

D06-5. ¿Qué datos personales viajan (nombre, teléfono, correo del destinatario) y qué retención exigen?
   - Por qué importa: Define qué campos se cifran, se muestran a Operaciones y cuánto tiempo se conservan.

D06-6. ¿Qué hacemos con campos desconocidos (rechazar o ignorar) y cómo versionan el esquema?
   - Por qué importa: Hoy rechazamos campos desconocidos (modo estricto); aceptar extras cambia la superficie de ataque.

D06-7. Si llega el mismo identificador con contenido distinto, ¿aceptan que respondamos 409 CONFLICT sin modificar la orden original?
   - Por qué importa: Es nuestra regla de idempotencia actual (8 envíos iguales → 1 orden).

**Dónde se enchufa la respuesta:**
- `src/lib/integrations/pricesmart/order-contract-dictionary.ts`
- `src/lib/integrations/pricesmart/lab-demo/contract.ts`
- `src/lib/integrations/pricesmart/contracts.ts`
- `src/lib/integrations/pricesmart/lab-demo/tms-link.ts`

## D08 — Estados externos visibles para PriceSmart

Estado: **PROPUESTA (no ratificada)** · Responde: AMBOS

**Sigue bloqueado mientras esté abierta:**
- La publicación de estados hacia PriceSmart está bloqueada (`publishable:false`); ningún estado confirma entrega

**Ya implementado sin esperar la respuesta (no es ratificación):**
- Proyección pura solicitud/plan → estado externo con estados desconocidos enviados a REVIEW_REQUIRED

**Preguntas:**

D08-1. Confirmar la lista de estados externos propuesta (RECEIVED, IN_REVIEW, REJECTED, CANCELLED, SCHEDULED, LOADED, IN_TRANSIT, UNLOADED_UNCONFIRMED, CLOSED_ADMINISTRATIVE, REVIEW_REQUIRED) o indicar los que necesitan.
   - Por qué importa: Es el vocabulario de la consulta periódica; ninguno afirma entrega.

D08-2. ¿Con qué frecuencia máxima consultarán el estado y qué retraso aceptan entre un cambio en el TMS y su visibilidad?
   - Por qué importa: Dimensiona cuotas y cachés.

**Dónde se enchufa la respuesta:**
- `src/lib/integrations/pricesmart/tms-contract-proposal.ts`

## D09 — Cancelación pedida por PriceSmart

Estado: **PROPUESTA (no ratificada)** · Responde: AMBOS

**Sigue bloqueado mientras esté abierta:**
- La cancelación nunca es automática (`automatic:false`): solo se registra la solicitud y se informa una evaluación; no se cancela el plan ni se modifica la solicitud del TMS

**Ya implementado sin esperar la respuesta (no es ratificación):**
- Evaluación pura por estado real del TMS con 7 veredictos y cancelación antes/después de vincular probada con MariaDB real

**Preguntas:**

D09-1. ¿Pedirán la cancelación con un POST a un recurso de solicitudes de cancelación (nuestro diseño actual) o exigen DELETE sobre la orden?
   - Por qué importa: DELETE obligaría a un manejador nuevo con otra semántica de idempotencia.

D09-2. ¿Hasta qué estado esperan poder cancelar (recibida, en revisión, programada, cargada)? ¿Qué debe pasar si el viaje ya está en ruta o descargado?
   - Por qué importa: Hoy: antes de programar → rechazo por personal; programado/cargado → Operaciones puede cancelar el plan a mano; en ruta o después → bloqueado.

D09-3. ¿Aceptan una respuesta asíncrona (solicitud recibida ahora, resultado después) y cómo quieren conocer el resultado?
   - Por qué importa: El TMS no cancela solicitudes automáticamente; el resultado depende de una decisión humana.

D09-4. ¿Qué motivos válidos existen además de ORIGIN_REQUEST y DUPLICATE y quién puede pedirlos (club o central)?
   - Por qué importa: Es el enum cerrado actual del contrato de cancelación.

D09-5. ¿Hay penalizaciones o plazos de cancelación que debamos reflejar o solo registrar?
   - Por qué importa: No inventamos reglas comerciales: solo se registran si PriceSmart las define.

**Dónde se enchufa la respuesta:**
- `src/lib/integrations/pricesmart/tms-contract-proposal.ts`
- `src/lib/integrations/pricesmart/lab-demo/tms-link.ts`
- `src/lib/integrations/pricesmart/contracts.ts`

## D13 — Entrega confirmada (evidencia y quién la confirma)

Estado: **PENDIENTE de PriceSmart** · Responde: AMBOS

**Sigue bloqueado mientras esté abierta:**
- `confirmsDelivery:false` siempre; no existe estado «entregada» en `EXTERNAL_STATUSES`; el piloto «terminó» NO es entrega aceptada

**Ya implementado sin esperar la respuesta (no es ratificación):**
- Evaluación informativa de evidencia por parada (niveles NONE/PARTIAL/PILOT_CONFIRMED_ALL/REVIEW_REQUIRED) sin afirmar entrega

**Preguntas:**

D13-1. ¿Qué constituye una entrega confirmada para PriceSmart (firma del receptor, foto, geolocalización, hora, documento)?
   - Por qué importa: Define la evidencia mínima que el TMS debe exigir y conservar.

D13-2. ¿Quién está autorizado a confirmarla (piloto, receptor, Operaciones) y cómo se resuelve una discrepancia?
   - Por qué importa: Hoy solo existe la confirmación del piloto, que no es aceptación del cliente.

D13-3. ¿Cómo tratan las entregas parciales o rechazadas por línea y por parada?
   - Por qué importa: El TMS no tiene estado por línea; hoy se envían a revisión.

D13-4. ¿Quieren recibir la evidencia en sí (archivo) o solo el estado y una referencia? ¿Con qué retención y privacidad?
   - Por qué importa: Determina qué se publica; hoy no se publica nada (`publishable:false`).

D13-5. ¿Qué plazo máximo (SLA) esperan entre la entrega y su publicación?
   - Por qué importa: Dimensiona el consumidor de la outbox y las alertas.

**Dónde se enchufa la respuesta:**
- `src/lib/integrations/pricesmart/delivery-evidence.ts`
- `src/lib/integrations/pricesmart/tms-contract-proposal.ts`

## KMS — Cifrado de datos: proveedor KMS/HSM y adaptador revisado

Estado: **PENDIENTE de PriceSmart** · Responde: AMBOS

**Sigue bloqueado mientras esté abierta:**
- `REVIEWED_KMS_ADAPTERS` está vacío: ningún adaptador aprobado, ni siquiera para pruebas en destino PRODUCTION
- El cifrado de laboratorio nunca se acepta para acceso externo

**Ya implementado sin esperar la respuesta (no es ratificación):**
- Kit de conformidad de cualquier cliente KMS (contexto, alias, manipulación, no determinismo, fugas) con clientes defectuosos que el kit detecta
- Mamparo de concurrencia, reintentos acotados, alias cerrados por destino y rotación en `createKmsKeyProvider`

**Preguntas:**

KMS-1. ¿PriceSmart exige un proveedor o una ubicación de claves concretos (nube, HSM propio, región) o lo decide SITSA?
   - Por qué importa: Sin proveedor no hay adaptador que revisar.

KMS-2. ¿Requisitos de cifrado: algoritmo mínimo, longitud de clave, periodo máximo de rotación y qué se cifra (cuerpo de la orden, datos personales, evidencia)?
   - Por qué importa: Hoy: cifrado de sobre AES-256-GCM con clave de datos envuelta por el KMS y rotación por alias.

KMS-3. ¿Debe PriceSmart poder auditar el uso de las claves o recibir notificación de compromiso? ¿Con qué plazo?
   - Por qué importa: Define el registro de acceso del KMS y el procedimiento de incidentes.

KMS-4. ¿Hay requisitos de residencia o de custodia (quién conserva las claves y qué pasa al terminar el contrato)?
   - Por qué importa: Condiciona proveedor, región y procedimiento de destrucción de claves.

**Dónde se enchufa la respuesta:**
- `src/lib/integrations/pricesmart/kms-provider-selection.ts`
- `src/lib/integrations/pricesmart/kms-adapter.ts`
- `src/lib/integrations/pricesmart/kms-client-conformance.ts`
- `src/lib/integrations/pricesmart/provider-cipher.ts`

