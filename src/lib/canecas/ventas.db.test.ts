import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { confirmarRecepcion } from './confirmar';
import { crearCatalogo, mapearProveedorCompra } from './catalogos';
import { comprasPendientesDeMapeo, mapeosRealizados } from './historico-proveedores';
import { registrarRedistribucion } from './redistribucion';
import { historialVentas, reportePorProducto, reporteResumen } from './reportes';
import { reversarSalidaFifo } from './salidas-fifo';
import { anularVenta, registrarVenta, salidaPerteneceAVenta } from './ventas';

// Lab Windows: CANECAS_FIFO_TEST_PIPE. Lab Linux: CANECAS_REDIS_TEST_SOCKET. Crea y elimina su propia base desechable.
const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
const socket = process.env.CANECAS_REDIS_TEST_SOCKET;
const opciones = (database?: string) => ({ socketPath: socket ?? `\\\\.\\pipe\\${pipe}`, user: 'root', multipleStatements: true, ...(database ? { database } : {}) });
type Fila = mysql.RowDataPacket;
const BASE = 'canecas_ventas_test';
const leer = (archivo: string) => readFileSync(archivo, 'utf8');
const k = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const HOY = '2026-11-24';

async function aplicar(pool: mysql.Pool, archivo: string) {
  const [ddl, resto] = leer(archivo).split('DELIMITER //');
  await pool.query(ddl);
  for (const t of (resto ?? '').replace(/DELIMITER ;\s*$/, '').split('//').map(s => s.trim()).filter(s => /^CREATE (OR REPLACE )?TRIGGER /.test(s))) await pool.query(t);
}

