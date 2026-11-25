// Ayudas SOLO para los laboratorios MariaDB de la simplificación (#688). No se importa desde código de producción.
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { confirmarRecepcion } from './confirmar';
import { ejecutarRedistribucionControlado } from '../../../scripts/ci/canecas/ejecutar-redistribucion-controlado.mjs';
import { ejecutarCatalogosControlado } from '../../../scripts/ci/canecas/ejecutar-catalogos-controlado.mjs';
import { ejecutarVentasControlado } from '../../../scripts/ci/canecas/ejecutar-ventas-controlado.mjs';

const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
const socket = process.env.CANECAS_REDIS_TEST_SOCKET;
export const hayLaboratorio = Boolean(pipe || socket);
export const opciones = (database?: string) => ({ socketPath: socket ?? `\\\\.\\pipe\\${pipe}`, user: 'root', multipleStatements: true, ...(database ? { database } : {}) });
export type Fila = mysql.RowDataPacket;
export const leer = (archivo: string) => readFileSync(archivo, 'utf8');
export const sentenciasTrigger = (archivo: string) => (leer(archivo).split('DELIMITER //')[1] ?? '').replace(/DELIMITER ;\s*$/, '').split('//').map(s => s.trim()).filter(s => /^CREATE (OR REPLACE )?TRIGGER /.test(s));

/** Aplica una migración WIP: el DDL y luego sus triggers (equivalente a lo que hacen los instaladores controlados). */
export async function aplicar(pool: mysql.Pool, archivo: string) {
  const [ddl] = leer(archivo).split('DELIMITER //');
  await pool.query(ddl);
  for (const t of sentenciasTrigger(archivo)) await pool.query(t);
}
export async function crearBase(nombre: string, limite = 8) {
  const admin = await mysql.createConnection(opciones());
  try { await admin.query(`DROP DATABASE IF EXISTS ${nombre}; CREATE DATABASE ${nombre}`); } finally { await admin.end(); }
  return mysql.createPool({ ...opciones(nombre), connectionLimit: limite });
}
export const instaladorEn = async (pool: mysql.Pool, f: (c: never) => Promise<unknown>) => { const c = await pool.getConnection(); try { return await f(c as never); } finally { c.release(); } };

/**
 * Estado previo a la simplificación: fase 1, costos, salidas, redistribución, catálogos y ventas instalados (los tres últimos con sus
 * instaladores controlados). Siembra empresa 1 (y 2 con `dosEmpresas`), usuario, empleado y proveedor anterior. `historial` agrega
 * un producto, una bodega y una compra histórica confirmada de 20 canecas a Q100.00.
 */
export async function prepararBaseHastaVentas(pool: mysql.Pool, { historial = false, dosEmpresas = false } = {}) {
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
  await pool.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a')${dosEmpresas ? ",(2,'B','B','b')" : ''};
    INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'test','hash','salt');
    INSERT INTO empleados (id,empresa_id,codigo,nombre) VALUES (1,1,'A','Ana'),(2,1,'A2','Beto')${dosEmpresas ? ",(3,2,'B','Carla')" : ''};
    INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (1,1,'Proveedor anterior','PROVEEDOR ANTERIOR');`);
  if (historial) {
    await pool.query(`INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,1,'A','Caneca','Caneca',5,'litros','caneca');
      INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega');
      INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion,precio_unitario_centavos,gastos_centavos,moneda) VALUES (1,1,1,'C1',1,20,1,'compra-1',10000,0,'GTQ');
      INSERT INTO canecas_recepciones (id,empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,creado_por) VALUES (1,1,1,1,1,'recepcion-1',20,1);`);
    await confirmarRecepcion(pool, 1, 1, 1);
  }
  await instaladorEn(pool, c => ejecutarCatalogosControlado(c));
  await instaladorEn(pool, c => ejecutarVentasControlado(c));
}
export const k = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
