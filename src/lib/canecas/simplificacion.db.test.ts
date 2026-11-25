import { describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { registrarCompraConIngreso } from './compra-ingreso';
import { anularVenta, registrarVenta } from './ventas';
import { crearCatalogo } from './catalogos';
import { aplicar, crearBase, hayLaboratorio, k, prepararBaseHastaVentas, type Fila } from './lab-simplificacion';

const BASE = 'canecas_simp_flujo_test';
const n = async (pool: mysql.Pool, sql: string, p: unknown[] = []) => Number(Object.values((await pool.query<Fila[]>(sql, p as never))[0][0])[0]);

describe.skipIf(!hayLaboratorio)('simplificación (#688) en MariaDB 11.8.9 desechable', () => {
  it('compra con ingreso atómica e idempotente, FIFO por lote, venta POS, concurrencia y anulación', async () => {
    const pool = await crearBase(BASE, 24);
    try {
      await prepararBaseHastaVentas(pool, { dosEmpresas: true });
      await aplicar(pool, 'sql/migrate-2026-11-canecas-simplificacion-wip.sql');
      await pool.query(`INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega'),(2,1,'Bodega 2'),(3,2,'Bodega B')`);
      const prov = await crearCatalogo(pool, 'proveedores', 1, 1, { nombre_comercial: 'Aceites SA', nit: null, telefono: null, direccion: null });
      const provB = await crearCatalogo(pool, 'proveedores', 2, 1, { nombre_comercial: 'Aceites B', nit: null, telefono: null, direccion: null });
      const cli = await crearCatalogo(pool, 'clientes', 1, 1, { nombre_comercial: 'Cliente Uno', nit: null, telefono: null, direccion: 'Zona 1, Ciudad' });
      const comprar = (cantidad: number, precio: string, clave: number, extra: Partial<{ ubicacionId: number; empleado: number }> = {}) =>
        registrarCompraConIngreso(pool, 1, 1, { proveedorId: prov, ubicacionId: extra.ubicacionId ?? 1, recibidoPorEmpleadoId: extra.empleado ?? 1, cantidad, precio, claveOperacion: k(clave) });
      const vender = (cantidad: number, precio: string, clave: number, direccion = 'Zona 4, Ciudad') =>
        registrarVenta(pool, 1, 1, { clienteId: cli, ubicacionId: 1, direccionEntrega: direccion, cantidad, precio, claveOperacion: k(clave) });
      const fisico = () => n(pool, 'SELECT COALESCE(SUM(fisico),0) FROM canecas_saldos WHERE empresa_id=1');
      const capas = () => n(pool, 'SELECT COALESCE(SUM(cantidad_disponible),0) FROM canecas_capas_costo WHERE empresa_id=1');

      // ── Sin caneca: la primera compra la crea (una sola, código automático) ───────────────
      expect(await n(pool, 'SELECT COUNT(*) FROM canecas_productos WHERE empresa_id=1')).toBe(0);
      const a = await comprar(10, '80.00', 1);
      expect(a).toMatchObject({ referencia: 'COMP-000001', total: 'Q 800.00', yaRegistrada: false });
      expect((await pool.query<Fila[]>('SELECT codigo,nombre FROM canecas_productos WHERE empresa_id=1'))[0]).toEqual([{ codigo: 'CAN-000001', nombre: 'Caneca' }]);
      // Ingreso físico correcto en la misma operación: saldo, movimiento, recepción confirmada y capa FIFO con costo.
      expect(await fisico()).toBe(10);
      expect((await pool.query<Fila[]>('SELECT estado,cantidad,ubicacion_id,recibido_por_empleado_id FROM canecas_recepciones WHERE compra_id=?', [a.id]))[0]).toMatchObject([{ estado: 'CONFIRMADA', cantidad: 10, ubicacion_id: 1, recibido_por_empleado_id: 1 }]);
      expect(await n(pool, "SELECT COUNT(*) FROM canecas_movimientos WHERE tipo='ENTRADA' AND cantidad=10")).toBe(1);
      expect((await pool.query<Fila[]>('SELECT cantidad_inicial,cantidad_disponible,CAST(costo_unitario_centavos AS CHAR) c,moneda FROM canecas_capas_costo'))[0]).toMatchObject([{ cantidad_inicial: 10, cantidad_disponible: 10, c: '8000', moneda: 'GTQ' }]);

      // ── Idempotencia: el mismo envío no duplica existencias, compras, recepciones, movimientos ni capas ──
      const otra = await comprar(10, '80.00', 1);
      expect(otra).toMatchObject({ id: a.id, referencia: 'COMP-000001', yaRegistrada: true });
      expect({ fisico: await fisico(), compras: await n(pool, 'SELECT COUNT(*) FROM canecas_compras'), recepciones: await n(pool, 'SELECT COUNT(*) FROM canecas_recepciones'), movimientos: await n(pool, 'SELECT COUNT(*) FROM canecas_movimientos'), capas: await n(pool, 'SELECT COUNT(*) FROM canecas_capas_costo') }).toEqual({ fisico: 10, compras: 1, recepciones: 1, movimientos: 1, capas: 1 });
      // Misma clave con otros datos (incluidos bodega y receptor) se rechaza.
      for (const cambio of [{ ubicacionId: 2 }, { empleado: 2 }]) await expect(comprar(10, '80.00', 1, cambio)).rejects.toThrow('CLAVE_REUTILIZADA');
      await expect(comprar(11, '80.00', 1)).rejects.toThrow('CLAVE_REUTILIZADA');
      await expect(comprar(10, '81.00', 1)).rejects.toThrow('CLAVE_REUTILIZADA');
      expect(await fisico()).toBe(10);

      // ── Entradas inválidas y aislamiento de empresa: sin efectos ───────────────────────────
      await expect(registrarCompraConIngreso(pool, 1, 1, { proveedorId: provB, ubicacionId: 1, recibidoPorEmpleadoId: 1, cantidad: 1, precio: '1.00', claveOperacion: k(90) })).rejects.toThrow('REFERENCIA_INVALIDA');
      await expect(registrarCompraConIngreso(pool, 1, 1, { proveedorId: prov, ubicacionId: 3, recibidoPorEmpleadoId: 1, cantidad: 1, precio: '1.00', claveOperacion: k(91) })).rejects.toThrow('REFERENCIA_INVALIDA');
      await expect(registrarCompraConIngreso(pool, 1, 1, { proveedorId: prov, ubicacionId: 1, recibidoPorEmpleadoId: 3, cantidad: 1, precio: '1.00', claveOperacion: k(92) })).rejects.toThrow('REFERENCIA_INVALIDA');
      expect(await n(pool, 'SELECT COUNT(*) FROM canecas_compras')).toBe(1);

      // ── Falla intermedia: TODO se revierte (sin compra/recepción a medias) y el número no se consume ──
      await pool.query('UPDATE canecas_saldos SET fisico=2147483647 WHERE empresa_id=1');
      await expect(comprar(5, '90.00', 2)).rejects.toThrow('SALDO_EXCEDE_LIMITE');
      await pool.query('UPDATE canecas_saldos SET fisico=10 WHERE empresa_id=1');
      expect({ compras: await n(pool, 'SELECT COUNT(*) FROM canecas_compras'), recepciones: await n(pool, 'SELECT COUNT(*) FROM canecas_recepciones'), movimientos: await n(pool, 'SELECT COUNT(*) FROM canecas_movimientos') }).toEqual({ compras: 1, recepciones: 1, movimientos: 1 });
      const b = await comprar(5, '100.00', 2); // reintento de la misma operación tras corregir la causa
      expect(b).toMatchObject({ referencia: 'COMP-000002', yaRegistrada: false });

      // ── FIFO por lote: 10 × Q80 y 5 × Q100; vender 12 = 10×80 + 2×100 = Q1,000 ───────────────
      expect(await fisico()).toBe(15);
      const v1 = await vender(12, '150.00', 10);
      expect(v1).toMatchObject({ documento: 'VTA-000001', total: 'Q 1,800.00', costo: 'Q 1,000.00', utilidad: 'Q 800.00', yaRegistrada: false });
      expect((await pool.query<Fila[]>('SELECT cantidad_disponible,CAST(costo_unitario_centavos AS CHAR) c FROM canecas_capas_costo ORDER BY id'))[0]).toMatchObject([{ cantidad_disponible: 0, c: '8000' }, { cantidad_disponible: 3, c: '10000' }]);
      expect(await fisico()).toBe(3);
      // Dirección histórica: se conserva aunque cambie la del cliente; es inmutable.
      await pool.query("UPDATE canecas_clientes SET direccion='Otra dirección' WHERE id=?", [cli]);
      expect((await pool.query<Fila[]>('SELECT direccion_entrega,documento,fecha_venta FROM canecas_ventas WHERE id=?', [v1.id]))[0][0]).toMatchObject({ direccion_entrega: 'Zona 4, Ciudad', documento: 'VTA-000001' });
      await expect(pool.query("UPDATE canecas_ventas SET direccion_entrega='x' WHERE id=?", [v1.id])).rejects.toThrow('CANECAS_VENTA_INMUTABLE');
      // Reintento idempotente y clave reutilizada con otra dirección.
      expect(await vender(12, '150.00', 10)).toMatchObject({ id: v1.id, documento: 'VTA-000001', yaRegistrada: true });
      await expect(vender(12, '150.00', 10, 'Otra')).rejects.toThrow('CLAVE_REUTILIZADA');
      expect(await fisico()).toBe(3);

      // ── Anulación: restablece inventario y capas exactamente; repetirla es idempotente ────────
      expect(await anularVenta(pool, 1, 1, v1.id, 'devolución')).toEqual({ yaAnulada: false });
      expect(await fisico()).toBe(15);
      expect((await pool.query<Fila[]>('SELECT cantidad_disponible FROM canecas_capas_costo ORDER BY id'))[0].map(f => f.cantidad_disponible)).toEqual([10, 5]);
      expect(await anularVenta(pool, 1, 1, v1.id, 'devolución')).toEqual({ yaAnulada: true });
      await expect(anularVenta(pool, 1, 1, v1.id, 'otro motivo')).rejects.toThrow('ANULACION_YA_REGISTRADA');
      expect(await n(pool, "SELECT COUNT(*) FROM canecas_ventas WHERE estado='ANULADA'")).toBe(1);

      // ── Concurrencia de compras: claves distintas = números únicos y existencias exactas ─────
      const compras = await Promise.all(Array.from({ length: 8 }, (_, i) => comprar(1, '70.00', 100 + i)));
      expect(new Set(compras.map(c => c.referencia)).size).toBe(8);
      expect(await fisico()).toBe(23);
      // Misma clave en paralelo: una sola compra, mismas respuestas, sin duplicar existencias.
      const iguales = await Promise.all(Array.from({ length: 6 }, () => comprar(2, '71.00', 200)));
      expect(new Set(iguales.map(c => c.id)).size).toBe(1);
      expect(iguales.filter(c => !c.yaRegistrada)).toHaveLength(1);
      expect(await fisico()).toBe(25);
      expect(await n(pool, "SELECT COUNT(*) FROM canecas_compras WHERE clave_operacion=?", [k(200)])).toBe(1);

      // ── Concurrencia de ventas: sin sobreventa, documentos únicos y FIFO consistente ─────────
      const resultados = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => vender(3, '120.00', 300 + i)));
      const ok = resultados.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof vender>>> => r.status === 'fulfilled');
      expect(ok).toHaveLength(8); // 25 canecas / 3 = 8 ventas completas
      expect(new Set(ok.map(r => r.value.documento)).size).toBe(8);
      for (const r of resultados.filter(x => x.status === 'rejected')) expect(String((r as PromiseRejectedResult).reason.message)).toMatch(/SALDO_INSUFICIENTE|CAPAS_INSUFICIENTES/);
      expect(await fisico()).toBe(1);
      expect(await capas()).toBe(1);
      // Misma clave de venta en paralelo: una sola venta.
      const mismas = await Promise.allSettled(Array.from({ length: 5 }, () => vender(1, '120.00', 400)));
      expect(mismas.filter(r => r.status === 'fulfilled')).not.toHaveLength(0);
      expect(await n(pool, 'SELECT COUNT(*) FROM canecas_ventas WHERE clave_operacion=?', [k(400)])).toBe(1);
      expect(await fisico()).toBe(0);

      // ── Compatibilidad: el código anterior (producto, fecha y documento explícitos, sin dirección) sigue funcionando ─
      await comprar(2, '60.00', 500);
      const legado = await registrarVenta(pool, 1, 1, { clienteId: cli, productoId: Number((await pool.query<Fila[]>('SELECT id FROM canecas_productos WHERE empresa_id=1'))[0][0].id), ubicacionId: 1, fechaVenta: '2026-11-10', documento: 'FAC-LEG', cantidad: 1, precio: '95.00', claveOperacion: k(501) }, '2026-11-24');
      expect((await pool.query<Fila[]>('SELECT documento,direccion_entrega FROM canecas_ventas WHERE id=?', [legado.id]))[0][0]).toEqual({ documento: 'FAC-LEG', direccion_entrega: null });
    } finally { await pool.end(); }
  }, 240000);

  it('la base impide dos canecas activas por empresa y una creación concurrente deja exactamente una', async () => {
    const pool = await crearBase(`${BASE}_unico`, 24);
    try {
      await prepararBaseHastaVentas(pool, { dosEmpresas: true });
      await aplicar(pool, 'sql/migrate-2026-11-canecas-simplificacion-wip.sql');
      await pool.query("INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega'),(2,2,'Bodega B')");
      const prov = await crearCatalogo(pool, 'proveedores', 1, 1, { nombre_comercial: 'Aceites SA', nit: null, telefono: null, direccion: null });
      const provB = await crearCatalogo(pool, 'proveedores', 2, 1, { nombre_comercial: 'Aceites B', nit: null, telefono: null, direccion: null });
      // 12 compras simultáneas en una empresa sin caneca: todas triunfan y existe un solo producto activo.
      const res = await Promise.all(Array.from({ length: 12 }, (_, i) => registrarCompraConIngreso(pool, 1, 1, { proveedorId: prov, ubicacionId: 1, recibidoPorEmpleadoId: 1, cantidad: 1, precio: '10.00', claveOperacion: k(i + 1) })));
      expect(new Set(res.map(r => r.referencia)).size).toBe(12);
      expect(await n(pool, 'SELECT COUNT(*) FROM canecas_productos WHERE empresa_id=1 AND activo=1')).toBe(1);
      expect(await n(pool, 'SELECT fisico FROM canecas_saldos WHERE empresa_id=1')).toBe(12);
      // Otra empresa: su propia caneca y su propia numeración (aislamiento).
      const b = await registrarCompraConIngreso(pool, 2, 1, { proveedorId: provB, ubicacionId: 2, recibidoPorEmpleadoId: 3, cantidad: 4, precio: '10.00', claveOperacion: k(50) });
      expect(b.referencia).toBe('COMP-000001');
      expect(await n(pool, 'SELECT COUNT(*) FROM canecas_productos')).toBe(2);
      // El esquema lo impide aunque se intente a mano; desactivar y volver a activar respeta la regla.
      await expect(pool.query("INSERT INTO canecas_productos (empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,'X','Otra','Otra',1,'unidad','caneca')")).rejects.toThrow(/uq_can_producto_activo_unico|Duplicate/);
      await pool.query("INSERT INTO canecas_productos (empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario,activo) VALUES (1,'X','Otra','Otra',1,'unidad','caneca',0)");
      await expect(pool.query("UPDATE canecas_productos SET activo=1 WHERE codigo='X'")).rejects.toThrow(/Duplicate/);
      // Con la caneca desactivada y otra inactiva, las operaciones se detienen sin crear ni elegir una.
      await pool.query('UPDATE canecas_productos SET activo=0 WHERE empresa_id=1');
      await expect(registrarCompraConIngreso(pool, 1, 1, { proveedorId: prov, ubicacionId: 1, recibidoPorEmpleadoId: 1, cantidad: 1, precio: '10.00', claveOperacion: k(60) })).rejects.toThrow('PRODUCTO_INACTIVO');
    } finally { await pool.end(); }
  }, 240000);
});
