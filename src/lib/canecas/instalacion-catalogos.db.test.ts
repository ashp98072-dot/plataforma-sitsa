import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { confirmarRecepcion } from './confirmar';
import { ejecutarCatalogosControlado } from '../../../scripts/ci/canecas/ejecutar-catalogos-controlado.mjs';
import { verificarContratoCatalogos, verificarMapeoProveedoresCompleto } from '../../../scripts/ci/canecas/contrato-catalogos.mjs';
import { ejecutarRedistribucionControlado } from '../../../scripts/ci/canecas/ejecutar-redistribucion-controlado.mjs';

// Lab Windows: CANECAS_FIFO_TEST_PIPE. Lab Linux: CANECAS_REDIS_TEST_SOCKET. Crea y elimina sus propias bases desechables.
const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
const socket = process.env.CANECAS_REDIS_TEST_SOCKET;
const opciones = (database?: string) => ({ socketPath: socket ?? `\\\\.\\pipe\\${pipe}`, user: 'root', multipleStatements: true, ...(database ? { database } : {}) });
type Fila = mysql.RowDataPacket;
const leer = (archivo: string) => readFileSync(archivo, 'utf8');
const BASES = ['canecas_cat_inst_a', 'canecas_cat_inst_b', 'canecas_cat_inst_c', 'canecas_cat_inst_d'];

async function aplicar(pool: mysql.Pool, archivo: string) {
  const [ddl, resto] = leer(archivo).split('DELIMITER //');
  await pool.query(ddl);
  const triggers = (resto ?? '').replace(/DELIMITER ;\s*$/, '').split('//').map(s => s.trim()).filter(s => /^CREATE (OR REPLACE )?TRIGGER /.test(s));
  for (const t of triggers) await pool.query(t);
}
async function crearBase(nombre: string) {
  const admin = await mysql.createConnection(opciones());
  try { await admin.query(`DROP DATABASE IF EXISTS ${nombre}; CREATE DATABASE ${nombre}`); } finally { await admin.end(); }
  return mysql.createPool({ ...opciones(nombre), connectionLimit: 8 });
}
// Estado previo: cadena instalada (fase 1, costos, salidas y redistribución) con una compra histórica.
async function prepararBase(pool: mysql.Pool, { historicas = true } = {}) {
  const schema = leer('sql/schema.sql');
  for (const tabla of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
    const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
    if (!ddl) throw Error(`Falta ${tabla}`);
    await pool.query(ddl[0]);
  }
  await pool.query(leer('sql/migrate-2026-11-canecas-fase1.sql'));
  await aplicar(pool, 'sql/migrate-2026-11-canecas-costos-wip.sql');
  await aplicar(pool, 'sql/migrate-2026-11-canecas-salidas-fifo-wip.sql');
  const conn = await pool.getConnection();
  try { await ejecutarRedistribucionControlado(conn); } finally { conn.release(); }
  await pool.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a'),(2,'B','B','b');
    INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'test','hash','salt');
    INSERT INTO empleados (id,empresa_id,codigo,nombre) VALUES (1,1,'A','Ana');
    INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (1,1,'Proveedor de Compras','PROVEEDOR DE COMPRAS');
    INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,1,'A','Caneca','Caneca',5,'litros','caneca');
    INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega');`);
  if (historicas) {
    await pool.query(`INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion,precio_unitario_centavos,gastos_centavos,moneda) VALUES (1,1,1,'C1',1,20,1,'compra-1',10000,0,'GTQ');
      INSERT INTO canecas_recepciones (id,empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,creado_por) VALUES (1,1,1,1,1,'recepcion-1',20,1);`);
    await confirmarRecepcion(pool, 1, 1, 1);
  }
}
async function instalar(pool: mysql.Pool, envoltura?: (c: mysql.PoolConnection) => unknown) {
  const conn = await pool.getConnection();
  try { return await ejecutarCatalogosControlado(envoltura ? envoltura(conn) : conn); } finally { conn.release(); }
}
const objetos = async (pool: mysql.Pool) => {
  const [r] = await pool.query<Fila[]>(`SELECT
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_proveedores','canecas_clientes')) tablas,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='canecas_proveedor_id') columnas`);
  return { tablas: Number(r[0].tablas), columnas: Number(r[0].columnas) };
};
const sinObjetos = { tablas: 0, columnas: 0 };
const verificar = async (pool: mysql.Pool) => { const c = await pool.getConnection(); try { await verificarContratoCatalogos(c); } finally { c.release(); } };

