import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePriceSmart } from './runtime';
import { installPriceSmartHandler, isPriceSmartHandlerInstalled } from './runtime-state';
import { ENABLE_ACK } from './runtime-config';
import { SANDBOX_DB_USER_PATTERN, buildReadinessDiagnostic, readinessDiagnostic } from './readiness-diagnostic';

const SECRETS = ['s3cr3t-club', 'schema_privado_x', 'usuario_privado_x', 'token-abc-123'];
const full = (over: Record<string, string> = {}): Record<string, string> => ({
  PRICESMART_RUNTIME_MODE: 'ENABLED', PRICESMART_RUNTIME_ACK: ENABLE_ACK, PRICESMART_RUNTIME_ENVIRONMENT: 'sandbox', PRICESMART_ORIGIN_CLUB: 's3cr3t-club',
  PRICESMART_DB_SCHEMA: 'schema_privado_x', PRICESMART_DB_RUNTIME_USER: 'usuario_privado_x', PRICESMART_RATIFIED_DECISIONS: 'D02,D06,D08,D09,D12', ...over });
const idle = { handlerInstalled: false, labActive: false };
beforeEach(() => installPriceSmartHandler(null));

describe('buildReadinessDiagnostic', () => {
  it('sin configuración: apagado, con bloqueos explícitos y sin puertos', () => {
    const r = buildReadinessDiagnostic({}, idle);
    expect(r.mode).toBe('DISABLED'); expect(r.ready).toBe(false);
    expect(r.blockers).toEqual(expect.arrayContaining(['MODE_DISABLED', 'PRODUCTION_ENVIRONMENT_NOT_MODELED', 'PORTS_NOT_WIRED']));
    expect(r.checks.filter(c => c.status === 'NOT_WIRED')).toHaveLength(7); expect(r.blockers).toContain('PRODUCTION_COMPOSITION_NOT_IMPLEMENTED');
    expect(r.decisions.every(d => !d.declaredRatified)).toBe(true);
  });
  it('nunca ratifica por su cuenta: D02/D06/D08/D09/D12 solo aparecen si el operador las declara', () => {
    expect(buildReadinessDiagnostic(full(), idle).decisions.map(d => d.declaredRatified)).toEqual([true, true, true, true, true]);
    const r = buildReadinessDiagnostic(full({ PRICESMART_RATIFIED_DECISIONS: 'D02' }), idle);
    expect(r.decisions.filter(d => d.declaredRatified).map(d => d.id)).toEqual(['D02']);
    expect(r.blockers).toContain('DECISION_PENDING');
  });
  it('una cuenta que no cumple sandbox_api02_* queda como limitación del código; una que sí, no bloquea por eso', () => {
    expect(buildReadinessDiagnostic(full(), idle).blockers).toContain('DB_USER_PATTERN_SANDBOX_ONLY');
    expect(buildReadinessDiagnostic(full({ PRICESMART_DB_RUNTIME_USER: 'sandbox_api02_x' }), idle).blockers).not.toContain('DB_USER_PATTERN_SANDBOX_ONLY');
    expect(buildReadinessDiagnostic({}, idle).checks.find(c => c.id === 'DB_RUNTIME_USER')?.status).toBe('MISSING');
  });
  it('el contrato sandbox-only se calcula del esquema real y NODE_ENV/NOVALVION_ENV=production se reporta', () => {
    expect(buildReadinessDiagnostic(full(), idle).blockers).toContain('PRODUCTION_ENVIRONMENT_NOT_MODELED');
    expect(buildReadinessDiagnostic({ ...full(), NODE_ENV: 'production' }, idle).blockers).toContain('RUNNING_IN_PRODUCTION_ENVIRONMENT');
  });
  it('configuración inválida: bloquea con nombres de variables, sin valores', () => {
    const r = buildReadinessDiagnostic(full({ PRICESMART_RATE_PER_WINDOW: '0', PRICESMART_DB_SCHEMA: 'x; DROP TABLE y' }), idle);
    expect(r.blockers).toContain('CONFIG_INVALID'); expect(JSON.stringify(r)).not.toMatch(/DROP TABLE/);
    expect(buildReadinessDiagnostic(full({ PRICESMART_RUNTIME_MODE: 'on' }), idle).mode).toBe('DISABLED');
  });
  it('nunca incluye valores de configuración: solo presencia', () => {
    const r = buildReadinessDiagnostic({ ...full(), PRICESMART_API_KEY: 'token-abc-123' }, idle);
    const text = JSON.stringify(r); for (const s of SECRETS) expect(text).not.toContain(s);
    expect(r.presentVariables.PRICESMART_ORIGIN_CLUB).toBe(true); expect(r.presentVariables.PRICESMART_TIMEOUT_MS).toBe(false);
    expect(Object.keys(r.presentVariables).every(k => /^PRICESMART_/.test(k)) && !('PRICESMART_API_KEY' in r.presentVariables)).toBe(true);
  });
  it('handler instalado + configuración aparentemente completa + laboratorio activo: sigue ready=false y ningún puerto es OK', () => {
    for (const labActive of [false, true]) {
      const r = buildReadinessDiagnostic(full({ PRICESMART_DB_RUNTIME_USER: 'sandbox_api02_x' }), { handlerInstalled: true, labActive });
      expect(r.ready).toBe(false); expect(r.handlerInstalled).toBe(true);
      expect(r.blockers).toEqual(expect.arrayContaining(['PORTS_UNVERIFIED', 'PRODUCTION_COMPOSITION_NOT_IMPLEMENTED']));
      expect(r.blockers).not.toContain('PORTS_NOT_WIRED');
      const ports = r.checks.filter(c => c.id.startsWith('PORT:')); expect(ports).toHaveLength(7);
      expect(ports.every(c => c.status === 'UNVERIFIED')).toBe(true); expect(r.checks.some(c => c.status === 'OK' && c.id.startsWith('PORT:'))).toBe(false);
      expect(r.blockers.includes('LAB_HANDLER_NOT_PRODUCTION_EVIDENCE')).toBe(labActive); expect(r.checks.some(c => c.id === 'LAB_COMPOSITION')).toBe(labActive);
    }
  });
  it('ready es false en toda combinación de modo, decisiones, handler y entorno', () => {
    for (const mode of ['DISABLED', 'READ_ONLY', 'ENABLED']) for (const handlerInstalled of [false, true]) for (const decisions of ['', 'D02,D06', 'D02,D06,D08,D09,D12'])
      expect(buildReadinessDiagnostic(full({ PRICESMART_RUNTIME_MODE: mode, PRICESMART_RATIFIED_DECISIONS: decisions, PRICESMART_DB_RUNTIME_USER: 'sandbox_api02_x' }), { handlerInstalled, labActive: handlerInstalled }).ready).toBe(false);
  });
  it('las decisiones no se ratifican artificialmente por tener un handler', () => {
    expect(buildReadinessDiagnostic({}, { handlerInstalled: true, labActive: true }).decisions.every(d => !d.declaredRatified)).toBe(true);
  });
});

