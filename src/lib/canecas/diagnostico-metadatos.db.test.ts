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
      const [diagnostic] = await c.query(readFileSync('sql/diagnostico-canecas-comparacion-solo-select.sql', 'utf8').replaceAll('ESQUEMA_OBJETIVO', 'canecas_hostinger_test'));
      expect(Array.isArray(diagnostic)).toBe(true);
      const metadata = await obtenerContratoBase(c);
      expect((metadata as { tablas: unknown[] }).tablas).toHaveLength(8);
    } finally { await c.end(); }
  });
  it('distingue DATABASE() information_schema y recupera el objetivo explicito', async () => {
    const c = await mysql.createConnection({ socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'information_schema', multipleStatements: true });
    try {
      const template = readFileSync('sql/diagnostico-canecas-comparacion-solo-select.sql', 'utf8');
      const [unconfigured] = await c.query<mysql.RowDataPacket[][]>(template);
      expect(unconfigured[0][0].comparacion_contexto).toBe('DETENER: sustituya el marcador');
      const sql = template.replaceAll('ESQUEMA_OBJETIVO', 'canecas_hostinger_test');
      const [result] = await c.query<mysql.RowDataPacket[][]>(sql);
      expect(result[0][0]).toMatchObject({ base_seleccionada: 'information_schema', esquema_objetivo: 'canecas_hostinger_test', comparacion_contexto: 'DISTINTOS: no usar DATABASE() como objetivo' });
      expect(result[2]).toHaveLength(8);
      expect(result[2].every(row => row.tabla_visible === row.nombre)).toBe(true);
      expect(result[3].some(row => row.fuente === 'COLUMNS' && row.TABLE_NAME === 'canecas_productos')).toBe(true);
      const [wrong] = await c.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_productos'");
      expect(wrong[0].n).toBe(0);
    } finally { await c.end(); }
  });

});

