// Consultas de empleados activos/de baja contra MariaDB 11.8.9 REAL y desechable (pipe sin red). Se omite sin CB2_587_PIPE.
// Cubre: SQL real de revisarNombresTx (con y sin fecha_egreso: error 1054 real), un usuario sin privilegio de columna (error 1143 real, NO se reintenta),
// la validación servidor de empleados de baja (FORCE INDEX + LOCK IN SHARE MODE) y la consulta de asignación posterior (FOR UPDATE).
import { readFileSync } from "node:fs";
import mysql, { type RowDataPacket } from "mysql2/promise";
import type { PoolConnection } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
const pipe = process.env.CB2_587_PIPE ?? "";
const BARRA = String.fromCharCode(92), DB = "cb2_baja_lab", NL = String.fromCharCode(10);
let admin: mysql.Connection, limitado: mysql.Connection | null = null;
const conexion = (c: mysql.Connection) => c as unknown as PoolConnection;
const NOMBRE = "Andres Norberto Taracena Mayen";

describe.skipIf(!pipe)("empleados de baja: consultas reales (MariaDB 11.8.9)", () => {
  beforeAll(async () => {
    if (!/^cb2-587-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
    const socketPath = `${BARRA}${BARRA}.${BARRA}pipe${BARRA}${pipe}`;
    admin = await mysql.createConnection({ socketPath, user: "root", password: "", multipleStatements: true });
    const [[v]] = await admin.query<RowDataPacket[]>("SELECT VERSION() v"); expect(v.v).toMatch(/^11\.8\.9-MariaDB/);
    await admin.query(`DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; USE ${DB}`);
    const esquema = readFileSync("sql/schema.sql", "utf8"), ini = esquema.indexOf("CREATE TABLE IF NOT EXISTS empresas"), fin = esquema.indexOf(";", ini);
    await admin.query(esquema.slice(ini, fin + 1));
    const ie = esquema.indexOf("CREATE TABLE IF NOT EXISTS empleados"), fe = esquema.indexOf(";", ie);
    await admin.query(esquema.slice(ie, fe + 1));
    await admin.query("ALTER TABLE empleados ADD COLUMN fecha_egreso DATE NULL");
    await admin.query("SET FOREIGN_KEY_CHECKS=0"); await admin.query("INSERT INTO empleados(empresa_id,codigo,nombre,estado,fecha_alta,fecha_egreso) VALUES (7,'A1','Edgar Palala','Activo','2024-01-01',NULL),(7,'B1',?, 'Baja','2024-01-10','2026-06-30'),(99,'B2',?, 'Baja','2024-01-10','2026-06-30')", [NOMBRE, NOMBRE]);
    // Usuario con privilegio solo sobre algunas columnas: SELECT de fecha_egreso falla con 1143 (permisos), no con 1054.
    await admin.query(`CREATE USER IF NOT EXISTS 'sin_fecha'@'%' IDENTIFIED VIA mysql_native_password USING PASSWORD('x'); GRANT SELECT(id,empresa_id,nombre,estado,codigo) ON ${DB}.empleados TO 'sin_fecha'@'%'`);
    limitado = await mysql.createConnection({ socketPath, user: "sin_fecha", password: "x", database: DB }).catch(() => null);
  });
  afterAll(async () => { await limitado?.end(); await admin?.query(`DROP DATABASE IF EXISTS ${DB}; DROP USER IF EXISTS 'sin_fecha'@'%'`).catch(() => undefined); await admin?.end(); });

  it("revisarNombresTx sobre SQL real: la baja de la empresa 7 llega con estado y fechas; la de otra empresa no aparece", async () => {
    await admin.query(`USE ${DB}`);
    const { revisarNombresTx } = await import("./pilotos-reportados");
    const [g] = await revisarNombresTx(conexion(admin), 7, [NOMBRE, NOMBRE, NOMBRE], false, ["2026-05-01", null, "2026-05-03"]);
    expect(g.candidatos).toHaveLength(1); expect(g.candidatos[0]).toMatchObject({ estado: "Baja", fechaBaja: "2026-06-30", fechaAlta: "2024-01-10" });
    expect(g.rango).toMatchObject({ min: "2026-05-01", max: "2026-05-03", sinFecha: true }); expect(g.propuesta).toMatchObject({ tipo: "EMPLEADO", confirmado: false });   // la baja se reconoce sola
    const [e] = await revisarNombresTx(conexion(admin), 7, ["Edgar Palala"], false, ["2026-05-01"]);
    expect(e.propuesta).toMatchObject({ tipo: "EMPLEADO", confirmado: false });
  });
  it("sin la columna fecha_egreso: MariaDB devuelve 1054 y SOLO entonces se reintenta (fechas nulas, sin acción masiva)", async () => {
    await admin.query(`USE ${DB}; ALTER TABLE empleados DROP COLUMN fecha_egreso`);
    try {
      const err = await admin.query("SELECT fecha_egreso FROM empleados").catch((e) => e); expect(err.errno).toBe(1054); expect(err.code).toBe("ER_BAD_FIELD_ERROR");
      const { revisarNombresTx } = await import("./pilotos-reportados");
      const [g] = await revisarNombresTx(conexion(admin), 7, [NOMBRE], false, ["2026-05-01"]);
      expect(g.candidatos[0]).toMatchObject({ estado: "Baja", fechaBaja: null }); expect(g.propuesta).toMatchObject({ tipo: "EMPLEADO" });
    } finally { await admin.query("ALTER TABLE empleados ADD COLUMN fecha_egreso DATE NULL; UPDATE empleados SET fecha_egreso='2026-06-30' WHERE estado='Baja'"); }
  });
  it("sin privilegio sobre la columna: el error de permisos se propaga y NO se reintenta", async () => {
    expect(limitado, "el usuario sin privilegio de columna debe conectarse").not.toBeNull();
    const err = await limitado!.query("SELECT fecha_egreso FROM empleados").catch((e) => e);
    expect([1143, 1142]).toContain(err.errno); expect(err.code).not.toBe("ER_BAD_FIELD_ERROR");
    const { revisarNombresTx } = await import("./pilotos-reportados");
    await expect(revisarNombresTx(conexion(limitado!), 7, [NOMBRE], false, ["2026-05-01"])).rejects.toMatchObject({ errno: err.errno });
  });
  it("validación del servidor: baja aceptada (automática única o manual) de la misma empresa; otra empresa 403; homónimo ambiguo", async () => {
    await admin.query(`USE ${DB}`);
    const [[b7]] = await admin.query<RowDataPacket[][]>("SELECT id FROM empleados WHERE empresa_id=7 AND estado='Baja'") as unknown as [RowDataPacket[]];
    const [[b99]] = await admin.query<RowDataPacket[][]>("SELECT id FROM empleados WHERE empresa_id=99") as unknown as [RowDataPacket[]];
    const { validarEmpleadosImportacion } = await import("./empleados-validacion");
    const ctx = { empresaId: 7, proveedorId: 3, actor: { id: 9, username: "demo" }, autorizar: async () => {} };
    const linea = { clave: "a".repeat(64), fila: { textos: { piloto: "Andres Taracena" } } } as never;
    const sel = (empleadoId: number, metodoEmpleado: string) => [{ candidato: "a".repeat(64), vehiculoId: 1, empleadoId, metodoEmpleado }] as never;
    await admin.beginTransaction();
    try {
      expect((await validarEmpleadosImportacion(conexion(admin), ctx, sel(Number(b7.id), "MANUAL"), [linea])).get("a".repeat(64))).toBe("MANUAL");
      await expect(validarEmpleadosImportacion(conexion(admin), ctx, sel(Number(b99.id), "MANUAL"), [linea])).rejects.toMatchObject({ status: 403 });
        const auto = await validarEmpleadosImportacion(conexion(admin), ctx, sel(Number(b7.id), "TOKENS_COMPLETOS_UNICOS"), [linea]);   // «Andres Taracena»: dos palabras completas, único → automática válida
      expect(auto.get("a".repeat(64))).toBe("TOKENS_COMPLETOS_UNICOS"); expect(auto.estados.get("a".repeat(64))).toBe("Baja");
      await admin.query("INSERT INTO empleados(empresa_id,codigo,nombre,estado) VALUES (7,'H1','Andres Taracena Lopez','Activo')");   // homónimo parcial: ahora ambiguo
      await expect(validarEmpleadosImportacion(conexion(admin), ctx, sel(Number(b7.id), "TOKENS_COMPLETOS_UNICOS"), [linea])).rejects.toThrow("ambigua");
      // Consulta de asignación posterior (asignaciones.ts): acotada por empresa e ID explícito.
      const sql = "SELECT id FROM empleados WHERE empresa_id=? AND id=? AND estado IN ('Activo','Baja') FOR UPDATE";
      expect((await admin.query<RowDataPacket[]>(sql, [7, b7.id]))[0]).toHaveLength(1); expect((await admin.query<RowDataPacket[]>(sql, [7, b99.id]))[0]).toHaveLength(0);
    } finally { await admin.rollback(); }
    expect(NL).toBe(String.fromCharCode(10));
  });
});