describe.skipIf(!pipe && !socket)('ventas, anulaciones, reportes y mapeo histórico en MariaDB desechable', () => {
  it('ventas parciales con costos distintos, ajuste 20→25, anulación, concurrencia, idempotencia, aislamiento y utilidad al centavo', async () => {
    const admin = await mysql.createConnection(opciones());
    await admin.query(`DROP DATABASE IF EXISTS ${BASE}; CREATE DATABASE ${BASE}`);
    await admin.end();
    const pool = mysql.createPool({ ...opciones(BASE), connectionLimit: 12 });
    try {
      const schema = leer('sql/schema.sql');
      for (const tabla of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
        const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
        if (!ddl) throw Error(`Falta ${tabla}`);
        await pool.query(ddl[0]);
      }
      await pool.query(leer('sql/migrate-2026-11-canecas-fase1.sql'));
      for (const m of ['costos-wip', 'salidas-fifo-wip', 'redistribucion-wip', 'catalogos-wip', 'ventas-wip']) await aplicar(pool, `sql/migrate-2026-11-canecas-${m}.sql`);
      await pool.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a'),(2,'B','B','b');
        INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'ana','hash','salt'),(2,'beto','hash','salt');
        INSERT INTO empleados (id,empresa_id,codigo,nombre) VALUES (1,1,'A','Ana'),(2,2,'B','Beto');
        INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (1,1,'Proveedor anterior','PROVEEDOR ANTERIOR');
        INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega'),(2,2,'Bodega B');
        INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES
          (1,1,'P1','Aceite 5L','Caneca',5,'litros','caneca'),(2,1,'P2','Aceite ajustado','Caneca',5,'litros','caneca'),(3,1,'P3','Aceite concurrente','Caneca',5,'litros','caneca'),(4,1,'P4','Aceite sin costo','Caneca',5,'litros','caneca'),(5,2,'P5','Otra empresa','Caneca',5,'litros','caneca');`);
      const prov = await crearCatalogo(pool, 'proveedores', 1, 1, { nombre_comercial: 'Aceites SA', nit: null, telefono: null, direccion: null });
      const cli = await crearCatalogo(pool, 'clientes', 1, 1, { nombre_comercial: 'Cliente Uno', nit: null, telefono: null, direccion: null });
      const cli2 = await crearCatalogo(pool, 'clientes', 1, 1, { nombre_comercial: 'Cliente Dos', nit: null, telefono: null, direccion: null });
      const cliInactivo = await crearCatalogo(pool, 'clientes', 1, 1, { nombre_comercial: 'Cliente Inactivo', nit: null, telefono: null, direccion: null });
      await pool.query('UPDATE canecas_clientes SET activo=0 WHERE id=?', [cliInactivo]);
      const cliOtra = await crearCatalogo(pool, 'clientes', 2, 2, { nombre_comercial: 'Cliente Otra Empresa', nit: null, telefono: null, direccion: null });
      const provOtra = await crearCatalogo(pool, 'proveedores', 2, 2, { nombre_comercial: 'Aceites SA', nit: null, telefono: null, direccion: null }); // mismo nombre en otra empresa: permitido
      let sig = 0;
      const comprar = async (productoId: number, cantidad: number, precio: number | null, gastos: number | null, empresa = 1, ubicacion = 1) => {
        const i = ++sig;
        await pool.query('INSERT INTO canecas_compras (id,empresa_id,canecas_proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion,precio_unitario_centavos,gastos_centavos,moneda) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [i, empresa, empresa === 1 ? prov : provOtra, `C${i}`, productoId, cantidad, empresa, `compra-${i}`, precio, gastos, precio == null ? null : 'GTQ']);
        await pool.query('INSERT INTO canecas_recepciones (id,empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,creado_por) VALUES (?,?,?,?,?,?,?,?)', [i, empresa, i, ubicacion, empresa, `recepcion-${i}`, cantidad, empresa]);
        await confirmarRecepcion(pool, empresa, i, empresa);
        return i;
      };
      const saldo = async (p: number) => Number((await pool.query<Fila[]>('SELECT COALESCE(SUM(fisico),0) n FROM canecas_saldos WHERE producto_id=?', [p]))[0][0].n);
      const capasDisponibles = async (p: number) => (await pool.query<Fila[]>('SELECT id,cantidad_disponible FROM canecas_capas_costo WHERE producto_id=? ORDER BY id', [p]))[0].map(c => [Number(c.id), Number(c.cantidad_disponible)]);
      let n = 100;
      const vender = (productoId: number, cantidad: number, precio: string, extra: Partial<{ clienteId: number; fechaVenta: string; empresa: number; usuario: number; clave: string; documento: string }> = {}) =>
        registrarVenta(pool, extra.empresa ?? 1, extra.usuario ?? 1, { clienteId: extra.clienteId ?? cli, productoId, ubicacionId: (extra.empresa ?? 1) === 1 ? 1 : 2, fechaVenta: extra.fechaVenta ?? '2026-11-10', documento: extra.documento ?? `FAC-${n}`, cantidad, precio, claveOperacion: extra.clave ?? k(++n) }, HOY);

      // ── Varias compras con costos distintos y ventas parciales ──────────────
      await comprar(1, 10, 8000, 0);      // A: 10 × Q80.00
      await comprar(1, 10, 10000, 1000);  // B: 10 × Q100.00 + Q10.00 de gastos = Q101.00 por unidad
      const v1 = await vender(1, 8, '95.00', { fechaVenta: '2026-11-01' });
      expect(v1).toMatchObject({ total: 'Q 760.00', costo: 'Q 640.00', utilidad: 'Q 120.00', yaRegistrada: false });
      const v2 = await vender(1, 6, '120.00', { fechaVenta: '2026-11-10', clienteId: cli2 });
      // 2 unidades de A (Q80.00) + 4 de B (Q101.00) = Q160.00 + Q404.00
      expect(v2).toMatchObject({ total: 'Q 720.00', costo: 'Q 564.00', utilidad: 'Q 156.00' });
      expect(await saldo(1)).toBe(6);
      const resumen = await reporteResumen(pool, 1, { productoId: 1 }, true);
      expect(resumen).toMatchObject({ vendidas: 14, ingresos: 'Q 1,480.00', costo_ventas: 'Q 1,204.00', utilidad_bruta: 'Q 276.00', compradas: 20, recibidas: 20, existencias: 6, compras_valor: 'Q 1,810.00' });
      // Las compras del período (Q1,810.00) NO son el costo de ventas (Q1,204.00).
      expect(resumen.compras_valor).not.toBe(resumen.costo_ventas);
      // Filtros por fecha y por cliente.
      expect(await reporteResumen(pool, 1, { desde: '2026-11-05', hasta: '2026-11-30' }, true)).toMatchObject({ vendidas: 6, ingresos: 'Q 720.00', utilidad_bruta: 'Q 156.00' });
      const soloCliente = await reporteResumen(pool, 1, { clienteId: cli }, true);
      expect(soloCliente).toMatchObject({ vendidas: 8, ingresos: 'Q 760.00', utilidad_bruta: 'Q 120.00', solo_ventas: true });
      expect(soloCliente).not.toHaveProperty('compradas');
      // Sin permiso de costos no se exponen costo ni utilidad.
      const sinCostos = await reporteResumen(pool, 1, {}, false);
      expect(sinCostos).not.toHaveProperty('costo_ventas'); expect(sinCostos).not.toHaveProperty('utilidad_bruta'); expect(sinCostos).not.toHaveProperty('compras_valor');
      expect((await historialVentas(pool, 1, {}, false))[0]).not.toHaveProperty('costo_fifo');
      const porProducto = await reportePorProducto(pool, 1, {}, true);
      expect(porProducto.find(p => p.producto.startsWith('Aceite 5L'))).toMatchObject({ vendidas: 14, utilidad_bruta: 'Q 276.00' });

      // ── Venta después de un ajuste 20→25 ───────────────────────────────────
      const c3 = await comprar(2, 20, 10000, 0); // Q2,000.00
      await registrarRedistribucion(pool, 1, 1, { compraId: c3, ubicacionId: 1, cantidadResultante: 25, documento: 'Ajuste de canecas', motivo: 'Aceite extra', claveOperacion: k(1) });
      const v3 = await vender(2, 10, '100.00');
      expect(v3).toMatchObject({ total: 'Q 1,000.00', costo: 'Q 800.00', utilidad: 'Q 200.00' }); // 25 unidades a Q80.00
      expect(await saldo(2)).toBe(15);
      expect(await reporteResumen(pool, 1, { productoId: 2 }, true)).toMatchObject({ compradas: 20, extras: 5, merma: 0, vendidas: 10, existencias: 15, ingresos: 'Q 1,000.00', costo_ventas: 'Q 800.00' });

      // ── Anulación: restablece inventario y capas sin borrar historial ───────
      const antesCapas = await capasDisponibles(2);
      const salidaDeV3 = String((await pool.query<Fila[]>('SELECT salida_id FROM canecas_ventas WHERE id=?', [v3.id]))[0][0].salida_id);
      expect(await salidaPerteneceAVenta(pool, 1, salidaDeV3)).toBe(true);
      expect(await salidaPerteneceAVenta(pool, 2, salidaDeV3)).toBe(false); // otra empresa
      await expect(anularVenta(pool, 2, 2, v3.id, 'Intento de otra empresa')).rejects.toThrow('VENTA_NO_ENCONTRADA');
      expect(await anularVenta(pool, 1, 1, v3.id, 'Devolución del cliente')).toEqual({ yaAnulada: false });
      expect(await anularVenta(pool, 1, 1, v3.id, 'Devolución del cliente')).toEqual({ yaAnulada: true });
      await expect(anularVenta(pool, 1, 1, v3.id, 'Otro motivo')).rejects.toThrow('ANULACION_YA_REGISTRADA');
      expect(await saldo(2)).toBe(25);
      const despuesCapas = await capasDisponibles(2);
      expect(despuesCapas.reduce((s, c) => s + c[1], 0)).toBe(25);
      expect(antesCapas.reduce((s, c) => s + c[1], 0)).toBe(15);
      const [anulada] = await pool.query<Fila[]>('SELECT estado,anulada_por,motivo_anulacion FROM canecas_ventas WHERE id=?', [v3.id]);
      expect(anulada[0]).toEqual({ estado: 'ANULADA', anulada_por: 1, motivo_anulacion: 'Devolución del cliente' });
      expect(await reporteResumen(pool, 1, { productoId: 2 }, true)).toMatchObject({ vendidas: 0, ingresos: 'Q 0.00', costo_ventas: 'Q 0.00', utilidad_bruta: 'Q 0.00', ventas_anuladas: 1, unidades_anuladas: 10, importe_anulado: 'Q 1,000.00' });
      expect((await historialVentas(pool, 1, { productoId: 2 }, true)).map(h => [h.estado, h.anulada_por])).toEqual([['ANULADA', 'ana']]);
      // Una salida de venta no puede revertirse por separado (la venta seguiría contando ingresos).
      expect(await salidaPerteneceAVenta(pool, 1, salidaDeV3)).toBe(true);
      await expect(pool.query("UPDATE canecas_ventas SET estado='ACTIVA',anulada_por=NULL,anulada_en=NULL,motivo_anulacion=NULL WHERE id=?", [v3.id])).rejects.toThrow('CANECAS_VENTA_ANULADA_INMUTABLE');
      await expect(reversarSalidaFifo(pool, 1, 1, salidaDeV3, 'otra vez')).rejects.toThrow('REVERSO_YA_REGISTRADO'); // nunca duplica el inventario
      expect(await saldo(2)).toBe(25);
      // Tras anular se puede volver a vender esas unidades.
      expect(await vender(2, 25, '90.00')).toMatchObject({ total: 'Q 2,250.00', costo: 'Q 2,000.00', utilidad: 'Q 250.00' });

      // ── Concurrencia: no se vende más de lo disponible ────────────────────
      await comprar(3, 5, 5000, 0);
      const carrera = await Promise.allSettled([vender(3, 4, '70.00'), vender(3, 4, '70.00')]);
      expect(carrera.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(carrera.filter(r => r.status === 'rejected')).toHaveLength(1);
      expect((carrera.find(r => r.status === 'rejected') as PromiseRejectedResult).reason.message).toBe('SALDO_INSUFICIENTE');
      expect(await saldo(3)).toBe(1);
      await expect(vender(3, 2, '70.00')).rejects.toThrow('SALDO_INSUFICIENTE');
      expect(Number((await pool.query<Fila[]>('SELECT COUNT(*) n FROM canecas_ventas WHERE producto_id=3'))[0][0].n)).toBe(1); // sin ventas ni salidas a medias

      // ── Idempotencia ───────────────────────────────────────────────────────
      const clave = k(900);
      const [a, b] = await Promise.all([vender(3, 1, '75.00', { clave, documento: 'FAC-IDEM' }), vender(3, 1, '75.00', { clave, documento: 'FAC-IDEM' })]);
      expect([a.yaRegistrada, b.yaRegistrada].sort()).toEqual([false, true]);
      expect(a.id).toBe(b.id);
      expect(await saldo(3)).toBe(0);
      await expect(vender(3, 1, '75.00', { clave, documento: 'FAC-IDEM-OTRO' })).rejects.toThrow('CLAVE_REUTILIZADA');
      await expect(vender(3, 1, '76.00', { clave, documento: 'FAC-IDEM' })).rejects.toThrow('CLAVE_REUTILIZADA');

      // ── Aislamiento entre empresas, clientes inactivos y validaciones ───────
      await comprar(5, 3, 1000, 0, 2, 2);
      await expect(vender(1, 1, '95.00', { clienteId: cliOtra })).rejects.toThrow('CLIENTE_INVALIDO'); // cliente de otra empresa
      await expect(vender(5, 1, '95.00', { empresa: 2, usuario: 2, clienteId: cli })).rejects.toThrow('CLIENTE_INVALIDO');
      await expect(vender(1, 1, '95.00', { clienteId: cliInactivo })).rejects.toThrow('CLIENTE_INVALIDO');
      await expect(vender(5, 1, '95.00')).rejects.toThrow(); // producto/ubicación de otra empresa
      expect(await vender(5, 1, '30.00', { empresa: 2, usuario: 2, clienteId: cliOtra })).toMatchObject({ total: 'Q 30.00', costo: 'Q 10.00' });
      expect((await reporteResumen(pool, 2, {}, true))).toMatchObject({ vendidas: 1, ingresos: 'Q 30.00' });
      expect((await historialVentas(pool, 2, {}, true))).toHaveLength(1);
      await expect(vender(1, 1, '95.00', { fechaVenta: '2026-11-25' })).rejects.toThrow('VENTA_INVALIDA'); // fecha futura
      await expect(vender(1, 0, '95.00')).rejects.toThrow('VENTA_INVALIDA');
      await expect(vender(1, 1, '0.00')).rejects.toThrow('VENTA_INVALIDA');

      // ── Costo desconocido: no se vende ni se presenta utilidad ──────────────
      await comprar(4, 3, null, null);
      await expect(vender(4, 1, '50.00')).rejects.toThrow('COSTO_PENDIENTE');
      expect(await saldo(4)).toBe(3);
      expect(await reporteResumen(pool, 1, { productoId: 4 }, true)).toMatchObject({ vendidas: 0, existencias: 3, existencias_con_costo_pendiente: 3, compras_sin_costo: 1 });

      // ── Integridad histórica ────────────────────────────────────────────────
      await expect(pool.query('UPDATE canecas_ventas SET total_centavos=1 WHERE id=?', [v1.id])).rejects.toThrow(/CANECAS_VENTA_INMUTABLE|chk_can_venta_importes/);
      await expect(pool.query('UPDATE canecas_ventas SET cantidad=cantidad+1 WHERE id=?', [v1.id])).rejects.toThrow('CANECAS_VENTA_INMUTABLE');
      await expect(pool.query('DELETE FROM canecas_ventas WHERE id=?', [v1.id])).rejects.toThrow('CANECAS_VENTA_NO_ELIMINABLE');
      await expect(pool.query("INSERT INTO canecas_ventas (empresa_id,cliente_id,producto_id,ubicacion_id,fecha_venta,documento,cantidad,precio_unitario_centavos,total_centavos,costo_centavos,moneda,salida_id,clave_operacion,creado_por) VALUES (1,?,1,1,'2026-11-01','X',1,100,999,0,'GTQ',1,'zzzz',1)", [cli])).rejects.toThrow(/chk_can_venta_importes/);
      await expect(pool.query("INSERT INTO canecas_ventas (empresa_id,cliente_id,producto_id,ubicacion_id,fecha_venta,documento,cantidad,precio_unitario_centavos,total_centavos,costo_centavos,moneda,salida_id,clave_operacion,creado_por) VALUES (1,?,1,1,'2026-11-01','X',1,100,100,0,'USD',1,'yyyy',1)", [cli])).rejects.toThrow(/chk_can_venta_importes/);

      // ── Proveedores históricos: lectura de solo lectura, mapeo manual y bitácora ──
      await pool.query("INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion) VALUES (900,1,1,'HIST-1',1,7,1,'hist-1')");
      const pendientes = await comprasPendientesDeMapeo(pool, 1);
      expect(pendientes.map(p => [p.referencia, p.proveedor_anterior])).toEqual([['HIST-1', 'Proveedor anterior']]);
      expect(await mapeosRealizados(pool, 1)).toEqual([]);
      const comprasProvAntes = (await pool.query<Fila[]>('SELECT * FROM compras_proveedores'))[0];
      await mapearProveedorCompra(pool, 1, 1, 900, prov);
      expect(await comprasPendientesDeMapeo(pool, 1)).toEqual([]);
      const mapeos = await mapeosRealizados(pool, 1);
      expect(mapeos).toHaveLength(1);
      expect(mapeos[0]).toMatchObject({ referencia: 'HIST-1', proveedor_canecas: 'Aceites SA', proveedor_anterior_id: 1, realizado_por: 'ana' });
      expect((await pool.query<Fila[]>('SELECT proveedor_id,canecas_proveedor_id FROM canecas_compras WHERE id=900'))[0][0]).toEqual({ proveedor_id: 1, canecas_proveedor_id: prov }); // proveedor anterior intacto
      expect((await pool.query<Fila[]>('SELECT * FROM compras_proveedores'))[0]).toEqual(comprasProvAntes);
      await expect(pool.query('UPDATE canecas_compras_mapeo_proveedor SET realizado_por=2')).rejects.toThrow('CANECAS_MAPEO_INMUTABLE');
      await expect(pool.query('DELETE FROM canecas_compras_mapeo_proveedor')).rejects.toThrow('CANECAS_MAPEO_NO_ELIMINABLE');
      await expect(mapearProveedorCompra(pool, 1, 2, 900, prov)).rejects.toThrow('COMPRA_YA_MAPEADA');
    } finally { await pool.end(); const limpia = await mysql.createConnection(opciones()); try { await limpia.query(`DROP DATABASE IF EXISTS ${BASE}`); } finally { await limpia.end(); } }
  }, 180000);
});
