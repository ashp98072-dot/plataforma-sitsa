import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parseBody } from '../contracts';
import { labContract, labOrderSchema } from './contract';
import { createLabDemoHandler, labDemoGate, LAB_DEMO_FLAG } from './composition';
import { autoInstallLabDemo } from './autoinstall';
import { labCipher, labVerifier } from './lab-crypto';
import { createTmsLinker } from './tms-link';
import { handlePriceSmart, installPriceSmartHandler } from '../runtime';

const goodEnv = { NODE_ENV: 'development', NOVALVION_ENV: 'sandbox', PRICESMART_LAB_DEMO: LAB_DEMO_FLAG, DB_HOST: '127.0.0.1', DB_NAME: 'sandbox_api02_abc', DB_USER: 'sandbox_api02_abc', PRICESMART_LAB_KEY: 'k'.repeat(40) };
const order = (over: Record<string, unknown> = {}) => ({ schemaVersion: 'lab-demo-1', externalOrderId: 'ORD-1', originClubReference: 'QA-CLUB', recipient: { name: 'Club Ficticio' }, address: 'Calle ficticia 1', deliveryDate: '2030-01-15', ...over });
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

describe('API-12 contrato de prueba lab-demo-1 (separado del borrador api01-draft-1)', () => {
  it('acepta los datos logísticos mínimos y rechaza campos extra, fechas inexistentes y versiones ajenas', () => {
    expect(parseBody(bytes(order()), labOrderSchema).recipient.name).toBe('Club Ficticio');
    for (const bad of [order({ extra: 1 }), order({ deliveryDate: '2030-02-31' }), order({ schemaVersion: 'api01-draft-1' }), order({ recipient: {} }), order({ address: '' })]) expect(() => parseBody(bytes(bad), labOrderSchema)).toThrow('INVALID_INPUT');
  });
  it('la identidad de contenido cubre TODOS los campos (mismo id con otros datos no es la misma orden)', () => {
    const a = labContract.canonicalInput(labOrderSchema.parse(order())); const b = labContract.canonicalInput(labOrderSchema.parse(order({ address: 'Otra' })));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    expect(JSON.stringify(labContract.canonicalInput(labOrderSchema.parse(order())))).toBe(JSON.stringify(a));
  });
});