describe('readinessDiagnostic (sin efectos)', () => {
  it('no instala ni retira handlers; la integración sigue en 503 DISABLED', async () => {
    const before = isPriceSmartHandlerInstalled(); const r = await readinessDiagnostic();
    expect(isPriceSmartHandlerInstalled()).toBe(before); expect(r.handlerInstalled).toBe(false);
    const res = await handlePriceSmart(new Request('https://x.test/api/integrations/pricesmart/v1/orders/A1')); expect(res.status).toBe(503); expect((await res.json()).code).toBe('DISABLED');
  });
  it('si hay un handler instalado, lo deja intacto', async () => {
    const h = async () => new Response('{}', { status: 200 }); installPriceSmartHandler(h);
    expect((await readinessDiagnostic()).handlerInstalled).toBe(true); expect(isPriceSmartHandlerInstalled()).toBe(true);
    expect((await handlePriceSmart(new Request('https://x.test/a'))).status).toBe(200);
  });
  it('un fallo de dependencias (entorno que lanza) produce un informe cerrado genérico sin filtrar el error', async () => {
    const original = process.env;
    vi.stubGlobal('process', { ...process, env: new Proxy({}, { get() { throw new Error('secreto-xyz'); } }) });
    try { const r = await readinessDiagnostic(); expect(r.ready).toBe(false); expect(r.blockers).toContain('DIAGNOSTIC_FAILED'); expect(JSON.stringify(r)).not.toContain('secreto'); }
    finally { vi.unstubAllGlobals(); expect(process.env).toBe(original); }
  });
});

