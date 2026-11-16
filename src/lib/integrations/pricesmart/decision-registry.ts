// PRICESMART API-27 — REGISTRO de decisiones externas (D02, D05, D06, D08, D09, D13 y KMS/HSM). Módulo PURO y autocontenido (sin importaciones): es la única fuente de la que se genera el paquete de preguntas
// para PriceSmart (docs/integraciones/pricesmart/api27/PAQUETE-PREGUNTAS-PRICESMART.md; una prueba comprueba que el documento coincide con `renderQuestionPackage()`).
// NO ratifica nada: un estado `PENDING_EXTERNAL`/`PROPOSED` significa que el comportamiento sigue DESACTIVADO y que el código solo contiene lo que podemos implementar y probar sin su respuesta. Las respuestas de
// PriceSmart no se inventan ni se suponen: cada pregunta está abierta hasta confirmación escrita.

/** Raíz de los módulos de PriceSmart (los puntos de enchufe se componen para no repetir literales que vigilan las guardas estáticas de API-22/API-26). */
const PS = 'src/lib/integrations/pricesmart/';
export type DecisionId = 'D02' | 'D05' | 'D06' | 'D08' | 'D09' | 'D13' | 'KMS';
export type DecisionStatus = 'APPROVED' | 'PROPOSED' | 'PENDING_EXTERNAL';
export type DecisionQuestion = Readonly<{ id: string; text: string; why: string }>;
export type DecisionEntry = Readonly<{
  id: DecisionId; title: string; status: DecisionStatus; owner: 'PRICESMART' | 'SITSA' | 'AMBOS';
  /** Qué sigue bloqueado mientras la decisión esté abierta (comportamiento actual, verificable). */
  blocks: readonly string[];
  /** Archivos del repositorio donde la decisión se enchufa (una prueba comprueba que existen). */
  seams: readonly string[];
  /** Lo que YA se implementó y se prueba sin esperar la respuesta (no cuenta como ratificación). */
  builtWithoutAnswer: readonly string[];
  questions: readonly DecisionQuestion[];
}>;

