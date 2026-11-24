import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { confirmarRecepcion } from './confirmar';
import { registrarRedistribucion, reversarRedistribucion } from './redistribucion';
import { registrarSalidaFifo, reversarSalidaFifo } from './salidas-fifo';

// Lab Windows: CANECAS_FIFO_TEST_PIPE (named pipe). Lab Linux: CANECAS_REDIS_TEST_SOCKET (socket Unix).
const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
const socket = process.env.CANECAS_REDIS_TEST_SOCKET;
const k = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Fila = mysql.RowDataPacket;

async function migracion(pool: mysql.Pool, archivo: string) {
  const [ddl, resto] = readFileSync(archivo, 'utf8').split('DELIMITER //');
  await pool.query(ddl);
  if (!resto) return;
  const sentencias = resto.replace(/DELIMITER ;\s*$/, '').split('//').map(s => s.trim()).filter(s => /^(CREATE TRIGGER|DROP TRIGGER)/.test(s));
  for (const s of sentencias) await pool.query(s);
}

describe.skipIf(!pipe && !socket)('redistribución de lotes FIFO en MariaDB desechable', () => {
  it('20→25, 20→20, 20→18, costos, trazabilidad, antigüedad, reversos y conciliación', async () => {
    const pool = mysql.createPool({ socketPath: socket ?? `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_redistribucion_test', multipleStatements: true, connectionLimit: 8 });
    try {
      const schema = readFileSync('sql/schema.sql', 'utf8');
      for (const tabla of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
        const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
        if (!ddl) throw Error(`Falta ${tabla}`);
        await pool.query(ddl[0]);
      }
      await pool.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
      await migracion(pool, 'sql/migrate-2026-11-canecas-costos-wip.sql');
      await migracion(pool, 'sql/migrate-2026-11-canecas-salidas-fifo-wip.sql');
      await migracion(pool, 'sql/migrate-2026-11-canecas-redistribucion-wip.sql');
      await pool.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a'),(2,'B','B','b');
        INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'test','hash','salt');
        INSERT INTO empleados (id,empresa_id,codigo,nombre) VALUES (1,1,'A','Ana');
        INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (1,1,'A','A');
        INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega');`);

      let sig = 0;
      const producto = async () => { const id = ++sig; await pool.query("INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (?,1,?,?,'Caneca',5,'litros','caneca')", [id, `P${id}`, `Caneca ${id}`]); return id; };
      const compra = async (productoId: number, cantidad: number, precio: number | null, gastos: number | null) => {
        const id = ++sig;
        await pool.query("INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion,precio_unitario_centavos,gastos_centavos,moneda) VALUES (?,1,1,?,?,?,1,?,?,?,?)", [id, `C${id}`, productoId, cantidad, `compra-${id}`, precio, gastos, precio == null ? null : 'GTQ']);
        await pool.query("INSERT INTO canecas_recepciones (id,empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,creado_por) VALUES (?,1,?,1,1,?,?,1)", [id, id, `recepcion-${id}`, cantidad]);
        await confirmarRecepcion(pool, 1, id, 1);
        return id;
      };
      const saldo = async (p: number) => Number(((await pool.query<Fila[]>('SELECT fisico FROM canecas_saldos WHERE empresa_id=1 AND producto_id=? AND ubicacion_id=1', [p]))[0][0]).fisico);
      const capas = async (p: number) => (await pool.query<Fila[]>("SELECT id,redistribucion_id,recepcion_id,cantidad_inicial,cantidad_disponible,CAST(costo_unitario_centavos AS CHAR) costo,DATE_FORMAT(creado_en,'%Y-%m-%d') dia FROM canecas_capas_costo WHERE empresa_id=1 AND producto_id=? ORDER BY creado_en,id", [p]))[0];
      const valorDisponible = async (p: number) => String((await pool.query<Fila[]>('SELECT CAST(COALESCE(SUM(CAST(costo_unitario_centavos AS DECIMAL(38,0))*cantidad_disponible),0) AS CHAR) v FROM canecas_capas_costo WHERE empresa_id=1 AND producto_id=?', [p]))[0][0].v);
      const costoSalidas = async (p: number) => String((await pool.query<Fila[]>('SELECT CAST(COALESCE(SUM(costo_centavos),0) AS CHAR) v FROM canecas_salidas_fifo WHERE empresa_id=1 AND producto_id=? AND reversado_en IS NULL', [p]))[0][0].v);
      const base = { ubicacionId: 1, documento: 'RD-1', motivo: 'Redistribución de aceite' };

      // ── 20 → 25 ────────────────────────────────────────────────
      const p1 = await producto();
      const c1 = await compra(p1, 20, 10000, 0); // Q100.00 × 20 = Q2,000.00
      const r1 = await registrarRedistribucion(pool, 1, 1, { ...base, compraId: c1, cantidadResultante: 25, claveOperacion: k(1) });
      expect(r1).toMatchObject({ costoTotalCentavos: '200000', moneda: 'GTQ', cantidadOrigen: 20, cantidadResultante: 25, diferencia: 5, yaRegistrada: false });
      expect(await saldo(p1)).toBe(25);
      expect((await capas(p1)).map(c => [c.recepcion_id, c.redistribucion_id == null ? null : String(c.redistribucion_id), c.cantidad_inicial, c.cantidad_disponible, c.costo])).toEqual([[c1, null, 20, 0, '10000'], [null, r1.id, 25, 25, '8000']]);
      const [traza] = await pool.query<Fila[]>('SELECT cantidad,CAST(costo_unitario_centavos AS CHAR) costo FROM canecas_redistribuciones_origen WHERE empresa_id=1 AND redistribucion_id=?', [r1.id]);
      expect(traza.map(t => [t.cantidad, t.costo])).toEqual([[20, '10000']]);
      const [mov] = await pool.query<Fila[]>("SELECT tipo,cantidad,documento FROM canecas_movimientos WHERE empresa_id=1 AND producto_id=? AND tipo='REDISTRIBUCION'", [p1]);
      expect(mov.map(m => [m.tipo, m.cantidad])).toEqual([['REDISTRIBUCION', 5]]);
      expect(await valorDisponible(p1)).toBe('200000');
      // Compra no alterada: no se crearon compras ni recepciones ficticias.
      expect(Number((await pool.query<Fila[]>('SELECT COUNT(*) n FROM canecas_compras WHERE producto_id=?', [p1]))[0][0].n)).toBe(1);
      // Idempotencia y reutilización de clave.
      expect((await registrarRedistribucion(pool, 1, 1, { ...base, compraId: c1, cantidadResultante: 25, claveOperacion: k(1) })).yaRegistrada).toBe(true);
      await expect(registrarRedistribucion(pool, 1, 1, { ...base, compraId: c1, cantidadResultante: 24, claveOperacion: k(1) })).rejects.toThrow('CLAVE_REUTILIZADA');
      expect(await saldo(p1)).toBe(25);

      // Venta parcial (salida FIFO existente #678) sobre las capas redistribuidas y conciliación.
      const salida = await registrarSalidaFifo(pool, 1, 1, { productoId: p1, ubicacionId: 1, cantidad: 8, documento: 'S-1', claveOperacion: k(2) });
      expect(salida).toMatchObject({ costoCentavos: '64000', moneda: 'GTQ' });
      expect(await saldo(p1)).toBe(17);
      expect(BigInt(await valorDisponible(p1)) + BigInt(await costoSalidas(p1))).toBe(BigInt(200000));
      await expect(reversarRedistribucion(pool, 1, 1, r1.id, 'Error')).rejects.toThrow('REDISTRIBUCION_CONSUMIDA');
      await reversarSalidaFifo(pool, 1, 1, salida.id, 'Devolución');
      expect(await saldo(p1)).toBe(25);
      expect(BigInt(await valorDisponible(p1)) + BigInt(await costoSalidas(p1))).toBe(BigInt(200000));

      // Segunda redistribución sobre el lote ya redistribuido: 25 → 24 (resto de centavos).
      const r1b = await registrarRedistribucion(pool, 1, 1, { ...base, documento: 'RD-2', compraId: c1, cantidadResultante: 24, claveOperacion: k(3) });
      expect(r1b).toMatchObject({ costoTotalCentavos: '200000', cantidadOrigen: 25, diferencia: -1 });
      expect((await capas(p1)).filter(c => String(c.redistribucion_id) === r1b.id).map(c => [c.cantidad_inicial, c.costo])).toEqual([[8, '8334'], [16, '8333']]);
      await expect(reversarRedistribucion(pool, 1, 1, r1.id, 'Error')).rejects.toThrow('REDISTRIBUCION_CONSUMIDA');
      expect(await reversarRedistribucion(pool, 1, 1, r1b.id, 'Corrección 2')).toEqual({ yaReversada: false });
      expect(await reversarRedistribucion(pool, 1, 1, r1b.id, 'Corrección 2')).toEqual({ yaReversada: true });
      await expect(reversarRedistribucion(pool, 1, 1, r1b.id, 'Otro motivo')).rejects.toThrow('REVERSO_YA_REGISTRADO');
      expect(await reversarRedistribucion(pool, 1, 1, r1.id, 'Corrección 1')).toEqual({ yaReversada: false });
      expect(await saldo(p1)).toBe(20);
      expect((await capas(p1)).filter(c => c.recepcion_id != null).map(c => [c.cantidad_inicial, c.cantidad_disponible, c.costo])).toEqual([[20, 20, '10000']]);
      expect(await valorDisponible(p1)).toBe('200000');
      const [movs] = await pool.query<Fila[]>("SELECT tipo,cantidad FROM canecas_movimientos WHERE empresa_id=1 AND producto_id=? AND tipo IN ('REDISTRIBUCION','REVERSO') ORDER BY id", [p1]);
      expect(movs.map(m => [m.tipo, Number(m.cantidad)])).toEqual([['REDISTRIBUCION', 5], ['REVERSO', 8], ['REDISTRIBUCION', -1], ['REVERSO', 1], ['REVERSO', -5]]);

      // ── 20 → 20: sin movimiento de inventario ─────────────────
      const p2 = await producto();
      const c2 = await compra(p2, 20, 10000, 7); // gastos de Q0.07 → 7 unidades a 10001 y 13 a 10000
      const r2 = await registrarRedistribucion(pool, 1, 1, { ...base, documento: 'RD-3', compraId: c2, cantidadResultante: 20, claveOperacion: k(4) });
      expect(r2).toMatchObject({ costoTotalCentavos: '200007', diferencia: 0 });
      expect(await saldo(p2)).toBe(20);
      expect((await capas(p2)).filter(c => c.redistribucion_id != null).map(c => [c.cantidad_inicial, c.costo])).toEqual([[7, '10001'], [13, '10000']]);
      expect(Number((await pool.query<Fila[]>("SELECT COUNT(*) n FROM canecas_movimientos WHERE producto_id=? AND tipo='REDISTRIBUCION'", [p2]))[0][0].n)).toBe(0);
      expect(await valorDisponible(p2)).toBe('200007');
      expect(await reversarRedistribucion(pool, 1, 1, r2.id, 'Prueba')).toEqual({ yaReversada: false });
      expect(await saldo(p2)).toBe(20);
      expect(await valorDisponible(p2)).toBe('200007');

      // ── 20 → 18: merma, costo total conservado ────────────────
      const p3 = await producto();
      const c3 = await compra(p3, 20, 10000, 0);
      const r3 = await registrarRedistribucion(pool, 1, 1, { ...base, documento: 'RD-4', compraId: c3, cantidadResultante: 18, claveOperacion: k(5) });
      expect(r3).toMatchObject({ costoTotalCentavos: '200000', cantidadOrigen: 20, diferencia: -2 });
      expect(await saldo(p3)).toBe(18);
      expect((await capas(p3)).filter(c => c.redistribucion_id != null).map(c => [c.cantidad_inicial, c.costo])).toEqual([[2, '11112'], [16, '11111']]);
      expect(await valorDisponible(p3)).toBe('200000');
      const [movMerma] = await pool.query<Fila[]>("SELECT cantidad FROM canecas_movimientos WHERE producto_id=? AND tipo='REDISTRIBUCION'", [p3]);
      expect(movMerma.map(m => m.cantidad)).toEqual([-2]);
      expect(await reversarRedistribucion(pool, 1, 1, r3.id, 'Prueba')).toEqual({ yaReversada: false });
      expect(await saldo(p3)).toBe(20);
      expect(await valorDisponible(p3)).toBe('200000');

      // ── Antigüedad del lote y orden FIFO ─────────────────────
      const p4 = await producto();
      const ids = [++sig, ++sig, ++sig];
      await pool.query(`INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion,precio_unitario_centavos,gastos_centavos,moneda) VALUES
        (${ids[0]},1,1,'X',${p4},5,1,'x-1',100,0,'GTQ'),(${ids[1]},1,1,'Y',${p4},2,1,'y-1',100,0,'GTQ');
        INSERT INTO canecas_recepciones (id,empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,estado,creado_por,confirmado_por,confirmado_en) VALUES
        (${ids[0]},1,${ids[0]},1,1,'rx-1',2,'CONFIRMADA',1,1,NOW()),(${ids[1]},1,${ids[1]},1,1,'ry-1',2,'CONFIRMADA',1,1,NOW()),(${ids[2]},1,${ids[0]},1,1,'rx-2',3,'CONFIRMADA',1,1,NOW());
        INSERT INTO canecas_saldos (empresa_id,producto_id,ubicacion_id,fisico,reservado) VALUES (1,${p4},1,7,0);
        INSERT INTO canecas_capas_costo (empresa_id,producto_id,ubicacion_id,recepcion_id,segmento,cantidad_inicial,cantidad_disponible,costo_unitario_centavos,moneda,creado_en) VALUES
        (1,${p4},1,${ids[0]},0,2,2,100,'GTQ','2026-01-01 08:00:00'),(1,${p4},1,${ids[1]},0,2,2,100,'GTQ','2026-02-01 08:00:00'),(1,${p4},1,${ids[2]},0,3,3,100,'GTQ','2026-03-01 08:00:00');`);
      const r4 = await registrarRedistribucion(pool, 1, 1, { ...base, documento: 'RD-5', compraId: ids[0], cantidadResultante: 6, claveOperacion: k(6) });
      expect(r4).toMatchObject({ costoTotalCentavos: '500', cantidadOrigen: 5, diferencia: 1 });
      const nuevas = (await capas(p4)).filter(c => c.redistribucion_id != null).map(c => [c.dia, c.cantidad_inicial, c.costo]);
      expect(nuevas).toEqual([['2026-01-01', 2, '84'], ['2026-03-01', 4, '83']]);
      const orden = await registrarSalidaFifo(pool, 1, 1, { productoId: p4, ubicacionId: 1, cantidad: 3, documento: 'S-2', claveOperacion: k(7) });
      const [consumo] = await pool.query<Fila[]>("SELECT d.cantidad,c.redistribucion_id,c.recepcion_id,DATE_FORMAT(c.creado_en,'%Y-%m-%d') dia FROM canecas_salidas_fifo_capas d JOIN canecas_capas_costo c ON c.empresa_id=d.empresa_id AND c.id=d.capa_id WHERE d.empresa_id=1 AND d.salida_id=? ORDER BY c.creado_en,c.id", [orden.id]);
      expect(consumo.map(c => [c.dia, c.cantidad, c.redistribucion_id != null])).toEqual([['2026-01-01', 2, true], ['2026-02-01', 1, false]]);

      // ── Rechazos que no alteran el estado ─────────────────────
      const p5 = await producto();
      const c5 = await compra(p5, 4, 100, 0);
      const antes = JSON.stringify(await capas(p5));
      await pool.query('UPDATE canecas_saldos SET reservado=1 WHERE empresa_id=1 AND producto_id=?', [p5]);
      await expect(registrarRedistribucion(pool, 1, 1, { ...base, compraId: c5, cantidadResultante: 5, claveOperacion: k(8) })).rejects.toThrow('RESERVAS_PENDIENTES');
      await pool.query('UPDATE canecas_saldos SET reservado=0 WHERE empresa_id=1 AND producto_id=?', [p5]);
      await pool.query('UPDATE canecas_saldos SET fisico=fisico+1 WHERE empresa_id=1 AND producto_id=?', [p5]);
      await expect(registrarRedistribucion(pool, 1, 1, { ...base, compraId: c5, cantidadResultante: 5, claveOperacion: k(9) })).rejects.toThrow('CAPAS_NO_CONCILIADAS');
      await pool.query('UPDATE canecas_saldos SET fisico=fisico-1 WHERE empresa_id=1 AND producto_id=?', [p5]);
      await expect(registrarRedistribucion(pool, 1, 1, { ...base, compraId: c5, cantidadResultante: 0, claveOperacion: k(10) })).rejects.toThrow('REDISTRIBUCION_INVALIDA');
      await expect(registrarRedistribucion(pool, 1, 1, { ...base, compraId: c5, cantidadResultante: 5, claveOperacion: 'no-es-uuid' })).rejects.toThrow('REDISTRIBUCION_INVALIDA');
      await expect(registrarRedistribucion(pool, 2, 1, { ...base, compraId: c5, cantidadResultante: 5, claveOperacion: k(11) })).rejects.toThrow('COMPRA_NO_ENCONTRADA');
      const p6 = await producto();
      const c6 = await compra(p6, 3, null, null); // costo realmente desconocido (NULL), distinto de Q0
      await expect(registrarRedistribucion(pool, 1, 1, { ...base, compraId: c6, cantidadResultante: 4, claveOperacion: k(12) })).rejects.toThrow('COSTO_PENDIENTE');
      const p7 = await producto();
      const c7 = await compra(p7, 3, 0, 0); // gasto y precio cero explícitos: costo conocido Q0
      expect(await registrarRedistribucion(pool, 1, 1, { ...base, compraId: c7, cantidadResultante: 4, claveOperacion: k(13) })).toMatchObject({ costoTotalCentavos: '0', diferencia: 1 });
      expect(JSON.stringify(await capas(p5))).toBe(antes);
      expect(await saldo(p5)).toBe(4);

      // ── Inmutabilidad y restricción de fuente ─────────────────
      await expect(pool.query('UPDATE canecas_redistribuciones SET documento=? WHERE id=?', ['X', r1.id])).rejects.toThrow('CANECAS_REDISTRIBUCION_INMUTABLE');
      await expect(pool.query('DELETE FROM canecas_redistribuciones WHERE id=?', [r1.id])).rejects.toThrow('CANECAS_REDISTRIBUCION_NO_ELIMINABLE');
      await expect(pool.query('UPDATE canecas_redistribuciones_origen SET cantidad=cantidad+1 WHERE redistribucion_id=?', [r1.id])).rejects.toThrow('CANECAS_REDISTRIBUCION_ORIGEN_INMUTABLE');
      await expect(pool.query('DELETE FROM canecas_redistribuciones_origen WHERE redistribucion_id=?', [r1.id])).rejects.toThrow('CANECAS_REDISTRIBUCION_ORIGEN_NO_ELIMINABLE');
      await expect(pool.query('UPDATE canecas_redistribuciones SET motivo_reverso=? WHERE id=?', ['X', r1.id])).rejects.toThrow();
      await expect(pool.query('UPDATE canecas_capas_costo SET redistribucion_id=NULL WHERE redistribucion_id=?', [r4.id])).rejects.toThrow('Costo historico de capa inmutable');
      await expect(pool.query('UPDATE canecas_capas_costo SET costo_unitario_centavos=1 WHERE redistribucion_id=?', [r4.id])).rejects.toThrow('Costo historico de capa inmutable');
      await expect(pool.query('DELETE FROM canecas_capas_costo WHERE redistribucion_id=?', [r4.id])).rejects.toThrow('No se permite borrar capas');
      await expect(pool.query(`INSERT INTO canecas_capas_costo (empresa_id,producto_id,ubicacion_id,recepcion_id,redistribucion_id,segmento,cantidad_inicial,cantidad_disponible,costo_unitario_centavos,moneda) VALUES (1,${p5},1,${c5},${r4.id},9,1,1,1,'GTQ')`)).rejects.toThrow(/chk_can_capa_fuente/);
      await expect(pool.query(`INSERT INTO canecas_capas_costo (empresa_id,producto_id,ubicacion_id,segmento,cantidad_inicial,cantidad_disponible,costo_unitario_centavos,moneda) VALUES (1,${p5},1,9,1,1,1,'GTQ')`)).rejects.toThrow(/chk_can_capa_fuente/);

      // ── Concurrencia: dos solicitudes con la misma clave ──────
      const p8 = await producto();
      const c8 = await compra(p8, 10, 100, 0);
      const par = await Promise.all([1, 2].map(() => registrarRedistribucion(pool, 1, 1, { ...base, compraId: c8, cantidadResultante: 12, claveOperacion: k(14) })));
      expect(par.filter(x => x.yaRegistrada)).toHaveLength(1);
      expect(await saldo(p8)).toBe(12);
      expect(await valorDisponible(p8)).toBe('1000');
    } finally { await pool.end(); }
  }, 120000);
});
