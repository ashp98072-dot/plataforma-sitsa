import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({ getPool: () => holder.pool!, query: async (t: string, p: unknown[] = []) => (await holder.pool!.query(t, p))[0] }));

import { abrirLectorVistaPrevia, errorVistaPrevia } from "./lector-vista-previa";
import { resolverUnidadTmsSoloLectura, resolverUnidadTmsTx } from "./unidad-canonica";

/**
 * Vista previa de «Copiar programación» SIN bloqueos, contra MariaDB DESECHABLE (solo local; se omite sin PLANES_DB_PORT=3399|3407) con el resolvedor REAL.
 *   PLANES_DB_PORT=3399 npx vitest run src/lib/tms/vista-previa-bloqueo.db.test.ts --no-file-parallelism
 * Esquema de flota_vehiculos/tms_unidades/empresas tomado de sql/schema.sql (colación uca1400 sustituida si el servidor es < 11.3). Nunca lee .env.
 */
const port = Number(process.env.PLANES_DB_PORT ?? 0);
const database = `vprev_${randomUUID().replaceAll("-", "")}`;
const E = 7;
const esquema = readFileSync("sql/schema.sql", "utf8");
const tabla = (n: string) => esquema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${n} \\([\\s\\S]*?\\n\\)[^;]*;`))![0];
const sql = async (t: string, p: unknown[] = []) => (await holder.pool!.query<RowDataPacket[]>(t, p))[0];
const veh = (id: number, placa: string) => sql("INSERT INTO flota_vehiculos (id, empresa_id, placa, activo, estado) VALUES (?, 7, ?, 1, 'Activo')", [id, placa]);
const capturar = async <T>(p: Promise<T>) => p.then((v) => ({ v }), (e: { message?: string; status?: number; errno?: number }) => ({ e }));

async function enTx<T>(fn: (c: PoolConnection) => Promise<T>) {
  const c = await holder.pool!.getConnection();
  try { await c.beginTransaction(); return await fn(c); } finally { await c.rollback().catch(() => undefined); c.release(); }   // rollback SIEMPRE: un error no puede dejar la transacción (y sus bloqueos) abierta
}

describe.skipIf(!port)("Vista previa sin bloqueos — MariaDB DESECHABLE SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "" });
    const sh = (s: string) => s.replaceAll("utf8mb4_uca1400_ai_ci", "utf8mb4_unicode_ci").replaceAll("utf8mb4_uca1400_as_cs", "utf8mb4_bin");
    await c.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); await c.query(`USE ${database}`);
    await c.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of ["empresas", "usuarios", "tms_unidades", "flota_vehiculos"]) await c.query(sh(tabla(t)));
    await c.query("CREATE TABLE flota_vehiculo_acceso (id INT AUTO_INCREMENT PRIMARY KEY, vehiculo_id INT NOT NULL, empresa_id INT NOT NULL) ENGINE=InnoDB");
    await c.query("CREATE TABLE flota_vehiculos_fusiones (id INT AUTO_INCREMENT PRIMARY KEY, origen_id INT NOT NULL, destino_id INT NOT NULL) ENGINE=InnoDB");
    await c.query("SET FOREIGN_KEY_CHECKS=1");
    await c.query("INSERT INTO empresas (id, codigo, nombre, slug) VALUES (7,'KT','KT','kt')");
    await c.end();
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 10 });
  });
  afterAll(async () => {
    await holder.pool?.end();
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "" });
    await c.query("SET GLOBAL innodb_lock_wait_timeout = 50"); await c.query(`DROP DATABASE IF EXISTS ${database}`); await c.end();
  });
  beforeEach(async () => { await sql("DELETE FROM tms_unidades"); await sql("DELETE FROM flota_vehiculos"); await sql("DELETE FROM flota_vehiculos_fusiones"); });

  describe("sin esperas por bloqueos de otras transacciones", () => {
    it("CONTRASTE (comportamiento anterior): el resolvedor con FOR UPDATE espera el timeout de bloqueo por CADA unidad y falla con ER_LOCK_WAIT_TIMEOUT", async () => {
      for (let i = 0; i < 3; i++) await veh(10 + i, `C-80${i}BXY`);
      await sql("INSERT INTO tms_unidades (empresa_id, placa, flota_vehiculo_id) VALUES (7,'C-800BXY',10),(7,'C-801BXY',11),(7,'C-802BXY',12)");
      await sql("SET GLOBAL innodb_lock_wait_timeout = 2");
      const a = await holder.pool!.getConnection();
      try {
        await a.beginTransaction(); await a.query("SELECT id FROM tms_unidades WHERE empresa_id=7 FOR UPDATE");   // otra operación retiene las unidades
        const t0 = Date.now(); const motivos: unknown[] = [];
        for (let i = 0; i < 3; i++) { const r = await capturar(enTx((c) => resolverUnidadTmsTx(c, E, `C-80${i}BXY`, 10 + i))); motivos.push("e" in r ? r.e.errno : "ok"); }
        expect(motivos).toEqual([1205, 1205, 1205]);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(5_500);   // 3 unidades × 2 s acumuladas
      } finally { await a.rollback(); a.release(); await sql("SET GLOBAL innodb_lock_wait_timeout = 50"); }
    }, 60_000);

    it("NUEVO: la vista previa con la MISMA transacción bloqueante abierta resuelve las 3 unidades al instante, sin esperar ni fallar", async () => {
      for (let i = 0; i < 3; i++) await veh(10 + i, `C-80${i}BXY`);
      await sql("INSERT INTO tms_unidades (id, empresa_id, placa, flota_vehiculo_id) VALUES (50,7,'C-800BXY',10),(51,7,'C-801BXY',11),(52,7,'C-802BXY',12)");
      await sql("SET GLOBAL innodb_lock_wait_timeout = 2");
      const a = await holder.pool!.getConnection();
      const lector = await abrirLectorVistaPrevia(holder.pool!);
      try {
        await a.beginTransaction(); await a.query("SELECT id FROM tms_unidades WHERE empresa_id=7 FOR UPDATE"); await a.query("SELECT id FROM empresas WHERE id=7 FOR UPDATE");
        const t0 = Date.now();
        const ids = [];
        for (let i = 0; i < 3; i++) ids.push(await resolverUnidadTmsSoloLectura(lector, E, `C-80${i}BXY`, 10 + i));
        expect(ids).toEqual([50, 51, 52]);
        expect(Date.now() - t0).toBeLessThan(1_500);
      } finally { await lector.liberar(); await a.rollback(); a.release(); await sql("SET GLOBAL innodb_lock_wait_timeout = 50"); }
    }, 30_000);
  });

  describe("paridad: la variante de lectura aplica EXACTAMENTE las mismas reglas de identidad que la de escritura", () => {
    const caso = async (nombre: string, preparar: () => Promise<void>, placa: string, flotaId: number | null) => {
      await sql("DELETE FROM tms_unidades"); await sql("DELETE FROM flota_vehiculos"); await sql("DELETE FROM flota_vehiculos_fusiones");
      await preparar();
      const antes = (await sql("SELECT COUNT(*) AS n FROM tms_unidades"))[0].n;
      const lector = await abrirLectorVistaPrevia(holder.pool!);
      const lectura = await capturar(resolverUnidadTmsSoloLectura(lector, E, placa, flotaId)); await lector.liberar();
      expect((await sql("SELECT COUNT(*) AS n FROM tms_unidades"))[0].n).toBe(antes);   // la lectura NUNCA inserta
      const escritura = await capturar(enTx((c) => resolverUnidadTmsTx(c, E, placa, flotaId)));
      return { nombre, lectura, escritura };
    };
    it.each([
      ["unidad vinculada al mismo vehículo", async () => { await veh(10, "C-801BXY"); await sql("INSERT INTO tms_unidades (id, empresa_id, placa, flota_vehiculo_id) VALUES (50,7,'C-801BXY',10)"); }, "C-801BXY", 10],
      ["unidad histórica SIN vínculo + vehículo de Flota (conflicto de identidad)", async () => { await veh(10, "C-801BXY"); await sql("INSERT INTO tms_unidades (empresa_id, placa, flota_vehiculo_id) VALUES (7,'C-801BXY',NULL)"); }, "C-801BXY", 10],
      ["mismo caso sin flotaVehiculoId (se busca por placa)", async () => { await veh(10, "C-801BXY"); await sql("INSERT INTO tms_unidades (empresa_id, placa, flota_vehiculo_id) VALUES (7,'C-801BXY',NULL)"); }, "C-801BXY", null],
      ["unidad vinculada a OTRO vehículo", async () => { await veh(10, "C-801BXY"); await veh(11, "OTRA-1"); await sql("INSERT INTO tms_unidades (empresa_id, placa, flota_vehiculo_id) VALUES (7,'C-801BXY',11)"); }, "C-801BXY", 10],
      ["vehículo fusionado (origen → destino)", async () => { await veh(10, "C-801BXY"); await veh(12, "C-801BXY-P"); await sql("INSERT INTO flota_vehiculos_fusiones (origen_id, destino_id) VALUES (10,12)"); await sql("INSERT INTO tms_unidades (id, empresa_id, placa, flota_vehiculo_id) VALUES (60,7,'C-801BXY',10)"); }, "C-801BXY-P", 12],
      ["empresa no vigente", async () => { await sql("UPDATE empresas SET activa=0 WHERE id=7"); }, "C-801BXY", null],
    ] as const)("%s", async (nombre, preparar, placa, flotaId) => {
      try {
        const { lectura, escritura } = await caso(nombre, preparar, placa, flotaId);
        if ("e" in escritura) {
          expect("e" in lectura && lectura.e.message).toBe(escritura.e.message);
          expect("e" in lectura && lectura.e.status).toBe(escritura.e.status);
        } else {
          expect("v" in lectura && lectura.v).toBe(escritura.v);
        }
      } finally { await sql("UPDATE empresas SET activa=1 WHERE id=7"); }
    });
    it("sin unidad TMS previa: la lectura devuelve null (se crearía al confirmar) y NO inserta; la escritura la crea", async () => {
      const { lectura, escritura } = await caso("nueva", async () => { await veh(10, "C-801BXY"); }, "C-801BXY", 10);
      expect(lectura).toEqual({ v: null });
      expect("v" in escritura && Number(escritura.v)).toBeGreaterThan(0);
    });
  });

  describe("consultas reutilizadas con muchas unidades", () => {
    it("28 unidades: muy por debajo de las ~11 consultas por unidad del comportamiento anterior", async () => {
      for (let i = 0; i < 28; i++) await veh(100 + i, `C-${700 + i}ZZZ`);
      await sql(`INSERT INTO tms_unidades (empresa_id, placa, flota_vehiculo_id) VALUES ${Array.from({ length: 28 }, (_, i) => `(7,'C-${700 + i}ZZZ',${100 + i})`).join(",")}`);
      const lector = await abrirLectorVistaPrevia(holder.pool!);
      for (let i = 0; i < 28; i++) expect(await resolverUnidadTmsSoloLectura(lector, E, `C-${700 + i}ZZZ`, 100 + i)).toBeGreaterThan(0);
      const n = lector.sentencias(); await lector.liberar();
      console.log("sentencias para 28 unidades:", n, "(antes ≈", 28 * 11, ")");
      expect(n).toBeLessThanOrEqual(28 * 5 + 10);
    });
  });

  describe("límite de tiempo real y mensajes controlados", () => {
    it("una consulta que excede el límite de sentencia falla con ER_STATEMENT_TIMEOUT y se traduce a un mensaje claro sin texto SQL", async () => {
      const lector = await abrirLectorVistaPrevia(holder.pool!, { limiteSentenciaMs: 1_000 });
      const r = await capturar(lector.query("SELECT SLEEP(5) AS s" as never));
      await lector.liberar();
      expect("e" in r).toBe(true);
      const c = errorVistaPrevia((r as { e: unknown }).e);
      expect(c.status).toBe(503);
      expect(c.message).toMatch(/tardó demasiado/);
      expect(c.message).not.toMatch(/SLEEP|SELECT/i);
    }, 20_000);
    it("al liberar, los límites de sesión se restablecen (la conexión del pool no queda alterada)", async () => {
      const lector = await abrirLectorVistaPrevia(holder.pool!, { limiteSentenciaMs: 1_000 });
      await lector.liberar();
      const [fila] = await sql("SELECT @@max_statement_time AS t, @@innodb_lock_wait_timeout AS l");
      expect(Number(fila.t)).toBe(0);
      expect(Number(fila.l)).toBe(50);
    });
  });
});
