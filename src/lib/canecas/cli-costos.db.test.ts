import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verificarClavesForaneas, verificarTriggers } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';

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
    const migration = readFileSync('sql/migrate-2026-11-canecas-costos-wip.sql', 'utf8');
    const triggers = migration.split('DELIMITER //')[1].split('//').map(s => s.trim()).filter(s => s.startsWith('CREATE TRIGGER'));
    const [post] = await db.query<mysql.RowDataPacket[][]>(readFileSync('sql/postcheck-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(() => verificarTriggers(post[8], triggers)).not.toThrow();
    expect(() => verificarClavesForaneas(post[9], migration)).not.toThrow();
    await db.query('ALTER TABLE canecas_valoraciones_iniciales DROP FOREIGN KEY fk_can_val_producto');
    await db.query('ALTER TABLE canecas_valoraciones_iniciales ADD CONSTRAINT fk_can_val_producto FOREIGN KEY (empresa_id,producto_id) REFERENCES canecas_ubicaciones(empresa_id,id)');
    const [fkAlterada] = await db.query<mysql.RowDataPacket[][]>(readFileSync('sql/postcheck-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(() => verificarClavesForaneas(fkAlterada[9], migration)).toThrow('definición incompatible');
    await db.query('DROP TRIGGER can_valoracion_no_borrar');
    await db.query('CREATE TRIGGER can_valoracion_no_borrar BEFORE DELETE ON canecas_valoraciones_iniciales FOR EACH ROW BEGIN SET @invalido=1; END');
    const [alterado] = await db.query<mysql.RowDataPacket[][]>(readFileSync('sql/postcheck-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(() => verificarTriggers(alterado[8], triggers)).toThrow('definición incompatible');
  });
});
