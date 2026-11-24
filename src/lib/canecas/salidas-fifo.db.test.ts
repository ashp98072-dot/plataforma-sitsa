import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { confirmarRecepcion } from './confirmar';
import { registrarSalidaFifo, reversarSalidaFifo } from './salidas-fifo';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
describe.skipIf(!pipe)('salida FIFO y reverso en MariaDB desechable', () => {
  it('compra, recibe dos capas, consume las más antiguas y revierte exactamente', async () => {
    const pool = mysql.createPool({ socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_salida_test', multipleStatements: true });
    try {
      const schema = readFileSync('sql/schema.sql', 'utf8');
      for (const tabla of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
        const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
        if (!ddl) throw Error(`Falta ${tabla}`);
        await pool.query(ddl[0]);
      }
      await pool.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
      const migration = readFileSync('sql/migrate-2026-11-canecas-costos-wip.sql', 'utf8');
      const [ddl, triggers] = migration.split('DELIMITER //');
      await pool.query(ddl);
      for (const trigger of triggers.split('//').map(s => s.trim()).filter(s => s.startsWith('CREATE TRIGGER'))) await pool.query(trigger);
      const salidaMigration = readFileSync('sql/migrate-2026-11-canecas-salidas-fifo-wip.sql', 'utf8');
      const [salidaTables, salidaTriggerSql, salidaExtra] = salidaMigration.split('DELIMITER //');
      if (!salidaTriggerSql || salidaExtra || !salidaTriggerSql.includes('DELIMITER ;')) throw Error('Migración FIFO de salidas incompleta');
      for (const statement of salidaTables.split(';').map(s => s.trim()).filter(Boolean)) await pool.query(statement);
      const salidaTriggers = salidaTriggerSql.split('//').map(s => s.trim()).filter(s => s.startsWith('CREATE TRIGGER'));
      if (salidaTriggers.length !== 5) throw Error('Faltan triggers de protección de salidas');
      for (const trigger of salidaTriggers) await pool.query(trigger);
      await pool.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a');
        INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'test','hash','salt');
        INSERT INTO empleados (id,empresa_id,codigo,nombre) VALUES (1,1,'A','Ana');
        INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (1,1,'A','A');
        INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,1,'A','Caneca','Caneca',5,'galones','caneca');
        INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega');
        INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion,precio_unitario_centavos,gastos_centavos,moneda) VALUES (1,1,1,'C1',1,2,1,'compra-1',100,0,'GTQ'),(2,1,1,'C2',1,3,1,'compra-2',200,0,'GTQ');
        INSERT INTO canecas_recepciones (id,empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,creado_por) VALUES (1,1,1,1,1,'recepcion-1',2,1),(2,1,2,1,1,'recepcion-2',3,1);`);
      await confirmarRecepcion(pool, 1, 1, 1);
      await confirmarRecepcion(pool, 1, 2, 1);
      const dato = { productoId: 1, ubicacionId: 1, cantidad: 3, documento: 'S-1', claveOperacion: '00000000-0000-4000-8000-000000000001' };
      const salida = await registrarSalidaFifo(pool, 1, 1, dato);
      expect(salida).toMatchObject({ costoCentavos: '400', moneda: 'GTQ', yaRegistrada: false });
      const [traza] = await pool.query<mysql.RowDataPacket[]>('SELECT d.cantidad,CAST(d.costo_unitario_centavos AS CHAR) costo,c.recepcion_id FROM canecas_salidas_fifo_capas d JOIN canecas_capas_costo c ON c.empresa_id=d.empresa_id AND c.id=d.capa_id WHERE d.empresa_id=1 AND d.salida_id=? ORDER BY c.creado_en,c.id', [salida.id]);
      expect(traza.map(r => [r.recepcion_id, r.cantidad, r.costo])).toEqual([[1, 2, '100'], [2, 1, '200']]);
      await expect(pool.query('UPDATE canecas_salidas_fifo SET documento=? WHERE id=?', ['Alterada', salida.id])).rejects.toThrow('CANECAS_SALIDA_INMUTABLE');
      await expect(pool.query('DELETE FROM canecas_salidas_fifo WHERE id=?', [salida.id])).rejects.toThrow('CANECAS_SALIDA_NO_ELIMINABLE');
      await expect(pool.query('UPDATE canecas_salidas_fifo_capas SET cantidad=cantidad+1 WHERE salida_id=?', [salida.id])).rejects.toThrow('CANECAS_DETALLE_SALIDA_INMUTABLE');
      await expect(pool.query('DELETE FROM canecas_salidas_fifo_capas WHERE salida_id=?', [salida.id])).rejects.toThrow('CANECAS_DETALLE_SALIDA_NO_ELIMINABLE');
      const [capas] = await pool.query<mysql.RowDataPacket[]>('SELECT cantidad_disponible FROM canecas_capas_costo ORDER BY creado_en,id');
      expect(capas.map(c => c.cantidad_disponible)).toEqual([0, 2]);
      expect((await registrarSalidaFifo(pool, 1, 1, dato)).yaRegistrada).toBe(true);
      expect(await reversarSalidaFifo(pool, 1, 1, salida.id, 'Corrección')).toEqual({ yaReversada: false });
      expect(await reversarSalidaFifo(pool, 1, 1, salida.id, 'Corrección')).toEqual({ yaReversada: true });
      const [movimientos] = await pool.query<mysql.RowDataPacket[]>("SELECT tipo,cantidad FROM canecas_movimientos WHERE tipo IN ('SALIDA','REVERSO') ORDER BY id");
      expect(movimientos.map(r => [r.tipo, r.cantidad])).toEqual([['SALIDA', -3], ['REVERSO', 3]]);
      const [final] = await pool.query<mysql.RowDataPacket[]>('SELECT cantidad_disponible FROM canecas_capas_costo ORDER BY creado_en,id');
      expect(final.map(c => c.cantidad_disponible)).toEqual([2, 3]);
      const [saldo] = await pool.query<mysql.RowDataPacket[]>('SELECT fisico FROM canecas_saldos WHERE empresa_id=1 AND producto_id=1 AND ubicacion_id=1');
      expect(saldo[0].fisico).toBe(5);
      const concurrencia = await Promise.allSettled([
        registrarSalidaFifo(pool, 1, 1, { ...dato, claveOperacion: '00000000-0000-4000-8000-000000000002' }),
        registrarSalidaFifo(pool, 1, 1, { ...dato, claveOperacion: '00000000-0000-4000-8000-000000000003' }),
      ]);
      expect(concurrencia.filter(x => x.status === 'fulfilled')).toHaveLength(1);
      expect(concurrencia.filter(x => x.status === 'rejected')).toHaveLength(1);
      const [saldoFinal] = await pool.query<mysql.RowDataPacket[]>('SELECT fisico FROM canecas_saldos WHERE empresa_id=1 AND producto_id=1 AND ubicacion_id=1');
      expect(saldoFinal[0].fisico).toBe(2);
      await pool.query('UPDATE canecas_saldos SET reservado=1 WHERE empresa_id=1 AND producto_id=1 AND ubicacion_id=1');
      await expect(registrarSalidaFifo(pool, 1, 1, { ...dato, cantidad: 1, claveOperacion: '00000000-0000-4000-8000-000000000005' })).rejects.toThrow('RESERVAS_PENDIENTES');
      const [saldoReservado] = await pool.query<mysql.RowDataPacket[]>('SELECT fisico,reservado FROM canecas_saldos WHERE empresa_id=1 AND producto_id=1 AND ubicacion_id=1');
      expect(saldoReservado[0]).toMatchObject({ fisico: 2, reservado: 1 });
      await pool.query('UPDATE canecas_saldos SET reservado=0 WHERE empresa_id=1 AND producto_id=1 AND ubicacion_id=1');
      await pool.query(`INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (2,1,'B','Caneca B','Caneca',5,'galones','caneca');
        INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion) VALUES (3,1,1,'C3',2,1,1,'compra-3');
        INSERT INTO canecas_recepciones (id,empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,creado_por) VALUES (3,1,3,1,1,'recepcion-3',1,1);`);
      await confirmarRecepcion(pool, 1, 3, 1);
      await expect(registrarSalidaFifo(pool, 1, 1, { ...dato, productoId: 2, cantidad: 1, claveOperacion: '00000000-0000-4000-8000-000000000004' })).rejects.toThrow('COSTO_PENDIENTE');
      const [sinCambios] = await pool.query<mysql.RowDataPacket[]>('SELECT fisico FROM canecas_saldos WHERE empresa_id=1 AND producto_id=2 AND ubicacion_id=1');
      expect(sinCambios[0].fisico).toBe(1);
    } finally { await pool.end(); }
  }, 30000);
});
