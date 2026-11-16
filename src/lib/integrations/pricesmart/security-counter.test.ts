import { describe, expect, it, vi } from 'vitest';
import { mariaDbSecurityPorts } from './security-mariadb';

vi.mock('../../sandbox-db', () => ({ isSandboxVerifiedPool: () => true }));

// PRICESMART API-25 — el contador de cuota de una credencial es un punto caliente (todas las consultas de PriceSmart lo incrementan): debe ser UNA sentencia atómica en autocommit,
// sin transacción explícita ni SELECT posterior, para que el bloqueo de la fila dure solo el UPDATE. La atomicidad real con 12 conexiones la prueba el laboratorio de API-11 (API11.11).
const schema = 'sandbox_api02_x'; const user = 'sandbox_api02_x';
function build(opts: { insertId?: unknown; affectedRows?: number } = {}) {
  const sql: string[] = []; const calls = { begin: 0, commit: 0, rollback: 0, released: 0 };
  const conn = {
    async query(s: string) { sql.push(s); return [[]]; },
    async execute(s: string) {
      sql.push(s);
      if (s.includes('DATABASE()')) return [[{ db: schema, account: `${user}@127.0.0.1` }]];
      if (s.startsWith('UPDATE')) return [{ affectedRows: opts.affectedRows ?? 1, insertId: 'insertId' in opts ? opts.insertId : 3 }];
      return [{ affectedRows: 1 }];
    },
    async beginTransaction() { calls.begin++; }, async commit() { calls.commit++; }, async rollback() { calls.rollback++; }, destroy() {}, release() { calls.released++; },
  };
  return { sql, calls, p: mariaDbSecurityPorts({ getConnection: async () => conn } as never, { schema, runtimeUser: user }) };
}
const consume = (p: ReturnType<typeof build>['p'], limit = 5) => p.counter.consume({ identityKey: 'k', limit, windowMs: 60000, nowMs: 120_000 });

describe('API-25 contador atómico de una sola sentencia', () => {
  it('incrementa con `used = LAST_INSERT_ID(used + 1)` en autocommit: sin transacción explícita, sin SELECT posterior y sin cambiar el aislamiento', async () => {
    const h = build({ insertId: 3 });
    expect(await consume(h.p)).toMatchObject({ allowed: true, used: 3, resetAtMs: 180_000, assurance: 'DISTRIBUTED_ATOMIC' });
    const updates = h.sql.filter((s) => s.startsWith('UPDATE')); expect(updates).toHaveLength(1); expect(updates[0]).toContain('SET used = LAST_INSERT_ID(used + 1)');
    expect(h.sql.some((s) => /^SELECT used/i.test(s) || /ISOLATION/i.test(s))).toBe(false); expect(h.calls).toMatchObject({ begin: 0, commit: 0, rollback: 0 }); expect(h.calls.released).toBe(2);   // INSERT IGNORE + UPDATE
  });
  it('permitida ⇔ used <= límite (la solicitud que excede cuenta, pero se rechaza); toda solicitud cuenta', async () => {
    expect((await consume(build({ insertId: 5 }).p, 5)).allowed).toBe(true); expect((await consume(build({ insertId: 6 }).p, 5)).allowed).toBe(false);
  });
  it('falla cerrada: sin fila afectada o con un valor no válido (0, NaN, negativo) → UNAVAILABLE; nunca «permitida»', async () => {
    await expect(consume(build({ affectedRows: 0 }).p)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    for (const bad of [0, -1, Number.NaN, 'x', undefined, 2 ** 60]) await expect(consume(build({ insertId: bad }).p), String(bad)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
  it('rechaza parámetros inválidos antes de tocar la base de datos', async () => {
    const h = build();
    for (const bad of [{ limit: 0, windowMs: 1000, nowMs: 1 }, { limit: 1, windowMs: 0, nowMs: 1 }, { limit: 1, windowMs: 1000, nowMs: -1 }, { limit: 1.5, windowMs: 1000, nowMs: 1 }])
      await expect(h.p.counter.consume({ identityKey: 'k', ...bad })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await expect(h.p.counter.consume({ identityKey: '', limit: 1, windowMs: 1000, nowMs: 1 })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(h.sql).toEqual([]);
  });
});