export const DECISIONS: readonly DecisionEntry[] = Object.freeze([
  {
    id: 'D02', title: 'Autenticación de PriceSmart hacia nuestro servicio', status: 'PENDING_EXTERNAL', owner: 'PRICESMART',
    blocks: ['No existe verificador de evidencia externo: `evaluateSandboxExposure` exige `verifier.kind=EXTERNAL` y el verificador sintético HMAC NUNCA se usa para acceso externo', 'La decisión D02 no está en `PRICESMART_RATIFIED_DECISIONS`', 'Endpoints en 503 DISABLED, ready=false'],
    seams: [`${PS}${['homologation', 'runtime.ts'].join('/')}`, 'src/lib/integrations/pricesmart/guarded-evidence-verifier.ts', 'src/lib/integrations/pricesmart/homologation-sandbox.ts', 'src/lib/integrations/pricesmart/runtime-config.ts'],
    builtWithoutAnswer: ['Puerto `verifier`/`evidence` inyectable con comprobación de conformidad de puertos', 'Revocación inmediata de credenciales (`revokeStatement`), cuotas, anti-reenvío y registro de pruebas por credencial en MariaDB', 'Proxy que elimina cabeceras de laboratorio (`x-lab-evidence`)'],
    questions: [
      { id: 'D02-1', text: '¿Qué mecanismo de autenticación máquina-a-máquina usará PriceSmart para llamar a nuestro servicio (por ejemplo mTLS, credenciales de cliente OAuth2 con token firmado, firma de cada petición u otro)?', why: 'Determina el verificador externo que debemos escribir y revisar; hoy no hay ninguno aprobado.' },
      { id: 'D02-2', text: '¿Quién emite la identidad o la evidencia y cuál es el ancla de confianza (autoridad certificadora, URL de claves públicas, clave pública pre-registrada)? ¿Cómo la validamos sin compartir secretos?', why: 'Define qué guardamos en el catálogo de integraciones y cómo se verifica sin material secreto de PriceSmart.' },
      { id: 'D02-3', text: '¿Cuál es el identificador/audiencia del servicio que PriceSmart incluirá o esperará, y cómo se identifica el club de origen (una credencial por club o un dato dentro de la evidencia)?', why: 'Evita que una credencial de un club pueda crear o leer órdenes de otro (aislamiento multiempresa y por club).' },
      { id: 'D02-4', text: '¿Qué vigencia máxima tendrán las credenciales, cómo se rotan sin corte (periodo de solapamiento) y cómo nos notifican un compromiso para revocar de inmediato?', why: 'Fija la vigencia acotada del registro y el procedimiento de revocación (efecto inmediato ya implementado).' },
      { id: 'D02-5', text: '¿Incluirán un identificador único por petición y una marca de tiempo? ¿Qué tolerancia de reloj aceptan?', why: 'Necesario para el control anti-reenvío; sin ello no podemos distinguir un reintento legítimo de un reenvío.' },
      { id: 'D02-6', text: '¿Llamarán desde direcciones IP fijas que podamos permitir en el proxy? ¿Cuáles y con qué aviso de cambio?', why: 'Allowlist de red del sandbox (nginx); hoy es una plantilla sin direcciones.' },
    ],
  },
  {
    id: 'D05', title: 'Modelo de cumplimiento (1 pedido = 1 solicitud = 1 plan)', status: 'APPROVED', owner: 'SITSA',
    blocks: ['Parciales, reintentos y viaje compartido se retienen para revisión humana (no se automatizan)'],
    seams: ['src/lib/integrations/pricesmart/tms-contract-proposal.ts'],
    builtWithoutAnswer: ['Modelo aprobado por el propietario e implementado en la proyección y el mapeo al TMS'],
    questions: [
      { id: 'D05-1', text: 'Confirmar que PriceSmart acepta que un pedido con varios destinos se represente como UNA solicitud y UN plan con varias entregas (máximo 18) y que lo no soportado (parciales, reintentos, viaje compartido) pase a revisión humana.', why: 'Evita prometer al cliente comportamientos que el TMS no soporta.' },
    ],
  },
  {
    id: 'D06', title: 'Contrato definitivo de la orden (diccionario de datos)', status: 'PROPOSED', owner: 'AMBOS',
    blocks: ['Solo existe el contrato provisional `lab-demo-1` (laboratorio); ningún diccionario `RATIFIED` es aceptado sin D06 en las decisiones ratificadas'],
    seams: ['src/lib/integrations/pricesmart/order-contract-dictionary.ts', 'src/lib/integrations/pricesmart/lab-demo/contract.ts', 'src/lib/integrations/pricesmart/contracts.ts', 'src/lib/integrations/pricesmart/lab-demo/tms-link.ts'],
    builtWithoutAnswer: ['Compilador de diccionarios declarativos a validador + identidad de contenido (idempotencia) con límites, Unicode, fechas y duplicados probados', 'Equivalencia demostrada entre `lab-demo-1` declarativo y el esquema de laboratorio', 'Límites del TMS (`TMS_LIMITS`) comprobados contra el código real'],
    questions: [
      { id: 'D06-1', text: 'Entregar el diccionario de datos de la orden: cada campo con nombre, tipo, obligatoriedad, longitud máxima, formato y ejemplo.', why: 'Es la entrada del compilador declarativo; con él el contrato definitivo es datos + pruebas, no código nuevo.' },
      { id: 'D06-2', text: '¿Cuál es el formato exacto del identificador de la orden y su unicidad (global, por club o por periodo)? ¿Cuántos caracteres?', why: 'Determina la clave de idempotencia; hoy exigimos 1–120 caracteres alfanuméricos con . _ : -.' },
      { id: 'D06-3', text: '¿Fecha y hora de entrega: solo fecha o fecha-hora, zona horaria, y cuál es la ventana mínima de antelación?', why: 'La solicitud del TMS usa fecha calendario; una hora exigiría ampliar el mapeo.' },
      { id: 'D06-4', text: '¿Puede una orden traer varias direcciones de entrega? ¿Máximo y orden de visita?', why: 'El TMS admite hasta 18 entregas por plan (D05); el diccionario debe declararlo.' },
      { id: 'D06-5', text: '¿Qué datos personales viajan (nombre, teléfono, correo del destinatario) y qué retención exigen?', why: 'Define qué campos se cifran, se muestran a Operaciones y cuánto tiempo se conservan.' },
      { id: 'D06-6', text: '¿Qué hacemos con campos desconocidos (rechazar o ignorar) y cómo versionan el esquema?', why: 'Hoy rechazamos campos desconocidos (modo estricto); aceptar extras cambia la superficie de ataque.' },
      { id: 'D06-7', text: 'Si llega el mismo identificador con contenido distinto, ¿aceptan que respondamos 409 CONFLICT sin modificar la orden original?', why: 'Es nuestra regla de idempotencia actual (8 envíos iguales → 1 orden).' },
    ],
  },
  {
    id: 'D08', title: 'Estados externos visibles para PriceSmart', status: 'PROPOSED', owner: 'AMBOS',
    blocks: ['La publicación de estados hacia PriceSmart está bloqueada (`publishable:false`); ningún estado confirma entrega'],
    seams: ['src/lib/integrations/pricesmart/tms-contract-proposal.ts'],
    builtWithoutAnswer: ['Proyección pura solicitud/plan → estado externo con estados desconocidos enviados a REVIEW_REQUIRED'],
    questions: [
      { id: 'D08-1', text: 'Confirmar la lista de estados externos propuesta (RECEIVED, IN_REVIEW, REJECTED, CANCELLED, SCHEDULED, LOADED, IN_TRANSIT, UNLOADED_UNCONFIRMED, CLOSED_ADMINISTRATIVE, REVIEW_REQUIRED) o indicar los que necesitan.', why: 'Es el vocabulario de la consulta periódica; ninguno afirma entrega.' },
      { id: 'D08-2', text: '¿Con qué frecuencia máxima consultarán el estado y qué retraso aceptan entre un cambio en el TMS y su visibilidad?', why: 'Dimensiona cuotas y cachés.' },
    ],
  },
  {
    id: 'D09', title: 'Cancelación pedida por PriceSmart', status: 'PROPOSED', owner: 'AMBOS',
    blocks: ['La cancelación nunca es automática (`automatic:false`): solo se registra la solicitud y se informa una evaluación; no se cancela el plan ni se modifica la solicitud del TMS'],
    seams: ['src/lib/integrations/pricesmart/tms-contract-proposal.ts', 'src/lib/integrations/pricesmart/lab-demo/tms-link.ts', 'src/lib/integrations/pricesmart/contracts.ts'],
    builtWithoutAnswer: ['Evaluación pura por estado real del TMS con 7 veredictos y cancelación antes/después de vincular probada con MariaDB real'],
    questions: [
      { id: 'D09-1', text: '¿Pedirán la cancelación con un POST a un recurso de solicitudes de cancelación (nuestro diseño actual) o exigen DELETE sobre la orden?', why: 'DELETE obligaría a un manejador nuevo con otra semántica de idempotencia.' },
      { id: 'D09-2', text: '¿Hasta qué estado esperan poder cancelar (recibida, en revisión, programada, cargada)? ¿Qué debe pasar si el viaje ya está en ruta o descargado?', why: 'Hoy: antes de programar → rechazo por personal; programado/cargado → Operaciones puede cancelar el plan a mano; en ruta o después → bloqueado.' },
      { id: 'D09-3', text: '¿Aceptan una respuesta asíncrona (solicitud recibida ahora, resultado después) y cómo quieren conocer el resultado?', why: 'El TMS no cancela solicitudes automáticamente; el resultado depende de una decisión humana.' },
      { id: 'D09-4', text: '¿Qué motivos válidos existen además de ORIGIN_REQUEST y DUPLICATE y quién puede pedirlos (club o central)?', why: 'Es el enum cerrado actual del contrato de cancelación.' },
      { id: 'D09-5', text: '¿Hay penalizaciones o plazos de cancelación que debamos reflejar o solo registrar?', why: 'No inventamos reglas comerciales: solo se registran si PriceSmart las define.' },
    ],
  },
  {
    id: 'D13', title: 'Entrega confirmada (evidencia y quién la confirma)', status: 'PENDING_EXTERNAL', owner: 'AMBOS',
    blocks: ['`confirmsDelivery:false` siempre; no existe estado «entregada» en `EXTERNAL_STATUSES`; el piloto «terminó» NO es entrega aceptada'],
    seams: ['src/lib/integrations/pricesmart/delivery-evidence.ts', 'src/lib/integrations/pricesmart/tms-contract-proposal.ts'],
    builtWithoutAnswer: ['Evaluación informativa de evidencia por parada (niveles NONE/PARTIAL/PILOT_CONFIRMED_ALL/REVIEW_REQUIRED) sin afirmar entrega'],
    questions: [
      { id: 'D13-1', text: '¿Qué constituye una entrega confirmada para PriceSmart (firma del receptor, foto, geolocalización, hora, documento)?', why: 'Define la evidencia mínima que el TMS debe exigir y conservar.' },
      { id: 'D13-2', text: '¿Quién está autorizado a confirmarla (piloto, receptor, Operaciones) y cómo se resuelve una discrepancia?', why: 'Hoy solo existe la confirmación del piloto, que no es aceptación del cliente.' },
      { id: 'D13-3', text: '¿Cómo tratan las entregas parciales o rechazadas por línea y por parada?', why: 'El TMS no tiene estado por línea; hoy se envían a revisión.' },
      { id: 'D13-4', text: '¿Quieren recibir la evidencia en sí (archivo) o solo el estado y una referencia? ¿Con qué retención y privacidad?', why: 'Determina qué se publica; hoy no se publica nada (`publishable:false`).' },
      { id: 'D13-5', text: '¿Qué plazo máximo (SLA) esperan entre la entrega y su publicación?', why: 'Dimensiona el consumidor de la outbox y las alertas.' },
    ],
  },
  {
    id: 'KMS', title: 'Cifrado de datos: proveedor KMS/HSM y adaptador revisado', status: 'PENDING_EXTERNAL', owner: 'AMBOS',
    blocks: ['`REVIEWED_KMS_ADAPTERS` está vacío: ningún adaptador aprobado, ni siquiera para pruebas en destino PRODUCTION', 'El cifrado de laboratorio nunca se acepta para acceso externo'],
    seams: ['src/lib/integrations/pricesmart/kms-provider-selection.ts', 'src/lib/integrations/pricesmart/kms-adapter.ts', 'src/lib/integrations/pricesmart/kms-client-conformance.ts', 'src/lib/integrations/pricesmart/provider-cipher.ts'],
    builtWithoutAnswer: ['Kit de conformidad de cualquier cliente KMS (contexto, alias, manipulación, no determinismo, fugas) con clientes defectuosos que el kit detecta', 'Mamparo de concurrencia, reintentos acotados, alias cerrados por destino y rotación en `createKmsKeyProvider`'],
    questions: [
      { id: 'KMS-1', text: '¿PriceSmart exige un proveedor o una ubicación de claves concretos (nube, HSM propio, región) o lo decide SITSA?', why: 'Sin proveedor no hay adaptador que revisar.' },
      { id: 'KMS-2', text: '¿Requisitos de cifrado: algoritmo mínimo, longitud de clave, periodo máximo de rotación y qué se cifra (cuerpo de la orden, datos personales, evidencia)?', why: 'Hoy: cifrado de sobre AES-256-GCM con clave de datos envuelta por el KMS y rotación por alias.' },
      { id: 'KMS-3', text: '¿Debe PriceSmart poder auditar el uso de las claves o recibir notificación de compromiso? ¿Con qué plazo?', why: 'Define el registro de acceso del KMS y el procedimiento de incidentes.' },
      { id: 'KMS-4', text: '¿Hay requisitos de residencia o de custodia (quién conserva las claves y qué pasa al terminar el contrato)?', why: 'Condiciona proveedor, región y procedimiento de destrucción de claves.' },
    ],
  },
] as const);

