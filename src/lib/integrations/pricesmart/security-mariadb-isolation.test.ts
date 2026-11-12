import { describe, expect, it, vi } from 'vitest';
import { mariaDbSecurityPorts } from './security-mariadb';

vi.mock('../../sandbox-db', () => ({ isSandboxVerifiedPool: () => true }));

// API-13 (auditoría de #604): un fallo al restaurar el aislamiento no debe ocultar el error original ni devolver al pool una conexión con el nivel alterado.
const schema = 'sandbox_api02_x'; const user = 'sandbox_api02_x';
function ports(o: { restoreFails: boolean; insertThrows?: Error }) {
  const calls = { destroyed: 0, released: 0, rolledBack: 0, committed: 0 };
  const conn = {
    async query(sql: string) { if (/REPEATABLE READ/.test(sql) && o.restoreFails) throw new Error('fallo al restaurar'); return [[]]; },
    async execute(sql: string) {
      if (sql.includes('DATABASE()')) return [[{ db: schema, account: `${user}@127.0.0.1` }]];
      if (o.insertThrows) throw o.insertThrows;
      return [{ affectedRows: 1 }];
    },
    async beginTransaction() { /* sin efecto */ }, async commit() { calls.committed++; }, async rollback() { calls.rolledBack++; },
    destroy() { calls.destroyed++; }, release() { calls.released++; },
  };
  return { calls, p: mariaDbSecurityPorts({ getConnection: async () => conn } as never, { schema, runtimeUser: user }) };
}
const claim = (p: ReturnType<typeof ports>['p']) => p.replay.claim({ identityKey: 'k', proofId: 'p1', bindingDigest: 'a'.repeat(64), retainUntilMs: 2000, nowMs: 1000 });

describe('puertos de seguridad: restauración del aislamiento', () => {
  it('restauración correcta: confirma y devuelve la conexión al pool', async () => {
    const h = ports({ restoreFails: false }); expect(await claim(h.p)).toMatchObject({ status: 'CLAIMED' }); expect(h.calls).toMatchObject({ committed: 1, released: 1, destroyed: 0 });
  });
  it('fallo al restaurar tras un trabajo correcto: el resultado confirmado se conserva y la conexión se destruye', async () => {
    const h = ports({ restoreFails: true }); expect(await claim(h.p)).toMatchObject({ status: 'CLAIMED' }); expect(h.calls).toMatchObject({ committed: 1, released: 0, destroyed: 1 });
  });
  it('fallo al restaurar tras un trabajo fallido: se revierte, se informa el fallo del trabajo (cerrado, sin detalles) y se destruye la conexión', async () => {
    const h = ports({ restoreFails: true, insertThrows: new Error('error original con detalles internos') });
    await expect(claim(h.p)).rejects.toMatchObject({ code: 'UNAVAILABLE' }); await expect(claim(h.p)).rejects.not.toThrow(/restaurar/);
    expect(h.calls.rolledBack).toBe(2); expect(h.calls.committed).toBe(0); expect(h.calls.destroyed).toBe(2); expect(h.calls.released).toBe(0);
  });
});
