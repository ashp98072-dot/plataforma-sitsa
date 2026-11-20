import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { ejecutarCostosControlado } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
describe.skipIf(!pipe)('recuperación de interrupción en MariaDB desechable', () => {
  const db = mysql.createPool({ socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_recovery_test', multipleStatements: true });
  const migration = readFileSync('sql/migrate-2026-11-canecas-costos-wip.sql', 'utf8');
  const diagnostic = readFileSync('sql/recuperacion-2026-11-canecas-costos-wip.sql', 'utf8');
  const [ddl, triggerSql] = migration.split('DELIMITER //');
  const triggers = triggerSql.split('//').map(s => s.trim()).filter(s => s.startsWith('CREATE TRIGGER'));
  beforeAll(async () => {
    const schema = readFileSync('sql/schema.sql', 'utf8');
    for (const tabla of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
      const def = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
      if (!def) throw Error(`Falta ${tabla}`);
      await db.query(def[0]);
    }
    await db.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
    await db.query(ddl);
    for (const trigger of triggers.slice(0, -1)) await db.query(trigger);
    await db.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a');
      INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'test','hash','salt');
      INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,1,'A','Caneca','Caneca',5,'galones','caneca');
      INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega');
      INSERT INTO canecas_valoraciones_iniciales (id,empresa_id,producto_id,ubicacion_id,cantidad,costo_unitario_centavos,moneda,documento,motivo,clave_operacion,creado_por) VALUES (1,1,1,1,2,100,'GTQ','Conteo','Inicial','00000000-0000-4000-8000-000000000001',1);
      INSERT INTO canecas_capas_costo (id,empresa_id,producto_id,ubicacion_id,valoracion_id,segmento,cantidad_inicial,cantidad_disponible,costo_unitario_centavos,moneda) VALUES (1,1,1,1,1,1,2,2,100,'GTQ');
      INSERT INTO canecas_movimientos (id,empresa_id,producto_id,ubicacion_id,tipo,cantidad,documento,usuario_id) VALUES (1,1,1,1,'AJUSTE',2,'Conteo',1);`);
  });
  afterAll(async () => { await db.end(); });
  it('repara solo el trigger ausente y conserva capas y movimientos', async () => {
    const [partial] = await db.query<mysql.RowDataPacket[][]>(diagnostic);
    expect(partial[1][0]).toMatchObject({ estado: 'DETENER_INSTALACION_PARCIAL', disparadores: 6 });
    const [layers] = await db.query('SELECT * FROM canecas_capas_costo');
    const [moves] = await db.query('SELECT * FROM canecas_movimientos');
    const conn = await db.getConnection();
    try { await expect(ejecutarCostosControlado(conn)).rejects.toThrow('DETENER: preflight incompatible'); } finally { conn.release(); }
    expect((await db.query('SELECT * FROM canecas_capas_costo'))[0]).toEqual(layers);
    expect((await db.query('SELECT * FROM canecas_movimientos'))[0]).toEqual(moves);
    expect(triggers[6]).toMatch(/^CREATE TRIGGER can_valoracion_no_borrar/);
    await db.query(triggers[6]);
    const [complete] = await db.query<mysql.RowDataPacket[][]>(diagnostic);
    expect(complete[1][0].estado).toBe('OBJETOS_PRESENTES_REVISAR_POSTCHECK_Y_DATOS');
    expect((await db.query('SELECT * FROM canecas_capas_costo'))[0]).toEqual(layers);
    expect((await db.query('SELECT * FROM canecas_movimientos'))[0]).toEqual(moves);
    await expect(db.query(triggers[6])).rejects.toThrow();
    expect((await db.query('SELECT * FROM canecas_capas_costo'))[0]).toEqual(layers);
  });
});
