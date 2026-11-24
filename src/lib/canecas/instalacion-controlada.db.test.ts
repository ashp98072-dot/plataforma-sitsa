import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { obtenerContratoBase } from '../../../scripts/ci/canecas/contrato-base.mjs';
import { ejecutarCostosControlado } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';
import { ejecutarSalidasControlado } from '../../../scripts/ci/canecas/ejecutar-salidas-controlado.mjs';
import { verificarContratoSalidas } from '../../../scripts/ci/canecas/contrato-salidas.mjs';
import { checksEquivalentes } from '../../../scripts/ci/canecas/check-equivalente.mjs';

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
      await conn.query(`INSERT INTO usuarios (id,username,password_hash,salt) VALUES (901,'lab901','hash','salt');
        INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (901,901,'A','Caneca','Caneca',5,'galones','caneca');
        INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (901,901,'Bodega');
        INSERT INTO canecas_saldos (empresa_id,producto_id,ubicacion_id,fisico,reservado) VALUES (901,901,901,2,0);
        INSERT INTO canecas_movimientos (empresa_id,producto_id,ubicacion_id,tipo,cantidad,documento,usuario_id) VALUES (901,901,901,'AJUSTE',2,'Inicial',901)`);
      const [antes] = await conn.query('SELECT id,codigo,nombre,slug FROM empresas WHERE id=901');
      const [saldosAntes] = await conn.query('SELECT * FROM canecas_saldos WHERE empresa_id=901');
      const [movimientosAntes] = await conn.query('SELECT * FROM canecas_movimientos WHERE empresa_id=901');
      const contrato = await obtenerContratoBase(conn);
      const checks = (contrato as { checks: { TABLE_NAME: string; CONSTRAINT_NAME: string; CHECK_CLAUSE: string }[] }).checks;
      expect(checks.map(c => `${c.TABLE_NAME}.${c.CONSTRAINT_NAME}`).sort()).toEqual([
        'canecas_compras.chk_can_compra_cantidad',
        'canecas_movimientos.chk_can_movimiento_cantidad',
        'canecas_productos.chk_can_capacidad',
        'canecas_recepciones.chk_can_recepcion_cantidad',
        'canecas_recepciones.chk_can_recepcion_estado',
        'canecas_saldos.chk_can_saldo',
        'empresas.modulos_json',
      ]);
      for (const check of checks) expect(checksEquivalentes(check.CHECK_CLAUSE, ` ( ${check.CHECK_CLAUSE} ) `)).toBe(true);
      const archivo = path.join(dir, 'contrato.json');
      const incompatible = structuredClone(contrato) as { columnas: { COLUMN_TYPE: string }[] };
      incompatible.columnas[0].COLUMN_TYPE += ' alterado';
      writeFileSync(archivo, JSON.stringify({ formato: 1, base: 'canecas_instalacion_test', contrato: incompatible }), { mode: 0o600 });
      process.env.CANECAS_CONTRATO_VALIDADO = archivo;
      await expect(ejecutarCostosControlado(conn)).rejects.toThrow('columnas');
      const checkDiferente = structuredClone(contrato) as { checks: { CHECK_CLAUSE: string }[] };
      checkDiferente.checks[0].CHECK_CLAUSE = `(${checkDiferente.checks[0].CHECK_CLAUSE}) OR 1=1`;
      writeFileSync(archivo, JSON.stringify({ formato: 1, base: 'canecas_instalacion_test', contrato: checkDiferente }), { mode: 0o600 });
      await expect(ejecutarCostosControlado(conn)).rejects.toThrow('checks');
      const [sinDdl] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='precio_unitario_centavos'");
      expect(Number(sinDdl[0].n)).toBe(0);
      const equivalente = structuredClone(contrato) as { checks: { CHECK_CLAUSE: string }[] };
      equivalente.checks[0].CHECK_CLAUSE = ` ( ( ${equivalente.checks[0].CHECK_CLAUSE} ) ) `;
      writeFileSync(archivo, JSON.stringify({ formato: 1, base: 'canecas_instalacion_test', contrato: equivalente }), { mode: 0o600 });
      await expect(ejecutarCostosControlado(conn)).resolves.toMatchObject({ modoSqlEstricto: true });
      let primerDdl = false;
      const advertencia = { query: async (statement: string, params?: unknown) => {
        if (primerDdl && statement === 'SHOW WARNINGS') return [[{ Level: 'Warning', Code: 1, Message: 'simulada' }], []];
        const result = await conn.query(statement, params as never);
        if (statement.includes('CREATE TABLE canecas_salidas_fifo (')) primerDdl = true;
        return result;
      } };
      await expect(ejecutarSalidasControlado(advertencia)).rejects.toThrow('advertencias DDL');
      await expect(ejecutarSalidasControlado(conn)).rejects.toThrow('instalación parcial');
      // Recuperación del prefijo conocido únicamente en esta base desechable.
      await conn.query('DROP TABLE canecas_salidas_fifo');
      await expect(ejecutarSalidasControlado(conn)).resolves.toEqual({ instalado: true });
      await expect(verificarContratoSalidas(conn)).resolves.toBeUndefined();
      await conn.query('ALTER TABLE canecas_salidas_fifo MODIFY documento VARCHAR(240) NOT NULL');
      await expect(verificarContratoSalidas(conn)).rejects.toThrow('columnas');
      expect((await conn.query('SELECT id,codigo,nombre,slug FROM empresas WHERE id=901'))[0]).toEqual(antes);
      expect((await conn.query('SELECT * FROM canecas_saldos WHERE empresa_id=901'))[0]).toEqual(saldosAntes);
      expect((await conn.query('SELECT * FROM canecas_movimientos WHERE empresa_id=901'))[0]).toEqual(movimientosAntes);
      await expect(ejecutarSalidasControlado(conn)).rejects.toThrow('instalación parcial');
      await expect(ejecutarCostosControlado(conn)).rejects.toThrow('DETENER');
    } finally {
      if (anterior === undefined) delete process.env.CANECAS_CONTRATO_VALIDADO; else process.env.CANECAS_CONTRATO_VALIDADO = anterior;
      rmSync(dir, { recursive: true, force: true });
      await conn.end();
    }
  }, 30000);
});
