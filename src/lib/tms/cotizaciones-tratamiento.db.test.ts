import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migración REAL del tratamiento del destinatario contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407).
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/tms/cotizaciones-tratamiento.db.test.ts
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const db = `cot_trat_${randomUUID().replaceAll("-", "")}`;
let admin: mysql.Connection, conn: mysql.Connection;

describe.skipIf(!port)("tratamiento del destinatario — migración / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    admin = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "" });
    await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4`);
    conn = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", database: db });
    await conn.query("CREATE TABLE tms_cotizaciones (id INT AUTO_INCREMENT PRIMARY KEY, documento_emisor VARCHAR(20) NOT NULL DEFAULT 'KUIQTRANS', atencion_nombre VARCHAR(160) NULL, atencion_cargo VARCHAR(160) NULL)");
    await conn.query("INSERT INTO tms_cotizaciones (atencion_nombre) VALUES ('Claudia Cordero'), (NULL)");
  });
  afterAll(async () => {
    await conn?.end();
    if (admin) { if (!/^cot_trat_[a-f0-9]{32}$/.test(db)) throw Error("BD no desechable"); await admin.query(`DROP DATABASE ${db}`); await admin.end(); }
  });
  const sql = () => readFileSync("sql/migrate-2026-10-cotizaciones-tratamiento-destinatario.sql", "utf8");

  it("aplica la migración real: una columna nullable tras atencion_nombre; las cotizaciones existentes quedan en NULL", async () => {
    await conn.query(sql());
    const [cols] = await conn.query<RowDataPacket[]>("SHOW COLUMNS FROM tms_cotizaciones LIKE 'atencion_tratamiento'");
    expect(cols[0]).toMatchObject({ Type: "varchar(10)", Null: "YES", Default: null });
    const [orden] = await conn.query<RowDataPacket[]>("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tms_cotizaciones' ORDER BY ORDINAL_POSITION", [db]);
    expect(orden.map((r) => r.c)).toEqual(["id", "documento_emisor", "atencion_nombre", "atencion_tratamiento", "atencion_cargo"]);
    const [filas] = await conn.query<RowDataPacket[]>("SELECT atencion_nombre, atencion_tratamiento FROM tms_cotizaciones ORDER BY id");
    expect(filas).toEqual([{ atencion_nombre: "Claudia Cordero", atencion_tratamiento: null }, { atencion_nombre: null, atencion_tratamiento: null }]);
  });
  it("es idempotente (segunda ejecución sin error ni cambios) y guarda los cuatro tratamientos", async () => {
    await conn.query(sql());
    for (const t of ["Sr.", "Sres.", "Sra.", "Srta."]) await conn.query("INSERT INTO tms_cotizaciones (atencion_nombre, atencion_tratamiento) VALUES ('X', ?)", [t]);
    const [r] = await conn.query<RowDataPacket[]>("SELECT atencion_tratamiento t FROM tms_cotizaciones WHERE atencion_tratamiento IS NOT NULL ORDER BY id");
    expect(r.map((x) => x.t)).toEqual(["Sr.", "Sres.", "Sra.", "Srta."]);
  });
});
