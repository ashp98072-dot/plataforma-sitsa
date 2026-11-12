import { createIsolatedHttpTransport, type HttpEvidencePort, type HttpTransportExtensions } from './http-transport';
import { installPriceSmartHandler, type PriceSmartHandler } from './runtime';
import { parseRuntimeConfig, type RuntimeConfig, type RuntimeMode } from './runtime-config';
import type { OrderRepository } from './ports';
import type { createM2MSecurity } from './m2m-security';

// PRICESMART API-14 — ensamblaje CONTROLADO del runtime. Esta función NO tiene ningún punto de llamada en la aplicación: nada la invoca hoy, por lo que las rutas siguen en 503 DISABLED.
// Una composición administrativa futura aportará los puertos reales (verificador D02, contrato D06, cifrado, repositorio) y llamará a `installControlledRuntime`; este módulo
// solo garantiza que el handler se instale únicamente si TODO está validado, y que quede detrás de un modo (DISABLED / READ_ONLY / ENABLED) y un interruptor de emergencia.

/** Decisiones de PriceSmart que deben estar ratificadas (declaradas por el operador) para cada modo. Supuesto conservador de este PR; ajustable cuando PriceSmart las confirme. */
export const REQUIRED_DECISIONS: Readonly<Record<Exclude<RuntimeMode, 'DISABLED'>, readonly string[]>> = {
  READ_ONLY: ['D02', 'D06'],
  ENABLED: ['D02', 'D06', 'D08', 'D09', 'D12'],
};
export type Blocker = { code: string; detail: string };
export type Readiness = { ready: boolean; mode: RuntimeMode; blockers: Blocker[] };

export type RuntimePorts = {
  evidence: HttpEvidencePort; security: Parameters<typeof createM2MSecurity>[0]; repository: OrderRepository; extensions?: HttpTransportExtensions;
  /** Comprobaciones de salud inyectadas (p. ej. ping a la base, esquema presente). Deben devolver true; cualquier otra cosa, excepción o demora > probeTimeoutMs cuenta como bloqueo. */
  probes?: Readonly<Record<string, () => Promise<boolean>>>;
  /** Interruptor de emergencia: true = apagar. Si no puede leerse, se asume true (cierra). */
  killSwitch?: () => boolean | Promise<boolean>;
};

async function runProbe(fn: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return (await Promise.race([fn(), new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })])) === true; }
  catch { return false; } finally { if (timer) clearTimeout(timer); }
}

/** Evalúa si el runtime puede abrirse. Nunca incluye valores de configuración ni mensajes de error de terceros en el informe. */
export async function evaluateReadiness(env: Record<string, string | undefined>, ports: Partial<RuntimePorts> | null, options: { probeTimeoutMs?: number } = {}): Promise<Readiness & { config: RuntimeConfig | null }> {
  const parsed = parseRuntimeConfig(env);
  if (!parsed.ok) {
    const off = parsed.issues.length === 0;
    return { ready: false, mode: 'DISABLED', config: null, blockers: off ? [{ code: 'MODE_DISABLED', detail: 'PRICESMART_RUNTIME_MODE ausente o DISABLED (estado seguro por defecto)' }] : parsed.issues.map(detail => ({ code: 'CONFIG_INVALID', detail })) };
  }
  const { config } = parsed; const blockers: Blocker[] = [];
  if (env.NODE_ENV === 'production' || env.NOVALVION_ENV === 'production') blockers.push({ code: 'PRODUCTION_ENVIRONMENT_NOT_MODELED', detail: 'el contrato de seguridad solo modela el entorno sandbox; producción requiere una decisión y un cambio de contrato aprobados' });
  for (const d of REQUIRED_DECISIONS[config.mode as 'READ_ONLY' | 'ENABLED']) if (!config.ratified.includes(d)) blockers.push({ code: 'DECISION_PENDING', detail: `${d} no está ratificada por PriceSmart` });
  const p = ports ?? {};
  if (!p.evidence || typeof p.evidence.extract !== 'function') blockers.push({ code: 'PORT_MISSING', detail: 'evidence' });
  if (!p.security?.verifier || !p.security.catalog || !p.security.revocation || !p.security.clock || !p.security.counter || !p.security.replay) blockers.push({ code: 'PORT_MISSING', detail: 'security' });
  if (!p.repository || typeof p.repository.runAtomic !== 'function') blockers.push({ code: 'PORT_MISSING', detail: 'repository' });
  if (!p.killSwitch) blockers.push({ code: 'PORT_MISSING', detail: 'killSwitch' });
  const probes = Object.entries(p.probes ?? {});
  if (!probes.length) blockers.push({ code: 'PORT_MISSING', detail: 'probes' });
  for (const [name, fn] of probes) if (!(await runProbe(fn, options.probeTimeoutMs ?? 2000))) blockers.push({ code: 'PROBE_FAILED', detail: name });
  return { ready: blockers.length === 0, mode: config.mode, blockers, config };
}

function closed(code: 'DISABLED' | 'READ_ONLY'): Response {
  const correlationId = crypto.randomUUID();
  return new Response(JSON.stringify({ code, correlationId }), { status: 503, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private', Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'X-Correlation-Id': correlationId, 'Retry-After': '60' } });
}
/** Envuelve un handler con el modo y el interruptor. Se evalúa en CADA solicitud: apagar no requiere reinicio. */
export function withRuntimeControls(inner: PriceSmartHandler, mode: RuntimeMode, killSwitch: () => boolean | Promise<boolean>): PriceSmartHandler {
  return async (request) => {
    if (mode === 'DISABLED') return closed('DISABLED');
    let off = true;
    try { off = (await killSwitch()) !== false; } catch { off = true; }
    if (off) return closed('DISABLED');
    if (mode === 'READ_ONLY' && request.method !== 'GET') return closed('READ_ONLY');
    return inner(request);
  };
}

/** Único camino hacia producción: valida, comprueba salud y SOLO entonces instala. Devuelve el informe; si no está listo, no instala nada.
 *  Falla cerrado: el handler anterior se retira ANTES de evaluar nada (una reinstalación nunca deja activa la composición previa, ni siquiera durante las sondas), y cualquier excepción
 *  —configuración, readiness o construcción del transporte— deja el handler desinstalado y produce un informe genérico sin mensajes ni valores. */
export async function installControlledRuntime(env: Record<string, string | undefined>, ports: RuntimePorts, options: { probeTimeoutMs?: number } = {}): Promise<Readiness> {
  installPriceSmartHandler(null);
  try {
    const { config, ...report } = await evaluateReadiness(env, ports, options);
    if (!report.ready || !config) return report;
    const transport = createIsolatedHttpTransport({ evidence: ports.evidence, security: ports.security, repository: ports.repository }, config.policy, config.limits, ports.extensions ?? {});
    installPriceSmartHandler(withRuntimeControls(transport, config.mode, ports.killSwitch as () => boolean | Promise<boolean>));
    return report;
  } catch {
    installPriceSmartHandler(null);
    return { ready: false, mode: 'DISABLED', blockers: [{ code: 'INSTALL_FAILED', detail: 'la construcción del runtime falló; se mantiene cerrado' }] };
  }
}
