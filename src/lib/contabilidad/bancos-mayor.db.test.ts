import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({ getPool: () => state.pool }));
import { movimientosMayorBancario } from "./bancos-mayor";
import { libroMayor, enSolicitudDeLectura } from "./reportes/reportes";
const enabled = Boolean(process.env.MIL_BAN03_DATADIR_SHA256);
const db = `ban_qa03_${randomUUID().replaceAll("-", "")}`, token = randomUUID();
let admin: mysql.Connection | undefined, created = false;
const a = { entidadId: 5, usuarioId: 91, admin: false };
const evidence: object[] = [];
function ddl(text: string, table: string) {
  const match = text.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`));
  if (!match) throw Error(`DDL original no encontrado: ${table}`);
  return match[0];
}
async function asiento(id: number, empresa: number, entidad: number, cuenta: number, fecha: string, estado = "Registrado") {
  await state.pool!.query("INSERT INTO cont_asientos(id,empresa_id,entidad_id,fecha,numero,estado) VALUES(?,?,?,?,?,?)", [id, empresa, entidad, fecha, "A" + id, estado]);
  await state.pool!.query("INSERT INTO cont_asiento_detalle(empresa_id,entidad_id,asiento_id,cuenta_id,debe,haber) VALUES(?,?,?,?,?,?),(?,?,?,?,?,?)", [empresa, entidad, id, cuenta, "0.10", "0.00", empresa, entidad, id, cuenta, "0.00", "0.20"]);
}
describe.skipIf(!enabled)("MIL-BAN-03 / MariaDB real aislada", () => {
  beforeAll(async () => {
    if (process.env.MIL_BAN03_LAB_ID !== "qa-desechable-ban03" || !/^[a-f0-9]{64}$/.test(process.env.MIL_BAN03_DATADIR_SHA256!)) throw Error("Identidad autorizada requerida");
    admin = await mysql.createConnection({ host: "127.0.0.1", port: 3399, user: "root", password: "" });
    const [r] = await admin.query<RowDataPacket[]>("SELECT VERSION() v,@@port p,@@datadir d,@@foreign_key_checks fk,@@check_constraint_checks ck");
    const hash = createHash("sha256").update(String(r[0].d)).digest("hex");
    if (!String(r[0].v).startsWith("11.8.9-MariaDB") || Number(r[0].p) !== 3399 || hash !== process.env.MIL_BAN03_DATADIR_SHA256 || Number(r[0].fk) !== 1 || Number(r[0].ck) !== 1) throw Error("Runtime incorrecto; no crear base");
    await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`); created = true;
    await admin.query(`CREATE TABLE ${db}.qa_ownership(token CHAR(36) PRIMARY KEY)`); await admin.query(`INSERT INTO ${db}.qa_ownership VALUES(?)`, [token]);
    state.pool = mysql.createPool({ host: "127.0.0.1", port: 3399, user: "root", password: "", database: db, connectionLimit: 3, dateStrings: true });
    await state.pool.query("CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB"); await state.pool.query("INSERT INTO empresas VALUES(1),(2)");
    const schema = readFileSync("sql/schema.sql", "utf8");
    for (const table of ["cont_entidades", "cont_cuentas", "cont_asientos", "cont_asiento_detalle"]) await state.pool.query(ddl(schema, table));
    await state.pool.query(ddl(readFileSync("sql/migrate-2026-10-fact-4-lineas-contado-retencion.sql", "utf8"), "cont_cuentas_bancarias"));
    await state.pool.query("INSERT INTO cont_entidades(id,empresa_id,codigo,nombre,activa) VALUES(5,1,'UNO','Uno',1),(6,1,'DOS','Dos',1),(7,2,'UNO','Otra empresa',1),(8,1,'INACT','Inactiva',0)");
    await state.pool.query("INSERT INTO cont_cuentas(id,empresa_id,entidad_id,codigo,nombre,tipo,activa) VALUES(10,1,5,'11103001','Banco QA','Activo',1),(11,1,5,'11103002','Banco vacío','Activo',0),(12,1,6,'11103001','Banco Dos','Activo',1),(13,2,7,'11103001','Banco ajeno','Activo',1),(14,1,8,'11103001','Inactiva','Activo',0)");
    await state.pool.query("INSERT INTO cont_cuentas_bancarias(id,empresa_id,entidad_id,cuenta_id,banco,alias,activa) VALUES(1,1,5,10,'QA','Uno',1),(2,1,5,11,'QA','Vacío',0),(3,1,6,12,'QA','Dos',1),(4,2,7,13,'QA','Ajena',1),(5,1,8,14,'QA','Inactiva',0)");
    await asiento(1, 1, 5, 10, "2026-01-01"); await asiento(2, 1, 5, 10, "2026-01-31");
    await asiento(3, 1, 5, 10, "2026-02-01"); await asiento(4, 1, 5, 10, "2026-01-15", "Borrador");
    await asiento(5, 1, 6, 12, "2026-01-01"); await asiento(6, 2, 7, 13, "2026-01-01");
    await state.pool.query("UPDATE cont_asiento_detalle SET debe='999999999999.99' WHERE asiento_id=1 AND debe>0");
    evidence.push({ alias: "qa-desechable-ban03", database: db, version: r[0].v, port: 3399, datadirSha256: hash, foreignKeys: r[0].fk, checks: r[0].ck, fixtures: "Tablas contables originales + FACT-4 original; empresas mínima sintética; sin históricos" });
  }, 30000);
  afterAll(async () => {
    await state.pool?.end();
    try {
      if (admin && created) {
        if (!/^ban_qa03_[a-f0-9]{32}$/.test(db)) throw Error("Nombre no propio");
        const [r] = await admin.query<RowDataPacket[]>(`SELECT token FROM ${db}.qa_ownership`);
        if (r.length !== 1 || r[0].token !== token) throw Error("Propiedad perdida; no eliminar");
        await admin.query(`DROP DATABASE ${db}`);
        const [res] = await admin.query<RowDataPacket[]>("SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?", [db]);
        evidence.push({ ownershipVerified: true, dropped: true, residualSchemas: res.length, poolClosed: true });
      }
    } finally {
      await admin?.end();
      writeFileSync("docs/evidence/mil-ban03/mariadb.json", JSON.stringify(evidence, null, 2) + "\n");
    }
  });
  it("misma fuente, fechas inclusivas, orden e importes exactos frente al Mayor", async () => {
    const f = { desde: "2026-01-01", hasta: "2026-01-31" };
    const r = await movimientosMayorBancario(1, a, 1, f), mayor = await libroMayor(1, 5, 10, f);
    expect(r.movimientos.map(m => [m.asientoId, m.fecha, m.debe, m.haber])).toEqual(mayor.movimientos.map(m => [m.asientoId, m.fecha, m.debe, m.haber]));
    expect(r.movimientos.map(m => m.asientoId)).toEqual([1, 1, 2, 2]);
    expect(r.movimientos[0].debe).toBe("999999999999.99"); expect(r.movimientos[1].haber).toBe("0.20");
    expect(r.movimientos[0].detalleId).toBeLessThan(r.movimientos[1].detalleId); expect(r).not.toHaveProperty("saldoInicial");
  });
  it("empresa/entidad y banco ajenos rechazados, cuentas inactivas y vacíos", async () => {
    for (const [empresa, entidad, banco] of [[1, 5, 3], [1, 5, 4], [1, 7, 4], [2, 5, 1], [1, 8, 5], [1, 5, 999]]) await expect(movimientosMayorBancario(empresa, { ...a, entidadId: entidad }, banco, {})).rejects.toMatchObject({ status: 404 });
    expect((await movimientosMayorBancario(1, a, 2, {})).movimientos).toEqual([]);
    expect((await movimientosMayorBancario(1, { ...a, entidadId: 8, admin: true }, 5, {})).movimientos).toEqual([]);
    expect((await movimientosMayorBancario(1, { ...a, entidadId: 6 }, 3, {})).movimientos.map(m => m.asientoId)).toEqual([5, 5]);
    expect((await movimientosMayorBancario(2, { ...a, entidadId: 7 }, 4, {})).movimientos.map(m => m.asientoId)).toEqual([6, 6]);
    expect((await movimientosMayorBancario(1, a, 1, { desde: "2030-01-01" })).movimientos).toEqual([]);
  });
  it("FK real impide ámbito cruzado en banco/detalle; lecturas no cambian filas", async () => {
    await expect(state.pool!.query("INSERT INTO cont_cuentas_bancarias(empresa_id,entidad_id,cuenta_id,banco,alias) VALUES(1,5,12,'QA','Cruce')")).rejects.toMatchObject({ errno: 1452 });
    await expect(state.pool!.query("INSERT INTO cont_asiento_detalle(empresa_id,entidad_id,asiento_id,cuenta_id,debe) VALUES(1,5,1,12,1)")).rejects.toMatchObject({ errno: 1452 });
    const [before] = await state.pool!.query("SELECT COUNT(*) n,SUM(debe) d,SUM(haber) h FROM cont_asiento_detalle");
    await movimientosMayorBancario(1, a, 1, {});
    const [after] = await state.pool!.query("SELECT COUNT(*) n,SUM(debe) d,SUM(haber) h FROM cont_asiento_detalle"); expect(after).toEqual(before);
  });
  it("transacción del reporte es READ ONLY real", async () => {
    await enSolicitudDeLectura(async c => {
      await expect(c.query("UPDATE cont_asientos SET numero=numero WHERE id=1")).rejects.toMatchObject({ errno: 1792 });
      return { soloLectura: true };
    }, 1, 5, {});
  });
});
