import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { confirmarRecepcion } from './confirmar';
import { consultarCapasFifo, ORDEN_FIFO } from './orden-fifo';
import { registrarRedistribucion } from './redistribucion';
import { registrarSalidaFifo } from './salidas-fifo';
import { ejecutarRedistribucionControlado } from '../../../scripts/ci/canecas/ejecutar-redistribucion-controlado.mjs';
import { verificarContratoRedistribucion } from '../../../scripts/ci/canecas/contrato-redistribucion.mjs';

// Lab Windows: CANECAS_FIFO_TEST_PIPE. Lab Linux: CANECAS_REDIS_TEST_SOCKET. Crea y elimina sus propias bases desechables.
const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
const socket = process.env.CANECAS_REDIS_TEST_SOCKET;
const opciones = (database?: string) => ({ socketPath: socket ?? `\\\\.\\pipe\\${pipe}`, user: 'root', multipleStatements: true, ...(database ? { database } : {}) });
type Fila = mysql.RowDataPacket;
const leer = (archivo: string) => readFileSync(archivo, 'utf8');
const sentenciasTrigger = (archivo: string) => (leer(archivo).split('DELIMITER //')[1] ?? '').replace(/DELIMITER ;\s*$/, '').split('//').map(s => s.trim()).filter(s => /^CREATE (OR REPLACE )?TRIGGER /.test(s));
const triggerRedistribucion = (nombre: string) => sentenciasTrigger('sql/migrate-2026-11-canecas-redistribucion-wip.sql').find(s => new RegExp(`TRIGGER ${nombre}\\s`).test(s)) as string;
const BASES = ['canecas_redis_inst_a', 'canecas_redis_inst_b', 'canecas_redis_inst_c', 'canecas_redis_inst_d1', 'canecas_redis_inst_d2'];

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
// Estado previo equivalente al de producción tras instalar costos y (opcionalmente) salidas.
async function prepararBase(pool: mysql.Pool, { salidas = true } = {}) {
  const schema = leer('sql/schema.sql');
  for (const tabla of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
    const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
    if (!ddl) throw Error(`Falta ${tabla}`);
    await pool.query(ddl[0]);
  }
  await pool.query(leer('sql/migrate-2026-11-canecas-fase1.sql'));
  await aplicar(pool, 'sql/migrate-2026-11-canecas-costos-wip.sql');
  if (salidas) await aplicar(pool, 'sql/migrate-2026-11-canecas-salidas-fifo-wip.sql');
}
async function sembrar(pool: mysql.Pool) {
  await pool.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a');
    INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'test','hash','salt');
    INSERT INTO empleados (id,empresa_id,codigo,nombre) VALUES (1,1,'A','Ana');
    INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (1,1,'A','A');
    INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,1,'A','Caneca','Caneca',5,'litros','caneca');
    INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega');
    INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion,precio_unitario_centavos,gastos_centavos,moneda) VALUES (1,1,1,'C1',1,20,1,'compra-1',10000,0,'GTQ');
    INSERT INTO canecas_recepciones (id,empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,creado_por) VALUES (1,1,1,1,1,'recepcion-1',20,1);`);
  await confirmarRecepcion(pool, 1, 1, 1);
}
async function instalar(pool: mysql.Pool, envoltura?: (c: mysql.PoolConnection) => unknown) {
  const conn = await pool.getConnection();
  try { return await ejecutarRedistribucionControlado(envoltura ? envoltura(conn) : conn); } finally { conn.release(); }
}
const objetos = async (pool: mysql.Pool) => {
  const [r] = await pool.query<Fila[]>(`SELECT
    (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_redistribuciones','canecas_redistribuciones_origen')) tablas,
    (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_capas_costo' AND COLUMN_NAME IN ('redistribucion_id','orden_fifo')) columnas,
    (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME LIKE 'trg_can_redis%') triggers`);
  return { tablas: Number(r[0].tablas), columnas: Number(r[0].columnas), triggers: Number(r[0].triggers) };
};
const sinObjetos = { tablas: 0, columnas: 0, triggers: 0 };

describe.skipIf(!pipe && !socket)('instalador controlado de redistribución en MariaDB 11.8.9 desechable', () => {
  it('rechaza estados previos incorrectos sin ejecutar DDL y luego instala', async () => {
    const pool = await crearBase(BASES[0]);
    try {
      await prepararBase(pool, { salidas: false });
      await expect(instalar(pool)).rejects.toThrow('salidas');
      expect(await objetos(pool)).toEqual(sinObjetos);
      await aplicar(pool, 'sql/migrate-2026-11-canecas-salidas-fifo-wip.sql');
      await pool.query('ALTER TABLE canecas_capas_costo MODIFY moneda CHAR(4) NULL');
      await expect(instalar(pool)).rejects.toThrow('columnas');
      expect(await objetos(pool)).toEqual(sinObjetos);
      await pool.query('ALTER TABLE canecas_capas_costo MODIFY moneda CHAR(3) NULL');
      await expect(instalar(pool)).resolves.toEqual({ instalado: true, yaInstalado: false });
    } finally { await pool.end(); }
  }, 60000);

  it('instalación limpia: conserva datos, valida orden_fifo y el criterio FIFO, y es idempotente', async () => {
    const pool = await crearBase(BASES[1]);
    try {
      await prepararBase(pool);
      await sembrar(pool);
      const instantanea = async () => ({
        capas: (await pool.query<Fila[]>('SELECT id,empresa_id,producto_id,ubicacion_id,recepcion_id,valoracion_id,segmento,cantidad_inicial,cantidad_disponible,costo_unitario_centavos,moneda,creado_en FROM canecas_capas_costo ORDER BY id'))[0],
        saldos: (await pool.query<Fila[]>('SELECT * FROM canecas_saldos'))[0],
        movimientos: (await pool.query<Fila[]>('SELECT * FROM canecas_movimientos ORDER BY id'))[0],
        compras: (await pool.query<Fila[]>('SELECT * FROM canecas_compras'))[0],
      });
      const antes = await instantanea();
      expect(antes.capas).toHaveLength(1);
      expect(await instalar(pool)).toEqual({ instalado: true, yaInstalado: false });
      expect(await instantanea()).toEqual(antes); // sin alterar datos históricos
      expect(await objetos(pool)).toEqual({ tablas: 2, columnas: 2, triggers: 4 });
      await expect(verificarContratoRedistribucion(await pool.getConnection())).resolves.toBeUndefined();
      const [col] = await pool.query<Fila[]>("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_capas_costo' AND COLUMN_NAME IN ('orden_fifo','redistribucion_id') ORDER BY COLUMN_NAME");
      expect(col.map(c => [c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE])).toEqual([['orden_fifo', 'bigint(20)', 'YES'], ['redistribucion_id', 'bigint(20)', 'YES']]);
      // orden_fifo: nulo en capas históricas, solo con redistribución, inmutable.
      const [historica] = await pool.query<Fila[]>('SELECT orden_fifo,redistribucion_id FROM canecas_capas_costo');
      expect(historica[0]).toEqual({ orden_fifo: null, redistribucion_id: null });
      await expect(pool.query('UPDATE canecas_capas_costo SET orden_fifo=5')).rejects.toThrow('Costo historico de capa inmutable');
      await expect(pool.query("INSERT INTO canecas_capas_costo (empresa_id,producto_id,ubicacion_id,recepcion_id,orden_fifo,segmento,cantidad_inicial,cantidad_disponible,costo_unitario_centavos,moneda) VALUES (1,1,1,1,7,9,1,1,1,'GTQ')")).rejects.toThrow(/chk_can_capa_orden/);
      await expect(pool.query("INSERT INTO canecas_capas_costo (empresa_id,producto_id,ubicacion_id,segmento,cantidad_inicial,cantidad_disponible,costo_unitario_centavos,moneda) VALUES (1,1,1,9,1,1,1,'GTQ')")).rejects.toThrow(/chk_can_capa_fuente/);
      // El criterio FIFO que usa el código es ejecutable y el instalador lo comprobó; consultarCapasFifo usa el criterio nuevo.
      const conn = await pool.getConnection();
      try {
        const consultas: string[] = [];
        const espia = { query: (sql: string, params: unknown[]) => { consultas.push(sql); return conn.query(sql, params as never); } } as unknown as mysql.PoolConnection;
        await consultarCapasFifo(espia, orden => `SELECT id FROM canecas_capas_costo WHERE empresa_id=? ORDER BY ${orden}`, [1]);
        expect(consultas).toEqual([`SELECT id FROM canecas_capas_costo WHERE empresa_id=? ORDER BY ${ORDEN_FIFO}`]);
      } finally { conn.release(); }
      // Idempotencia: reintento sin cambios.
      expect(await instalar(pool)).toEqual({ instalado: false, yaInstalado: true });
      expect(await instantanea()).toEqual(antes);
      // Con el esquema instalado, el código opera de extremo a extremo.
      const r = await registrarRedistribucion(pool, 1, 1, { compraId: 1, ubicacionId: 1, cantidadResultante: 25, documento: 'RD-1', motivo: 'Prueba', claveOperacion: '00000000-0000-4000-8000-000000000001' });
      expect(r).toMatchObject({ costoTotalCentavos: '200000', diferencia: 5 });
      const s = await registrarSalidaFifo(pool, 1, 1, { productoId: 1, ubicacionId: 1, cantidad: 8, documento: 'S-1', claveOperacion: '00000000-0000-4000-8000-000000000002' });
      expect(s).toMatchObject({ costoCentavos: '64000' });
    } finally { await pool.end(); }
  }, 60000);

  it('rechaza diferencias estructurales (columnas, índices, CHECK, claves foráneas y triggers) y acepta el estado restaurado', async () => {
    const pool = await crearBase(BASES[2]);
    try {
      await prepararBase(pool);
      await instalar(pool);
      const verificar = async () => { const c = await pool.getConnection(); try { await verificarContratoRedistribucion(c); } finally { c.release(); } };
      const caso = async (alterar: string | string[], seccion: string, restaurar: string | string[]) => {
        for (const s of [alterar].flat()) await pool.query(s);
        await expect(verificar()).rejects.toThrow(seccion);
        await expect(instalar(pool)).rejects.toThrow('instalación parcial');
        for (const s of [restaurar].flat()) await pool.query(s);
        await expect(verificar()).resolves.toBeUndefined();
      };
      await caso('ALTER TABLE canecas_redistribuciones MODIFY documento VARCHAR(240) NOT NULL', 'columnas', 'ALTER TABLE canecas_redistribuciones MODIFY documento VARCHAR(250) NOT NULL');
      await caso('CREATE INDEX idx_extra_orden ON canecas_capas_costo (orden_fifo)', 'indices', 'DROP INDEX idx_extra_orden ON canecas_capas_costo');
      await caso(['ALTER TABLE canecas_capas_costo DROP CONSTRAINT chk_can_capa_orden', 'ALTER TABLE canecas_capas_costo ADD CONSTRAINT chk_can_capa_orden CHECK (orden_fifo IS NULL OR orden_fifo > 0)'], 'checks', ['ALTER TABLE canecas_capas_costo DROP CONSTRAINT chk_can_capa_orden', 'ALTER TABLE canecas_capas_costo ADD CONSTRAINT chk_can_capa_orden CHECK (orden_fifo IS NULL OR (orden_fifo > 0 AND redistribucion_id IS NOT NULL))']);
      await caso('ALTER TABLE canecas_capas_costo DROP FOREIGN KEY fk_can_capa_redistribucion', 'foraneas', 'ALTER TABLE canecas_capas_costo ADD CONSTRAINT fk_can_capa_redistribucion FOREIGN KEY (empresa_id,redistribucion_id) REFERENCES canecas_redistribuciones(empresa_id,id)');
      await caso("CREATE OR REPLACE TRIGGER can_capa_costo_inmutable BEFORE UPDATE ON canecas_capas_costo FOR EACH ROW BEGIN IF 1=2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='otro'; END IF; END", 'definición incompatible del trigger can_capa_costo_inmutable', sentenciasTrigger('sql/migrate-2026-11-canecas-redistribucion-wip.sql').find(s => s.includes('can_capa_costo_inmutable')) as string);
      await caso('DROP TRIGGER trg_can_redis_bd', 'incompletos', triggerRedistribucion('trg_can_redis_bd'));
      await expect(instalar(pool)).resolves.toEqual({ instalado: false, yaInstalado: true });
    } finally { await pool.end(); }
  }, 90000);

  it('fallo intermedio: instalación parcial detectada, diagnóstico de solo lectura y reintento sobre estado restaurado', async () => {
    // Fallo 1: advertencia DDL justo después de crear la primera tabla.
    const pool1 = await crearBase(BASES[3]);
    try {
      await prepararBase(pool1);
      await expect(instalar(pool1, conn => ({ query: async (sql: string, params?: unknown) => {
        if (sql === 'SHOW WARNINGS' && globalThis.__redisPrimera) return [[{ Level: 'Warning', Code: 1, Message: 'simulada' }], []];
        const resultado = await conn.query(sql, params as never);
        if (sql.includes('CREATE TABLE canecas_redistribuciones (')) globalThis.__redisPrimera = true;
        return resultado;
      } }))).rejects.toThrow('advertencias DDL');
      globalThis.__redisPrimera = false;
      expect(await objetos(pool1)).toEqual({ tablas: 1, columnas: 0, triggers: 0 });
      await expect(instalar(pool1)).rejects.toThrow('instalación parcial');
      // Recuperación del prefijo conocido únicamente en esta base desechable (en producción: restaurar el respaldo).
      await pool1.query('DROP TABLE canecas_redistribuciones');
      await expect(instalar(pool1)).resolves.toEqual({ instalado: true, yaInstalado: false });
    } finally { await pool1.end(); }

    // Fallo 2: error al reemplazar el trigger de capas, con tablas y columnas ya aplicadas.
    let pool2 = await crearBase(BASES[4]);
    try {
      await prepararBase(pool2);
      await sembrar(pool2);
      await expect(instalar(pool2, conn => ({ query: async (sql: string, params?: unknown) => {
        if (sql.startsWith('CREATE OR REPLACE TRIGGER can_capa_costo_inmutable')) throw Object.assign(new Error('fallo simulado'), { code: 'ER_SIMULADO' });
        return conn.query(sql, params as never);
      } }))).rejects.toThrow('DDL 4/8');
      expect(await objetos(pool2)).toEqual({ tablas: 2, columnas: 2, triggers: 0 });
      await expect(instalar(pool2)).rejects.toThrow('instalación parcial');
      // El diagnóstico de solo lectura se ejecuta completo sobre el estado parcial y no modifica nada.
      const antes = await objetos(pool2);
      const [diagnostico] = await pool2.query<Fila[][]>(leer('sql/recuperacion-canecas-redistribucion-solo-lectura.sql'));
      expect(Array.isArray(diagnostico)).toBe(true);
      expect(await objetos(pool2)).toEqual(antes);
      // Restauración del respaldo (aquí: base nueva con el mismo estado previo) y reintento.
      await pool2.end();
      pool2 = await crearBase(BASES[4]);
      await prepararBase(pool2);
      await sembrar(pool2);
      await expect(instalar(pool2)).resolves.toEqual({ instalado: true, yaInstalado: false });
    } finally { await pool2.end(); }
  }, 90000);

  it('limpia las bases desechables', async () => {
    const admin = await mysql.createConnection(opciones());
    try { for (const b of BASES) await admin.query(`DROP DATABASE IF EXISTS ${b}`); } finally { await admin.end(); }
  });
});

declare global { var __redisPrimera: boolean | undefined; }
