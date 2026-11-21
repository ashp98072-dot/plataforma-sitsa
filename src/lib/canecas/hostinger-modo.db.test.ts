import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ejecutarCostosControlado } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';

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
        const [state] = await conn.query<mysql.RowDataPacket[]>("SELECT @@SESSION.sql_mode modo, (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='precio_unitario_centavos') columnas");
        expect(state[0]).toMatchObject({ modo: hostMode, columnas: 0 });
        await conn.query(`SET SESSION ${variable}=1`);
      }
    } finally { conn.release(); }
  });
  it('instala con modo estricto temporal sin cambiar global ni otra sesión', async () => {
    const [before] = await db.query<mysql.RowDataPacket[]>('SELECT @@GLOBAL.sql_mode global_mode,@@SESSION.sql_mode session_mode,@@SESSION.innodb_strict_mode innodb_mode,@@SESSION.foreign_key_checks fk,@@SESSION.check_constraint_checks checks');
    expect(before[0]).toMatchObject({ global_mode: hostMode, innodb_mode: 0, fk: 1, checks: 1 });
    expect(before[0].session_mode).toContain('NO_AUTO_CREATE_USER');
    expect(before[0].session_mode).toContain('NO_ENGINE_SUBSTITUTION');
    expect(before[0].session_mode).not.toContain('STRICT_');
    const env = { ...process.env, CANECAS_SQL_HOST: '127.0.0.1', CANECAS_SQL_PORT: String(port), CANECAS_SQL_CA: process.env.CANECAS_TLS_TEST_CA, CANECAS_SQL_DATABASE: 'canecas_hostinger_test', CANECAS_SQL_USER: 'fifo_host', CANECAS_SQL_PASSWORD: 'fifo-host-only' };
    const result = spawnSync(process.execPath, ['scripts/ci/canecas/ejecutar-costos-controlado.mjs', '--ejecutar'], { env, encoding: 'utf8', timeout: 30000 });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"modoSqlEstricto":true');
    const [after] = await db.query<mysql.RowDataPacket[]>('SELECT @@GLOBAL.sql_mode global_mode,@@SESSION.sql_mode session_mode,@@SESSION.innodb_strict_mode innodb_mode,@@SESSION.foreign_key_checks fk,@@SESSION.check_constraint_checks checks');
    expect(after).toEqual(before);
  }, 30000);
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
      const rejected = { query: async (sql: string, params?: unknown) => {
        if (sql === 'SET SESSION innodb_strict_mode = 1') throw Error('fallo sintético');
        return conn.query(sql, params as never);
      } };
      await expect(ejecutarCostosControlado(rejected)).rejects.toThrow('fallo sintético');
      const [before] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='precio_unitario_centavos'");
      expect(before[0].n).toBe(0);
      const warning = { query: async (sql: string, params?: unknown) => {
        const result = await conn.query(sql, params as never);
        return sql === 'SHOW WARNINGS' ? [[{ Level: 'Warning', Code: 1, Message: 'sintética' }], []] : result;
      } };
      await expect(ejecutarCostosControlado(warning)).rejects.toThrow('DDL 1/12');
      const [after] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='precio_unitario_centavos'");
      expect(after[0].n).toBe(1);
      await expect(ejecutarCostosControlado(conn)).rejects.toThrow('preflight incompatible');
    } finally { await conn.end(); }
  }, 30000);
});