describe.skipIf(!pipe && !socket)('instalador controlado de catálogos de Canecas en MariaDB 11.8.9 desechable', () => {
  it('rechaza un estado previo incorrecto sin ejecutar DDL', async () => {
    const pool = await crearBase(BASES[0]);
    try {
      await prepararBase(pool);
      await pool.query('ALTER TABLE canecas_capas_costo DROP CONSTRAINT chk_can_capa_orden'); // la cadena previa ya no coincide
      await expect(instalar(pool)).rejects.toThrow();
      expect(await objetos(pool)).toEqual(sinObjetos);
      await pool.query('ALTER TABLE canecas_capas_costo ADD CONSTRAINT chk_can_capa_orden CHECK (orden_fifo IS NULL OR (orden_fifo > 0 AND redistribucion_id IS NOT NULL))');
      await pool.query('ALTER TABLE canecas_compras MODIFY proveedor_id INT NULL'); // estado previo distinto del esperado
      await expect(instalar(pool)).rejects.toThrow('proveedor_id');
      expect(await objetos(pool)).toEqual(sinObjetos);
      await pool.query('ALTER TABLE canecas_compras MODIFY proveedor_id INT NOT NULL');
      await expect(instalar(pool)).resolves.toMatchObject({ instalado: true, yaInstalado: false });
    } finally { await pool.end(); }
  }, 90000);

  it('instalación limpia con compras históricas: no altera datos, informa el mapeo pendiente y es idempotente', async () => {
    const pool = await crearBase(BASES[1]);
    try {
      await prepararBase(pool);
      const instantanea = async () => ({
        compras: (await pool.query<Fila[]>('SELECT id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,creado_en,clave_operacion,precio_unitario_centavos,gastos_centavos,moneda FROM canecas_compras ORDER BY id'))[0],
        capas: (await pool.query<Fila[]>('SELECT * FROM canecas_capas_costo ORDER BY id'))[0],
        saldos: (await pool.query<Fila[]>('SELECT * FROM canecas_saldos'))[0],
        movimientos: (await pool.query<Fila[]>('SELECT * FROM canecas_movimientos ORDER BY id'))[0],
        proveedoresCompras: (await pool.query<Fila[]>('SELECT * FROM compras_proveedores ORDER BY id'))[0],
      });
      const antes = await instantanea();
      expect(antes.compras).toHaveLength(1);
      expect(await instalar(pool)).toEqual({ instalado: true, yaInstalado: false, comprasSinMapear: 1 });
      expect(await instantanea()).toEqual(antes); // compras históricas, costos, capas y proveedores de Compras intactos
      await verificar(pool);
      const [fk] = await pool.query<Fila[]>("SELECT CONSTRAINT_NAME,REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_proveedores','canecas_clientes') AND REFERENCED_TABLE_NAME IS NOT NULL");
      expect([...new Set(fk.map(f => f.REFERENCED_TABLE_NAME))].sort()).toEqual(['empresas', 'usuarios']); // sin relación con compras_proveedores ni con clientes de Operaciones
      const [compra] = await pool.query<Fila[]>("SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='proveedor_id'");
      expect(compra[0].IS_NULLABLE).toBe('YES');
      // La compra histórica conserva su FK al proveedor anterior y no tiene proveedor de Canecas.
      const [hist] = await pool.query<Fila[]>('SELECT proveedor_id,canecas_proveedor_id FROM canecas_compras');
      expect(hist[0]).toEqual({ proveedor_id: 1, canecas_proveedor_id: null });
      // Nuevas compras: proveedor de Canecas sin proveedor de Compras; sin ningún proveedor se rechaza.
      await pool.query("INSERT INTO canecas_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado,creado_por) VALUES (1,1,'Aceites','ACEITES',1),(2,2,'Otra empresa','OTRA EMPRESA',1)");
      await pool.query("INSERT INTO canecas_compras (empresa_id,canecas_proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion) VALUES (1,1,'C2',1,5,1,'compra-2')");
      await expect(pool.query("INSERT INTO canecas_compras (empresa_id,referencia,producto_id,cantidad,creado_por,clave_operacion) VALUES (1,'C3',1,5,1,'compra-3')")).rejects.toThrow(/chk_can_compra_proveedor/);
      await expect(pool.query("INSERT INTO canecas_compras (empresa_id,canecas_proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion) VALUES (1,2,'C4',1,5,1,'compra-4')")).rejects.toThrow(/fk_can_compra_canecas_proveedor/); // proveedor de otra empresa
      await pool.query("DELETE FROM canecas_compras WHERE referencia='C2'");
      await pool.query('DELETE FROM canecas_proveedores');
      // Idempotencia: reintento sin cambios y con el mismo informe.
      expect(await instalar(pool)).toEqual({ instalado: false, yaInstalado: true, comprasSinMapear: 1 });
      expect(await instantanea()).toEqual(antes);
      // La compuerta de contracción se detiene mientras haya compras sin mapear.
      const conn = await pool.getConnection();
      try { await expect(verificarMapeoProveedoresCompleto(conn)).rejects.toThrow('1 compras históricas sin proveedor de Canecas'); } finally { conn.release(); }
    } finally { await pool.end(); }
  }, 90000);

  it('instala sobre una base sin compras históricas y la compuerta de mapeo queda abierta', async () => {
    const pool = await crearBase(BASES[2]);
    try {
      await prepararBase(pool, { historicas: false });
      expect(await instalar(pool)).toEqual({ instalado: true, yaInstalado: false, comprasSinMapear: 0 });
      const conn = await pool.getConnection();
      try { await expect(verificarMapeoProveedoresCompleto(conn)).resolves.toBeUndefined(); } finally { conn.release(); }
    } finally { await pool.end(); }
  }, 90000);

  it('detecta diferencias estructurales, fallo intermedio y permite reintentar sobre estado restaurado', async () => {
    let pool = await crearBase(BASES[3]);
    try {
      await prepararBase(pool);
      await expect(instalar(pool, conn => ({ query: async (sql: string, params?: unknown) => {
        if (sql.startsWith('ALTER TABLE canecas_compras')) throw Object.assign(new Error('fallo simulado'), { code: 'ER_SIMULADO' });
        return conn.query(sql, params as never);
      } }))).rejects.toThrow('DDL 3/3');
      expect(await objetos(pool)).toEqual({ tablas: 2, columnas: 0 });
      await expect(instalar(pool)).rejects.toThrow('instalación parcial');
      const antes = await objetos(pool);
      const [diagnostico] = await pool.query<Fila[][]>(leer('sql/recuperacion-canecas-catalogos-solo-lectura.sql'));
      expect(Array.isArray(diagnostico)).toBe(true);
      expect(await objetos(pool)).toEqual(antes);
      // Restauración del respaldo (aquí: base nueva con el mismo estado previo) y reintento correcto.
      await pool.end();
      pool = await crearBase(BASES[3]);
      await prepararBase(pool);
      await expect(instalar(pool)).resolves.toMatchObject({ instalado: true });
      const caso = async (alterar: string, seccion: string, restaurar: string) => {
        await pool.query(alterar);
        await expect(verificar(pool)).rejects.toThrow(seccion);
        await expect(instalar(pool)).rejects.toThrow('instalación parcial');
        await pool.query(restaurar);
        await expect(verificar(pool)).resolves.toBeUndefined();
      };
      await caso('ALTER TABLE canecas_proveedores MODIFY telefono VARCHAR(30) NULL', 'columnas', 'ALTER TABLE canecas_proveedores MODIFY telefono VARCHAR(40) NULL');
      await caso('CREATE INDEX idx_extra_cli ON canecas_clientes (telefono)', 'indices', 'DROP INDEX idx_extra_cli ON canecas_clientes');
      await caso('ALTER TABLE canecas_compras DROP CONSTRAINT chk_can_compra_proveedor', 'checks', 'ALTER TABLE canecas_compras ADD CONSTRAINT chk_can_compra_proveedor CHECK (proveedor_id IS NOT NULL OR canecas_proveedor_id IS NOT NULL)');
      await caso('ALTER TABLE canecas_compras DROP FOREIGN KEY fk_can_compra_canecas_proveedor', 'foraneas', 'ALTER TABLE canecas_compras ADD CONSTRAINT fk_can_compra_canecas_proveedor FOREIGN KEY (empresa_id,canecas_proveedor_id) REFERENCES canecas_proveedores(empresa_id,id)');
      await expect(instalar(pool)).resolves.toMatchObject({ instalado: false, yaInstalado: true });
    } finally { await pool.end(); }
  }, 120000);

  it('limpia las bases desechables', async () => {
    const admin = await mysql.createConnection(opciones());
    try { for (const b of BASES) await admin.query(`DROP DATABASE IF EXISTS ${b}`); } finally { await admin.end(); }
  });
});
