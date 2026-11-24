import { readFileSync, writeFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { describe, it } from 'vitest';
import { obtenerContratoRedistribucion } from '../../../scripts/ci/canecas/contrato-redistribucion.mjs';

// Solo laboratorio: CANECAS_GENERAR_CONTRATO=redistribucion. Obtiene el contrato del estado posterior a la migración
// en una base desechable nueva con MariaDB 11.8.9. El instalador compara contra el JSON versionado.
const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
const socket = process.env.CANECAS_REDIS_TEST_SOCKET;
describe.skipIf(process.env.CANECAS_GENERAR_CONTRATO !== 'redistribucion' || (!pipe && !socket))('generar contrato de redistribución solo en laboratorio', () => {
  it('registra metadatos de la migración en la base desechable nueva', async () => {
    const db = await mysql.createConnection({ socketPath: socket ?? `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_redis_gen_test', multipleStatements: true });
    try {
      const schema = readFileSync('sql/schema.sql', 'utf8');
      for (const table of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
        const match = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
        if (!match) throw Error(`Falta ${table}`);
        await db.query(match[0]);
      }
      await db.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
      for (const archivo of ['sql/migrate-2026-11-canecas-costos-wip.sql', 'sql/migrate-2026-11-canecas-salidas-fifo-wip.sql', 'sql/migrate-2026-11-canecas-redistribucion-wip.sql']) {
        const [ddl, triggerSql] = readFileSync(archivo, 'utf8').split('DELIMITER //');
        await db.query(ddl);
        for (const trigger of (triggerSql ?? '').replace(/DELIMITER ;\s*$/, '').split('//').map(s => s.trim()).filter(s => /^CREATE (OR REPLACE )?TRIGGER /.test(s))) await db.query(trigger);
      }
      writeFileSync('scripts/ci/canecas/contrato-redistribucion-mariadb-11.8.9.json', `${JSON.stringify(await obtenerContratoRedistribucion(db), null, 2)}\n`);
    } finally { await db.end(); }
  }, 30000);
});
