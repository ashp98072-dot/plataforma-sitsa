import { describe, expect, it } from 'vitest';
import mysql from 'mysql2/promise';
import { registrarCompraConIngreso } from './compra-ingreso';
import { registrarVenta } from './ventas';
import { crearCatalogo } from './catalogos';
import { crearBase, hayLaboratorio, instaladorEn, k, prepararBaseHastaVentas, type Fila } from './lab-simplificacion';
import { ejecutarSimplificacionControlado } from '../../../scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs';

const instalar = (pool: mysql.Pool) => instaladorEn(pool, c => ejecutarSimplificacionControlado(c));
const todo = async (pool: mysql.Pool, sql: string, p: unknown[] = []) => (await pool.query<Fila[]>(sql, p as never))[0];
const secuencias = async (pool: mysql.Pool) => Object.fromEntries((await todo(pool, 'SELECT empresa_id,tipo,ultimo FROM canecas_secuencias ORDER BY empresa_id,tipo')).map(f => [`${f.empresa_id}:${f.tipo}`, Number(f.ultimo)]));
const compra = (pool: mysql.Pool, empresa: number, prov: number, ubic: number, emp: number, clave: number) =>
  registrarCompraConIngreso(pool, empresa, 1, { proveedorId: prov, ubicacionId: ubic, recibidoPorEmpleadoId: emp, cantidad: 2, precio: '50.00', claveOperacion: k(clave) });
const rango = (prefijo: string, desde: number, hasta: number) => Array.from({ length: hasta - desde + 1 }, (_, i) => `${prefijo}-${String(desde + i).padStart(6, '0')}`);
let historica = 0;
const insertarCompraHistorica = (pool: mysql.Pool, empresa: number, referencia: string, producto: number) => pool.query(
  'INSERT INTO canecas_compras (empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion,precio_unitario_centavos,gastos_centavos,moneda) VALUES (?,?,?,?,1,1,?,10000,0,\'GTQ\')', [empresa, empresa === 1 ? 1 : empresa, referencia, producto, `hist-${++historica}`]);

