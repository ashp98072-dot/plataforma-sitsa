import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { handlePriceSmart, installPriceSmartHandler } from './runtime';
import { ENABLE_ACK, parseRuntimeConfig } from './runtime-config';
import { evaluateReadiness, installControlledRuntime, withRuntimeControls, type RuntimePorts } from './runtime-assembly';

const baseEnv = (over: Record<string, string> = {}): Record<string, string> => ({
  PRICESMART_RUNTIME_MODE: 'ENABLED', PRICESMART_RUNTIME_ACK: ENABLE_ACK, PRICESMART_RUNTIME_ENVIRONMENT: 'sandbox', PRICESMART_ORIGIN_CLUB: 'CLUB-X',
  PRICESMART_DB_SCHEMA: 'schema_x', PRICESMART_DB_RUNTIME_USER: 'user_x', PRICESMART_RATIFIED_DECISIONS: 'D02,D06,D08,D09,D12', ...over });
const ok = async () => true;
// Puertos de prueba mínimos (estructurales): el transporte real solo valida su forma al construirse.
const ports = (over: Partial<RuntimePorts> = {}): RuntimePorts => ({
  evidence: { extract: async () => null },
  security: { verifier: { verify: async () => null }, catalog: { findByCredential: async () => [] }, revocation: { isRevoked: async () => false }, clock: { nowMs: () => Date.now() },
    counter: { consume: async () => ({ allowed: true, used: 1, resetAtMs: 1, assurance: 'DISTRIBUTED_ATOMIC' as const }) }, replay: { claim: async () => ({ status: 'CLAIMED' as const, assurance: 'DURABLE_ATOMIC' as const }) } },
  repository: { runAtomic: async () => { throw new Error('no usado'); } } as unknown as RuntimePorts['repository'],
  probes: { db: ok }, killSwitch: () => false, ...over });

beforeEach(() => installPriceSmartHandler(null));

describe('parseRuntimeConfig', () => {
  it('por defecto está apagado y es un estado válido', () => {
    for (const env of [{}, { PRICESMART_RUNTIME_MODE: '' }, { PRICESMART_RUNTIME_MODE: 'DISABLED' }]) expect(parseRuntimeConfig(env)).toEqual({ ok: false, mode: 'DISABLED', issues: [] });
  });
  it('un modo desconocido o campos inválidos/ausentes cierran sin filtrar valores', () => {
    for (const env of [baseEnv({ PRICESMART_RUNTIME_MODE: 'on' }), baseEnv({ PRICESMART_DB_SCHEMA: 'x; DROP' }), baseEnv({ PRICESMART_RUNTIME_ENVIRONMENT: 'staging' }), baseEnv({ PRICESMART_RUNTIME_ENVIRONMENT: 'Sandbox' }), baseEnv({ PRICESMART_RATE_PER_WINDOW: '0' }), baseEnv({ PRICESMART_UNKNOWN: '1' })]) {
      const r = parseRuntimeConfig(env); if (r.ok && !('PRICESMART_UNKNOWN' in env)) throw new Error('debía rechazar'); if (!r.ok) expect(JSON.stringify(r)).not.toMatch(/DROP|production|club-x/i);
    }
  });
  it('ENABLED exige la confirmación explícita', () => {
    const r = parseRuntimeConfig(baseEnv({ PRICESMART_RUNTIME_ACK: 'si' })); expect(r.ok).toBe(false);
    expect(parseRuntimeConfig(baseEnv({ PRICESMART_RUNTIME_MODE: 'READ_ONLY', PRICESMART_RUNTIME_ACK: '' })).ok).toBe(true);
  });
  it('rechaza una política antiabuso incoherente y entrega configuración congelada', () => {
    expect(parseRuntimeConfig(baseEnv({ PRICESMART_REPLAY_RETENTION_MS: '1000' })).ok).toBe(false);
    const r = parseRuntimeConfig(baseEnv()); expect(r.ok && Object.isFrozen(r.config) && Object.isFrozen(r.config.policy)).toBe(true);
  });
});

