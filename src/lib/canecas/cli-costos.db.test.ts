import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
describe.skipIf(!pipe)('CLI contra MariaDB desechable', () => {
  const db = mysql.createPool({ socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_cli_test', multipleStatements: true });
  beforeAll(async () => {
    const schema = readFileSync('sql/schema.sql', 'utf8');
    for (const tabla of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
      const def = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
      if (!def) throw Error(`Falta ${tabla}`);
      await db.query(def[0]);
    }
    await db.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
  });
  afterAll(async () => { await db.end(); });
  it('ejecuta el instalador una vez y bloquea el reintento sin cambiar el esquema', async () => {
    const env = { ...process.env, CANECAS_SQL_PIPE: pipe, CANECAS_SQL_DATABASE: 'canecas_cli_test', CANECAS_SQL_USER: 'fifo_lab', CANECAS_SQL_PASSWORD: 'fifo-lab-only' };
    const run = () => spawnSync(process.execPath, ['scripts/ci/canecas/ejecutar-costos-controlado.mjs', '--ejecutar'], { env, encoding: 'utf8', timeout: 30000 });
    const first = run();
    expect(first.stderr).toBe('');
    expect(first.status).toBe(0);
    expect(first.stdout).toContain('postcheck completos');
    const [before] = await db.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME');
    const second = run();
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain('DETENER');
    expect((await db.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME'))[0]).toEqual(before);
  });
});