describe.skipIf(!hayLaboratorio)('numeración automática frente a documentos históricos en MariaDB 11.8.9 desechable', () => {
  it('siembra por máximo histórico y empresa; no reutiliza ni renumera; soporta huecos, formatos mixtos y concurrencia', async () => {
    const pool = await crearBase('canecas_simp_num_a', 24);
    try {
      await prepararBaseHastaVentas(pool, { historial: true, dosEmpresas: true });
      // Datos históricos de las empresas 2 y 3 (una empresa sin contador aún) y cadenas heterogéneas en la empresa 1.
      await pool.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (3,'C','C','c');
        INSERT INTO empleados (id,empresa_id,codigo,nombre) VALUES (4,3,'C','Dora');
        INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (2,2,'Prov B','PROV B'),(3,3,'Prov C','PROV C');
        INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (2,2,'Bodega B'),(3,3,'Bodega C');
        INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (2,2,'Z2','Caneca','Caneca',5,'litros','caneca'),(3,3,'Z3','Caneca','Caneca',5,'litros','caneca');
        INSERT INTO canecas_productos (empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario,activo) VALUES
          (1,'CAN-000004','Vieja 1','Caneca',5,'litros','caneca',0),(1,'can-9','Vieja 2','Caneca',5,'litros','caneca',0),(1,'CAN-X','No numérica','Caneca',5,'litros','caneca',0);`);
      // Compras históricas de la empresa 1: huecos y mezcla de formatos (mayúsculas, espacios, separadores, sin separador, no numéricos).
      for (const ref of ['COMP-000007', 'comp-12', ' COMP 000020 ', 'COMP000030', 'COMP_5', 'FAC-9999', 'COMP-00005X', 'COMP-0000012A', 'PRECOMP-000099']) await insertarCompraHistorica(pool, 1, ref, 1);
      await insertarCompraHistorica(pool, 2, 'COMP-000100', 2);   // otra empresa: su máximo es independiente
      await insertarCompraHistorica(pool, 3, 'COMP-000009', 3);
      // Ventas históricas de la empresa 1 con el código anterior (documento libre).
      const cli = await crearCatalogo(pool, 'clientes', 1, 1, { nombre_comercial: 'Cliente', nit: null, telefono: null, direccion: null });
      let n = 0;
      for (const doc of ['VTA-000015', 'vta-20', 'VTA 000009', 'FAC-1', 'VTA-000002']) {
        await registrarVenta(pool, 1, 1, { clienteId: cli, productoId: 1, ubicacionId: 1, fechaVenta: '2026-11-10', documento: doc, cantidad: 1, precio: '95.00', claveOperacion: k(++n) }, '2026-11-24');
      }
      const instantanea = async () => ({
        compras: await todo(pool, 'SELECT id,empresa_id,referencia FROM canecas_compras ORDER BY id'),
        ventas: await todo(pool, 'SELECT id,empresa_id,documento FROM canecas_ventas ORDER BY id'),
        productos: await todo(pool, 'SELECT id,empresa_id,codigo FROM canecas_productos ORDER BY id'),
      });
      const antes = await instantanea();

      // ── Instalación: contadores sembrados con el MÁXIMO histórico por empresa y tipo (huecos sin rellenar) ──
      expect(await instalar(pool)).toEqual({ instalado: true, yaInstalado: false });
      expect(await secuencias(pool)).toEqual({
        '1:COMPRA': 30, '1:PRODUCTO': 9, '1:VENTA': 20,
        '2:COMPRA': 100, '2:PRODUCTO': 0, '2:VENTA': 0,
        '3:COMPRA': 9, '3:PRODUCTO': 0, '3:VENTA': 0,
      });
      expect(await instantanea()).toEqual(antes);           // ningún documento histórico cambió ni se renumeró
      expect(await instalar(pool)).toEqual({ instalado: false, yaInstalado: true });
      expect(await secuencias(pool)).toMatchObject({ '1:COMPRA': 30 }); // idempotente: no vuelve a sembrar

      // ── Operaciones nuevas: continúan después del máximo, sin reutilizar números históricos ──────────────
      const prov1 = await crearCatalogo(pool, 'proveedores', 1, 1, { nombre_comercial: 'Aceites SA', nit: null, telefono: null, direccion: null });
      const pos = (clave: number, empresa = 1, cliente = cli, ubic = 1) => registrarVenta(pool, empresa, 1, { clienteId: cliente, ubicacionId: ubic, direccionEntrega: 'Zona 4', cantidad: 1, precio: '120.00', claveOperacion: k(clave) });
      // Concurrencia: 8 compras simultáneas = 8 números consecutivos únicos a partir de 31.
      const compras = await Promise.all(Array.from({ length: 8 }, (_, i) => compra(pool, 1, prov1, 1, 1, 100 + i)));
      expect(compras.map(c => c.referencia).sort()).toEqual(rango('COMP', 31, 38));
      // 6 ventas POS simultáneas = VTA-000021..26 (el máximo histórico era 20).
      const ventas = await Promise.all(Array.from({ length: 6 }, (_, i) => pos(200 + i)));
      expect(ventas.map(v => v.documento).sort()).toEqual(rango('VTA', 21, 26));
      // Un documento escrito a mano DESPUÉS de la migración (API histórica) tampoco se repite: se salta.
      await insertarCompraHistorica(pool, 1, 'COMP-000040', 1);
      expect((await compra(pool, 1, prov1, 1, 1, 300)).referencia).toBe('COMP-000039');
      expect((await compra(pool, 1, prov1, 1, 1, 301)).referencia).toBe('COMP-000041');
      // Reintento idempotente: mismo número, sin consumir otro.
      expect((await compra(pool, 1, prov1, 1, 1, 301))).toMatchObject({ referencia: 'COMP-000041', yaRegistrada: true });
      expect((await compra(pool, 1, prov1, 1, 1, 302)).referencia).toBe('COMP-000042');
      expect((await secuencias(pool))['1:COMPRA']).toBe(42);

      // ── Otra empresa con su propio máximo y otra sin historial ─────────────────────────────────────────
      const prov2 = await crearCatalogo(pool, 'proveedores', 2, 1, { nombre_comercial: 'Aceites B', nit: null, telefono: null, direccion: null });
      expect((await compra(pool, 2, prov2, 2, 3, 400)).referencia).toBe('COMP-000101');
      const cli2 = await crearCatalogo(pool, 'clientes', 2, 1, { nombre_comercial: 'Cliente B', nit: null, telefono: null, direccion: null });
      expect((await pos(401, 2, cli2, 2)).documento).toBe('VTA-000001');

      // ── Empresa creada después de la migración y SIN contadores: se siembran desde su historial, en paralelo ──
      expect(Object.keys(await secuencias(pool)).filter(x => x.startsWith('3:'))).toHaveLength(3); // el instalador creó filas para todas las empresas
      await pool.query('DELETE FROM canecas_secuencias WHERE empresa_id=3');   // simula una empresa sin contadores aún
      const prov3 = await crearCatalogo(pool, 'proveedores', 3, 1, { nombre_comercial: 'Aceites C', nit: null, telefono: null, direccion: null });
      const c3 = await Promise.all(Array.from({ length: 6 }, (_, i) => compra(pool, 3, prov3, 3, 4, 500 + i)));
      expect(c3.map(c => c.referencia).sort()).toEqual(rango('COMP', 10, 15));
      expect((await secuencias(pool))['3:COMPRA']).toBe(15);

      // ── Sin duplicados visibles por empresa y sin tocar los históricos ───────────────────────────────────
      expect(await todo(pool, 'SELECT empresa_id,referencia,COUNT(*) n FROM canecas_compras WHERE referencia REGEXP \'^COMP-[0-9]{6}$\' GROUP BY empresa_id,referencia HAVING n>1')).toEqual([]);
      expect(await todo(pool, 'SELECT empresa_id,documento,COUNT(*) n FROM canecas_ventas WHERE documento REGEXP \'^VTA-[0-9]{6}$\' GROUP BY empresa_id,documento HAVING n>1')).toEqual([]);
      const despues = await instantanea();
      expect(despues.compras.slice(0, antes.compras.length)).toEqual(antes.compras);
      expect(despues.ventas.slice(0, antes.ventas.length)).toEqual(antes.ventas);
      expect(despues.productos.slice(0, antes.productos.length)).toEqual(antes.productos);
    } finally { await pool.end(); }
  }, 240000);

  it('sin historial los contadores empiezan en cero y el máximo con ceros a la izquierda o 7 dígitos se respeta', async () => {
    const pool = await crearBase('canecas_simp_num_b', 12);
    try {
      await prepararBaseHastaVentas(pool, { historial: true });
      await insertarCompraHistorica(pool, 1, 'COMP-999999', 1);
      expect(await instalar(pool)).toEqual({ instalado: true, yaInstalado: false });
      expect(await secuencias(pool)).toEqual({ '1:COMPRA': 999999, '1:PRODUCTO': 0, '1:VENTA': 0 });
      const prov = await crearCatalogo(pool, 'proveedores', 1, 1, { nombre_comercial: 'Aceites SA', nit: null, telefono: null, direccion: null });
      expect((await compra(pool, 1, prov, 1, 1, 1)).referencia).toBe('COMP-1000000');
      const cli = await crearCatalogo(pool, 'clientes', 1, 1, { nombre_comercial: 'Cliente', nit: null, telefono: null, direccion: null });
      expect((await registrarVenta(pool, 1, 1, { clienteId: cli, ubicacionId: 1, direccionEntrega: 'Zona 1', cantidad: 1, precio: '10.00', claveOperacion: k(2) })).documento).toBe('VTA-000001');
    } finally { await pool.end(); }
  }, 180000);

  it('un sufijo histórico de más de 15 dígitos no se puede conciliar: el preflight se detiene con explicación y no crea nada', async () => {
    const pool = await crearBase('canecas_simp_num_c', 12);
    try {
      await prepararBaseHastaVentas(pool, { historial: true });
      await insertarCompraHistorica(pool, 1, 'COMP-1234567890123456', 1);
      await expect(instalar(pool)).rejects.toThrow(/sin sufijos COMP de más de 15 dígitos en canecas_compras\.referencia/);
      expect(await todo(pool, "SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_secuencias'")).toMatchObject([{ n: 0 }]);
      await pool.query("DELETE FROM canecas_compras WHERE referencia='COMP-1234567890123456'"); // lo resuelve el propietario; luego instala
      await expect(instalar(pool)).resolves.toEqual({ instalado: true, yaInstalado: false });
    } finally { await pool.end(); }
  }, 180000);
});
