import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { ejecutarCostosControlado } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
describe.skipIf(!pipe)('interrupciones DDL en MariaDB desechable', () => {
  it('bloquea reintentos después de cada sentencia ejecutada', async () => {
    const config = { socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', multipleStatements: true };
    const root = await mysql.createConnection(config);
    const schema = readFileSync('sql/schema.sql', 'utf8');
    const migration = readFileSync('sql/migrate-2026-11-canecas-costos-wip.sql', 'utf8');
    const [ddl, rest] = migration.split('DELIMITER //');
    const stages = [...ddl.split(';').map(s => s.trim()).filter(Boolean), ...rest.split('//').map(s => s.trim()).filter(s => s.startsWith('CREATE TRIGGER'))];
    expect(stages).toHaveLength(12);
    try {
      for (let cut = 1; cut < stages.length; cut++) {
        const database = `canecas_interrupcion_${cut}`;
        await root.query(`CREATE DATABASE ${database}`);
        const db = await mysql.createConnection({ ...config, database });
        try {
          for (const table of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
            const match = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
            if (!match) throw Error(`Falta ${table}`);
            await db.query(match[0]);
          }
          await db.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
          for (const statement of stages.slice(0, cut)) await db.query(statement);
          const inspect = `SELECT TABLE_NAME,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME;
            SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION;
            SELECT TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
            SELECT TRIGGER_NAME,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME`;
          const [before] = await db.query(inspect);
          await expect(ejecutarCostosControlado(db)).rejects.toThrow('DETENER');
          await expect(ejecutarCostosControlado(db)).rejects.toThrow('DETENER');
          expect((await db.query(inspect))[0]).toEqual(before);
        } finally { await db.end(); }
      }
    } finally { await root.end(); }
  }, 120000);
});