describe('evaluateReadiness', () => {
  it('sin configuración: MODE_DISABLED', async () => { const r = await evaluateReadiness({}, null); expect(r.ready).toBe(false); expect(r.blockers[0].code).toBe('MODE_DISABLED'); });
  it('completo y ratificado: listo', async () => { const r = await evaluateReadiness(baseEnv(), ports()); expect(r.blockers).toEqual([]); expect(r.ready).toBe(true); });
  it('decisiones sin ratificar bloquean (por defecto ninguna lo está)', async () => {
    const r = await evaluateReadiness(baseEnv({ PRICESMART_RATIFIED_DECISIONS: 'D02,D06' }), ports());
    expect(r.blockers.map(b => b.detail)).toEqual(['D08 no está ratificada por PriceSmart', 'D09 no está ratificada por PriceSmart', 'D12 no está ratificada por PriceSmart']);
    const none = { ...baseEnv() }; delete (none as Record<string, string | undefined>).PRICESMART_RATIFIED_DECISIONS;
    expect((await evaluateReadiness(none, ports())).blockers.filter(b => b.code === 'DECISION_PENDING')).toHaveLength(5);
    expect((await evaluateReadiness(baseEnv({ PRICESMART_RUNTIME_MODE: 'READ_ONLY', PRICESMART_RATIFIED_DECISIONS: 'D02,D06' }), ports())).ready).toBe(true);
  });
  it('NODE_ENV/NOVALVION_ENV=production bloquea: producción no está autorizada (API-22)', async () => {
    for (const e of [{ NODE_ENV: 'production' }, { NOVALVION_ENV: 'production' }]) expect((await evaluateReadiness({ ...baseEnv(), ...e }, ports())).blockers.map(b => b.code)).toContain('PRODUCTION_ENVIRONMENT_NOT_AUTHORIZED');
  });
  it('puertos ausentes, sin interruptor o sin sondas bloquean', async () => {
    const r = await evaluateReadiness(baseEnv(), { probes: {} });
    expect(r.blockers.map(b => b.detail)).toEqual(expect.arrayContaining(['evidence', 'security', 'repository', 'killSwitch', 'probes']));
  });
  it('una sonda que falla, lanza o se demora bloquea, sin exponer el error', async () => {
    const boom = async () => { throw new Error('secreto-interno-123'); };
    const r = await evaluateReadiness(baseEnv(), ports({ probes: { a: async () => false, b: boom, c: () => new Promise<boolean>(() => {}) } }), { probeTimeoutMs: 20 });
    expect(r.blockers.filter(b => b.code === 'PROBE_FAILED').map(b => b.detail)).toEqual(['a', 'b', 'c']); expect(JSON.stringify(r)).not.toContain('secreto');
  });
});

describe('installControlledRuntime y controles', () => {
  it('sin readiness no instala nada: 503 DISABLED', async () => {
    const r = await installControlledRuntime(baseEnv({ PRICESMART_RATIFIED_DECISIONS: 'D02' }), ports()); expect(r.ready).toBe(false);
    const res = await handlePriceSmart(new Request('https://x.test/api/integrations/pricesmart/v1/orders/A1')); expect(res.status).toBe(503); expect((await res.json()).code).toBe('DISABLED');
  });
  it('listo: instala; el interruptor apaga sin reinicio y su fallo cierra', async () => {
    let off: boolean | 'error' = false;
    const killSwitch = () => { if (off === 'error') throw new Error('x'); return off; };
    const r = await installControlledRuntime(baseEnv(), ports({ killSwitch })); expect(r.ready).toBe(true);
    const get = () => handlePriceSmart(new Request('https://x.test/api/integrations/pricesmart/v1/orders/A1'));
    expect((await get()).status).not.toBe(503);   // el transporte responde con su propio código (sin evidencia válida)
    expect((await get()).headers.get('X-Correlation-Id')).toBeTruthy();
    off = true; const a = await get(); expect(a.status).toBe(503); expect((await a.json()).code).toBe('DISABLED');
    off = 'error'; expect((await get()).status).toBe(503);
    off = false; expect((await get()).status).not.toBe(503);
  });
  it('READ_ONLY solo deja pasar GET', async () => {
    const calls: string[] = []; const inner = async (req: Request) => { calls.push(req.method); return new Response('{}', { status: 200 }); };
    const h = withRuntimeControls(inner, 'READ_ONLY', () => false);
    expect((await h(new Request('https://x.test/a', { method: 'GET' }))).status).toBe(200);
    const w = await h(new Request('https://x.test/a', { method: 'POST', body: '{}' })); expect(w.status).toBe(503); expect((await w.json()).code).toBe('READ_ONLY'); expect(calls).toEqual(['GET']);
  });
  it('DISABLED nunca llama al interior', async () => {
    let n = 0; const h = withRuntimeControls(async () => { n++; return new Response('{}'); }, 'DISABLED', () => false);
    expect((await h(new Request('https://x.test/a'))).status).toBe(503); expect(n).toBe(0);
  });
});

