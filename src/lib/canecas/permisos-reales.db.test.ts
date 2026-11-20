import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
describe.skipIf(!pipe)('matriz de privilegios DDL MariaDB desechable', () => {
  it('ejecuta cada sentencia directamente omitiendo un privilegio a la vez', async () => {
    const config = { socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', multipleStatements: true };
    const root = await mysql.createConnection(config);
    const schema = readFileSync('sql/schema.sql', 'utf8');
    const migration = readFileSync('sql/migrate-2026-11-canecas-costos-wip.sql', 'utf8');
    const [ddl, rest] = migration.split('DELIMITER //');
    const stages = [...ddl.split(';').map(s => s.trim()).filter(Boolean), ...rest.split('//').map(s => s.trim()).filter(s => s.startsWith('CREATE TRIGGER'))];
    const privileges = ['SELECT', 'CREATE', 'ALTER', 'INDEX', 'REFERENCES', 'TRIGGER'];
    const report: Array<{ omitido: string; aplicadas: number; error: string | null }> = [];
    try {
      for (let i = 0; i < privileges.length; i++) {
        const database = `canecas_permiso_${i}`;
        const user = `permiso_lab_${i}`;
        await root.query(`CREATE DATABASE ${database}`);
        await root.query(`CREATE USER '${user}'@'localhost' IDENTIFIED BY 'test-only-pass'`);
        await root.query(`GRANT ${privileges.filter((_, j) => j !== i).join(', ')} ON ${database}.* TO '${user}'@'localhost'`);
        const admin = await mysql.createConnection({ ...config, database });
        try {
          for (const table of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
            const match = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
            if (!match) throw Error(`Falta ${table}`);
            await admin.query(match[0]);
          }
          await admin.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
          const restricted = await mysql.createConnection({ ...config, database, user, password: 'test-only-pass' });
          let applied = 0, code: string | null = null;
          try {
            for (const stage of stages) {
              try { await restricted.query(stage); applied++; }
              catch (error) { code = (error as { code?: string }).code || 'ERROR'; break; }
            }
          } finally { await restricted.end(); }
          report.push({ omitido: privileges[i], aplicadas: applied, error: code });
        } finally { await admin.end(); }
      }
    } finally { await root.end(); }
    console.log('Matriz experimental DDL:', JSON.stringify(report));
    expect(report).toEqual([
      { omitido: 'SELECT', aplicadas: 12, error: null },
      { omitido: 'CREATE', aplicadas: 2, error: 'ER_TABLEACCESS_DENIED_ERROR' },
      { omitido: 'ALTER', aplicadas: 0, error: 'ER_TABLEACCESS_DENIED_ERROR' },
      { omitido: 'INDEX', aplicadas: 12, error: null },
      { omitido: 'REFERENCES', aplicadas: 12, error: null },
      { omitido: 'TRIGGER', aplicadas: 5, error: 'ER_TABLEACCESS_DENIED_ERROR' },
    ]);
  }, 120000);
});
