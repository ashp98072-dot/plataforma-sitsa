import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ verified: true }));
vi.mock('../../sandbox-db', () => ({ isSandboxVerifiedPool: () => state.verified }));
import { mariaDbAttestationPorts } from './attestation-mariadb';

const LAB = { schema: 'sandbox_api02_x', runtimeUser: 'sandbox_api02_x', target: 'LAB' as const };
const PROD = { schema: 'novalvion_prod_att', runtimeUser: 'att_runtime', target: 'PRODUCTION' as const };
type Calls = { sql: string[]; destroyed: number; released: number };
function fakePool(o: { db?: string; account?: string; insertErrno?: number; rows?: unknown[]; insertMessage?: string } = {}, cfg: { schema: string; runtimeUser: string } = LAB) {
  const calls: Calls = { sql: [], destroyed: 0, released: 0 };
  const conn = {
    async execute(sql: string) {
      calls.sql.push(sql);
      if (sql.includes('DATABASE()')) return [[{ db: o.db ?? cfg.schema, account: o.account ?? `${cfg.runtimeUser}@127.0.0.1` }]];
      if (/^INSERT/i.test(sql)) { if (o.insertErrno) throw Object.assign(new Error(o.insertMessage ?? 'motor: detalle interno secreto-db-77'), { errno: o.insertErrno }); return [{ affectedRows: 1 }]; }
      return [o.rows ?? []];
    },
    destroy() { calls.destroyed++; }, release() { calls.released++; },
  };
  return { calls, pool: { getConnection: async () => conn } as never };
}
const nonce = 'a'.repeat(32);

describe('guardas de separación LAB / PRODUCTION', () => {
  it('LAB exige pool verificado de sandbox y nombres sandbox_api02_*', () => {
    state.verified = true; expect(() => mariaDbAttestationPorts(fakePool().pool, LAB)).not.toThrow();
    state.verified = false; expect(() => mariaDbAttestationPorts(fakePool().pool, LAB)).toThrow(); state.verified = true;
    expect(() => mariaDbAttestationPorts(fakePool().pool, { ...LAB, schema: 'otro_esquema' })).toThrow();
    expect(() => mariaDbAttestationPorts(fakePool().pool, { ...LAB, runtimeUser: 'otro_user' })).toThrow();
  });
  it('PRODUCTION exige un pool que NO sea de sandbox y nombres que no sean de laboratorio', () => {
    state.verified = false; expect(() => mariaDbAttestationPorts(fakePool({}, PROD).pool, PROD)).not.toThrow();
    state.verified = true; expect(() => mariaDbAttestationPorts(fakePool({}, PROD).pool, PROD)).toThrow();   // pool de laboratorio con destino producción
    state.verified = false;
    expect(() => mariaDbAttestationPorts(fakePool().pool, { ...PROD, schema: 'sandbox_api02_x' })).toThrow();
    expect(() => mariaDbAttestationPorts(fakePool().pool, { ...PROD, runtimeUser: 'sandbox_api02_x' })).toThrow();
    expect(() => mariaDbAttestationPorts(fakePool().pool, { ...PROD, schema: 'con-guion' })).toThrow();
    expect(() => mariaDbAttestationPorts(fakePool().pool, { ...PROD, target: 'OTRO' as never })).toThrow();
    state.verified = true;
  });
});

