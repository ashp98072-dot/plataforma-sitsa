import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { confirmarRecepcion } from './confirmar';
import { crearCatalogo } from './catalogos';
import { anularVenta, registrarVenta } from './ventas';
import { ejecutarRedistribucionControlado } from '../../../scripts/ci/canecas/ejecutar-redistribucion-controlado.mjs';
import { ejecutarCatalogosControlado } from '../../../scripts/ci/canecas/ejecutar-catalogos-controlado.mjs';
import { ejecutarVentasControlado } from '../../../scripts/ci/canecas/ejecutar-ventas-controlado.mjs';
import { verificarContratoVentas } from '../../../scripts/ci/canecas/contrato-ventas.mjs';

// Lab Windows: CANECAS_FIFO_TEST_PIPE. Lab Linux: CANECAS_REDIS_TEST_SOCKET. Crea y elimina sus propias bases desechables.
const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
const socket = process.env.CANECAS_REDIS_TEST_SOCKET;
const opciones = (database?: string) => ({ socketPath: socket ?? `\\\\.\\pipe\\${pipe}`, user: 'root', multipleStatements: true, ...(database ? { database } : {}) });
type Fila = mysql.RowDataPacket;
const leer = (archivo: string) => readFileSync(archivo, 'utf8');
const BASES = ['canecas_ven_inst_a', 'canecas_ven_inst_b', 'canecas_ven_inst_c', 'canecas_ven_inst_d'];
const sentenciasTrigger = (archivo: string) => (leer(archivo).split('DELIMITER //')[1] ?? '').replace(/DELIMITER ;\s*$/, '').split('//').map(s => s.trim()).filter(s => /^CREATE (OR REPLACE )?TRIGGER /.test(s));
const triggerVentas = (nombre: string) => sentenciasTrigger('sql/migrate-2026-11-canecas-ventas-wip.sql').find(s => new RegExp(`TRIGGER ${nombre}\\s`).test(s)) as string;

