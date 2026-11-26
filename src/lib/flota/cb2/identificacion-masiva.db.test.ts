import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({ getPool: () => estado.pool, query: async (sql: string, args: unknown[] = []) => (await estado.pool!.query(sql, args))[0] }));
import { confirmarIdentificacion, vistaIdentificacion } from "./identificacion-masiva-service";

const pipe = process.env.CB2_TEST_PIPE ?? "";
const barra = String.fromCharCode(92), base = "cb2_masiva_lab";
let admin: mysql.Connection;
const ctx = { empresaId: 1, proveedorId: 3, actor: { id: 4, username: "SINTETICO" }, autorizar: async () => {} };
const op = { nombre: "Jaime Calderon", empleadoId: 8, proveedorId: 3, motivo: "Identificación confirmada", clave: "1234567890123456", items: [{ id: 1, revision: 0 }, { id: 2, revision: 0 }] };
const q = async (sql: string) => (await estado.pool!.query<RowDataPacket[]>(sql))[0];

describe.skipIf(!pipe)("identificación masiva en MariaDB aislada", () => {
  beforeAll(async () => {
    if (!/^cb2-508-[0-9a-f-]{36}$/.test(pipe)) throw Error("Pipe no autorizado");
    admin = await mysql.createConnection({ socketPath: `${barra}${barra}.${barra}pipe${barra}${pipe}`, user: "root", password: "", multipleStatements: true });
    const [[v]] = await admin.query<RowDataPacket[]>("SELECT VERSION() v,@@skip_networking aislado,@@socket pipe");
    if (!String(v.v).startsWith("11.8.9-MariaDB") || Number(v.aislado) !== 1 || v.pipe !== pipe) throw Error("Servidor no aislado");
    await admin.query(`CREATE DATABASE ${base} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; USE ${base};
      CREATE TABLE compras_proveedores (id INT,empresa_id INT,nombre_comercial VARCHAR(100),activo INT,PRIMARY KEY(empresa_id,id)) ENGINE=InnoDB;
      CREATE TABLE empleados (id INT PRIMARY KEY,empresa_id INT,nombre VARCHAR(100),estado VARCHAR(20)) ENGINE=InnoDB;
      CREATE TABLE flota_cb2_consumos (id INT PRIMARY KEY,empresa_id INT,proveedor_id INT,piloto_informado VARCHAR(255),empleado_id INT NULL,revision_asignacion INT NOT NULL DEFAULT 0,vehiculo_id INT,producto_clasificado VARCHAR(32),galones DECIMAL(18,6),monto DECIMAL(18,6)) ENGINE=InnoDB;
      CREATE TABLE flota_cb2_asignaciones (id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT,proveedor_id INT,consumo_id INT,clave VARCHAR(64),digest CHAR(64),anterior LONGTEXT,nuevo LONGTEXT,motivo VARCHAR(1000),usuario_id INT,creado_en DATETIME(6),UNIQUE KEY(empresa_id,proveedor_id,clave)) ENGINE=InnoDB;
      CREATE TABLE auditoria (id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT,usuario VARCHAR(100),accion VARCHAR(100),modulo VARCHAR(100),detalle LONGTEXT) ENGINE=InnoDB;
      INSERT INTO compras_proveedores VALUES (3,1,'Uno',1),(4,1,'Dos',1),(3,2,'Ajeno',1);
      INSERT INTO empleados VALUES (8,1,'Jayme Calderón','Activo'),(9,1,'Otra Persona','Activo'),(10,2,'Ajeno','Activo');`);
    estado.pool = mysql.createPool({ socketPath: `${barra}${barra}.${barra}pipe${barra}${pipe}`, user: "root", password: "", database: base, connectionLimit: 6, dateStrings: true, multipleStatements: true });
  }, 120000);
  afterAll(async () => { await estado.pool?.end(); await admin?.end(); });
  beforeEach(async () => {
    await estado.pool!.query("DELETE FROM auditoria; DELETE FROM flota_cb2_asignaciones; DELETE FROM flota_cb2_consumos");
    await estado.pool!.query("INSERT INTO flota_cb2_consumos VALUES (1,1,3,'Jaime Calderon',NULL,0,11,'DIESEL',10,50),(2,1,3,'JAIME  CALDERON',NULL,0,12,'DIESEL',20,100),(3,1,3,'Jaime Calderon',9,0,13,'DIESEL',30,150),(4,1,4,'Jaime Calderon',NULL,0,14,'DIESEL',40,200),(5,2,3,'Jaime Calderon',NULL,0,15,'DIESEL',50,250)");
  });
  it("agrupa por proveedor y conserva datos, empresa y asignaciones existentes", async () => {
    const antes = await q("SELECT * FROM flota_cb2_consumos ORDER BY id");
    const vista = await vistaIdentificacion(1, op);
    expect(vista.proveedores.map(p => [p.proveedorId, p.pendientes.length, p.conflictos])).toEqual([[3, 2, 1], [4, 1, 0]]);
    expect(await confirmarIdentificacion(ctx, op)).toMatchObject({ actualizados: 2 });
    expect(await confirmarIdentificacion(ctx, op)).toMatchObject({ repetidos: 2 });
    const despues = await q("SELECT * FROM flota_cb2_consumos ORDER BY id");
    expect(despues.slice(2)).toEqual(antes.slice(2));
    for (let i = 0; i < 2; i++) expect(despues[i]).toEqual({ ...antes[i], empleado_id: 8, revision_asignacion: 1 });
    expect((await q("SELECT * FROM auditoria")).length).toBe(2);
  });
  it("una respuesta perdida después del commit se reintenta sin duplicar asignaciones ni auditorías", async () => {
    const respuestaPerdida = async () => { await confirmarIdentificacion(ctx, op); throw new Error("respuesta perdida después del commit"); };
    await expect(respuestaPerdida()).rejects.toThrow("respuesta perdida");
    expect((await q("SELECT * FROM flota_cb2_asignaciones")).length).toBe(2);
    expect((await q("SELECT * FROM auditoria")).length).toBe(2);
    await expect(confirmarIdentificacion(ctx, op)).resolves.toMatchObject({ actualizados: 0, repetidos: 2 });
    expect((await q("SELECT * FROM flota_cb2_asignaciones")).length).toBe(2);
    expect((await q("SELECT * FROM auditoria")).length).toBe(2);
  });
  it("una empresa grande sin coincidencias detiene la vista al límite sin entregar resultados parciales", async () => {
    for (let inicio = 100; inicio < 25100; inicio += 1000) {
      const valores = Array.from({ length: 1000 }, (_, i) => [inicio + i, 1, 3, "Otra Persona", null, 0, 11, "DIESEL", 10, 50]);
      await estado.pool!.query("INSERT INTO flota_cb2_consumos VALUES ?", [valores]);
    }
    const inicio = performance.now();
    await expect(vistaIdentificacion(1, { nombre: "Nadie Coincide", empleadoId: 8 })).rejects.toMatchObject({ status: 413 });
    const duracion = Math.round(performance.now() - inicio);
    console.info(`Vista limitada a 25 000 filas en MariaDB aislada: ${duracion} ms`);
    expect((await q("SELECT * FROM auditoria")).length).toBe(0);
  }, 120000);
  it("revierte todos los cambios cuando una revisión ya no coincide", async () => {
    await estado.pool!.query("UPDATE flota_cb2_consumos SET revision_asignacion=1 WHERE id=2");
    await expect(confirmarIdentificacion(ctx, op)).rejects.toThrow("ya no es elegible");
    expect((await q("SELECT empleado_id FROM flota_cb2_consumos WHERE id=1"))[0].empleado_id).toBeNull();
    expect((await q("SELECT * FROM auditoria")).length).toBe(0);
  });
  it("dos administradores concurrentes no sobrescriben la identidad", async () => {
    const otra = { ...op, empleadoId: 9, clave: "abcdefghijklmnop" }, ctx2 = { ...ctx, actor: { id: 5, username: "OTRO" } };
    const resultados = await Promise.allSettled([confirmarIdentificacion(ctx, op), confirmarIdentificacion(ctx2, otra)]);
    expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const filas = await q("SELECT empleado_id FROM flota_cb2_consumos WHERE id IN (1,2) ORDER BY id");
    expect(filas[0].empleado_id).toBe(filas[1].empleado_id);
    expect([8, 9]).toContain(filas[0].empleado_id);
  });
  it("procesa cada proveedor por separado y revalida permisos y empresa", async () => {
    await confirmarIdentificacion(ctx, op);
    const otro = { ...op, proveedorId: 4, items: [{ id: 4, revision: 0 }] };
    await expect(confirmarIdentificacion({ ...ctx, proveedorId: 4, autorizar: async () => { throw new Error("Permiso revocado"); } }, otro)).rejects.toThrow("Permiso revocado");
    expect((await q("SELECT empleado_id FROM flota_cb2_consumos WHERE id=4"))[0].empleado_id).toBeNull();
    await expect(confirmarIdentificacion({ ...ctx, proveedorId: 4 }, otro)).resolves.toMatchObject({ actualizados: 1 });
    await expect(confirmarIdentificacion(ctx, { ...op, empleadoId: 10, clave: "empleadoajeno1234" })).rejects.toThrow("Empleado no autorizado");
    expect((await q("SELECT empleado_id FROM flota_cb2_consumos WHERE id=5"))[0].empleado_id).toBeNull();
  });
});
