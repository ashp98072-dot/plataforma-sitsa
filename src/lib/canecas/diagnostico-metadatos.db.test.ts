import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { obtenerContratoBase } from '../../../scripts/ci/canecas/contrato-base.mjs';

const pipe = process.env.CANECAS_DIAG_PIPE;
describe.skipIf(!pipe)('metadatos de MariaDB 11.8.9 de laboratorio existente', () => {
  it('compara filtros con y sin BINARY y ejecuta el diagnóstico SELECT', async () => {
    const c = await mysql.createConnection({ socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_hostinger_test', multipleStatements: true });
    try {
      const [version] = await c.query<mysql.RowDataPacket[]>('SELECT VERSION() version');
      expect(version[0].version).toMatch(/^11\.8\.9-MariaDB/);
      const names = "'empresas','usuarios','canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos'";
      for (const view of ['TABLES', 'COLUMNS', 'STATISTICS', 'KEY_COLUMN_USAGE', 'TABLE_CONSTRAINTS']) {
        const [plain] = await c.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) n FROM information_schema.${view} WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names})`);
        const [binary] = await c.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) n FROM information_schema.${view} WHERE BINARY TABLE_SCHEMA=BINARY DATABASE() AND BINARY TABLE_NAME IN (${names.split(',').map(x => 'BINARY ' + x).join(',')})`);
        expect(plain[0].n).toBeGreaterThan(0);
        expect(binary[0].n).toBe(plain[0].n);
      }
      const [diagnostic] = await c.query(readFileSync('sql/diagnostico-canecas-comparacion-solo-select.sql', 'utf8'));
      expect(Array.isArray(diagnostic)).toBe(true);
      const metadata = await obtenerContratoBase(c);
      expect((metadata as { tablas: unknown[] }).tablas).toHaveLength(8);
    } finally { await c.end(); }
  });
});

