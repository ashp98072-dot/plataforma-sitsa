import { readFileSync, writeFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { describe, it } from 'vitest';
import { obtenerContrato } from '../../../scripts/ci/canecas/contrato-costos.mjs';

describe.skipIf(process.env.CANECAS_GENERAR_CONTRATO !== '1' || !process.env.CANECAS_FIFO_TEST_PIPE)('generar contrato solo en laboratorio', () => {
  it('registra metadatos de la migración en la base desechable nueva', async () => {
    const db = await mysql.createConnection({ socketPath: `\\\\.\\pipe\\${process.env.CANECAS_FIFO_TEST_PIPE}`, user: 'root', database: 'canecas_cli_test', multipleStatements: true });
    try {
      const schema = readFileSync('sql/schema.sql', 'utf8');
      for (const table of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
        const match = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
        if (!match) throw Error(`Falta ${table}`);
        await db.query(match[0]);
      }
      await db.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
      const [ddl, triggerSql] = readFileSync('sql/migrate-2026-11-canecas-costos-wip.sql', 'utf8').split('DELIMITER //');
      await db.query(ddl);
      for (const trigger of triggerSql.split('//').map(s => s.trim()).filter(s => s.startsWith('CREATE TRIGGER'))) await db.query(trigger);
      writeFileSync('scripts/ci/canecas/contrato-costos-mariadb-11.8.9.json', `${JSON.stringify(await obtenerContrato(db), null, 2)}\n`);
    } finally { await db.end(); }
  }, 30000);
});
