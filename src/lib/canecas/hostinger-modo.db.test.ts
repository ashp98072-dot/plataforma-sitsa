import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ejecutarCostosControlado, ejecutarOperacionesDDL } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
const port = Number(process.env.CANECAS_TLS_TEST_PORT);
const hostMode = 'NO_AUTO_CREATE_USER,NO_ENGINE_SUBSTITUTION';
describe.skipIf(!pipe || !port)('modo de Hostinger en laboratorio aislado', () => {
  const db = mysql.createPool({ socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_hostinger_test', multipleStatements: true });
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
  it('rechaza FK y CHECK desactivados y restaura el modo aun si falla el preflight', async () => {
    const conn = await db.getConnection();
    try {
      await conn.query('SET SESSION sql_mode = ?', [hostMode]);
      for (const variable of ['foreign_key_checks', 'check_constraint_checks']) {
        await conn.query(`SET SESSION ${variable}=0`);
        await expect(ejecutarCostosControlado(conn)).rejects.toThrow('DETENER: preflight incompatible');
        const [state] = await conn.query<mysql.RowDataPacket[]>("SELECT @@SESSION.innodb_strict_mode innodb, IS_FREE_LOCK(CONCAT('canecas-costos:', DATABASE())) libre, @@SESSION.sql_mode modo, (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='precio_unitario_centavos') columnas");
        expect(state[0]).toMatchObject({ modo: hostMode, innodb: 0, libre: 1, columnas: 0 });
        await conn.query(`SET SESSION ${variable}=1`);
      }
    } finally { conn.release(); }
  });
  it('restaura ambos modos y libera el lock tras activar InnoDB y fallar el contrato', async () => {
    const conn = await db.getConnection();
    try {
      await conn.query('SET SESSION sql_mode = ?', [hostMode]);
      await conn.query('SET SESSION innodb_strict_mode = 0');
      const observed = { activo: false };
      const proxy = { query: async (sql: string, params?: unknown) => {
        const result = await conn.query(sql, params as never);
        if (sql === 'SELECT @@SESSION.innodb_strict_mode AS activo') observed.activo = Number((result[0] as mysql.RowDataPacket[])[0].activo) === 1;
        return result;
      } };
      await expect(ejecutarCostosControlado(proxy)).rejects.toThrow('contrato real completo del esquema base pendiente');
      expect(observed.activo).toBe(true);
      const [state] = await conn.query<mysql.RowDataPacket[]>("SELECT @@SESSION.sql_mode modo, @@SESSION.innodb_strict_mode innodb, IS_FREE_LOCK(CONCAT('canecas-costos:', DATABASE())) libre");
      expect(state[0]).toMatchObject({ modo: hostMode, innodb: 0, libre: 1 });
    } finally { conn.release(); }
  });
  it('detiene antes de DDL si no se activa InnoDB estricto y detiene ante advertencia DDL', async () => {
    const conn = await mysql.createConnection({ socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_warning_test', multipleStatements: true });
    try {
      const schema = readFileSync('sql/schema.sql', 'utf8');
      for (const table of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
        const def = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
        if (!def) throw Error(`Falta ${table}`);
        await conn.query(def[0]);
      }
      await conn.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
      await conn.query('SET SESSION sql_mode = ?', [hostMode]);
      await conn.query('SET SESSION innodb_strict_mode = 0');
      const rejected = { query: async (sql: string, params?: unknown) => {
        if (sql === 'SET SESSION innodb_strict_mode = 1') throw Error('fallo sintético');
        return conn.query(sql, params as never);
      } };
      await expect(ejecutarCostosControlado(rejected)).rejects.toThrow('fallo sintético');
      const [before] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='precio_unitario_centavos'");
      expect(before[0].n).toBe(0);
      const [state] = await conn.query<mysql.RowDataPacket[]>("SELECT @@SESSION.sql_mode modo, @@SESSION.innodb_strict_mode innodb, IS_FREE_LOCK(CONCAT('canecas-costos:', DATABASE())) libre");
      expect(state[0]).toMatchObject({ modo: hostMode, innodb: 0, libre: 1 });
      const warning = { query: async (sql: string, params?: unknown) => {
        const result = await conn.query(sql, params as never);
        return sql === 'SHOW WARNINGS' ? [[{ Level: 'Warning', Code: 1, Message: 'simulada' }], []] : result;
      } };
      await expect(ejecutarOperacionesDDL(warning, ['ALTER TABLE canecas_compras ADD COLUMN prueba_sintetica INT'])).rejects.toThrow('simulada');

    } finally { await conn.end(); }
  }, 30000);
});
