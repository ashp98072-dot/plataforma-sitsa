import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { ejecutarCostosControlado } from '../../../scripts/ci/canecas/ejecutar-costos-controlado.mjs';
import { confirmarRecepcion } from './confirmar';
import { valorarExistenciaInicial } from './valoracion-inicial';
import { registrarGastoPosterior } from './gasto-posterior';
const api = vi.hoisted(() => ({ pool: null as import('mysql2/promise').Pool | null, acceso: vi.fn() }));
vi.mock('@/lib/canecas/acceso', () => ({ accesoCanecas: api.acceso }));
vi.mock('@/lib/db', () => ({ getPool: () => api.pool, query: async (sql: string, params: unknown[]) => (await api.pool!.query(sql, params))[0] }));
vi.mock('@/lib/compras/proveedores', () => ({ guardarProveedor: vi.fn(), ErrorProveedorDuplicado: class extends Error {} }));
import { GET, POST } from '@/app/api/empresas/[slug]/canecas/[recurso]/route';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
describe.skipIf(!pipe)('prototipo de recepción contra MariaDB aislada', () => {
  const pool = mysql.createPool({ socketPath: `\\\\.\\pipe\\${pipe}`, user: 'root', database: 'canecas_fifo_test', multipleStatements: true, connectionLimit: 8 });
  beforeAll(async () => {
    api.pool = pool;
    api.acceso.mockResolvedValue({ empresa: { id: 1 }, session: { id: 1, username: 'test' } });
    const schema = readFileSync('sql/schema.sql', 'utf8');
    for (const tabla of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
      const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
      if (!ddl) throw new Error(`Falta definición ${tabla}`);
      await pool.query(ddl[0]);
    }
    await pool.query(readFileSync('sql/migrate-2026-11-canecas-fase1.sql', 'utf8'));
    const diagnostico = readFileSync('sql/recuperacion-2026-11-canecas-costos-wip.sql', 'utf8');
    const [sinInstalar] = await pool.query<mysql.RowDataPacket[][]>(diagnostico);
    expect(sinInstalar[1][0].estado).toBe('SIN_OBJETOS_REVISAR_PREFLIGHT');
    const [sinInstalarReintento] = await pool.query<mysql.RowDataPacket[][]>(diagnostico);
    expect(sinInstalarReintento[1][0]).toEqual(sinInstalar[1][0]);
    const [pre] = await pool.query<mysql.RowDataPacket[][]>(readFileSync('sql/preflight-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(pre[1].filter(r => r.resultado === 'DETENER')).toEqual([]);
    expect(pre[2].filter(r => r.resultado === 'DETENER')).toEqual([]);
    expect(pre[3].filter(r => r.resultado === 'DETENER')).toEqual([]);
    await pool.query('ALTER TABLE canecas_saldos MODIFY fisico INT UNSIGNED NOT NULL DEFAULT 0');
    const [incompatible] = await pool.query<mysql.RowDataPacket[][]>(readFileSync('sql/preflight-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(incompatible[2].find(r => r.tabla === 'canecas_saldos' && r.columna === 'fisico')?.resultado).toBe('DETENER');
    const incompat = await pool.getConnection();
    try { await expect(ejecutarCostosControlado(incompat)).rejects.toThrow('DETENER: preflight incompatible'); } finally { incompat.release(); }
    const [sinCambios] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='precio_unitario_centavos'");
    expect(sinCambios[0].n).toBe(0);
    await pool.query('ALTER TABLE canecas_saldos MODIFY fisico INT NOT NULL DEFAULT 0');
    await pool.query('CREATE TABLE canecas_capas_costo (id INT) ENGINE=InnoDB');
    const [parcial] = await pool.query<mysql.RowDataPacket[][]>(readFileSync('sql/preflight-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(parcial[1].find(r => r.comprobacion === 'tablas nuevas ausentes')?.resultado).toBe('DETENER');
    const [recuperacionParcial] = await pool.query<mysql.RowDataPacket[][]>(readFileSync('sql/recuperacion-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(recuperacionParcial[1][0].estado).toBe('DETENER_INSTALACION_PARCIAL');
    expect(recuperacionParcial[2].some(r => r.TABLE_NAME === 'canecas_capas_costo')).toBe(true);
    const bloqueada = await pool.getConnection();
    try {
      await expect(ejecutarCostosControlado(bloqueada)).rejects.toThrow('DETENER: preflight incompatible');
      const [sinDDL] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='precio_unitario_centavos'");
      expect(sinDDL[0].n).toBe(0);
      await expect(ejecutarCostosControlado(bloqueada)).rejects.toThrow('DETENER: preflight incompatible');
    } finally { bloqueada.release(); }
    await pool.query('DROP TABLE canecas_capas_costo');
    await pool.query('CREATE TABLE canecas_traslados (id INT) ENGINE=InnoDB');
    const [traslados] = await pool.query<mysql.RowDataPacket[][]>(readFileSync('sql/preflight-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(traslados[1].find(r => r.comprobacion === 'traslados pendientes de compatibilidad FIFO')?.resultado).toBe('DETENER');
    await pool.query('DROP TABLE canecas_traslados');
    // Migración local en desarrollo, aplicada exclusivamente a esta base nueva.
    const instalacion = await pool.getConnection();
    try { await ejecutarCostosControlado(instalacion); } finally { instalacion.release(); }
    const [post] = await pool.query<mysql.RowDataPacket[][]>(readFileSync('sql/postcheck-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(post[1].filter(r => r.resultado === 'DETENER')).toEqual([]);
    expect(post[2].filter(r => r.resultado === 'DETENER')).toEqual([]);
    expect(post[3]).toEqual([]);
    expect(post[4]).toEqual([]);
    expect(post[5]).toEqual([]);
    expect(post[6].filter(r => r.resultado === 'DETENER')).toEqual([]);
    expect(post[7].filter(r => r.resultado === 'DETENER')).toEqual([]);
    const [recuperacion] = await pool.query<mysql.RowDataPacket[][]>(readFileSync('sql/recuperacion-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(recuperacion[1][0].estado).toBe('OBJETOS_PRESENTES_REVISAR_POSTCHECK_Y_DATOS');
    expect(recuperacion[2].filter(r => r.TABLE_NAME.startsWith('canecas_')).length).toBeGreaterThanOrEqual(3);
    await pool.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a');
      INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'test','hash','salt');
      INSERT INTO empleados (id,empresa_id,codigo,nombre) VALUES (1,1,'A','Ana');
      INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (1,1,'A','A');
      INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,1,'A','Caneca','Caneca',5,'galones','caneca'),(2,1,'B','Caneca B','Caneca',5,'galones','caneca');
      INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega');
      INSERT INTO canecas_saldos (empresa_id,producto_id,ubicacion_id,fisico,reservado) VALUES (1,2,1,5,0);
      INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion,precio_unitario_centavos,gastos_centavos,moneda) VALUES (1,1,1,'X',1,10,1,'compra-1',1000,7,'GTQ'),(2,1,1,'Y',1,1,1,'compra-2',NULL,NULL,NULL);
      INSERT INTO canecas_recepciones (id,empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,creado_por) VALUES (1,1,1,1,1,'recepcion-1',7,1),(2,1,1,1,1,'recepcion-2',7,1),(3,1,2,1,1,'recepcion-3',1,1);`);
  });
  afterAll(async () => { await pool.end(); });
  it('repite el diagnóstico con datos existentes sin modificar compras ni recepciones', async () => {
    const [antes] = await pool.query<mysql.RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM canecas_compras) compras, (SELECT COUNT(*) FROM canecas_recepciones) recepciones');
    const sql = readFileSync('sql/recuperacion-2026-11-canecas-costos-wip.sql', 'utf8');
    const [primero] = await pool.query<mysql.RowDataPacket[][]>(sql);
    const [segundo] = await pool.query<mysql.RowDataPacket[][]>(sql);
    const [despues] = await pool.query<mysql.RowDataPacket[]>('SELECT (SELECT COUNT(*) FROM canecas_compras) compras, (SELECT COUNT(*) FROM canecas_recepciones) recepciones');
    expect(primero[1][0].estado).toBe('OBJETOS_PRESENTES_REVISAR_POSTCHECK_Y_DATOS');
    expect(segundo[1][0]).toEqual(primero[1][0]);
    expect(despues).toEqual(antes);
  });
  it('detecta existencias históricas en unidades distintas sin convertirlas', async () => {
    await pool.query("UPDATE canecas_productos SET unidad_inventario='litros' WHERE empresa_id=1 AND id=2");
    const [pre] = await pool.query<mysql.RowDataPacket[][]>(readFileSync('sql/preflight-2026-11-canecas-costos-wip.sql', 'utf8'));
    expect(pre[pre.length-1][0]).toMatchObject({ filas:1, resultado:'DETENER' });
    await pool.query("UPDATE canecas_productos SET unidad_inventario='caneca' WHERE empresa_id=1 AND id=2");
  });
  it('serializa dos recepciones simultáneas que excederían la compra', async () => {
    const resultados = await Promise.allSettled([confirmarRecepcion(pool,1,1,1), confirmarRecepcion(pool,1,2,1)]);
    expect(resultados.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(resultados.filter(x => x.status === 'rejected')).toHaveLength(1);
    const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT fisico FROM canecas_saldos WHERE empresa_id=1 AND producto_id=1');
    expect(rows[0].fisico).toBe(7);
    const [capas] = await pool.query<mysql.RowDataPacket[]>('SELECT SUM(cantidad_inicial) total FROM canecas_capas_costo WHERE empresa_id=1');
    expect(Number(capas[0].total)).toBe(7);
  });
  it('la repetición confirmada no crea capas ni movimientos adicionales', async () => {
    const [recepciones] = await pool.query<mysql.RowDataPacket[]>("SELECT id FROM canecas_recepciones WHERE compra_id=1 AND estado='CONFIRMADA'");
    const [antes] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM canecas_capas_costo');
    expect(await confirmarRecepcion(pool,1,recepciones[0].id,1)).toEqual({ yaConfirmada: true });
    const [despues] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM canecas_capas_costo');
    expect(despues[0].n).toBe(antes[0].n);
    const [movs] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM canecas_movimientos');
    expect(movs[0].n).toBe(1);
  });
  it('concilia el inventario inicial y serializa valoraciones concurrentes sin inventar costos', async () => {
    const base = { productoId: 2, ubicacionId: 1, cantidad: 4, costoCentavos: BigInt(100), moneda: 'GTQ', documento: 'Conteo', motivo: 'Saldo anterior' };
    const clave1 = 'a0000000-0000-4000-8000-000000000001', clave2 = 'a0000000-0000-4000-8000-000000000002';
    const resultados = await Promise.allSettled([valorarExistenciaInicial(pool,1,1,{ ...base, claveOperacion: clave1 }), valorarExistenciaInicial(pool,1,1,{ ...base, claveOperacion: clave2 })]);
    expect(resultados.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT clave_operacion FROM canecas_valoraciones_iniciales WHERE empresa_id=1 AND producto_id=2');
    expect(await valorarExistenciaInicial(pool,1,1,{ ...base, claveOperacion: rows[0].clave_operacion })).toEqual({ yaRegistrada: true });
    const [capas] = await pool.query<mysql.RowDataPacket[]>('SELECT cantidad_inicial,costo_unitario_centavos FROM canecas_capas_costo WHERE empresa_id=1 AND producto_id=2');
    expect(capas).toHaveLength(1);
    expect(capas[0]).toMatchObject({ cantidad_inicial: 4, costo_unitario_centavos: 100 });
    await expect(pool.query('UPDATE canecas_valoraciones_iniciales SET costo_unitario_centavos=0 WHERE empresa_id=1 AND producto_id=2')).rejects.toThrow();
    await expect(valorarExistenciaInicial(pool,2,1,{ ...base, claveOperacion: clave1 })).rejects.toThrow('SALDO_NO_ENCONTRADO');
  });
  it('registra el gasto tardío una vez sin modificar capas ni movimientos', async () => {
    const gasto = { compraId: 1, importeCentavos: BigInt("100"), moneda: 'GTQ', fechaDocumento:'2026-11-20', referencia: 'Flete', motivo: 'Factura posterior', claveOperacion: 'b0000000-0000-4000-8000-000000000001' };
    const [antes] = await pool.query<mysql.RowDataPacket[]>('SELECT id,cantidad_disponible,costo_unitario_centavos FROM canecas_capas_costo ORDER BY id');
    expect((await registrarGastoPosterior(pool,1,1,gasto)).yaRegistrado).toBe(false);
    expect((await registrarGastoPosterior(pool,1,1,gasto)).yaRegistrado).toBe(true);
    await expect(registrarGastoPosterior(pool,1,1,{ ...gasto, importeCentavos: BigInt("200") })).rejects.toThrow('CLAVE_REUTILIZADA');
    await expect(registrarGastoPosterior(pool,1,1,{ ...gasto, fechaDocumento:'2026-11-19' })).rejects.toThrow('CLAVE_REUTILIZADA');
    await expect(registrarGastoPosterior(pool,1,1,{ ...gasto, moneda:'USD' })).rejects.toThrow('MONEDA_INCOMPATIBLE');
    await expect(registrarGastoPosterior(pool,2,1,gasto)).rejects.toThrow('COMPRA_NO_ENCONTRADA');
    await expect(confirmarRecepcion(pool,2,1,1)).rejects.toThrow('RECEPCION_NO_ENCONTRADA');
    expect((await registrarGastoPosterior(pool,1,1,{ ...gasto, compraId:2, claveOperacion:'b0000000-0000-4000-8000-000000000002' })).yaRegistrado).toBe(false);
    const [despues] = await pool.query<mysql.RowDataPacket[]>('SELECT id,cantidad_disponible,costo_unitario_centavos FROM canecas_capas_costo ORDER BY id');
    expect(despues).toEqual(antes);
    await expect(pool.query('UPDATE canecas_gastos_posteriores SET importe_centavos=0 WHERE empresa_id=1')).rejects.toThrow();
    await expect(pool.query('UPDATE canecas_compras SET gastos_centavos=99 WHERE empresa_id=1 AND id=1')).rejects.toThrow();
    await expect(pool.query('UPDATE canecas_capas_costo SET costo_unitario_centavos=99 WHERE empresa_id=1 AND recepcion_id IS NOT NULL')).rejects.toThrow();
  });
  it('crea compra con costo por API y confirma su recepción con capas', async () => {
    const ctx = (recurso: string) => ({ params: Promise.resolve({ slug:'a', recurso }) });
    const post = (recurso: string, data: object) => POST(new Request('http://local', { method:'POST', body:JSON.stringify(data) }), ctx(recurso));
    const compra = { proveedor_id:1, producto_id:1, cantidad:2, referencia:'API', precio_compra:'12.34', gastos_adquisicion:'0.05', moneda:'GTQ', clave_operacion:'c0000000-0000-4000-8000-000000000001' };
    const compraResp = await post('compras',compra);
    expect(compraResp.status).toBe(201);
    const compraId = (await compraResp.json()).id;
    const repetida = await post('compras',compra);
    expect((await repetida.json()).id).toBe(compraId);
    expect((await post('compras',{ ...compra, precio_compra:'12.35' })).status).toBe(409);
    const recResp = await post('recepciones',{ compra_id:compraId, ubicacion_id:1, recibido_por_empleado_id:1, cantidad:2, clave_operacion:'c0000000-0000-4000-8000-000000000002' });
    expect(recResp.status).toBe(201);
    const recepcionId = (await recResp.json()).id;
    expect((await post('confirmar',{ id:recepcionId })).status).toBe(200);
    const [capas] = await pool.query<mysql.RowDataPacket[]>('SELECT cantidad_inicial,costo_unitario_centavos,moneda FROM canecas_capas_costo WHERE empresa_id=1 AND recepcion_id=? ORDER BY segmento',[recepcionId]);
    expect(capas).toHaveLength(2);
    expect(capas.map(c => Number(c.cantidad_inicial)*Number(c.costo_unitario_centavos)).reduce((a,b)=>a+b,0)).toBe(2473);
    expect(capas.every(c => c.moneda === 'GTQ')).toBe(true);
    const inventario = await GET(new Request('http://local'), ctx('valoracion_inventario'));
    const valoración = (await inventario.json()).datos;
    expect(valoración).toHaveLength(2);
    expect(valoración.find((v: { nombre:string }) => v.nombre === 'Caneca')).toMatchObject({ moneda:'GTQ', costo_conocido:'94.80' });
    const antes = JSON.stringify(capas);
    expect((await post('precio_referencia',{ producto_id:1,precio_venta_referencia:'29.50',moneda:'GTQ' })).status).toBe(200);
    expect((await post('precio_referencia',{ producto_id:1,precio_venta_referencia:'29.50',moneda:'GTQ' })).status).toBe(200);
    const [precio] = await pool.query<mysql.RowDataPacket[]>('SELECT precio_venta_referencia_centavos,precio_venta_referencia_moneda FROM canecas_productos WHERE empresa_id=1 AND id=1');
    expect(precio[0]).toMatchObject({ precio_venta_referencia_centavos:2950,precio_venta_referencia_moneda:'GTQ' });
    const [capasDespues] = await pool.query<mysql.RowDataPacket[]>('SELECT cantidad_inicial,costo_unitario_centavos,moneda FROM canecas_capas_costo WHERE empresa_id=1 AND recepcion_id=? ORDER BY segmento',[recepcionId]);
    expect(JSON.stringify(capasDespues)).toBe(antes);
  });
  it('no expone gastos, valoraciones ni costos a otra empresa', async () => {
    const ctx = (recurso: string) => ({ params: Promise.resolve({ slug:'otra', recurso }) });
    for (const recurso of ['gastos_posteriores','valoracion_inicial','valoracion_inventario']) {
      api.acceso.mockResolvedValueOnce({ empresa:{ id:2 }, session:{ id:1, username:'test' } });
      const respuesta = await GET(new Request('http://local'),ctx(recurso));
      expect(respuesta.status).toBe(200);
      expect((await respuesta.json()).datos).toEqual([]);
    }
  });
  it('devuelve compras sin importes a quien solo tiene permiso de lectura', async () => {
    api.acceso.mockResolvedValueOnce({ empresa:{ id:1 }, session:{ id:1, username:'test' } }).mockResolvedValueOnce({ error:new Response(null,{status:403}) });
    const respuesta = await GET(new Request('http://local'),{ params:Promise.resolve({slug:'a',recurso:'compras'}) });
    expect(respuesta.status).toBe(200);
    const compras = (await respuesta.json()).datos;
    expect(compras.length).toBeGreaterThan(0);
    expect(compras[0]).not.toHaveProperty('precio_unitario_centavos');
    expect(compras[0]).not.toHaveProperty('gastos_centavos');
    api.acceso.mockResolvedValueOnce({ empresa:{ id:1 }, session:{ id:1, username:'test' } }).mockResolvedValueOnce({ error:new Response(null,{status:403}) }).mockResolvedValueOnce({ error:new Response(null,{status:403}) });
    const productos = await GET(new Request('http://local'),{ params:Promise.resolve({slug:'a',recurso:'productos'}) });
    expect(productos.status).toBe(200);
    const lista = (await productos.json()).datos;
    expect(lista.length).toBeGreaterThan(0);
    expect(lista[0]).not.toHaveProperty('precio_venta_referencia_centavos');
  });
  it('revierte saldo, movimiento y estado si falla la inserción de la capa', async () => {
    await pool.query("CREATE TRIGGER fallo_capa BEFORE INSERT ON canecas_capas_costo FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='FALLO_CAPA'");
    await expect(confirmarRecepcion(pool,1,3,1)).rejects.toThrow('FALLO_CAPA');
    const [rows] = await pool.query<mysql.RowDataPacket[]>('SELECT fisico FROM canecas_saldos WHERE empresa_id=1 AND producto_id=1');
    const [rec] = await pool.query<mysql.RowDataPacket[]>('SELECT estado FROM canecas_recepciones WHERE id=3');
    const [mov] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM canecas_movimientos WHERE recepcion_id=3');
    expect(rows[0].fisico).toBe(9);
    expect(rec[0].estado).toBe('BORRADOR');
    expect(mov[0].n).toBe(0);
    const valoracion = { productoId: 2, ubicacionId: 1, cantidad: 1, costoCentavos: BigInt(100), moneda: 'GTQ', documento: 'Conteo', motivo: 'Saldo anterior', claveOperacion: 'a0000000-0000-4000-8000-000000000003' };
    await expect(valorarExistenciaInicial(pool,1,1,valoracion)).rejects.toThrow('FALLO_CAPA');
    const [eventos] = await pool.query<mysql.RowDataPacket[]>('SELECT COUNT(*) n FROM canecas_valoraciones_iniciales WHERE empresa_id=1 AND clave_operacion=?',[valoracion.claveOperacion]);
    expect(eventos[0].n).toBe(0);
  });
});