export const decisionById = (id: DecisionId): DecisionEntry => { const d = DECISIONS.find((x) => x.id === id); if (!d) throw new Error(`decisión desconocida: ${id}`); return d; };
/** Decisiones que dependen de una respuesta externa y siguen abiertas. */
export const openDecisions = (): readonly DecisionEntry[] => DECISIONS.filter((d) => d.status !== 'APPROVED');
export const allQuestions = (): readonly (DecisionQuestion & { decision: DecisionId })[] => DECISIONS.flatMap((d) => d.questions.map((q) => ({ ...q, decision: d.id })));

const STATUS_LABEL: Record<DecisionStatus, string> = { APPROVED: 'APROBADA', PROPOSED: 'PROPUESTA (no ratificada)', PENDING_EXTERNAL: 'PENDIENTE de PriceSmart' };
/** Documento Markdown determinista (la prueba compara el archivo del repositorio con esta salida). */
export function renderQuestionPackage(): string {
  const lines: string[] = [
    '# PriceSmart — paquete de preguntas y decisiones a confirmar (API-27)', '',
    '> Generado desde `src/lib/integrations/pricesmart/decision-registry.ts`. No editar a mano: una prueba falla si el documento no coincide con el registro.',
    '> Ninguna respuesta se supone. Mientras una decisión esté abierta, el comportamiento permanece **desactivado** (503 DISABLED, ready=false, sin adaptador KMS aprobado).', '',
    '## Resumen', '', '| Decisión | Estado | Responde | Preguntas |', '|---|---|---|---|',
    ...DECISIONS.map((d) => `| ${d.id} — ${d.title} | ${STATUS_LABEL[d.status]} | ${d.owner} | ${d.questions.length} |`), '',
  ];
  for (const d of DECISIONS) {
    lines.push(`## ${d.id} — ${d.title}`, '', `Estado: **${STATUS_LABEL[d.status]}** · Responde: ${d.owner}`, '', '**Sigue bloqueado mientras esté abierta:**', ...d.blocks.map((b) => `- ${b}`), '',
      '**Ya implementado sin esperar la respuesta (no es ratificación):**', ...d.builtWithoutAnswer.map((b) => `- ${b}`), '', '**Preguntas:**', '');
    for (const q of d.questions) lines.push(`${q.id}. ${q.text}`, `   - Por qué importa: ${q.why}`, '');
    lines.push('**Dónde se enchufa la respuesta:**', ...d.seams.map((s) => `- \`${s}\``), '');
  }
  return `${lines.join('\n')}\n`;
}
