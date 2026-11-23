import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { ejecutarCostosControlado } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';
import { verificarContrato } from '../../../scripts/ci/canecas/contrato-costos.mjs';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
describe.skipIf(!pipe)('interrupciones DDL en MariaDB desechable', () => {
  it('bloquea reintentos y recupera prefijos preservando saldos, movimientos y capas', async () => {
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
          await db.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a');
            INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'test','hash','salt');
            INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,1,'A','Caneca','Caneca',5,'galones','caneca');
            INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega');
            INSERT INTO canecas_saldos (empresa_id,producto_id,ubicacion_id,fisico,reservado) VALUES (1,1,1,2,0);
            INSERT INTO canecas_movimientos (id,empresa_id,producto_id,ubicacion_id,tipo,cantidad,documento,usuario_id) VALUES (1,1,1,1,'AJUSTE',2,'Conteo',1);`);
          for (const statement of stages.slice(0, cut)) await db.query(statement);
          if (cut >= 4) {
            await db.query(`INSERT INTO canecas_valoraciones_iniciales (id,empresa_id,producto_id,ubicacion_id,cantidad,costo_unitario_centavos,moneda,documento,motivo,clave_operacion,creado_por) VALUES
              (1,1,1,1,1,100,'GTQ','Conteo','Inicial','00000000-0000-4000-8000-000000000001',1),
              (2,1,1,1,1,200,'GTQ','Conteo','Inicial','00000000-0000-4000-8000-000000000002',1);
              INSERT INTO canecas_capas_costo (id,empresa_id,producto_id,ubicacion_id,valoracion_id,segmento,cantidad_inicial,cantidad_disponible,costo_unitario_centavos,moneda,creado_en) VALUES
              (1,1,1,1,1,1,1,1,100,'GTQ','2026-01-01 00:00:00'),(2,1,1,1,2,1,1,1,200,'GTQ','2026-01-02 00:00:00');`);
          }
          const [movements] = await db.query('SELECT * FROM canecas_movimientos ORDER BY id');
          const [saldo] = await db.query('SELECT * FROM canecas_saldos ORDER BY empresa_id,producto_id,ubicacion_id');
          const layers = cut >= 4 ? (await db.query('SELECT * FROM canecas_capas_costo ORDER BY creado_en,id'))[0] : null;
          const [diagnosis] = await db.query<mysql.RowDataPacket[][]>(readFileSync('sql/recuperacion-2026-11-canecas-costos-wip.sql', 'utf8'));
          expect(diagnosis[1][0].estado).toBe('DETENER_INSTALACION_PARCIAL');
          const inspect = `SELECT TABLE_NAME,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME;
            SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION;
            SELECT TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
            SELECT TRIGGER_NAME,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME`;
          const [before] = await db.query(inspect);
          await expect(ejecutarCostosControlado(db)).rejects.toThrow('DETENER');
          await expect(ejecutarCostosControlado(db)).rejects.toThrow('DETENER');
          expect((await db.query(inspect))[0]).toEqual(before);
          // Recuperación supervisada en laboratorio: estado conocido y exacto,
          // ejecutar exclusivamente las sentencias aún ausentes en orden.
          for (const statement of stages.slice(cut)) await db.query(statement);
          await expect(verificarContrato(db)).resolves.toBeUndefined();
          expect((await db.query('SELECT * FROM canecas_movimientos ORDER BY id'))[0]).toEqual(movements);
          expect((await db.query('SELECT * FROM canecas_saldos ORDER BY empresa_id,producto_id,ubicacion_id'))[0]).toEqual(saldo);
          if (layers) expect((await db.query('SELECT * FROM canecas_capas_costo ORDER BY creado_en,id'))[0]).toEqual(layers);
        } finally { await db.end(); }
      }
    } finally { await root.end(); }
  }, 120000);
});