describe('API-12 la composición de laboratorio no puede activarse fuera de un laboratorio local', () => {
  it('la compuerta exige TODAS las condiciones', () => {
    expect(labDemoGate(goodEnv).ok).toBe(true);
    for (const [k, v] of [['NODE_ENV', 'production'], ['NOVALVION_ENV', 'production'], ['PRICESMART_LAB_DEMO', 'true'], ['DB_HOST', '10.0.0.5'], ['DB_NAME', 'produccion'], ['DB_USER', 'root'], ['PRICESMART_LAB_KEY', 'corta']] as const) {
      expect(labDemoGate({ ...goodEnv, [k]: v }).ok, k).toBe(false);
    }
    expect(labDemoGate({ ...goodEnv, PRICESMART_LAB_KEY: undefined }).ok).toBe(false);
  });
  it('sin las condiciones, ni se construye el manejador ni se instala, y las rutas siguen cerradas', async () => {
    expect(await createLabDemoHandler({ ...goodEnv, NODE_ENV: 'production' })).toBeNull();
    expect(await autoInstallLabDemo({ ...goodEnv, NODE_ENV: 'production' })).toBe(false);
    expect(await autoInstallLabDemo({})).toBe(false);
    installPriceSmartHandler(null);
    const res = await handlePriceSmart(new Request('http://localhost/api/integrations/pricesmart/v1/orders', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(503);
  });
  it('el verificador de laboratorio rechaza firmas ajenas y el cifrador exige una clave suficiente', async () => {
    const v = labVerifier('k'.repeat(40)); const payload = Buffer.from(JSON.stringify({ k: 'a', proof: {} })).toString('base64url');
    expect(await v.verify(new TextEncoder().encode(`${payload}.${'0'.repeat(64)}`))).toBeNull();
    expect(await v.verify(new TextEncoder().encode('basura'))).toBeNull();
    expect(() => labCipher('corta')).toThrow();
    const c = labCipher('k'.repeat(40)); const sealed = await c.seal({ schemaVersion: 'x', externalOrderId: 'a', originClubReference: 'b' } as never, 'ctx');
    expect(await c.open(sealed.ciphertext, sealed.keyReference, 'ctx')).toMatchObject({ externalOrderId: 'a' });
    await expect(c.open(sealed.ciphertext, sealed.keyReference, 'otro-contexto')).rejects.toThrow();
  });
  it('la clave y el flag de laboratorio no están escritos en el repositorio', () => {
    for (const f of ['composition.ts', 'autoinstall.ts', 'lab-crypto.ts', 'tms-link.ts']) {
      const text = readFileSync(`src/lib/integrations/pricesmart/lab-demo/${f}`, 'utf8');
      expect(text).not.toMatch(/PRICESMART_LAB_KEY\s*=\s*['"`][^'"`]{8,}/);
    }
  });
});

// ---- RELEASE_LOCK: un fallo al liberar el bloqueo no oculta errores ni sustituye el resultado
vi.mock('@/lib/tms/solicitudes-cliente', () => ({ crearSolicitudCliente: vi.fn() }));
vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn() }));
describe('API-12 liberación del bloqueo de vinculación', () => {
  const scope = { environment: 'sandbox' as const, tenantId: 1, clientId: 1, integrationId: 'pricesmart-lab' };
  function harness(opts: { release: 'ok' | 'zero' | 'throws'; work: 'unmapped' | 'throws' }) {
    const calls = { destroyed: 0, released: 0 };
    const conn = {
      async query(sql: string) {
        if (sql.includes('GET_LOCK')) return [[{ ok: 1 }]];
        if (sql.includes('RELEASE_LOCK')) { if (opts.release === 'throws') throw new Error('fallo al liberar'); return [[{ ok: opts.release === 'ok' ? 1 : 0 }]]; }
        throw new Error('consulta inesperada');
      },
      async execute() { if (opts.work === 'throws') throw new Error('fallo del trabajo'); return [[]]; },
      destroy() { calls.destroyed++; }, release() { calls.released++; },
    };
    const pool = { getConnection: async () => conn } as never;
    return { calls, linker: createTmsLinker({ pool, schema: 'sandbox_api02_x', repository: { runAtomic: async () => { throw new Error('no se usa'); } } as never }) };
  }
  it('liberación correcta: sin advertencia y la conexión vuelve al pool', async () => {
    const h = harness({ release: 'ok', work: 'unmapped' });
    expect(await h.linker.link(scope, 'A1')).toEqual({ state: 'UNMAPPED' }); expect(h.calls).toEqual({ destroyed: 0, released: 1 });
  });
  it('fallo (excepción o 0) al liberar con trabajo correcto: el resultado se conserva, se informa la advertencia y se destruye la conexión', async () => {
    for (const release of ['throws', 'zero'] as const) {
      const h = harness({ release, work: 'unmapped' });
      expect(await h.linker.link(scope, 'A1')).toEqual({ state: 'UNMAPPED', warning: 'LOCK_RELEASE_FAILED' }); expect(h.calls).toEqual({ destroyed: 1, released: 0 });
    }
  });
  it('fallo al liberar con el trabajo fallido: se propaga el error ORIGINAL del trabajo (no el de liberación)', async () => {
    for (const release of ['throws', 'zero'] as const) {
      const h = harness({ release, work: 'throws' });
      await expect(h.linker.link(scope, 'A1')).rejects.toThrow('fallo del trabajo'); expect(h.calls).toEqual({ destroyed: 1, released: 0 });
    }
  });
});
