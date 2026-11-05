import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, expect, it, describe, vi } from "vitest";
import { laboratorio, validarServidor, sha256 } from "./cxp/__tests__/integridad-lab";
const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({ getPool: () => state.pool }));
import { consultarBancos } from "./bancos";

// Nunca conecta por LIQ_TEST_DB_PORT heredado; autorización e identidad específicas de MIL-BAN-01.
const enabled = Boolean(process.env.MIL_BAN01_DATADIR_SHA256);
const db = `ban_qa01_${randomUUID().replaceAll("-", "")}`, token = randomUUID();
let admin: mysql.Connection | undefined, created = false;
const a = { entidadId: 5, usuarioId: 91, admin: false };
const evidence: unknown[] = [];
describe.skipIf(!enabled)("MIL-BAN-01 MariaDB real, base propia nueva", () => {
  beforeAll(async () => {
    const cfg = laboratorio({ LIQ_TEST_DB_PORT: "3399", MIL_CXP05_LAB_ID: process.env.MIL_BAN01_LAB_ID, MIL_CXP05_DATADIR_SHA256: process.env.MIL_BAN01_DATADIR_SHA256 });
    if (cfg.alias !== "qa-desechable-ban01") throw Error("Alias no autorizado para Bancos");
    admin = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: "root", password: "" });
    const [identity] = await admin.query<RowDataPacket[]>("SELECT VERSION() v,@@port p,@@datadir d");
    validarServidor(String(identity[0].v), Number(identity[0].p), String(identity[0].d), cfg);
    await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`); created = true;
    await admin.query(`CREATE TABLE ${db}.qa_ownership(token CHAR(36) PRIMARY KEY)`);
    await admin.query(`INSERT INTO ${db}.qa_ownership VALUES (?)`, [token]);
    state.pool = mysql.createPool({ host: cfg.host, port: cfg.port, user: "root", password: "", database: db, multipleStatements: true, connectionLimit: 3 });
    expect((await state.pool.query<RowDataPacket[]>("SELECT DATABASE() d"))[0][0].d).toBe(db);
    await state.pool.query(`CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO empresas VALUES(1),(2);
      CREATE TABLE cont_entidades(id INT PRIMARY KEY,empresa_id INT NOT NULL,codigo VARCHAR(40),nombre VARCHAR(200),activa TINYINT DEFAULT 1,UNIQUE(empresa_id,id)) ENGINE=InnoDB;
      INSERT INTO cont_entidades VALUES(5,1,'QA','Uno',1),(6,1,'DOS','Dos',1),(7,2,'AJENA','Otra',1),(8,1,'INACTIVA','Inactiva',0);
      CREATE TABLE cont_cuentas(id INT PRIMARY KEY,empresa_id INT NOT NULL,entidad_id INT NOT NULL,codigo VARCHAR(40),nombre VARCHAR(200),activa TINYINT DEFAULT 1,UNIQUE(empresa_id,entidad_id,id)) ENGINE=InnoDB;
      INSERT INTO cont_cuentas VALUES(10,1,5,'11103001','Banco QA',1),(11,1,5,'11103002','Banco inactivo',0),(12,1,6,'11103001','Otra entidad',1),(13,2,7,'11103001','Otra empresa',1);`);
    const migration = readFileSync("sql/migrate-2026-10-fact-4-lineas-contado-retencion.sql", "utf8");
    const ddl = migration.match(/CREATE TABLE IF NOT EXISTS cont_cuentas_bancarias \([\s\S]*?\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;/)?.[0];
    if (!ddl) throw Error("Contrato FACT-4 no reconocido; no improvisar DDL");
    await state.pool.query(ddl); // Bloque bancario original, sin aplicar los ALTER de Facturación fuera de alcance.
    await state.pool.query(`INSERT INTO cont_cuentas_bancarias(empresa_id,entidad_id,cuenta_id,banco,alias,referencia,moneda,activa) VALUES
      (1,5,10,'Banco QA','Operativa','123456789012','GTQ',1),(1,5,11,'Banco QA','Inactiva',NULL,'USD',0),
      (1,6,12,'Banco QA','Entidad Dos',NULL,'GTQ',1),(2,7,13,'Banco QA','Empresa Dos',NULL,'GTQ',1)`);
    evidence.push({ alias: cfg.alias, version: identity[0].v, port: cfg.port, datadirSha256: cfg.fingerprint, database: db, migration: "FACT-4 bloque cont_cuentas_bancarias original", migrationSha256: sha256(migration), ddlSha256: sha256(ddl) });
  }, 30000);
  afterAll(async () => {
    try {
      await state.pool?.end();
      if (admin && created) {
        if (!/^ban_qa01_[a-f0-9]{32}$/.test(db)) throw Error("Nombre no propio");
        const [r] = await admin.query<RowDataPacket[]>(`SELECT token FROM ${db}.qa_ownership`);
        if (r.length !== 1 || r[0].token !== token) throw Error("Propiedad perdida: no eliminar");
        await admin.query(`DROP DATABASE ${db}`); evidence.push({ cleanup: true, ownershipVerified: true });
      }
    } finally { await admin?.end(); console.info("MIL_BAN01_EVIDENCE", JSON.stringify(evidence)); }
  });
  it("catálogo real por entidad/empresa, inactivas explícitas y referencia nunca devuelta", async () => {
    const rows = await consultarBancos(1, a);
    expect(rows).toHaveLength(2); expect(rows.map(r => r.alias)).toEqual(["Inactiva", "Operativa"]);
    expect(rows[0]).toMatchObject({ activa: false, moneda: "USD", cuenta: { activa: false } });
    expect(rows[0].advertencias).toContain("Cuenta contable inactiva.");
    expect(JSON.stringify(rows)).not.toContain("123456789012");
    expect((await consultarBancos(1, { ...a, entidadId: 6 })).map(r => r.alias)).toEqual(["Entidad Dos"]);
    expect((await consultarBancos(2, { ...a, entidadId: 7 })).map(r => r.alias)).toEqual(["Empresa Dos"]);
  });
  it("entidad ajena/inactiva denegada, Admin conserva consulta histórica vacía", async () => {
    for (const entidadId of [7, 8, 999]) await expect(consultarBancos(1, { ...a, entidadId })).rejects.toMatchObject({ status: 404 });
    expect(await consultarBancos(1, { ...a, entidadId: 8, admin: true })).toEqual([]);
  });
  it("FK original rechaza cuenta contable de otra entidad/empresa e inexistente", async () => {
    for (const cuentaId of [12, 13, 999]) await expect(state.pool!.query("INSERT INTO cont_cuentas_bancarias(empresa_id,entidad_id,cuenta_id,banco,alias) VALUES(1,5,?,'QA','Cruce')", [cuentaId])).rejects.toMatchObject({ errno: 1452 });
  });
});
