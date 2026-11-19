import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { crearTraslado, enviarTraslado, recibirTraslado } from "./traslados";

const pipe = process.env.CANECAS_TEST_PIPE;
describe.skipIf(!pipe)("esquema de traslados en MariaDB aislada", () => {
  const pool = mysql.createPool({ socketPath: `\\\\.\\pipe\\${pipe}`, user: "root", database: "canecas_traslados_test", multipleStatements: true });
  async function migrar() {
    const sql = readFileSync("sql/migrate-2026-11-canecas-traslados.sql", "utf8");
    const [tablas, triggers] = sql.split("DELIMITER //");
    await pool.query(tablas);
    for (const trigger of triggers.split("//").map(s => s.trim()).filter(s => s.startsWith("CREATE TRIGGER"))) await pool.query(trigger);
  }
  beforeAll(async () => {
    const schema = readFileSync("sql/schema.sql", "utf8");
    for (const tabla of ["empresas", "usuarios", "empleados", "compras_proveedores", "auditoria"]) {
      const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${tabla} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`));
      if (!ddl) throw new Error(`Falta ${tabla}`);
      await pool.query(ddl[0]);
    }
    await pool.query(readFileSync("sql/migrate-2026-11-canecas-fase1.sql", "utf8"));
  });
  afterAll(async () => { await pool.end(); });
  it("instala las tablas y exige preflight y postcheck satisfactorios", async () => {
    const [pre] = await pool.query<mysql.RowDataPacket[]>(readFileSync("sql/preflight-2026-11-canecas-traslados.sql", "utf8"));
    expect(pre.every(r => r.resultado === "OK")).toBe(true);
    await migrar();
    const [post] = await pool.query<mysql.RowDataPacket[]>(readFileSync("sql/postcheck-2026-11-canecas-traslados.sql", "utf8"));
    expect(post.every(r => r.resultado === "OK")).toBe(true);
  });
  it("permite rollback únicamente con las tablas vacías y volver a instalar", async () => {
    const sql = readFileSync("sql/rollback-2026-11-canecas-traslados.sql", "utf8");
    await pool.query(sql.split("DELIMITER //")[1].split("//")[0].trim());
    await pool.query("CALL can_tras_rollback_vacio()");
    await pool.query("DROP PROCEDURE can_tras_rollback_vacio");
    const [pre] = await pool.query<mysql.RowDataPacket[]>(readFileSync("sql/preflight-2026-11-canecas-traslados.sql", "utf8"));
    expect(pre.every(r => r.resultado === "OK")).toBe(true);
    await migrar();
  });
  it("rechaza referencias cruzadas y documentos históricos mutables", async () => {
    await pool.query(`INSERT INTO empresas (id,codigo,nombre,slug) VALUES (1,'A','A','a'),(2,'B','B','b');
      INSERT INTO usuarios (id,username,password_hash,salt) VALUES (1,'test','hash','salt');
      INSERT INTO canecas_ubicaciones (id,empresa_id,nombre) VALUES (1,1,'Origen'),(2,1,'Destino'),(3,2,'Ajena');`);
    await expect(pool.query("INSERT INTO canecas_traslados (empresa_id,origen_id,destino_id,numero,clave_operacion,huella,entrega,creado_por) VALUES (1,1,3,'1','1','hash','Ana',1)")).rejects.toThrow();
    await pool.query("INSERT INTO canecas_traslados (id,empresa_id,origen_id,destino_id,numero,clave_operacion,huella,entrega,creado_por) VALUES (1,1,1,2,'1','1','hash','Ana',1)");
    await pool.query("INSERT INTO canecas_traslado_documentos (empresa_id,traslado_id,version,datos,creado_por) VALUES (1,1,1,'{}',1)");
    await expect(pool.query("UPDATE canecas_traslado_documentos SET datos='{}' WHERE id=1")).rejects.toThrow();
    await expect(pool.query("DELETE FROM canecas_traslado_documentos WHERE id=1")).rejects.toThrow();
  });
  it("impide el rollback si existen traslados o documentos", async () => {
    const sql = readFileSync("sql/rollback-2026-11-canecas-traslados.sql", "utf8");
    const procedimiento = sql.split("DELIMITER //")[1].split("//")[0].trim();
    await pool.query(procedimiento);
    await expect(pool.query("CALL can_tras_rollback_vacio()")).rejects.toThrow("Rollback detenido");
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM canecas_traslado_documentos");
    expect(Number(rows[0].n)).toBe(1);
    await pool.query("DROP PROCEDURE can_tras_rollback_vacio");
  });
  it("envía una sola vez y registra recepciones parciales idempotentes", async () => {
    await pool.query(`INSERT INTO canecas_productos (id,empresa_id,codigo,nombre,presentacion,capacidad,unidad_capacidad,unidad_inventario) VALUES (1,1,'A','Aceite','Caneca',5,'galones','caneca');
      INSERT INTO canecas_saldos (empresa_id,producto_id,ubicacion_id,fisico,reservado) VALUES (1,1,1,10,1);
      INSERT INTO canecas_traslados (id,empresa_id,origen_id,destino_id,numero,clave_operacion,huella,entrega,creado_por) VALUES (2,1,1,2,'T-2','2','hash','Ana',1);
      INSERT INTO canecas_traslado_partidas (id,empresa_id,traslado_id,producto_id,cantidad) VALUES (1,1,2,1,8);`);
    const marca = { nombre: "MONACO", logo: Buffer.from("logo"), logoTipo: "image/png" };
    const envios = await Promise.all([enviarTraslado(pool,1,2,1,marca), enviarTraslado(pool,1,2,1,marca)]);
    expect(envios.filter(e => e.yaEnviado)).toHaveLength(1);
    const input = { clave: "rec-1", recibe: "Berta", condicion: "Bien", observaciones: "", partidas: [{ partidaId: 1, recibido: 3, faltante: 0, motivo: "" }] };
    const recepciones = await Promise.all([recibirTraslado(pool,1,2,1,input,false), recibirTraslado(pool,1,2,1,input,false)]);
    expect(recepciones.filter(r => r.yaRegistrada)).toHaveLength(1);
    await expect(recibirTraslado(pool,1,2,1,{ ...input, partidas: [{ ...input.partidas[0], recibido: 4 }] },false)).rejects.toThrow("CLAVE_REUTILIZADA");
    await expect(recibirTraslado(pool,1,2,1,{ ...input, clave: "rec-2", partidas: [{ ...input.partidas[0], recibido: 6 }] },false)).rejects.toThrow("CANTIDAD_EXCEDE_ENVIO");
    await expect(recibirTraslado(pool,2,2,1,input,false)).rejects.toThrow("TRASLADO_NO_ENCONTRADO");
    await expect(recibirTraslado(pool,1,2,1,{ ...input, clave: "rec-3", partidas: [{ ...input.partidas[0], recibido: 4, faltante: 1, motivo: "Daño" }] },false)).rejects.toThrow("FALTANTE_NO_AUTORIZADO");
    const cierre = await recibirTraslado(pool,1,2,1,{ ...input, clave: "rec-3", partidas: [{ ...input.partidas[0], recibido: 4, faltante: 1, motivo: "Daño" }] },true);
    expect(cierre).toMatchObject({ estado: "CON_DIFERENCIAS", enTransito: 0 });
    const [saldos] = await pool.query<mysql.RowDataPacket[]>("SELECT ubicacion_id,fisico FROM canecas_saldos WHERE empresa_id=1 ORDER BY ubicacion_id");
    expect(saldos.map(s => s.fisico)).toEqual([2,7]);
    const [documentos] = await pool.query<mysql.RowDataPacket[]>("SELECT version,logo FROM canecas_traslado_documentos WHERE empresa_id=1 AND traslado_id=2 ORDER BY version");
    expect(documentos.map(d => d.version)).toEqual([1,2,3]);
    expect(documentos.every(d => Buffer.from(d.logo).equals(marca.logo))).toBe(true);
  });
  it("crea borradores idempotentes sin tocar stock y bloquea envíos sin disponible", async () => {
    const input = { clave: "draft-1", origenId: 1, destinoId: 2, entrega: "Ana", transporte: "", observaciones: "", partidas: [{ productoId: 1, cantidad: 3 }] };
    const duplicados = await Promise.all([crearTraslado(pool,1,1,input), crearTraslado(pool,1,1,input)]);
    expect(duplicados[0].id).toBe(duplicados[1].id);
    await expect(crearTraslado(pool,1,1,{...input, entrega: "Otra"})).rejects.toThrow("CLAVE_REUTILIZADA");
    await expect(enviarTraslado(pool,1,duplicados[0].id,1,{ nombre: "A", logo: null, logoTipo: null })).rejects.toThrow("EXISTENCIA_INSUFICIENTE");
    const [saldos] = await pool.query<mysql.RowDataPacket[]>("SELECT ubicacion_id,fisico FROM canecas_saldos WHERE empresa_id=1 ORDER BY ubicacion_id");
    expect(saldos.map(s => s.fisico)).toEqual([2,7]);
    const [rows] = await pool.query<mysql.RowDataPacket[]>("SELECT estado FROM canecas_traslados WHERE empresa_id=1 AND id=?", [duplicados[0].id]);
    expect(rows[0].estado).toBe("BORRADOR");
  });
});

