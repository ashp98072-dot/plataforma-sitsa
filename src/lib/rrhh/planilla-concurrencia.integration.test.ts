import { randomUUID } from "node:crypto";
import mysql, { type Connection, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { bloquearPeriodosPlanilla, conPeriodoBloqueado, exigirPrimeraQuincenaSinDependientes } from "./planilla-control";
import { getPool } from "@/lib/db";

// Nunca cargar .env ni getPool real: la conexión es únicamente al loopback.
vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
const enabled = process.env.PLANILLA_TEST_MYSQL === "1";
const database = "sitsa_planilla_test_" + randomUUID().replaceAll("-", "");
let admin: Connection | undefined;
let pool: Pool | undefined;
let created = false;

describe.skipIf(!enabled)("bloqueos reales de Planillas (MySQL local, InnoDB)", () => {
  beforeAll(async () => {
    const user = process.env.PLANILLA_TEST_USER;
    if (!user) throw new Error("Configura PLANILLA_TEST_USER para el servidor LOCAL de pruebas.");
    const port = Number(process.env.PLANILLA_TEST_PORT ?? 3306);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Puerto de pruebas inválido.");
    const config = { host: "127.0.0.1", port, user,
      password: process.env.PLANILLA_TEST_PASSWORD ?? "", connectTimeout: 5000 };
    admin = await mysql.createConnection(config);
    // Nombre generado internamente; jamás recibe una base del usuario o de producción.
    await admin.query(`CREATE DATABASE \`${database}\``);
    created = true;
    pool = mysql.createPool({ ...config, database, connectionLimit: 4 });
    vi.mocked(getPool).mockReturnValue(pool);
    await pool.query(`CREATE TABLE rrhh_planilla_periodos (
      id INT PRIMARY KEY, empresa_id INT NOT NULL, estado VARCHAR(20) NOT NULL,
      tipo_periodo VARCHAR(20) NOT NULL, mes INT NOT NULL, anio INT NOT NULL,
      INDEX empresa_periodo (empresa_id, id)
    ) ENGINE=InnoDB`);
    await pool.query(`INSERT INTO rrhh_planilla_periodos VALUES
      (1, 10, 'Generada', 'QUINCENA_1', 8, 2026),
      (2, 10, 'Borrador', 'QUINCENA_2', 8, 2026),
      (3, 20, 'Generada', 'QUINCENA_1', 8, 2026)`);
  });

  afterAll(async () => {
    await pool?.end();
    try {
      // Único DROP permitido: la base aleatoria creada por esta ejecución.
      if (created && admin && /^sitsa_planilla_test_[a-f0-9]{32}$/.test(database)) {
        await admin.query(`DROP DATABASE \`${database}\``);
      }
    } finally {
      await admin?.end();
    }
  });

  async function connection(): Promise<PoolConnection> {
    const conn = await pool!.getConnection();
    await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await conn.query("SET SESSION innodb_lock_wait_timeout = 1");
    return conn;
  }

  it("otra transacción no modifica Q1 mientras Q2 tiene el bloqueo", async () => {
    const a = await connection();
    const b = await connection();
    try {
      await a.beginTransaction();
      await bloquearPeriodosPlanilla(a, 10, 2);
      await b.beginTransaction();
      await expect(bloquearPeriodosPlanilla(b, 10, 1)).rejects.toMatchObject({ code: "ER_LOCK_WAIT_TIMEOUT" });
    } finally {
      await b.rollback(); await a.rollback(); b.release(); a.release();
    }
  });

  it("el guard ve Q2 confirmada aunque la conexión tenga un snapshot anterior", async () => {
    const a = await connection();
    const b = await connection();
    try {
      await b.beginTransaction();
      await b.query("SELECT * FROM rrhh_planilla_periodos WHERE id = 2");
      await a.beginTransaction();
      await bloquearPeriodosPlanilla(a, 10, 2);
      await a.query("UPDATE rrhh_planilla_periodos SET estado = 'Generada' WHERE id = 2");
      await a.commit();
      await bloquearPeriodosPlanilla(b, 10, 1);
      await expect(exigirPrimeraQuincenaSinDependientes(b, 10, 1)).rejects.toThrow("segunda quincena");
    } finally {
      await b.rollback(); await a.rollback(); b.release(); a.release();
      await pool!.query("UPDATE rrhh_planilla_periodos SET estado = 'Borrador' WHERE id = 2");
    }
  });

  it("una empresa distinta puede operar mientras la primera mantiene bloqueos", async () => {
    const a = await connection();
    const b = await connection();
    try {
      await a.beginTransaction();
      await bloquearPeriodosPlanilla(a, 10, 1);
      await b.beginTransaction();
      expect(await bloquearPeriodosPlanilla(b, 20, 3)).toMatchObject({ id: 3 });
      expect(await bloquearPeriodosPlanilla(b, 20, 1)).toBeUndefined();
    } finally {
      await b.rollback(); await a.rollback(); b.release(); a.release();
    }
  });

  it("el wrapper revierte escrituras reales si una operación intermedia falla", async () => {
    await expect(conPeriodoBloqueado(10, 1, async (conn) => {
      await conn.query("UPDATE rrhh_planilla_periodos SET estado = 'Cancelado' WHERE id = 1 AND empresa_id = 10");
      throw new Error("Fallo de prueba");
    })).rejects.toThrow("Fallo de prueba");
    const [rows] = await pool!.query<RowDataPacket[]>("SELECT estado FROM rrhh_planilla_periodos WHERE id = 1");
    expect(rows[0].estado).toBe("Generada");
  });

  it.each(["Generada", "Cerrada", "Pagada"])("Q2 %s bloquea cambios de Q1", async (estado) => {
    await pool!.query("UPDATE rrhh_planilla_periodos SET estado = ? WHERE id = 2", [estado]);
    try {
      await expect(conPeriodoBloqueado(10, 1, async (conn) => {
        await exigirPrimeraQuincenaSinDependientes(conn, 10, 1);
      })).rejects.toThrow("segunda quincena");
    } finally {
      await pool!.query("UPDATE rrhh_planilla_periodos SET estado = 'Borrador' WHERE id = 2");
    }
  });

  it.each(["Cancelado", "Borrador"])("Q2 %s no impide revisar Q1", async (estado) => {
    await pool!.query("UPDATE rrhh_planilla_periodos SET estado = ? WHERE id = 2", [estado]);
    try {
      await expect(conPeriodoBloqueado(10, 1, async (conn) => {
        await exigirPrimeraQuincenaSinDependientes(conn, 10, 1);
      })).resolves.toBeUndefined();
    } finally {
      await pool!.query("UPDATE rrhh_planilla_periodos SET estado = 'Borrador' WHERE id = 2");
    }
  });

  it("Q2 de otra empresa o mes no bloquea Q1", async () => {
    await pool!.query("INSERT INTO rrhh_planilla_periodos VALUES (4, 20, 'Generada', 'QUINCENA_2', 8, 2026), (5, 10, 'Generada', 'QUINCENA_2', 9, 2026)");
    try {
      await expect(conPeriodoBloqueado(10, 1, async (conn) => {
        await exigirPrimeraQuincenaSinDependientes(conn, 10, 1);
      })).resolves.toBeUndefined();
    } finally {
      await pool!.query("DELETE FROM rrhh_planilla_periodos WHERE id IN (4, 5)");
    }
  });
});
