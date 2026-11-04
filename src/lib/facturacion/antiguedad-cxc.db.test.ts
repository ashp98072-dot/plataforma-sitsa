import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => holder.pool,
  query: async (sql: string, params: unknown[] = []) => (await holder.pool!.query(sql, params))[0],
  execute: async (sql: string, params: unknown[] = []) => (await holder.pool!.execute(sql, params as never))[0],
}));

import { asegurarSchemaClientes } from "@/lib/clientes/schema";
import { anularCobro, registrarCobro, type ActorCobro } from "./cobros";
import { ErrorAntiguedad, listarAntiguedadCxc, listarAntiguedadParaExportar } from "./antiguedad-cxc";
import { antiguedadAExcel } from "./antiguedad-cxc-excel";
import { tramoDe, type FiltrosAntiguedad } from "./antiguedad-cxc-shared";

/**
 * MIL-CXC-ANT-01 contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407, solo local) con datos SINTÉTICOS.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/facturacion/antiguedad-cxc.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const database = `antig_test_${randomUUID().replaceAll("-", "")}`;
const E1 = 7, E2 = 8;
const CORTE = "2026-11-30";
const ana: ActorCobro = { empresaId: E1, usuarioId: 31, usuario: "ana" };
let admin: Connection;
let KT = 0, MON = 0, OTRA = 0;
let fid = 1000;
let clienteSeq = 100;

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const extraerCreate = (sql: string, t: string) => {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`).exec(sql);
  if (!m) throw new Error(`Sin CREATE TABLE ${t}`);
  return m[0];
};
const filas = async (sql: string, p: unknown[] = []) => (await admin.query<RowDataPacket[]>(sql, p as never))[0];
const dia = (n: number) => new Date(Date.UTC(2026, 10, 30) - n * 86_400_000).toISOString().slice(0, 10); // fecha de emisión con n días de antigüedad al corte
/** Cliente sintético NUEVO por prueba: aísla los totales sin depender del orden. */
async function nuevoCliente(empresa = E1): Promise<number> {
  const id = ++clienteSeq;
  await admin.query("INSERT INTO clientes (id, empresa_id, nombre, razon_social) VALUES (?, ?, ?, ?)", [id, empresa, `Cliente ${id}`, `Cliente ${id}, S.A.`]);
  return id;
}
async function factura(o: { cliente: number; empresa?: number; entidad?: number | null; monto?: string; estado?: string; moneda?: string; dias?: number }) {
  const id = ++fid;
  await admin.query(
    `INSERT INTO fact_facturas (id, empresa_id, cliente_id, numero_factura, fecha_emision, monto_total, estado_admin, creado_por, moneda, entidad_id, condicion_pago)
     VALUES (?, ?, ?, ?, ?, ?, ?, 31, ?, ?, 'CREDITO')`,
    [id, o.empresa ?? E1, o.cliente, `AN-${id}`, dia(o.dias ?? 0), o.monto ?? "1000.00", o.estado ?? "Emitida", o.moneda ?? "GTQ", o.entidad === undefined ? KT : o.entidad]);
  return id;
}
const pagoLegado = (f: number, monto: string, empresa = E1) =>
  admin.query("INSERT INTO fact_pagos (empresa_id, factura_id, fecha_pago, monto, registrado_por) VALUES (?, ?, '2026-11-01', ?, 31)", [empresa, f, monto]);
const entrada = (clienteId: number, aplicaciones: [number, string][]) => ({
  clienteId, fechaCobro: "2026-11-10", medioPago: "Transferencia", referencia: "BOL-1", observaciones: null, claveIdempotencia: `clave-${randomUUID()}`,
  aplicaciones: aplicaciones.map(([facturaId, monto]) => ({ facturaId, monto })),
});
const listar = (f: FiltrosAntiguedad, empresa = E1) => listarAntiguedadCxc(empresa, { pageSize: 100, ...f }, CORTE);
const suma = (xs: string[]) => xs.reduce((a, x) => a.plus(x), new Decimal(0)).toFixed(2);

