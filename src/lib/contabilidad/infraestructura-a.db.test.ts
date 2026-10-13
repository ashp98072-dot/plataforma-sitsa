import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
// Opt-in SOLO local. Nunca lee .env ni las credenciales de la aplicación.
vi.mock("@/lib/db", () => ({ getPool: () => { throw new Error("Prohibido usar DB de aplicación en esta suite"); }, execute: vi.fn(), query: vi.fn() }));
import { registrarAsientoTx } from "./asientos";
import { registrarEventoContableTx } from "./eventos";
import { resolverCuentaPorRol } from "./cuentas-rol";
const port = Number(process.env.CONTA_A_TEST_PORT ?? 0);
const db = "conta_a_test_" + randomUUID().replaceAll("-", "");
const admin = () => mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
let pool: mysql.Pool;
const a = { entidadId: 9, usuarioId: 4, admin: false };
const asiento = (numero: string) => ({ numero, fecha: "2026-10-13", lineas: [{ cuentaId: 1, debe: 10 }, { cuentaId: 2, haber: 10 }] });
const snapshot = { version: 1, versionCalculo: "INFRA_A", origen: { tipo: "FACTURA", id: 5 }, cuentas: [], importes: [], impuestos: [] };
const sql = (name: string) => readFileSync("sql/" + name, "utf8").replaceAll("\r\n", "\n");
const tabla = (name: string) => {
  const contenido = sql("schema.sql");
  const inicio = contenido.indexOf("CREATE TABLE IF NOT EXISTS " + name + " (");
  if (inicio < 0) throw new Error("Tabla fixture no encontrada: " + name);
  return contenido.slice(inicio, contenido.indexOf(";", inicio) + 1);
};
async function tx<T>(fn: (c: PoolConnection) => Promise<T>) {
  const c = await pool.getConnection();
  try { await c.beginTransaction(); const result = await fn(c); await c.commit(); return result; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
}
describe.skipIf(!port)("PR A / MariaDB desechable local", () => {
  beforeAll(async () => {
    if (port !== 3407) throw new Error("Solo instancia desechable explícita en puerto 3407.");
    const c = await admin();
    try {
      await c.query("CREATE DATABASE " + db + " CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
      await c.query("USE " + db);
      await c.query("CREATE TABLE empresas (id INT PRIMARY KEY) ENGINE=InnoDB; CREATE TABLE usuarios (id INT PRIMARY KEY) ENGINE=InnoDB");
      for (const name of ["cont_entidades", "cont_cuentas", "cont_asientos", "cont_asiento_detalle", "cont_cxc", "cont_cxp"]) await c.query(tabla(name));
      await c.query("CREATE TABLE fact_facturas (id INT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NULL) ENGINE=InnoDB; CREATE TABLE auditoria (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT) ENGINE=InnoDB");
      await c.query("INSERT INTO empresas VALUES (7),(8); INSERT INTO usuarios VALUES (4); INSERT INTO cont_entidades (id,empresa_id,codigo,nombre,activa) VALUES (9,7,'A','A',1),(10,8,'B','B',1); INSERT INTO fact_facturas VALUES (5,7,9),(6,7,9),(7,8,10)");
      await c.query("INSERT INTO cont_cuentas (id,empresa_id,entidad_id,codigo,nombre,tipo,nivel,activa) VALUES (1,7,9,'D','D','Activo',1,1),(2,7,9,'H','H','Ingreso',1,1),(3,8,10,'D','D','Activo',1,1),(4,8,10,'H','H','Ingreso',1,1)");
      await c.query(sql("preflight-2026-10-contabilidad-infraestructura-a.sql"));
      await c.query(sql("migrate-2026-10-contabilidad-infraestructura-a.sql"));
      await c.query(sql("migrate-2026-10-contabilidad-infraestructura-a.sql"));
      await c.query(sql("verify-2026-10-contabilidad-infraestructura-a.sql"));
      const [rows] = await c.query<RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM cont_eventos) AS eventos,(SELECT COUNT(*) FROM cont_cuentas_rol) AS roles");
      expect(rows[0]).toMatchObject({ eventos: 0, roles: 0 });
    } finally { await c.end(); }
    pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database: db, connectionLimit: 4 });
  });
  afterAll(async () => { if (pool) await pool.end(); }); // Sin DROP. Datadir temporal queda recuperable.
  it("migrate repetible y schema tienen el mismo DDL", () => {
    const migration = sql("migrate-2026-10-contabilidad-infraestructura-a.sql");
    expect(migration).toContain(tabla("cont_cuentas_rol"));
    expect(migration).toContain(tabla("cont_eventos"));
  });
  it("CHECKs/FKs rechazan rol desconocido, cuenta ajena y cobro sin confirmación", async () => {
    await expect(pool.query("INSERT INTO cont_cuentas_rol (empresa_id,entidad_id,cuenta_id,rol) VALUES (7,9,1,'INVENTADO')")).rejects.toThrow();
    await expect(pool.query("INSERT INTO cont_cuentas_rol (empresa_id,entidad_id,cuenta_id,rol) VALUES (7,9,3,'CLIENTES')")).rejects.toThrow();
    await pool.query("INSERT INTO cont_cuentas_rol (empresa_id,entidad_id,cuenta_id,rol) VALUES (7,9,1,'CLIENTES')");
    await tx(async c => expect(await resolverCuentaPorRol({ empresaId: 7, entidadId: 9, rol: "CLIENTES" }, c)).toMatchObject({ id: 1 }));
    await expect(tx(async c => {
      const id = await registrarAsientoTx(c, 7, "actor", asiento("COBRO_PROHIBIDO"), a);
      await c.query("INSERT INTO cont_eventos (empresa_id,entidad_id,factura_id,tipo_evento,asiento_id,clave_evento,huella,fecha_contable,datos_snapshot,creado_por) VALUES (7,9,5,'COBRO_CONFIRMADO',?,'COBRO:1',?,'2026-10-13',?,4)", [id, "a".repeat(64), JSON.stringify(snapshot)]);
    })).rejects.toThrow();
  });
  it("rollback externo deshace asiento, detalle y auditoría", async () => {
    await expect(tx(async c => { await registrarAsientoTx(c, 7, "actor", asiento("ROLLBACK"), a); throw new Error("rollback solicitado"); })).rejects.toThrow("rollback solicitado");
    const [r] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM cont_asientos WHERE numero='ROLLBACK'");
    expect(Number(r[0].n)).toBe(0);
    const [au] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM auditoria");
    expect(Number(au[0].n)).toBe(0);
  });
  it("dos intentos concurrentes iguales crean un solo asiento/evento", async () => {
    const fn = () => tx(c => registrarEventoContableTx(c, 7, "actor", a, { facturaId: 5, tipo: "FACTURA_EMITIDA", snapshot, asiento: asiento("EVENTO5") }));
    const results = await Promise.all([fn(), fn()]);
    expect(results[0].asientoId).toBe(results[1].asientoId);
    expect(results.filter(r => r.reutilizado)).toHaveLength(1);
    await expect(tx(c => registrarEventoContableTx(c, 7, "actor", a, { facturaId: 5, tipo: "FACTURA_EMITIDA", snapshot: { ...snapshot, versionCalculo: "OTRA" }, asiento: asiento("EVENTO5") }))).rejects.toMatchObject({ status: 409 });
  });
  it("otra clave y otra empresa mantienen eventos independientes", async () => {
    const segundo = await tx(c => registrarEventoContableTx(c, 7, "actor", a, { facturaId: 6, tipo: "FACTURA_EMITIDA", snapshot, asiento: asiento("EVENTO6") }));
    const otro = await tx(c => registrarEventoContableTx(c, 8, "actor", { ...a, entidadId: 10 }, { facturaId: 7, tipo: "FACTURA_EMITIDA", snapshot, asiento: { ...asiento("EVENTO7"), lineas: [{ cuentaId: 3, debe: 10 }, { cuentaId: 4, haber: 10 }] } }));
    expect(segundo.eventoId).not.toBe(otro.eventoId);
    await expect(tx(c => registrarEventoContableTx(c, 8, "actor", { ...a, entidadId: 10 }, { facturaId: 5, tipo: "FACTURA_EMITIDA", snapshot, asiento: asiento("AJENO") }))).rejects.toThrow("Factura fuera");
  });
  it("BD impide reutilizar asiento y FK de asiento de otra empresa", async () => {
    const [r] = await pool.query<RowDataPacket[]>("SELECT asiento_id,datos_snapshot,huella FROM cont_eventos WHERE empresa_id=7 ORDER BY id LIMIT 1");
    const valores = [r[0].asiento_id, r[0].huella, typeof r[0].datos_snapshot === "string" ? r[0].datos_snapshot : JSON.stringify(r[0].datos_snapshot)];
    await expect(pool.query("INSERT INTO cont_eventos (empresa_id,entidad_id,factura_id,tipo_evento,asiento_id,clave_evento,huella,fecha_contable,datos_snapshot,creado_por) VALUES (7,9,5,'FACTURA_EMITIDA',?,'OTRA_CLAVE',?,'2026-10-13',?,4)", valores)).rejects.toThrow();
    await expect(pool.query("INSERT INTO cont_eventos (empresa_id,entidad_id,factura_id,tipo_evento,asiento_id,clave_evento,huella,fecha_contable,datos_snapshot,creado_por) VALUES (8,10,7,'FACTURA_EMITIDA',?,'ASIENTO_AJENO',?,'2026-10-13',?,4)", valores)).rejects.toThrow();
  });
});
