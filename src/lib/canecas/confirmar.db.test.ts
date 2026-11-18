import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { confirmarRecepcion } from "./confirmar";

const pipe = process.env.CANECAS_TEST_PIPE;
describe.skipIf(!pipe)("confirmación contra MariaDB aislada", () => {
  const pool = mysql.createPool({ socketPath: `\\\\.\\pipe\\${pipe}`, user: "root", database: "canecas_test", multipleStatements: true, connectionLimit: 8 });
  beforeAll(async () => {
    const schema = readFileSync("sql/schema.sql", "utf8");
    for (const tabla of ["empresas","usuarios","empleados","compras_proveedores","auditoria"]) {
      const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
      if (!ddl) throw new Error(`Falta definición ${tabla}`);
      await pool.query(ddl[0]);
    }
    await pool.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a'),(2,'B','B','b');
      INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'test','hash','salt');
      INSERT INTO empleados (id,empresa_id,codigo,nombre) VALUES (1,1,'A','Ana'),(2,2,'B','Berta');
      INSERT INTO compras_proveedores (id,empresa_id,nombre_comercial,nombre_normalizado) VALUES (1,1,'A','A'),(2,2,'B','B');`);
    const [preflight] = await pool.query<mysql.RowDataPacket[][]>(readFileSync("sql/preflight-2026-11-canecas-fase1.sql", "utf8"));
    expect(preflight[0][0].estado_motor).toBe("APTO");
    expect(preflight[1].find(r => r.prueba === "RESULTADO")?.estado).toBe("APTO");
    await pool.query(readFileSync("sql/migrate-2026-11-canecas-fase1.sql", "utf8"));
    await pool.query(readFileSync("sql/migrate-2026-11-canecas-fase1.sql", "utf8"));
    await pool.query(`INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES
      (1,1,'A','Aceite','Caneca',5,'galones','caneca'),(2,2,'A','Aceite','Caneca',5,'galones','caneca');
      INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Bodega'),(2,2,'Bodega');
      INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion) VALUES
      (1,1,1,'FAC-1',1,30,1,'compra-1'),(2,2,2,'FAC-2',2,10,1,'compra-2');
      INSERT INTO canecas_recepciones (id,empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,creado_por) VALUES
      (1,1,1,1,1,'recepcion-1',20,1),(2,1,1,1,1,'recepcion-2',10,1),(3,1,1,1,1,'recepcion-3',1,1);`);
  });
  afterAll(async () => { await pool.end(); });
  it("serializa dobles confirmaciones y acumula recepciones parciales", async () => {
    const results = await Promise.all([confirmarRecepcion(pool,1,1,1), confirmarRecepcion(pool,1,1,1), confirmarRecepcion(pool,1,2,1)]);
    expect(results.filter(r => r.yaConfirmada)).toHaveLength(1);
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT fisico,reservado FROM canecas_saldos WHERE empresa_id=1");
    expect(rows[0]).toMatchObject({ fisico: 30, reservado: 0 });
    const [movs] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n, SUM(cantidad) AS total FROM canecas_movimientos WHERE empresa_id=1");
    expect(Number(movs[0].n)).toBe(2);
    expect(Number(movs[0].total)).toBe(30);
  });
  it("rechaza el exceso y el acceso cruzado sin alterar el saldo", async () => {
    await expect(confirmarRecepcion(pool,1,3,1)).rejects.toThrow("CANTIDAD_EXCEDE_COMPRA");
    await expect(confirmarRecepcion(pool,2,1,1)).rejects.toThrow("RECEPCION_NO_ENCONTRADA");
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT fisico FROM canecas_saldos WHERE empresa_id=1");
    expect(rows[0].fisico).toBe(30);
    await expect(pool.query("INSERT INTO canecas_recepciones (empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,creado_por) VALUES (1,1,2,1,'cruce',1,1)")).rejects.toThrow();
  });
  it("acumula compras distintas concurrentes sobre el mismo saldo", async () => {
    await pool.query(`INSERT INTO canecas_compras (id,empresa_id,proveedor_id,referencia,producto_id,cantidad,creado_por,clave_operacion) VALUES
      (3,1,1,'FAC-3',1,4,1,'compra-3'),(4,1,1,'FAC-4',1,6,1,'compra-4');
      INSERT INTO canecas_recepciones (id,empresa_id,compra_id,ubicacion_id,recibido_por_empleado_id,clave_operacion,cantidad,creado_por) VALUES
      (4,1,3,1,1,'recepcion-4',4,1),(5,1,4,1,1,'recepcion-5',6,1);`);
    await Promise.all([confirmarRecepcion(pool,1,4,1),confirmarRecepcion(pool,1,5,1)]);
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT fisico FROM canecas_saldos WHERE empresa_id=1");
    const [movs] = await pool.query<mysql.RowDataPacket[]>("SELECT SUM(cantidad) AS total FROM canecas_movimientos WHERE empresa_id=1");
    expect(rows[0].fisico).toBe(40);
    expect(Number(movs[0].total)).toBe(40);
    const [postcheck] = await pool.query<mysql.RowDataPacket[][]>(readFileSync("sql/postcheck-2026-11-canecas-fase1.sql", "utf8"));
    expect(postcheck[0].filter(r => r.estado !== "APTO")).toEqual([]);
    expect(postcheck[0].find(r => r.prueba === "RESULTADO")?.estado).toBe("APTO");
    expect(postcheck.slice(1).every(rows => rows.length === 0)).toBe(true);
  });
  it("detecta movimientos cargados con referencias de otra empresa", async () => {
    const conn = await pool.getConnection();
    try {
      await conn.query("SET SESSION foreign_key_checks=0");
      await conn.query("INSERT INTO canecas_movimientos (empresa_id,producto_id,ubicacion_id,tipo,cantidad,documento,usuario_id) VALUES (1,2,1,'ENTRADA',1,'invalido',1)");
      await conn.query("SET SESSION foreign_key_checks=1");
      const [postcheck] = await conn.query<mysql.RowDataPacket[][]>(readFileSync("sql/postcheck-2026-11-canecas-fase1.sql", "utf8"));
      expect(postcheck[4].some(r => r.movimiento === "movimiento")).toBe(true);
    } finally {
      await conn.query("SET SESSION foreign_key_checks=1");
      conn.release();
    }
  });
});
