import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const pipe = process.env.CANECAS_TEST_PIPE;
describe.skipIf(!pipe)("preflight y postcheck con DDL real de plataforma", () => {
  const pool = mysql.createPool({socketPath:`\\\\.\\pipe\\${pipe}`,user:"root",database:"canecas_schema_test",multipleStatements:true,connectionLimit:1});
  const schema = readFileSync("sql/schema.sql","utf8");
  const pre = readFileSync("sql/preflight-2026-11-canecas-fase1.sql","utf8");
  const post = readFileSync("sql/postcheck-2026-11-canecas-fase1.sql","utf8");
  async function resultado(sql: string) {
    const [result] = await pool.query<mysql.RowDataPacket[] | mysql.RowDataPacket[][]>(sql);
    return (Array.isArray(result[0]) ? result[sql === pre ? 1 : 0] : result) as mysql.RowDataPacket[];
  }
  const estado = (rows: mysql.RowDataPacket[], prueba: string) => rows.find(r => r.prueba === prueba)?.estado;
  beforeAll(async () => {
    for (const tabla of ["empresas","usuarios","empleados","compras_proveedores","auditoria"]) {
      const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
      if (!ddl) throw new Error(`Falta definición ${tabla}`);
      await pool.query(ddl[0]);
    }
  });
  afterAll(async () => { await pool.end(); });
  it("acepta las referencias declaradas por schema.sql y detecta preexistencias o claves ausentes", async () => {
    expect(estado(await resultado(pre),"RESULTADO")).toBe("APTO");
    await pool.query("ALTER TABLE compras_proveedores DROP INDEX uq_compras_proveedor_empresa");
    expect(estado(await resultado(pre),"RESULTADO")).toBe("DETENER");
    await pool.query("ALTER TABLE compras_proveedores ADD UNIQUE KEY uq_compras_proveedor_empresa (empresa_id,id)");
    await pool.query("ALTER TABLE empleados MODIFY empresa_id INT NULL");
    expect(estado(await resultado(pre),"INT firmado NOT NULL: empleados.empresa_id")).toBe("DETENER");
    await pool.query("ALTER TABLE empleados MODIFY empresa_id INT NOT NULL");
    await pool.query("ALTER TABLE empleados DROP FOREIGN KEY fk_emp_empresa");
    await pool.query("ALTER TABLE empleados MODIFY empresa_id INT UNSIGNED NOT NULL");
    expect(estado(await resultado(pre),"INT firmado NOT NULL: empleados.empresa_id")).toBe("DETENER");
    await pool.query("ALTER TABLE empleados MODIFY empresa_id INT NOT NULL");
    await pool.query("ALTER TABLE empleados ADD CONSTRAINT fk_emp_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE");
    await pool.query("CREATE TABLE canecas_preexistente (id INT) ENGINE=InnoDB");
    expect(estado(await resultado(pre),"sin tablas ni vistas canecas_ preexistentes")).toBe("DETENER");
    await pool.query("DROP TABLE canecas_preexistente");
    expect(estado(await resultado(pre),"RESULTADO")).toBe("APTO");
  });
  it("detecta columnas, índices, FKs y CHECK alterados", async () => {
    await pool.query(readFileSync("sql/migrate-2026-11-canecas-fase1.sql","utf8"));
    expect(estado(await resultado(post),"RESULTADO")).toBe("APTO");
    expect(estado(await resultado(pre),"RESULTADO")).toBe("DETENER");
    await pool.query("ALTER TABLE canecas_compras DROP INDEX uq_can_compra_clave");
    expect(estado(await resultado(post),"indice unico: canecas_compras.uq_can_compra_clave")).toBe("DETENER");
    await pool.query("ALTER TABLE canecas_compras ADD UNIQUE KEY uq_can_compra_clave (empresa_id,clave_operacion)");
    await pool.query("ALTER TABLE canecas_compras ADD UNIQUE KEY bloquea_lineas (empresa_id,proveedor_id,referencia,producto_id)");
    expect(estado(await resultado(post),"compras sin unicidad comercial adicional")).toBe("DETENER");
    await pool.query("ALTER TABLE canecas_compras ADD KEY soporte_proveedor (empresa_id,proveedor_id)");
    await pool.query("ALTER TABLE canecas_compras DROP INDEX bloquea_lineas");
    await pool.query("ALTER TABLE canecas_productos MODIFY codigo VARCHAR(81) NOT NULL");
    expect(estado(await resultado(post),"columna: canecas_productos.codigo")).toBe("DETENER");
    await pool.query("ALTER TABLE canecas_productos MODIFY codigo VARCHAR(80) NOT NULL");
    await pool.query("ALTER TABLE canecas_saldos ALTER fisico SET DEFAULT 1");
    expect(estado(await resultado(post),"valor inicial: canecas_saldos.fisico")).toBe("DETENER");
    await pool.query("ALTER TABLE canecas_saldos ALTER fisico SET DEFAULT 0");
    await pool.query("ALTER TABLE canecas_recepciones DROP FOREIGN KEY fk_can_recepcion_empleado");
    expect(estado(await resultado(post),"FK: canecas_recepciones.fk_can_recepcion_empleado")).toBe("DETENER");
    await pool.query("ALTER TABLE canecas_recepciones ADD CONSTRAINT fk_can_recepcion_empleado FOREIGN KEY (empresa_id,recibido_por_empleado_id) REFERENCES empleados(empresa_id,id) ON DELETE RESTRICT");
    await pool.query("ALTER TABLE canecas_compras DROP CONSTRAINT chk_can_compra_cantidad");
    expect(estado(await resultado(post),"CHECK: canecas_compras.chk_can_compra_cantidad")).toBe("DETENER");
    await pool.query("ALTER TABLE canecas_compras ADD CONSTRAINT chk_can_compra_cantidad CHECK (cantidad > 1)");
    expect(estado(await resultado(post),"CHECK: canecas_compras.chk_can_compra_cantidad")).toBe("DETENER");
  }, 30000);
});
