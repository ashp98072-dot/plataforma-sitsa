import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Pool } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => state.pool,
  query: async (sql: string, params: (string | number | boolean | Date | null)[] = []) => (await state.pool!.query(sql, params))[0],
}));
import { balanceComprobacion, libroDiario, libroMayor } from "./reportes";

/**
 * Reportes contables M-4 contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407) con las tablas REALES de sql/schema.sql
 * (cont_entidades, cont_cuentas, cont_asientos, cont_asiento_detalle).
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/contabilidad/reportes/reportes.db.test.ts
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const db = `cont_rep_${randomUUID().replaceAll("-", "")}`;
let admin: mysql.Connection;

function tabla(schema: string, nombre: string) {
  const i = schema.indexOf(`CREATE TABLE IF NOT EXISTS ${nombre} (`);
  if (i < 0) throw new Error(`No se encontró ${nombre} en schema.sql`);
  return schema.slice(i, schema.indexOf(";", i) + 1);
}
// Empresas 1 (entidades 5=Mónaco, 6=KuiqTrans) y 2 (entidad 7). Cuentas por entidad: 1101 Caja, 2101 Proveedores, 4101 Ventas.
const C = { cajaM: 51, provM: 52, ventM: 53, vacioM: 54, cajaK: 61, ventK: 62, cajaX: 71 };
async function asiento(emp: number, ent: number, fecha: string, numero: string, lineas: [number, string, string][], estado = "Registrado", usuario = "conta") {
  const [r] = await state.pool!.query<mysql.ResultSetHeader>("INSERT INTO cont_asientos (empresa_id, entidad_id, fecha, numero, glosa, estado, creado_por) VALUES (?,?,?,?,?,?,?)",
    [emp, ent, fecha, numero, `Glosa ${numero}`, estado, usuario]);
  for (const [cuenta, debe, haber] of lineas) await state.pool!.query("INSERT INTO cont_asiento_detalle (empresa_id, entidad_id, asiento_id, cuenta_id, debe, haber) VALUES (?,?,?,?,?,?)", [emp, ent, r.insertId, cuenta, debe, haber]);
  return r.insertId;
}

describe.skipIf(!port)("Reportes contables M-4 / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    admin = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "" });
    await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
    state.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database: db, connectionLimit: 6, dateStrings: true });
    const schema = readFileSync("sql/schema.sql", "utf8");
    await state.pool.query("CREATE TABLE empresas (id INT PRIMARY KEY) ENGINE=InnoDB");
    await state.pool.query("INSERT INTO empresas VALUES (1),(2)");
    for (const t of ["cont_entidades", "cont_cuentas", "cont_asientos", "cont_asiento_detalle"]) await state.pool.query(tabla(schema, t));
    await state.pool.query("INSERT INTO cont_entidades (id, empresa_id, codigo, nombre, activa) VALUES (5,1,'MON','Logiservicios Mónaco',1),(6,1,'KT','KuiqTrans',1),(7,2,'OTRA','Otra empresa',1)");
    await state.pool.query(`INSERT INTO cont_cuentas (id, empresa_id, entidad_id, codigo, nombre, tipo) VALUES
      (${C.cajaM},1,5,'1101','Caja','Activo'),(${C.provM},1,5,'2101','Proveedores','Pasivo'),(${C.ventM},1,5,'4101','Ventas','Ingreso'),(${C.vacioM},1,5,'5199','Sin movimientos','Gasto'),
      (${C.cajaK},1,6,'1101','Caja','Activo'),(${C.ventK},1,6,'4101','Ventas','Ingreso'),(${C.cajaX},2,7,'1101','Caja','Activo')`);
    // Mónaco: A-1 (enero) venta de contado 1,000.00; A-2 (febrero) compra a crédito 250.50 contra caja 100.25; A-3 (marzo) venta 2,000.75.
    await asiento(1, 5, "2026-01-10", "A-1", [[C.cajaM, "1000.00", "0.00"], [C.ventM, "0.00", "1000.00"]], "Registrado", "ana");
    await asiento(1, 5, "2026-02-15", "A-2", [[C.cajaM, "0.00", "100.25"], [C.provM, "0.00", "150.25"], [C.ventM, "250.50", "0.00"]], "Registrado", "luis");
    await asiento(1, 5, "2026-03-20", "A-3", [[C.cajaM, "2000.75", "0.00"], [C.ventM, "0.00", "2000.75"]]);
    await asiento(1, 5, "2026-03-25", "A-4-BORRADOR", [[C.cajaM, "999.00", "0.00"], [C.ventM, "0.00", "999.00"]], "Borrador");
    // KuiqTrans: mismo código de cuenta y mismo número de asiento que Mónaco, importes distintos.
    await asiento(1, 6, "2026-01-12", "A-1", [[C.cajaK, "500.00", "0.00"], [C.ventK, "0.00", "500.00"]]);
    // Otra empresa.
    await asiento(2, 7, "2026-01-10", "A-1", [[C.cajaX, "7777.00", "0.00"], [C.cajaX, "0.00", "7777.00"]]);
  }, 90000);
  afterAll(async () => {
    await state.pool?.end();
    if (admin) { if (!/^cont_rep_[a-f0-9]{32}$/.test(db)) throw Error("BD no desechable"); await admin.query(`DROP DATABASE ${db}`); await admin.end(); }
  });

  describe("Libro Diario", () => {
    it("lista los asientos Registrados de la entidad con cuenta, nombre, debe, haber, total por asiento, usuario y cuadre", async () => {
      const r = await libroDiario(1, 5);
      expect(r.entidad).toMatchObject({ id: 5, codigo: "MON" });
      expect(r.asientos.map((a) => a.numero)).toEqual(["A-1", "A-2", "A-3"]); // el Borrador no entra
      const a2 = r.asientos[1];
      expect(a2).toMatchObject({ fecha: "2026-02-15", glosa: "Glosa A-2", usuario: "luis", totalDebe: "250.50", totalHaber: "250.50", cuadra: true });
      expect(a2.lineas).toEqual([
        { cuentaId: C.cajaM, codigo: "1101", cuenta: "Caja", debe: "0.00", haber: "100.25" },
        { cuentaId: C.provM, codigo: "2101", cuenta: "Proveedores", debe: "0.00", haber: "150.25" },
        { cuentaId: C.ventM, codigo: "4101", cuenta: "Ventas", debe: "250.50", haber: "0.00" },
      ]);
      expect(r.asientos.every((a) => a.cuadra)).toBe(true);
      expect(r.totalesRango).toEqual({ debe: "3251.25", haber: "3251.25", diferencia: "0.00", asientosDescuadrados: 0 });
    });
    it("rango de fechas (inclusivo) y número de asiento", async () => {
      expect((await libroDiario(1, 5, { desde: "2026-02-01", hasta: "2026-02-28" })).asientos.map((a) => a.numero)).toEqual(["A-2"]);
      expect((await libroDiario(1, 5, { desde: "2026-03-20", hasta: "2026-03-20" })).asientos.map((a) => a.numero)).toEqual(["A-3"]);
      expect((await libroDiario(1, 5, { numero: "A-3" })).asientos).toHaveLength(1);
      const vacio = await libroDiario(1, 5, { desde: "2030-01-01" });
      expect(vacio.asientos).toEqual([]);
      expect(vacio.totalesRango).toMatchObject({ debe: "0.00", haber: "0.00", diferencia: "0.00" });
    });
    it("aislamiento: otra entidad de la misma empresa y otra empresa nunca se mezclan", async () => {
      const kt = await libroDiario(1, 6);
      expect(kt.asientos).toHaveLength(1);
      expect(kt.asientos[0].lineas.map((l) => l.debe + "/" + l.haber)).toEqual(["500.00/0.00", "0.00/500.00"]);
      expect(kt.totalesRango.debe).toBe("500.00");
      expect((await libroDiario(2, 7)).totalesRango.debe).toBe("7777.00");
      await expect(libroDiario(1, 7)).rejects.toMatchObject({ status: 404 }); // entidad de otra empresa
      await expect(libroDiario(2, 5)).rejects.toMatchObject({ status: 404 });
      await expect(libroDiario(1, 999)).rejects.toMatchObject({ status: 404 });
    });
    it("un asiento que no cuadra se marca y se cuenta (nunca se oculta)", async () => {
      await asiento(1, 6, "2026-04-01", "DESC-1", [[C.cajaK, "10.00", "0.00"], [C.ventK, "0.00", "9.99"]]);
      const r = await libroDiario(1, 6);
      expect(r.asientos.find((a) => a.numero === "DESC-1")).toMatchObject({ cuadra: false, totalDebe: "10.00", totalHaber: "9.99" });
      expect(r.totalesRango).toMatchObject({ asientosDescuadrados: 1, diferencia: "0.01" });
      await state.pool!.query("DELETE FROM cont_asiento_detalle WHERE asiento_id = (SELECT id FROM cont_asientos WHERE numero = 'DESC-1')");
      await state.pool!.query("DELETE FROM cont_asientos WHERE numero = 'DESC-1'");
    });
  });

  describe("Libro Mayor", () => {
    it("saldo acumulado por cuenta, orden cronológico, sin saldo inicial inventado", async () => {
      const r = await libroMayor(1, 5, C.cajaM);
      expect(r.cuenta).toMatchObject({ codigo: "1101", nombre: "Caja" });
      expect(r.movimientos.map((m) => [m.numero, m.debe, m.haber, m.saldo])).toEqual([
        ["A-1", "1000.00", "0.00", "1000.00"], ["A-2", "0.00", "100.25", "899.75"], ["A-3", "2000.75", "0.00", "2900.50"],
      ]);
      expect(r.totales).toEqual({ debe: "3000.75", haber: "100.25", saldoFinal: "2900.50" });
      expect(r.saldoInicial).toBe("0.00");
      expect(r.nota).toContain("saldo inicial");
    });
    it("el saldo acumulado corresponde SOLO al rango consultado", async () => {
      const r = await libroMayor(1, 5, C.cajaM, { desde: "2026-02-01" });
      expect(r.movimientos.map((m) => m.saldo)).toEqual(["899.75", "2900.50"]);
      expect(r.totales.saldoFinal).toBe("2900.50");
    });
    it("cuenta sin movimientos: vacío con saldo 0; cuenta de otra entidad/empresa: 404; el mismo código en otra entidad no se mezcla", async () => {
      expect(await libroMayor(1, 5, C.vacioM)).toMatchObject({ movimientos: [], totales: { debe: "0.00", haber: "0.00", saldoFinal: "0.00" } });
      await expect(libroMayor(1, 5, C.cajaK)).rejects.toMatchObject({ status: 404 });
      await expect(libroMayor(1, 5, C.cajaX)).rejects.toMatchObject({ status: 404 });
      expect((await libroMayor(1, 6, C.cajaK)).totales.saldoFinal).toBe("500.00");
    });
  });

  describe("Balance de comprobación", () => {
    it("débito/crédito acumulados y saldos por cuenta; total debe = total haber", async () => {
      const r = await balanceComprobacion(1, 5);
      expect(r.filas.map((f) => [f.codigo, f.debito, f.credito, f.saldoDeudor, f.saldoAcreedor])).toEqual([
        ["1101", "3000.75", "100.25", "2900.50", "0.00"],
        ["2101", "0.00", "150.25", "0.00", "150.25"],
        ["4101", "250.50", "3000.75", "0.00", "2750.25"],
      ]);
      expect(r.totales).toMatchObject({ totalDebe: "3251.25", totalHaber: "3251.25", diferencia: "0.00", totalSaldoDeudor: "2900.50", totalSaldoAcreedor: "2900.50", cuadra: true });
    });
    it("rango de fechas, cuentas sin movimientos opcionales y varias entidades sin mezclarse", async () => {
      const feb = await balanceComprobacion(1, 5, { desde: "2026-02-01", hasta: "2026-02-28" });
      expect(feb.totales).toMatchObject({ totalDebe: "250.50", totalHaber: "250.50", diferencia: "0.00" });
      expect((await balanceComprobacion(1, 5)).filas.some((f) => f.codigo === "5199")).toBe(false);
      const con = await balanceComprobacion(1, 5, { incluirSinMovimiento: true });
      expect(con.filas.find((f) => f.codigo === "5199")).toMatchObject({ debito: "0.00", credito: "0.00", saldoDeudor: "0.00", saldoAcreedor: "0.00" });
      expect((await balanceComprobacion(1, 6)).totales).toMatchObject({ totalDebe: "500.00", totalHaber: "500.00" });
      expect((await balanceComprobacion(2, 7)).totales).toMatchObject({ totalDebe: "7777.00", totalHaber: "7777.00", diferencia: "0.00" });
      await expect(balanceComprobacion(1, 7)).rejects.toMatchObject({ status: 404 });
    });
    it("un asiento descuadrado se refleja en la diferencia (no se oculta)", async () => {
      await asiento(1, 6, "2026-05-01", "DESC-2", [[C.cajaK, "5.00", "0.00"]]);
      const r = await balanceComprobacion(1, 6, { desde: "2026-05-01" });
      expect(r.totales).toMatchObject({ totalDebe: "5.00", totalHaber: "0.00", diferencia: "5.00", cuadra: false });
    });
  });
});
