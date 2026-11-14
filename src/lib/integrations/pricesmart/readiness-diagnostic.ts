import { isPriceSmartHandlerInstalled } from './runtime-state';
import { labDemoGate } from './lab-demo/gate';
import { REQUIRED_DECISIONS, parseRuntimeConfig } from './runtime-config';
import { COMPOSITION_ENV_VARIABLES, parseCompositionConfig } from './composition-config';
import { KMS_ENV_VARIABLES } from './kms-config';
import { hasReviewedKmsAdapter } from './kms-provider-selection';

// PRICESMART API-15 — diagnóstico administrativo de readiness. SOLO LECTURA y PURO respecto del sistema: no abre conexiones, no consulta ni escribe datos del TMS ni de ninguna empresa,
// no instala ni retira handlers, no habilita endpoints y no cambia ninguna bandera. Informa únicamente PRESENCIA (booleanos) y estados; nunca valores de variables, claves, tokens ni
// mensajes de error de terceros. Las decisiones D02/D06/D08/D09/D12 se muestran como «declaradas por el operador»: este módulo no las ratifica ni las verifica.
export type CheckStatus = 'OK' | 'MISSING' | 'BLOCKED' | 'NOT_WIRED' | 'UNVERIFIED' | 'INFO';
export type Check = { id: string; status: CheckStatus; detail: string };
export type ReadinessDiagnostic = {
  generatedAt: string;
  handlerInstalled: boolean;
  mode: 'DISABLED' | 'READ_ONLY' | 'ENABLED';
  ready: false;   // constante mientras no exista una composición productiva verificable
  blockers: string[];
  checks: Check[];
  decisions: { id: string; declaredRatified: boolean; requiredFor: string[] }[];
  presentVariables: Record<string, boolean>;
};

/** Refleja la restricción de `mariaDbOrderRepository` (la prueba estática comprueba que siga idéntica). Es una limitación de código vigente, no una decisión nueva. */
export const SANDBOX_DB_USER_PATTERN = /^sandbox_api02_[a-z0-9_]+$/;
const DECISION_IDS = ['D02', 'D06', 'D08', 'D09', 'D12'] as const;
const VARIABLES = [
  'PRICESMART_RUNTIME_MODE', 'PRICESMART_RUNTIME_ACK', 'PRICESMART_RUNTIME_ENVIRONMENT', 'PRICESMART_ORIGIN_CLUB', 'PRICESMART_DB_SCHEMA', 'PRICESMART_DB_RUNTIME_USER',
  'PRICESMART_RATIFIED_DECISIONS', 'PRICESMART_TIMEOUT_MS', 'PRICESMART_MAX_BODY_BYTES', 'PRICESMART_MAX_EVIDENCE_BYTES', 'PRICESMART_RATE_PER_WINDOW', 'PRICESMART_RATE_WINDOW_MS',
  'PRICESMART_MAX_PROOF_AGE_MS', 'PRICESMART_FUTURE_SKEW_MS', 'PRICESMART_REPLAY_RETENTION_MS',
  ...COMPOSITION_ENV_VARIABLES, ...KMS_ENV_VARIABLES,
] as const;
const PORTS = ['verifier de evidencia (D02)', 'puerto de evidencia HTTP', 'cifrado de cargas con gestión de claves', 'contrato de orden (D06)', 'repositorio de producción', 'interruptor de emergencia', 'sondas de salud'] as const;