describe.skipIf(!port)("MIL-CXC-ANT-01 antigüedad de saldos CxC / MariaDB 11.8.9 SOLO LOCAL", { timeout: 60000 }, () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    admin = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    expect(String((await admin.query<RowDataPacket[]>("SELECT VERSION() v"))[0][0].v)).toContain("11.8.9");
    await admin.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    await admin.query(`USE ${database}`);
    const schema = leer("sql/schema.sql");
    for (const t of ["empresas", "usuarios", "auditoria", "tms_clientes", "tms_lugares", "tms_unidades", "tms_personal", "tms_planes_viaje", "clientes", "cont_entidades", "cont_cuentas", "fact_cliente_perfil"]) await admin.query(extraerCreate(schema, t));
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 10, timezone: "local" });
    await asegurarSchemaClientes();
    for (const f of ["migrate-2026-08-fact-1-facturas-pagos", "migrate-2026-10-fact-2-borrador-snapshots-iva", "migrate-2026-10-fact-3-anuladas-historico", "migrate-2026-10-fact-4-lineas-contado-retencion", "migrate-2026-10-confirmaciones-bancarias"]) await admin.query(leer(`sql/${f}.sql`));
    await admin.query(leer("sql/migrate-2026-10-cxc-cobros-multifactura.sql"));
    await admin.query(`INSERT INTO empresas (id, codigo, nombre, slug) VALUES (${E1}, 'E7', 'Empresa 7', 'e7'), (${E2}, 'E8', 'Empresa 8', 'e8')`);
    await admin.query("INSERT INTO usuarios (id, username, password_hash, salt) VALUES (31, 'ana', 'x', 's')");
    KT = (await admin.query<mysql.ResultSetHeader>("INSERT INTO cont_entidades (empresa_id, codigo, nombre) VALUES (?, 'KT', 'Kuiqtrans')", [E1]))[0].insertId;
    MON = (await admin.query<mysql.ResultSetHeader>("INSERT INTO cont_entidades (empresa_id, codigo, nombre) VALUES (?, 'MON', 'Mónaco')", [E1]))[0].insertId;
    OTRA = (await admin.query<mysql.ResultSetHeader>("INSERT INTO cont_entidades (empresa_id, codigo, nombre) VALUES (?, 'OTR', 'Otra')", [E2]))[0].insertId;
  }, 120000);
  afterAll(async () => {
    await holder.pool?.end();
    if (admin) { if (!/^antig_test_[a-f0-9]{32}$/.test(database)) throw Error("BD no desechable"); await admin.query(`DROP DATABASE ${database}`); await admin.end(); }
  });

  it("fronteras de tramo en BD coinciden con tramoDe(): 0/15/16/30/31/60/61/90/91 días", async () => {
    const c = await nuevoCliente();
    const dias = [0, 15, 16, 30, 31, 60, 61, 90, 91];
    for (const d of dias) await factura({ cliente: c, dias: d, monto: "10.00" });
    const r = await listar({ clienteId: c });
    expect(r.filas.map((f) => [f.diasDesdeEmision, f.tramo])).toEqual([...dias].reverse().map((d) => [d, tramoDe(d)])); // orden: emisión más antigua primero
    expect(r.totalesPorTramo.map((t) => [t.tramo, t.facturas])).toEqual([["0-15", 2], ["16-30", 2], ["31-60", 2], ["61-90", 2], ["90+", 1]]);
  });

  it("filtro por tramo devuelve solo ese tramo y los totales respetan el filtro", async () => {
    const c = await nuevoCliente();
    await factura({ cliente: c, dias: 5, monto: "10.00" });
    await factura({ cliente: c, dias: 45, monto: "20.00" });
    await factura({ cliente: c, dias: 200, monto: "30.00" });
    const r = await listar({ clienteId: c, tramo: "31-60" });
    expect(r.filas.map((f) => f.saldoPendiente)).toEqual(["20.00"]);
    expect(r.totalesPorMoneda).toEqual([{ moneda: "GTQ", facturas: 1, saldo: "20.00" }]);
  });

  it("pagos parciales y totales; centavos exactos con pago legado + cobro multifactura (sin duplicar)", async () => {
    const c = await nuevoCliente();
    const a = await factura({ cliente: c, monto: "100.10", dias: 20 });
    const b = await factura({ cliente: c, monto: "0.30", dias: 20 });
    const pagada = await factura({ cliente: c, monto: "50.00", dias: 20 });
    await pagoLegado(a, "0.03");
    await pagoLegado(pagada, "50.00");
    const pagosAntes = Number((await filas("SELECT COUNT(*) n FROM fact_pagos"))[0].n);
    await registrarCobro(ana, KT, entrada(c, [[a, "0.07"], [b, "0.10"]]));
    expect(Number((await filas("SELECT COUNT(*) n FROM fact_pagos"))[0].n)).toBe(pagosAntes); // el cobro multifactura NO escribe en fact_pagos
    const r = await listar({ clienteId: c });
    const porId = new Map(r.filas.map((f) => [f.facturaId, f]));
    expect(porId.get(a)).toMatchObject({ montoOriginal: "100.10", montoCobrado: "0.10", saldoPendiente: "100.00" });
    expect(porId.get(b)).toMatchObject({ montoOriginal: "0.30", montoCobrado: "0.10", saldoPendiente: "0.20" });
    expect(porId.has(pagada)).toBe(false); // totalmente pagada: fuera
    expect(r.totalesPorMoneda).toEqual([{ moneda: "GTQ", facturas: 2, saldo: "100.20" }]);
    expect(suma(r.filas.map((f) => f.saldoPendiente))).toBe(r.totalesPorMoneda[0].saldo);
  });

  it("sobrepago heredado (pagos > monto) no entra a la cartera y no resta de los totales", async () => {
    const c = await nuevoCliente();
    const f = await factura({ cliente: c, monto: "10.00" });
    const ok = await factura({ cliente: c, monto: "5.00" });
    await pagoLegado(f, "10.00");
    await pagoLegado(f, "2.50"); // sobrepago insertado a mano (el servicio lo impediría)
    const r = await listar({ clienteId: c });
    expect(r.filas.map((x) => x.facturaId)).toEqual([ok]);
    expect(r.totalesPorMoneda).toEqual([{ moneda: "GTQ", facturas: 1, saldo: "5.00" }]);
  });

  it("cobro anulado deja de contar: el saldo se restaura; un cobro vigente sí reduce", async () => {
    const c = await nuevoCliente();
    const f = await factura({ cliente: c, monto: "300.00" });
    const { cobro } = await registrarCobro(ana, KT, entrada(c, [[f, "300.00"]]));
    expect((await listar({ clienteId: c })).filas).toHaveLength(0);
    await anularCobro(ana, KT, cobro.id, "Error de captura sintético");
    const r = await listar({ clienteId: c });
    expect(r.filas.map((x) => [x.facturaId, x.saldoPendiente])).toEqual([[f, "300.00"]]);
  });

  it("Borrador y Anulada quedan fuera; una factura sin fecha de emisión no entra", async () => {
    const c = await nuevoCliente();
    await factura({ cliente: c, estado: "Borrador" });
    await factura({ cliente: c, estado: "Anulada" });
    const ok = await factura({ cliente: c, monto: "1.00" });
    expect((await listar({ clienteId: c })).filas.map((x) => x.facturaId)).toEqual([ok]);
  });

  it("monedas: nunca se suman distintas; el filtro de moneda aísla", async () => {
    const c = await nuevoCliente();
    await factura({ cliente: c, monto: "100.00", moneda: "GTQ" });
    await factura({ cliente: c, monto: "100.00", moneda: "USD", dias: 40 });
    await factura({ cliente: c, monto: "25.50", moneda: "USD", dias: 41 });
    const r = await listar({ clienteId: c });
    expect(r.totalesPorMoneda).toEqual([{ moneda: "GTQ", facturas: 1, saldo: "100.00" }, { moneda: "USD", facturas: 2, saldo: "125.50" }]);
    expect(r.totalesPorTramo.every((t) => ["GTQ", "USD"].includes(t.moneda))).toBe(true);
    const usd = await listar({ clienteId: c, moneda: "USD" });
    expect(usd.filas.every((f) => f.moneda === "USD")).toBe(true);
    expect(usd.totalesPorMoneda).toEqual([{ moneda: "USD", facturas: 2, saldo: "125.50" }]);
  });

  it("entidad: KT, MON y «Sin entidad» (NULL) se filtran por separado; entidad de OTRA empresa no devuelve nada", async () => {
    const c = await nuevoCliente();
    const fk = await factura({ cliente: c, entidad: KT });
    const fm = await factura({ cliente: c, entidad: MON });
    const fn = await factura({ cliente: c, entidad: null });
    expect((await listar({ clienteId: c, entidad: KT })).filas.map((x) => x.facturaId)).toEqual([fk]);
    expect((await listar({ clienteId: c, entidad: MON })).filas.map((x) => [x.facturaId, x.entidad])).toEqual([[fm, "Mónaco"]]);
    const sin = await listar({ clienteId: c, entidad: "sin" });
    expect(sin.filas.map((x) => [x.facturaId, x.entidadId, x.entidad])).toEqual([[fn, null, "Sin entidad"]]);
    expect((await listar({ clienteId: c })).totalReal).toBe(3); // sin filtro de entidad: todas, la NULL como «Sin entidad»
    expect((await listar({ clienteId: c, entidad: OTRA })).totalReal).toBe(0);
  });

  it("aislamiento entre empresas: cada empresa ve solo lo suyo, aunque el id de cliente/factura exista", async () => {
    const c1 = await nuevoCliente(E1), c2 = await nuevoCliente(E2);
    const f1 = await factura({ cliente: c1, monto: "11.00" });
    const f2 = await factura({ cliente: c2, empresa: E2, entidad: OTRA, monto: "22.00" });
    await pagoLegado(f2, "2.00", E2);
    expect((await listar({ clienteId: c1 }, E1)).filas.map((x) => x.facturaId)).toEqual([f1]);
    expect((await listar({ clienteId: c2 }, E1)).totalReal).toBe(0); // cliente de otra empresa pedido desde E1
    const r2 = await listar({ clienteId: c2 }, E2);
    expect(r2.filas.map((x) => [x.facturaId, x.saldoPendiente])).toEqual([[f2, "20.00"]]);
    expect((await listar({ clienteId: c1 }, E2)).totalReal).toBe(0);
  });

  it("paginación: totalReal y totales no dependen de la página; las páginas suman exactamente el total", async () => {
    const c = await nuevoCliente();
    for (let i = 0; i < 23; i++) await factura({ cliente: c, monto: "10.01", dias: i * 5 });
    const paginas = [];
    for (let p = 1; p <= 3; p++) paginas.push(await listarAntiguedadCxc(E1, { clienteId: c, page: p, pageSize: 10 }, CORTE));
    expect(paginas.map((p) => p.filas.length)).toEqual([10, 10, 3]);
    expect(new Set(paginas.map((p) => p.totalReal))).toEqual(new Set([23]));
    expect(new Set(paginas.map((p) => JSON.stringify(p.totalesPorMoneda)))).toEqual(new Set([JSON.stringify([{ moneda: "GTQ", facturas: 23, saldo: "230.23" }])]));
    const ids = paginas.flatMap((p) => p.filas.map((f) => f.facturaId));
    expect(new Set(ids).size).toBe(23); // sin repetidos entre páginas
    expect(suma(paginas.flatMap((p) => p.filas.map((f) => f.saldoPendiente)))).toBe("230.23");
  });

  it("exportación: mismo conjunto y totales que la lista con los mismos filtros; genera un xlsx", async () => {
    const c = await nuevoCliente();
    await factura({ cliente: c, monto: "40.00", dias: 3 });
    await factura({ cliente: c, monto: "60.00", dias: 70, moneda: "USD" });
    const f = { clienteId: c };
    const lista = await listar(f);
    const ex = await listarAntiguedadParaExportar(E1, f, CORTE);
    if (!ex.ok) throw new Error(ex.error);
    expect(ex.filas).toEqual(lista.filas);
    expect(ex.totalesPorMoneda).toEqual(lista.totalesPorMoneda);
    const xlsx = await antiguedadAExcel(ex.filas, ex.totales, ex.totalesPorMoneda, ex.fechaCorte);
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
    const filtrado = await listarAntiguedadParaExportar(E1, { ...f, moneda: "USD" }, CORTE);
    if (!filtrado.ok) throw new Error(filtrado.error);
    expect(filtrado.filas).toHaveLength(1);
  });

  it("concurrencia: cobros simultáneos no desfasan filas y totales de una misma lectura (instantánea consistente)", async () => {
    const c = await nuevoCliente();
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) ids.push(await factura({ cliente: c, monto: "100.00", dias: i }));
    const cobros = ids.map((id) => registrarCobro(ana, KT, entrada(c, [[id, "33.33"]])).catch(() => null));
    const lecturas = Promise.all(Array.from({ length: 8 }, () => listar({ clienteId: c })));
    const [rs] = await Promise.all([lecturas, Promise.all(cobros)]);
    for (const r of rs) expect(suma(r.filas.map((f) => f.saldoPendiente))).toBe(r.totalesPorMoneda[0].saldo);
    const final = await listar({ clienteId: c });
    expect(final.totalesPorMoneda[0].saldo).toBe(new Decimal(1200).minus(new Decimal("33.33").times(12)).toFixed(2));
  });

  it("MIGRACION_PENDIENTE (503): sin las tablas CxC-1 devuelve el error controlado (solo en la BD desechable, restaurada después)", async () => {
    await admin.query("RENAME TABLE fact_cobro_aplicaciones TO fact_cobro_aplicaciones_tmp");
    try {
      await expect(listar({})).rejects.toMatchObject({ codigo: "MIGRACION_PENDIENTE", status: 503 });
      await expect(listarAntiguedadParaExportar(E1, {}, CORTE)).rejects.toBeInstanceOf(ErrorAntiguedad);
    } finally {
      await admin.query("RENAME TABLE fact_cobro_aplicaciones_tmp TO fact_cobro_aplicaciones");
    }
    await expect(listar({})).resolves.toBeTruthy();
  });

  it("corte inválido se rechaza antes de tocar el SQL", async () => {
    await expect(listarAntiguedadCxc(E1, {}, "2026-11-30'; DROP TABLE x;--")).rejects.toMatchObject({ codigo: "CORTE_INVALIDO", status: 400 });
  });
});
