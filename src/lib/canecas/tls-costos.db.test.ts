import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
const port = Number(process.env.CANECAS_TLS_TEST_PORT);
describe.skipIf(!pipe || !port)('CLI TLS en MariaDB aislada por red', () => {
  const db = mysql.createPool({ socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_tls_test', multipleStatements: true });
  beforeAll(async () => {
    const schema = readFileSync('sql/schema.sql', 'utf8');
    for (const table of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
      const def = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
      if (!def) throw Error(`Falta ${table}`);
      await db.query(def[0]);
    }
    await db.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
  });
  afterAll(async () => { await db.end(); });
  it('rechaza transporte sin verificar y CA incorrecta, y acepta CA válida', async () => {
    const env = { ...process.env, CANECAS_SQL_HOST: '127.0.0.1', CANECAS_SQL_PORT: String(port), CANECAS_SQL_DATABASE: 'canecas_tls_test', CANECAS_SQL_USER: 'fifo_tls', CANECAS_SQL_PASSWORD: 'fifo-tls-only' };
    const run = (ca: string | undefined) => spawnSync(process.execPath, ['scripts/ci/canecas/ejecutar-costos-controlado.mjs', '--ejecutar'], { env: { ...env, CANECAS_SQL_CA: ca }, encoding: 'utf8', timeout: 30000 });
    expect(run(undefined).status).not.toBe(0);
    expect(run(process.env.CANECAS_TLS_TEST_WRONG_CA).status).not.toBe(0);
    await expect(mysql.createConnection({ host: '127.0.0.1', port, user: 'fifo_tls', password: 'fifo-tls-only', database: 'canecas_tls_test' })).rejects.toThrow();
    const denied = spawnSync(process.execPath, ['scripts/ci/canecas/ejecutar-costos-controlado.mjs', '--ejecutar'], { env: { ...env, CANECAS_SQL_CA: process.env.CANECAS_TLS_TEST_CA, CANECAS_SQL_USER: 'fifo_denied', CANECAS_SQL_PASSWORD: 'fifo-denied-only' }, encoding: 'utf8', timeout: 30000 });
    expect(denied.status).not.toBe(0);
    expect(denied.stderr).toContain('DETENER');
    const [before] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_capas_costo'");
    expect(before[0].n).toBe(0);
    const valid = run(process.env.CANECAS_TLS_TEST_CA);
    expect(valid.stderr).toBe('');
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain('postcheck completos');
  });
});
