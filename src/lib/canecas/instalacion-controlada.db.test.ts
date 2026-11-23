import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { obtenerContratoBase } from '../../../scripts/ci/canecas/contrato-base.mjs';
import { ejecutarCostosControlado } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
describe.skipIf(!pipe)('instalación real en MariaDB desechable', () => {
  it('compara contrato privado, instala y conserva los datos anteriores', async () => {
    const conn = await mysql.createConnection({ socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_instalacion_test', multipleStatements: true });
    const dir = mkdtempSync(path.join(os.tmpdir(), 'canecas-contrato-lab-'));
    const anterior = process.env.CANECAS_CONTRATO_VALIDADO;
    try {
      const schema = readFileSync('sql/schema.sql', 'utf8');
      for (const table of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
        const def = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
        if (!def) throw Error(`Falta ${table}`);
        await conn.query(def[0]);
      }
      await conn.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
      await conn.query("INSERT INTO empresas (id,codigo,nombre,slug) VALUES (901,'LAB901','Laboratorio','lab901')");
      const [antes] = await conn.query('SELECT id,codigo,nombre,slug FROM empresas WHERE id=901');
      const contrato = await obtenerContratoBase(conn);
      const archivo = path.join(dir, 'contrato.json');
      const incompatible = structuredClone(contrato);
      incompatible.columnas[0].COLUMN_TYPE += ' alterado';
      writeFileSync(archivo, JSON.stringify({ formato: 1, base: 'canecas_instalacion_test', contrato: incompatible }), { mode: 0o600 });
      process.env.CANECAS_CONTRATO_VALIDADO = archivo;
      await expect(ejecutarCostosControlado(conn)).rejects.toThrow('columnas');
      const [sinDdl] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='precio_unitario_centavos'");
      expect(Number(sinDdl[0].n)).toBe(0);
      writeFileSync(archivo, JSON.stringify({ formato: 1, base: 'canecas_instalacion_test', contrato }), { mode: 0o600 });
      await expect(ejecutarCostosControlado(conn)).resolves.toMatchObject({ modoSqlEstricto: true });
      expect((await conn.query('SELECT id,codigo,nombre,slug FROM empresas WHERE id=901'))[0]).toEqual(antes);
      await expect(ejecutarCostosControlado(conn)).rejects.toThrow('DETENER');
    } finally {
      if (anterior === undefined) delete process.env.CANECAS_CONTRATO_VALIDADO; else process.env.CANECAS_CONTRATO_VALIDADO = anterior;
      rmSync(dir, { recursive: true, force: true });
      await conn.end();
    }
  }, 30000);
});
