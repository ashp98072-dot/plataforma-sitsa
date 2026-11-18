import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { confirmarRecepcion } from "./confirmar";

const pipe = process.env.CANECAS_TEST_PIPE;
describe.skipIf(!pipe)("confirmación contra MariaDB aislada", () => {
  const pool = mysql.createPool({ socketPath: `\\\\.\\pipe\\${pipe}`, user: "root", database: "canecas_test", multipleStatements: true, connectionLimit: 8 });
  beforeAll(async () => {
    await pool.query(`CREATE TABLE empresas (id INT PRIMARY KEY) ENGINE=InnoDB;
      CREATE TABLE usuarios (id INT PRIMARY KEY) ENGINE=InnoDB;
      CREATE TABLE empleados (id INT PRIMARY KEY, empresa_id INT NOT NULL, UNIQUE KEY (empresa_id,id)) ENGINE=InnoDB;
      CREATE TABLE compras_proveedores (id INT PRIMARY KEY, empresa_id INT NOT NULL, UNIQUE KEY (empresa_id,id)) ENGINE=InnoDB;
      INSERT INTO empresas VALUES (1),(2); INSERT INTO usuarios VALUES (1);
      INSERT INTO empleados VALUES (1,1),(2,2); INSERT INTO compras_proveedores VALUES (1,1),(2,2);`);
    await pool.query(readFileSync("sql/preflight-2026-11-canecas-fase1.sql", "utf8"));
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
    expect(postcheck[0]).toHaveLength(6);
    expect(postcheck.slice(1).every(rows => rows.length === 0)).toBe(true);
  });
});