async function aplicar(pool: mysql.Pool, archivo: string) {
  const [ddl] = leer(archivo).split('DELIMITER //');
  await pool.query(ddl);
  for (const t of sentenciasTrigger(archivo)) await pool.query(t);
}
async function crearBase(nombre: string) {
  const admin = await mysql.createConnection(opciones());
  try { await admin.query(`DROP DATABASE IF EXISTS ${nombre}; CREATE DATABASE ${nombre}`); } finally { await admin.end(); }
  return mysql.createPool({ ...opciones(nombre), connectionLimit: 8 });
}
const instaladorEn = async (pool: mysql.Pool, f: (c: never) => Promise<unknown>) => { const c = await pool.getConnection(); try { return await f(c as never); } finally { c.release(); } };
// Estado previo: fase 1, costos, salidas, redistribución y catálogos (opcional) instalados, con una compra histórica.
async function prepararBase(pool: mysql.Pool, { catalogos = true } = {}) {
  const schema = leer('sql/schema.sql');
  for (const tabla of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
    const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
    if (!ddl) throw Error(`Falta ${tabla}`);
    await pool.query(ddl[0]);
  }
  await pool.query(leer('sql/migrate-2026-11-canecas-fase1.sql'));
  await aplicar(pool, 'sql/migrate-2026-11-canecas-costos-wip.sql');
  await aplicar(pool, 'sql/migrate-2026-11-canecas-salidas-fifo-wip.sql');
  await instaladorEn(pool, c => ejecutarRedistribucionControlado(c));
  await pool.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a');
    INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'test','hash','salt');
    INSERT INTO empleados (id,empresa_id,codigo,nombre) VALUES (1,1,'A','Ana');
    INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (1,1,'Proveedor anterior','PROVEEDOR ANTERIOR');
    INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,1,'A','Caneca','Caneca',5,'litros','caneca');
    INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega');
    INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion,precio_unitario_centavos,gastos_centavos,moneda) VALUES (1,1,1,'C1',1,20,1,'compra-1',10000,0,'GTQ');
    INSERT INTO canecas_recepciones (id,empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,creado_por) VALUES (1,1,1,1,1,'recepcion-1',20,1);`);
  await confirmarRecepcion(pool, 1, 1, 1);
  if (catalogos) await instaladorEn(pool, c => ejecutarCatalogosControlado(c));
}
const instalar = (pool: mysql.Pool, envoltura?: (c: mysql.PoolConnection) => unknown) => instaladorEn(pool, c => ejecutarVentasControlado(envoltura ? envoltura(c as mysql.PoolConnection) : c));
const objetos = async (pool: mysql.Pool) => {
  const [r] = await pool.query<Fila[]>(`SELECT
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_ventas','canecas_compras_mapeo_proveedor')) tablas,
    (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('trg_can_venta_bu','trg_can_venta_bd','trg_can_mapeo_bu','trg_can_mapeo_bd')) triggers`);
  return { tablas: Number(r[0].tablas), triggers: Number(r[0].triggers) };
};
const sinObjetos = { tablas: 0, triggers: 0 };
const verificar = (pool: mysql.Pool) => instaladorEn(pool, c => verificarContratoVentas(c));

describe.skipIf(!pipe && !socket)('instalador controlado de ventas en MariaDB 11.8.9 desechable', () => {
  it('exige la cadena instalada: sin catálogos se detiene sin ejecutar DDL y luego instala', async () => {
    const pool = await crearBase(BASES[0]);
    try {
      await prepararBase(pool, { catalogos: false });
      await expect(instalar(pool)).rejects.toThrow('catálogos');
      expect(await objetos(pool)).toEqual(sinObjetos);
      await instaladorEn(pool, c => ejecutarCatalogosControlado(c));
      await expect(instalar(pool)).resolves.toEqual({ instalado: true, yaInstalado: false });
    } finally { await pool.end(); }
  }, 120000);

  it('instalación limpia: no altera datos, es idempotente y permite vender y anular de extremo a extremo', async () => {
    const pool = await crearBase(BASES[1]);
    try {
      await prepararBase(pool);
      const instantanea = async () => ({
        compras: (await pool.query<Fila[]>('SELECT * FROM canecas_compras ORDER BY id'))[0],
        capas: (await pool.query<Fila[]>('SELECT * FROM canecas_capas_costo ORDER BY id'))[0],
        saldos: (await pool.query<Fila[]>('SELECT * FROM canecas_saldos'))[0],
        movimientos: (await pool.query<Fila[]>('SELECT * FROM canecas_movimientos ORDER BY id'))[0],
        proveedoresCompras: (await pool.query<Fila[]>('SELECT * FROM compras_proveedores ORDER BY id'))[0],
        redistribuciones: (await pool.query<Fila[]>('SELECT * FROM canecas_redistribuciones ORDER BY id'))[0],
      });
      const antes = await instantanea();
      expect(await instalar(pool)).toEqual({ instalado: true, yaInstalado: false });
      expect(await instantanea()).toEqual(antes);
      expect(await objetos(pool)).toEqual({ tablas: 2, triggers: 4 });
      await verificar(pool);
      const [fk] = await pool.query<Fila[]>("SELECT DISTINCT REFERENCED_TABLE_NAME t FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_ventas','canecas_compras_mapeo_proveedor') AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY 1");
      expect(fk.map(f => f.t)).toEqual(['canecas_clientes', 'canecas_compras', 'canecas_productos', 'canecas_proveedores', 'canecas_salidas_fifo', 'canecas_ubicaciones', 'usuarios']); // sin Compras ni clientes de Operaciones
      expect(await instalar(pool)).toEqual({ instalado: false, yaInstalado: true });
      expect(await instantanea()).toEqual(antes);
      // Con el esquema instalado, el código opera de extremo a extremo y la idempotencia sobrevive a nuevos datos.
      const cliente = await crearCatalogo(pool, 'clientes', 1, 1, { nombre_comercial: 'Cliente', nit: null, telefono: null, direccion: null });
      const venta = await registrarVenta(pool, 1, 1, { clienteId: cliente, productoId: 1, ubicacionId: 1, fechaVenta: '2026-11-10', documento: 'FAC-1', cantidad: 8, precio: '95.00', claveOperacion: '00000000-0000-4000-8000-000000000001' }, '2026-11-24');
      expect(venta).toMatchObject({ total: 'Q 760.00', costo: 'Q 800.00', utilidad: '-Q 40.00' }); // 8 × Q100.00 de costo: la pérdida se muestra, no se oculta
      expect(await instalar(pool)).toEqual({ instalado: false, yaInstalado: true });
      await anularVenta(pool, 1, 1, venta.id, 'Prueba');
      expect(Number((await pool.query<Fila[]>('SELECT fisico FROM canecas_saldos'))[0][0].fisico)).toBe(20);
    } finally { await pool.end(); }
  }, 120000);

  it('detecta diferencias estructurales (columnas, índices, CHECK, claves foráneas y triggers) y acepta el estado restaurado', async () => {
    const pool = await crearBase(BASES[2]);
    try {
      await prepararBase(pool);
      await instalar(pool);
      const caso = async (alterar: string | string[], seccion: string, restaurar: string | string[]) => {
        for (const s of [alterar].flat()) await pool.query(s);
        await expect(verificar(pool)).rejects.toThrow(seccion);
        await expect(instalar(pool)).rejects.toThrow('instalación parcial');
        for (const s of [restaurar].flat()) await pool.query(s);
        await expect(verificar(pool)).resolves.toBeUndefined();
      };
      await caso('ALTER TABLE canecas_ventas MODIFY documento VARCHAR(240) NOT NULL', 'columnas', 'ALTER TABLE canecas_ventas MODIFY documento VARCHAR(250) NOT NULL');
      await caso('CREATE INDEX idx_extra_venta ON canecas_ventas (documento)', 'indices', 'DROP INDEX idx_extra_venta ON canecas_ventas');
      await caso(['ALTER TABLE canecas_ventas DROP CONSTRAINT chk_can_venta_importes', 'ALTER TABLE canecas_ventas ADD CONSTRAINT chk_can_venta_importes CHECK (cantidad > 0)'], 'checks', ['ALTER TABLE canecas_ventas DROP CONSTRAINT chk_can_venta_importes', "ALTER TABLE canecas_ventas ADD CONSTRAINT chk_can_venta_importes CHECK (cantidad > 0 AND precio_unitario_centavos > 0 AND total_centavos = CAST(precio_unitario_centavos AS DECIMAL(38,0)) * cantidad AND costo_centavos >= 0 AND moneda = 'GTQ')"]);
      await caso('ALTER TABLE canecas_ventas DROP FOREIGN KEY fk_can_venta_salida', 'foraneas', 'ALTER TABLE canecas_ventas ADD CONSTRAINT fk_can_venta_salida FOREIGN KEY (empresa_id,salida_id) REFERENCES canecas_salidas_fifo(empresa_id,id)');
      await caso("CREATE OR REPLACE TRIGGER trg_can_venta_bd BEFORE DELETE ON canecas_ventas FOR EACH ROW BEGIN IF 1=2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='otro'; END IF; END", 'definición incompatible del trigger trg_can_venta_bd', triggerVentas('trg_can_venta_bd'));
      await caso('DROP TRIGGER trg_can_mapeo_bu', 'incompletos', triggerVentas('trg_can_mapeo_bu'));
      await expect(instalar(pool)).resolves.toEqual({ instalado: false, yaInstalado: true });
    } finally { await pool.end(); }
  }, 120000);

  it('fallo intermedio: instalación parcial detectada, diagnóstico de solo lectura y reintento sobre estado restaurado', async () => {
    let pool = await crearBase(BASES[3]);
    try {
      await prepararBase(pool);
      await expect(instalar(pool, conn => ({ query: async (sql: string, params?: unknown) => {
        if (sql.includes('TRIGGER trg_can_venta_bd')) throw Object.assign(new Error('fallo simulado'), { code: 'ER_SIMULADO' });
        return conn.query(sql, params as never);
      } }))).rejects.toThrow('DDL 4/6');
      expect(await objetos(pool)).toEqual({ tablas: 2, triggers: 1 });
      await expect(instalar(pool)).rejects.toThrow('instalación parcial');
      const antes = await objetos(pool);
      const [diagnostico] = await pool.query<Fila[][]>(leer('sql/recuperacion-canecas-ventas-solo-lectura.sql'));
      expect(Array.isArray(diagnostico)).toBe(true);
      expect(await objetos(pool)).toEqual(antes);
      // Restauración del respaldo (aquí: base nueva con el mismo estado previo) y reintento correcto.
      await pool.end();
      pool = await crearBase(BASES[3]);
      await prepararBase(pool);
      await expect(instalar(pool)).resolves.toEqual({ instalado: true, yaInstalado: false });
    } finally { await pool.end(); }
  }, 120000);

  it('limpia las bases desechables', async () => {
    const admin = await mysql.createConnection(opciones());
    try { for (const b of BASES) await admin.query(`DROP DATABASE IF EXISTS ${b}`); } finally { await admin.end(); }
  });
});