describe('aislamiento', () => {
  const src = (f: string) => readFileSync(path.join(__dirname, f), 'utf8').replace(/\/\/.*$/gm, '');
  it('el módulo no usa base de datos, TMS, red ni escribe handlers', () => {
    const s = src('readiness-diagnostic.ts');
    expect(s).not.toMatch(/from\s+['"](?:mysql2|@\/lib\/(?:db|tms|auditoria)|node:(?:net|tls|http|https|fs|child_process))/);
    expect(s).not.toMatch(/\bfetch\s*\(|\.execute\(|\.query\(/);
    expect(s).not.toContain(['install', 'PriceSmartHandler'].join(''));   // el diagnóstico no instala ni retira handlers
    expect(s).not.toContain(['install', 'ControlledRuntime'].join(''));
    expect(s).not.toContain(['runtime', 'assembly'].join('-'));
  });
  it('el patrón sandbox del diagnóstico coincide con el del repositorio', () => {
    expect(readFileSync(path.join(__dirname, 'mariadb-repository.ts'), 'utf8')).toContain(SANDBOX_DB_USER_PATTERN.source);
  });
});

describe('aislamiento transitivo del diagnóstico', () => {
  const srcRoot = path.resolve(__dirname, '../../..');
  const resolveSpec = (from: string, spec: string): string | null => {
    const base = spec.startsWith('@/') ? path.join(srcRoot, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
    if (!base) return null;
    for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) { try { readFileSync(c); return c; } catch { /* siguiente */ } }
    return null;
  };
  /** Cierre de importaciones (estáticas y dinámicas) a partir de un módulo, más los paquetes externos alcanzados. */
  const closure = (entry: string) => {
    const files = new Set<string>(); const external = new Set<string>(); const queue = [entry];
    while (queue.length) {
      const f = queue.pop() as string; if (files.has(f)) continue; files.add(f);
      const text = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) {
        const spec = m[1]; const resolved = resolveSpec(f, spec);
        if (resolved) queue.push(resolved); else if (!spec.startsWith('.') && !spec.startsWith('@/')) external.add(spec); else throw new Error(`no resuelto: ${spec} en ${f}`);
      }
    }
    return { files: [...files].map(f => path.relative(srcRoot, f).replaceAll('\\', '/')), external: [...external] };
  };
  it('el diagnóstico no alcanza, ni siquiera transitivamente, la composición del laboratorio, la base de datos, el TMS ni mysql2', () => {
    const { files, external } = closure(path.join(__dirname, 'readiness-diagnostic.ts'));
    expect(files).toContain('lib/integrations/pricesmart/lab-demo/gate.ts');
    for (const forbidden of ['lab-demo/composition', 'mariadb-composition', 'autoinstall', 'link-retry', 'tms-link', 'lab-crypto', 'ops-view', 'mariadb-repository', 'security-mariadb', 'http-transport', 'runtime.ts', ['runtime', 'assembly'].join('-'), 'lib/db', 'lib/tms/', 'sandbox-db'])
      expect(files.filter(f => f.includes(forbidden)), forbidden).toEqual([]);
    expect(external.filter(e => /^(mysql2|next|node:)/.test(e) || e.startsWith('node:'))).toEqual([]);
  });
  it('las condiciones del laboratorio tienen una única implementación (composition reutiliza gate)', () => {
    const composition = readFileSync(path.join(__dirname, 'lab-demo/composition.ts'), 'utf8');
    expect(composition).not.toMatch(/function labDemoGate/); expect(composition).toMatch(/from '\.\/gate'/);
    expect(readFileSync(path.join(__dirname, 'lab-demo/gate.ts'), 'utf8').match(/function labDemoGate/g)).toHaveLength(1);
  });
});
