import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { cambiarEstadoCatalogo, crearCatalogo, editarCatalogo, ErrorCatalogoDuplicado, ErrorCatalogoNoEncontrado, listarCatalogo, mapearProveedorCompra, proveedorActivo } from './catalogos';

// Lab Windows: CANECAS_FIFO_TEST_PIPE. Lab Linux: CANECAS_REDIS_TEST_SOCKET. Crea y elimina su propia base desechable.
const pipe = process.env.CANECAS_FIFO_TEST_PIPE;
const socket = process.env.CANECAS_REDIS_TEST_SOCKET;
const opciones = (database?: string) => ({ socketPath: socket ?? `\\\\.\\pipe\\${pipe}`, user: 'root', multipleStatements: true, ...(database ? { database } : {}) });
type Fila = mysql.RowDataPacket;
const BASE = 'canecas_cat_lib_test';
const leer = (archivo: string) => readFileSync(archivo, 'utf8');

describe.skipIf(!pipe && !socket)('catálogos exclusivos de Canecas en MariaDB desechable', () => {
  it('aísla empresas, evita duplicados, respeta inactivos, no toca Operaciones y mapea compras históricas sin alterar datos', async () => {
    const admin = await mysql.createConnection(opciones());
    await admin.query(`DROP DATABASE IF EXISTS ${BASE}; CREATE DATABASE ${BASE}`);
    await admin.end();
    const pool = mysql.createPool({ ...opciones(BASE), connectionLimit: 8 });
    try {
      const schema = leer('sql/schema.sql');
      for (const tabla of ['empresas', 'usuarios', 'empleados', 'compras_proveedores', 'auditoria']) {
        const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
        if (!ddl) throw Error(`Falta ${tabla}`);
        await pool.query(ddl[0]);
      }
      await pool.query(leer('sql/migrate-2026-11-canecas-fase1.sql'));
      await pool.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a'),(2,'B','B','b');
        INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'ana','hash','salt'),(2,'beto','hash','salt');
        INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (1,1,'Aceites del Sur','ACEITES DEL SUR');
        INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,1,'A','Caneca','Caneca',5,'litros','caneca');
        INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion) VALUES (1,1,1,'HIST-1',1,20,1,'hist-1'),(2,1,1,'HIST-2',1,10,1,'hist-2');`);
      const historicas = async () => (await pool.query<Fila[]>('SELECT * FROM canecas_compras ORDER BY id'))[0];
      const proveedoresCompras = async () => (await pool.query<Fila[]>('SELECT * FROM compras_proveedores ORDER BY id'))[0];
      const comprasAntes = await historicas();
      const operacionesAntes = await proveedoresCompras();
      // Migración (aditiva) sobre una base con compras históricas.
      const [ddl] = leer('sql/migrate-2026-11-canecas-catalogos-wip.sql').split('DELIMITER //');
      await pool.query(ddl);
      expect((await historicas()).map(c => ({ ...c, canecas_proveedor_id: undefined }))).toEqual(comprasAntes.map(c => ({ ...c, canecas_proveedor_id: undefined })));

      // Independencia: crear en Canecas no escribe en Compras y lo de Compras no aparece en Canecas.
      const a = await crearCatalogo(pool, 'proveedores', 1, 1, { nombre_comercial: 'Aceites del Sur', nit: '1234567-8', telefono: '5555-1111', direccion: 'Zona 4' });
      expect(await proveedoresCompras()).toEqual(operacionesAntes);
      expect((await listarCatalogo(pool, 'proveedores', 1)).map(r => r.nombre_comercial)).toEqual(['Aceites del Sur']);
      expect(a).toBe(1);
      await pool.query("INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (2,1,'Solo en Compras','SOLO EN COMPRAS')");
      expect((await listarCatalogo(pool, 'proveedores', 1)).map(r => r.nombre_comercial)).not.toContain('Solo en Compras');

      // Aislamiento por empresa: mismo nombre y NIT permitidos en otra empresa; nada se ve ni se edita entre empresas.
      const b = await crearCatalogo(pool, 'proveedores', 2, 2, { nombre_comercial: 'Aceites del Sur', nit: '1234567-8', telefono: null, direccion: null });
      expect((await listarCatalogo(pool, 'proveedores', 2)).map(r => r.id)).toEqual([b]);
      await expect(editarCatalogo(pool, 'proveedores', 2, 2, a, { nombre_comercial: 'Intruso', nit: null, telefono: null, direccion: null })).rejects.toBeInstanceOf(ErrorCatalogoNoEncontrado);
      await expect(cambiarEstadoCatalogo(pool, 'proveedores', 2, 2, a, false)).rejects.toBeInstanceOf(ErrorCatalogoNoEncontrado);
      expect((await listarCatalogo(pool, 'proveedores', 1))[0]).toMatchObject({ nombre_comercial: 'Aceites del Sur', activo: 1 });
      expect(await proveedorActivo(pool, 2, a)).toBe(false);

      // Duplicados: acentos, mayúsculas, espacios y formato del NIT; los NIT vacíos no chocan.
      await expect(crearCatalogo(pool, 'proveedores', 1, 1, { nombre_comercial: '  ACEITES   del   sur ', nit: null, telefono: null, direccion: null })).rejects.toMatchObject({ campo: 'nombre' });
      await expect(crearCatalogo(pool, 'proveedores', 1, 1, { nombre_comercial: 'Aceites Del Sür', nit: null, telefono: null, direccion: null })).rejects.toBeInstanceOf(ErrorCatalogoDuplicado);
      await expect(crearCatalogo(pool, 'proveedores', 1, 1, { nombre_comercial: 'Otro nombre', nit: '1234567 8', telefono: null, direccion: null })).rejects.toMatchObject({ campo: 'nit' });
      const sinNit1 = await crearCatalogo(pool, 'proveedores', 1, 1, { nombre_comercial: 'Sin NIT uno', nit: null, telefono: null, direccion: null });
      const sinNit2 = await crearCatalogo(pool, 'proveedores', 1, 1, { nombre_comercial: 'Sin NIT dos', nit: '', telefono: null, direccion: null } as never);
      expect(sinNit1).not.toBe(sinNit2);
      await expect(editarCatalogo(pool, 'proveedores', 1, 1, sinNit2, { nombre_comercial: 'sin nit UNO', nit: null, telefono: null, direccion: null })).rejects.toBeInstanceOf(ErrorCatalogoDuplicado);
      await editarCatalogo(pool, 'proveedores', 1, 1, a, { nombre_comercial: 'Aceites del Sur', nit: '1234567-8', telefono: '5555-2222', direccion: 'Zona 4' }); // sin cambiar su identidad
      expect((await listarCatalogo(pool, 'proveedores', 1)).find(r => r.id === a)).toMatchObject({ telefono: '5555-2222' });
      // Red de seguridad de la base de datos ante una carrera.
      await expect(pool.query("INSERT INTO canecas_proveedores (empresa_id,nombre_comercial,nombre_normalizado,creado_por) VALUES (1,'x','ACEITES DEL SUR',1)")).rejects.toThrow(/uq_can_prov_nombre/);
      const carrera = await Promise.allSettled([1, 2].map(() => crearCatalogo(pool, 'clientes', 1, 1, { nombre_comercial: 'Cliente Carrera', nit: null, telefono: null, direccion: null })));
      expect(carrera.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(carrera.filter(r => r.status === 'rejected')).toHaveLength(1);

      // Clientes: catálogo independiente del de proveedores y por empresa; inactivos listados pero no operables.
      const c1 = await crearCatalogo(pool, 'clientes', 1, 1, { nombre_comercial: 'Aceites del Sur', nit: '1234567-8', telefono: null, direccion: null });
      expect(c1).toBeGreaterThan(0); // mismo nombre/NIT que un proveedor: son catálogos distintos
      await cambiarEstadoCatalogo(pool, 'clientes', 1, 1, c1, false);
      expect((await listarCatalogo(pool, 'clientes', 1)).find(r => r.id === c1)).toMatchObject({ activo: 0, estado: 'Inactivo' });
      expect((await listarCatalogo(pool, 'clientes', 2))).toEqual([]);
      await cambiarEstadoCatalogo(pool, 'proveedores', 1, 1, sinNit1, false);
      expect(await proveedorActivo(pool, 1, sinNit1)).toBe(false);
      expect(await proveedorActivo(pool, 1, a)).toBe(true);
      const [auditoria] = await pool.query<Fila[]>('SELECT creado_por,actualizado_por FROM canecas_proveedores WHERE id=?', [a]);
      expect(auditoria[0]).toEqual({ creado_por: 1, actualizado_por: 1 });

      // Mapeo manual de compras históricas: no modifica proveedor_id y exige proveedor activo de la misma empresa.
      await expect(mapearProveedorCompra(pool, 1, 1, 1, sinNit1)).rejects.toThrow('PROVEEDOR_INVALIDO'); // inactivo
      await expect(mapearProveedorCompra(pool, 1, 1, 1, b)).rejects.toThrow('PROVEEDOR_INVALIDO'); // de otra empresa
      await expect(mapearProveedorCompra(pool, 2, 2, 1, b)).rejects.toBeInstanceOf(ErrorCatalogoNoEncontrado); // compra de otra empresa
      await mapearProveedorCompra(pool, 1, 1, 1, a);
      await expect(mapearProveedorCompra(pool, 1, 1, 1, a)).rejects.toThrow('COMPRA_YA_MAPEADA');
      const finales = await historicas();
      expect(finales[0]).toMatchObject({ id: 1, proveedor_id: 1, canecas_proveedor_id: a }); // proveedor_id intacto
      expect(finales[1]).toMatchObject({ id: 2, proveedor_id: 1, canecas_proveedor_id: null }); // sin mapeo automático
      expect(await proveedoresCompras()).toEqual([...operacionesAntes, expect.objectContaining({ id: 2 })]);
    } finally { await pool.end(); const limpia = await mysql.createConnection(opciones()); try { await limpia.query(`DROP DATABASE IF EXISTS ${BASE}`); } finally { await limpia.end(); } }
  }, 90000);
});