export function buildReadinessDiagnostic(env: Record<string, string | undefined>, state: { handlerInstalled: boolean; labActive: boolean }, now: Date = new Date()): ReadinessDiagnostic {
  const checks: Check[] = []; const blockers: string[] = [];
  const block = (id: string, detail: string) => { blockers.push(id); checks.push({ id, status: 'BLOCKED', detail }); };
  const presentVariables = Object.fromEntries(VARIABLES.map(k => [k, env[k] !== undefined && env[k] !== '']));
  const parsed = parseRuntimeConfig(env);
  const mode = parsed.ok ? parsed.config.mode : 'DISABLED';

  checks.push({ id: 'RUNTIME_HANDLER', status: state.handlerInstalled ? 'OK' : 'INFO', detail: state.handlerInstalled ? 'hay un handler instalado' : 'sin handler instalado: las rutas responden 503 DISABLED' });
  if (!parsed.ok && parsed.issues.length === 0) block('MODE_DISABLED', 'PRICESMART_RUNTIME_MODE ausente o DISABLED (estado seguro por defecto)');
  else if (!parsed.ok) for (const issue of parsed.issues) block('CONFIG_INVALID', issue);
  else checks.push({ id: 'CONFIG', status: 'OK', detail: `configuración válida, modo ${parsed.config.mode}` });

  // API-22: el contrato de seguridad ya modela `sandbox` y `production`, pero NINGÚN componente autoriza `production`: la persistencia (guardas `sandbox_api02_*`), el verificador criptográfico (D02) y el KMS siguen pendientes.
  block('PRODUCTION_ENVIRONMENT_NOT_AUTHORIZED', 'el contrato modela production, pero no hay persistencia, verificador criptográfico ni KMS autorizados para ese entorno');
  if (env.NODE_ENV === 'production' || env.NOVALVION_ENV === 'production') block('RUNNING_IN_PRODUCTION_ENVIRONMENT', 'el proceso se declara de producción; el runtime no puede abrirse');

  const user = env.PRICESMART_DB_RUNTIME_USER;
  if (!user) checks.push({ id: 'DB_RUNTIME_USER', status: 'MISSING', detail: 'PRICESMART_DB_RUNTIME_USER no está definida' });
  else if (!SANDBOX_DB_USER_PATTERN.test(user)) block('DB_USER_PATTERN_SANDBOX_ONLY', 'el repositorio actual solo acepta cuentas sandbox_api02_*; una cuenta de ejecución distinta requiere una decisión explícita');
  else checks.push({ id: 'DB_RUNTIME_USER', status: 'OK', detail: 'cuenta con el patrón de laboratorio/sandbox' });
  checks.push({ id: 'DB_SCHEMA', status: env.PRICESMART_DB_SCHEMA ? 'OK' : 'MISSING', detail: env.PRICESMART_DB_SCHEMA ? 'definido' : 'PRICESMART_DB_SCHEMA no está definida' });

  const declared = parsed.ok ? parsed.config.ratified : [];
  const decisions = DECISION_IDS.map(id => ({ id, declaredRatified: declared.includes(id),
    requiredFor: (Object.entries(REQUIRED_DECISIONS) as [string, readonly string[]][]).filter(([, ids]) => ids.includes(id)).map(([m]) => m) }));
  if (parsed.ok) for (const d of REQUIRED_DECISIONS[parsed.config.mode as 'READ_ONLY' | 'ENABLED']) if (!declared.includes(d)) block('DECISION_PENDING', `${d} no está declarada como ratificada por PriceSmart`);

  // API-21 — configuración de composición por destino y selección del proveedor KMS: ambas fallan cerradas y NUNCA se consideran «OK» por sí solas.
  const compositionDeclared = [...COMPOSITION_ENV_VARIABLES, ...KMS_ENV_VARIABLES].some(v => env[v] !== undefined && env[v] !== '');
  if (!compositionDeclared) checks.push({ id: 'COMPOSITION_CONFIG', status: 'MISSING', detail: 'sin configuración de composición (destino, base de datos y KMS)' });
  else { const c = parseCompositionConfig(env); if (!c.ok) block('COMPOSITION_CONFIG_INVALID', 'la configuración de composición es inválida, está incompleta o mezcla destinos'); else checks.push({ id: 'COMPOSITION_CONFIG', status: 'INFO', detail: `configuración de composición válida para el destino ${c.config.target} (no implica readiness)` }); }
  if (!hasReviewedKmsAdapter()) block('KMS_PROVIDER_NOT_SELECTED', 'no hay ningún adaptador de proveedor KMS/HSM revisado: la selección del proveedor es una decisión pendiente');
  // Los puertos NUNCA se marcan OK por la mera existencia de un handler: un handler (incluido el de laboratorio) no demuestra que sus puertos sean productivos. Hoy no existe ningún
  // mecanismo que aporte evidencia verificable de una composición productiva, así que, con o sin handler, ningún puerto puede declararse OK.
  for (const p of PORTS) checks.push(state.handlerInstalled
    ? { id: `PORT:${p}`, status: 'UNVERIFIED', detail: 'hay un handler instalado, pero no existe evidencia verificable de que este puerto sea productivo' }
    : { id: `PORT:${p}`, status: 'NOT_WIRED', detail: 'sin composición administrativa que lo aporte' });
  blockers.push(state.handlerInstalled ? 'PORTS_UNVERIFIED' : 'PORTS_NOT_WIRED');
  if (state.handlerInstalled && state.labActive) blockers.push('LAB_HANDLER_NOT_PRODUCTION_EVIDENCE');
  // Mientras la composición productiva no esté implementada, el diagnóstico no puede dar ready=true bajo ninguna combinación de entorno y handlers.
  block('PRODUCTION_COMPOSITION_NOT_IMPLEMENTED', 'no existe una composición productiva verificable; ninguna configuración ni handler instalado basta para declarar la integración lista');
  if (state.labActive) checks.push({ id: 'LAB_COMPOSITION', status: 'INFO', detail: 'las condiciones del laboratorio local se cumplen (no es el runtime productivo ni evidencia de readiness)' });

  return { generatedAt: now.toISOString(), handlerInstalled: state.handlerInstalled, mode, ready: false, blockers: [...new Set(blockers)], checks, decisions, presentVariables };
}

/** Punto de entrada para la ruta: lee el entorno del proceso y el estado de instalación, sin efectos. Cualquier excepción interna produce un informe cerrado genérico. */
export async function readinessDiagnostic(): Promise<ReadinessDiagnostic> {
  try {
    return buildReadinessDiagnostic(process.env, { handlerInstalled: isPriceSmartHandlerInstalled(), labActive: labDemoGate(process.env).ok });
  } catch {
    return { generatedAt: new Date().toISOString(), handlerInstalled: false, mode: 'DISABLED', ready: false, blockers: ['DIAGNOSTIC_FAILED'],
      checks: [{ id: 'DIAGNOSTIC', status: 'BLOCKED', detail: 'el diagnóstico no pudo completarse' }], decisions: [], presentVariables: {} };
  }
}