describe('almacén de nonces', () => {
  it('inserta con destino y hash (nunca el nonce en claro) y devuelve FRESH', async () => {
    state.verified = true; const { pool, calls } = fakePool(); const { nonces } = mariaDbAttestationPorts(pool, LAB);
    expect(await nonces.consume(nonce, 5000)).toBe('FRESH'); expect(calls.sql.some(s => /INSERT INTO `sandbox_api02_x`\.`ps_api18_attestation_nonces`/.test(s))).toBe(true); expect(calls.released).toBe(1);
  });
  it('clave duplicada (1062) → USED; cualquier otro fallo → error genérico sin detalles del motor', async () => {
    state.verified = true;
    expect(await mariaDbAttestationPorts(fakePool({ insertErrno: 1062 }).pool, LAB).nonces.consume(nonce, 5000)).toBe('USED');
    const e = await mariaDbAttestationPorts(fakePool({ insertErrno: 1205 }).pool, LAB).nonces.consume(nonce, 5000).catch((x: Error) => x);
    expect((e as Error).message).toBe('UNAVAILABLE'); expect(String((e as Error).stack)).not.toContain('secreto-db');
  });
  it('rechaza nonces mal formados y vencimientos inválidos antes de tocar la base', async () => {
    state.verified = true; const { pool, calls } = fakePool(); const { nonces } = mariaDbAttestationPorts(pool, LAB);
    for (const bad of ['', 'x'.repeat(32), 'A'.repeat(32), 'a'.repeat(31)]) await expect(nonces.consume(bad, 5000)).rejects.toThrow('UNAVAILABLE');
    for (const exp of [0, -1, 1.5, Number.NaN]) await expect(nonces.consume(nonce, exp)).rejects.toThrow('UNAVAILABLE');
    expect(calls.sql).toEqual([]);
  });
  it('si la sesión no es la esperada (esquema o cuenta distintos) cierra y destruye la conexión', async () => {
    state.verified = true;
    for (const o of [{ db: 'otra_db' }, { account: 'otro@127.0.0.1' }]) {
      const { pool, calls } = fakePool(o); await expect(mariaDbAttestationPorts(pool, LAB).nonces.consume(nonce, 5000)).rejects.toThrow('UNAVAILABLE');
      expect(calls.destroyed).toBe(1); expect(calls.sql.some(s => /^INSERT/i.test(s))).toBe(false);
    }
  });
});

describe('lector del registro', () => {
  it('consulta solo su propio destino: pedir el otro destino devuelve null SIN consultar', async () => {
    state.verified = true; const { pool, calls } = fakePool({ rows: [] }); const { registry } = mariaDbAttestationPorts(pool, LAB);
    expect(await registry.lookup({ target: 'PRODUCTION', port: 'counter', resourceId: 'lab-counter-iso' })).toBeNull(); expect(calls.sql).toEqual([]);
  });
  it('devuelve sujeto y estado válidos; ignora filas ambiguas o con valores fuera de catálogo; valida el identificador', async () => {
    state.verified = true; const mk = (rows: unknown[]) => mariaDbAttestationPorts(fakePool({ rows }).pool, LAB).registry;
    expect(await mk([{ subject: 'ISOLATED_COPY', status: 'ACTIVE' }]).lookup({ target: 'LAB', port: 'counter', resourceId: 'r-1' })).toEqual({ subject: 'ISOLATED_COPY', status: 'ACTIVE' });
    expect(await mk([]).lookup({ target: 'LAB', port: 'counter', resourceId: 'r-1' })).toBeNull();
    expect(await mk([{ subject: 'X', status: 'ACTIVE' }]).lookup({ target: 'LAB', port: 'counter', resourceId: 'r-1' })).toBeNull();
    expect(await mk([{ subject: 'LIVE', status: 'ACTIVE' }, { subject: 'LIVE', status: 'ACTIVE' }]).lookup({ target: 'LAB', port: 'counter', resourceId: 'r-1' })).toBeNull();
    expect(await mk([{ subject: 'LIVE', status: 'ACTIVE' }]).lookup({ target: 'LAB', port: 'counter', resourceId: "r'; DROP TABLE x" })).toBeNull();
  });
});

describe('aislamiento estático del módulo', () => {
  const src = readFileSync(path.join(__dirname, 'attestation-mariadb.ts'), 'utf8').replace(/\/\/.*$/gm, '');
  it('solo inserta y lee: nunca UPDATE, DELETE, TRUNCATE ni DDL; no lee el entorno; no instala handlers', () => {
    expect(src).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b\s/); expect(src).not.toMatch(/process\.env/); expect(src).not.toContain(['install', 'PriceSmartHandler'].join('')); expect(src).not.toMatch(/from '\.\/runtime/);
  });
});