describe('reinstalación fallida (fallo cerrado)', () => {
  const previous = async () => new Response('{"anterior":true}', { status: 200 });
  const get = () => handlePriceSmart(new Request('https://x.test/api/integrations/pricesmart/v1/orders/A1'));
  const expectClosed = async () => { const r = await get(); expect(r.status).toBe(503); expect((await r.json()).code).toBe('DISABLED'); };
  it('antes de la falla el handler previo responde; tras una construcción fallida queda 503 DISABLED y sin secretos', async () => {
    installPriceSmartHandler(previous); expect((await get()).status).toBe(200);
    // Provoca la excepción en createIsolatedHttpTransport: el puerto de evidencia pasa el control de readiness pero su `extract` es un getter que lanza la 2.ª vez.
    let reads = 0;
    const evidence = { get extract() { if (++reads > 1) throw new Error('secreto-token-ABC123'); return async () => null; } } as unknown as RuntimePorts['evidence'];
    const report = await installControlledRuntime(baseEnv(), ports({ evidence }));
    expect(report.ready).toBe(false); expect(report.blockers).toEqual([{ code: 'INSTALL_FAILED', detail: expect.any(String) }]);
    expect(JSON.stringify(report)).not.toMatch(/secreto|ABC123/); await expectClosed();
  });
  it('un fallo de readiness (sonda que lanza o configuración incompleta) también retira el handler previo', async () => {
    installPriceSmartHandler(previous);
    const r = await installControlledRuntime(baseEnv({ PRICESMART_RATIFIED_DECISIONS: 'D02' }), ports()); expect(r.ready).toBe(false); await expectClosed();
    installPriceSmartHandler(previous);
    await installControlledRuntime(baseEnv(), ports({ probes: { db: async () => { throw new Error('secreto-db'); } } })); await expectClosed();
  });
  it('un entorno que lanza al leerse retira el handler y no filtra el mensaje', async () => {
    installPriceSmartHandler(previous);
    const env = new Proxy({}, { get() { throw new Error('secreto-env-XYZ'); } }) as Record<string, string | undefined>;
    const r = await installControlledRuntime(env, ports()); expect(JSON.stringify(r)).not.toMatch(/secreto|XYZ/); await expectClosed();
  });
  it('el handler previo ya no está activo mientras corren las sondas de la reinstalación', async () => {
    installPriceSmartHandler(previous); let during = 0;
    await installControlledRuntime(baseEnv(), ports({ probes: { db: async () => { during = (await get()).status; return true; } } }));
    expect(during).toBe(503);
  });
  it('una reinstalación correcta sustituye al previo y deja de usarlo', async () => {
    installPriceSmartHandler(previous);
    expect((await installControlledRuntime(baseEnv(), ports())).ready).toBe(true);
    const res = await get(); expect(await res.text()).not.toContain('anterior');
  });
});

describe('aislamiento del cableado', () => {
  it('ninguna ruta ni módulo de la aplicación invoca el ensamblaje (producción sigue cerrada)', () => {
    const root = path.resolve(__dirname, '../../..');   // src/
    const hits: string[] = [];
    const walk = (dir: string) => { for (const n of readdirSync(dir)) { const f = path.join(dir, n); if (statSync(f).isDirectory()) walk(f); else if (/\.(ts|tsx)$/.test(n) && !n.includes('.test.') && !/runtime-assembly\.ts$/.test(n) && /runtime-assembly|installControlledRuntime/.test(readFileSync(f, 'utf8'))) hits.push(path.relative(root, f)); } };
    walk(root); expect(hits).toEqual([]);
  }, 30000);
  it('el módulo de configuración no lee process.env', () => {
    expect(readFileSync(path.join(__dirname, 'runtime-config.ts'), 'utf8').replace(/\/\/.*$/gm, '')).not.toMatch(/process\.env/);
  });
});
