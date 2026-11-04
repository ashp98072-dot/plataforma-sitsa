import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => state.pool,
  query: async (sql: string, params: (string | number | boolean | Date | null)[] = []) => (await state.pool!.query(sql, params))[0],
}));
import { registrarFactura, anularFactura } from "./facturas";
import { guardarConfigFiscal } from "./proveedor-fiscal";
import { registrarPago, reversarPago } from "./pagos";
import { listarAntiguedadCxp, listarAntiguedadCxpParaExportar } from "./antiguedad";
import { antiguedadCxpAExcel } from "./antiguedad-excel";
import { tramoDe, type FiltrosAntiguedadCxp } from "./antiguedad-shared";

/**
 * MIL-CXP-01 (antigüedad de saldos de proveedores) contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407, solo local, datos SINTÉTICOS).
 * Aplica las migraciones REALES M-3A y M-3B1 y usa los servicios reales (registrarFactura, registrarPago, reversarPago, anularFactura).
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/contabilidad/cxp/antiguedad.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const db = `cxp_ant_${randomUUID().replaceAll("-", "")}`;
const actor = { id: 91, username: "conta" };
const CORTE = "2026-11-30";
let admin: mysql.Connection;
const q = async (s: string, p: unknown[] = []) => (await state.pool!.query<RowDataPacket[]>(s, p))[0];

function sentencias(texto: string) {
  let delimiter = ";", buffer = "";
  const out: string[] = [];
  for (const line of texto.split(/\r?\n/)) {
    const d = line.trim().match(/^DELIMITER (.+)$/);
    if (d) { delimiter = d[1]; continue; }
    buffer += `${line}\n`;
    if (line.trimEnd().endsWith(delimiter)) {
      const stmt = buffer.slice(0, buffer.lastIndexOf(delimiter)).trim();
      if (stmt.replace(/--[^\n]*/g, "").trim()) out.push(stmt);
      buffer = "";
    }
  }
  return out;
}
async function ejecutarArchivo(archivo: string) {
  const c = await state.pool!.getConnection();
  try { for (const s of sentencias(readFileSync(`sql/${archivo}`, "utf8"))) await c.query(s); } finally { c.release(); }
}

const E1 = 5, E1B = 6, E2 = 7; // E1/E1B: entidades de la empresa 1; E2: entidad de la empresa 2
const dia = (n: number) => new Date(Date.UTC(2026, 10, 30) - n * 86_400_000).toISOString().slice(0, 10); // fecha con n días de antigüedad al corte
const venc = (n: number) => new Date(Date.UTC(2026, 10, 30) + n * 86_400_000).toISOString().slice(0, 10); // vencimiento n días después del corte (negativo = antes)
let seq = 0;
const clave = () => `clave-${++seq}-${randomUUID().slice(0, 8)}`;
/** Proveedor sintético NUEVO por prueba (aísla totales sin depender del orden). Sin ISR para que monto pagadero = total salvo que se pida. */
let provSeq = 100;
async function proveedor(o: { empresa?: number; entidad?: number; sujetoIsr?: boolean; nombre?: string } = {}): Promise<number> {
  const id = ++provSeq, empresa = o.empresa ?? 1, entidad = o.entidad ?? E1;
  await state.pool!.query("INSERT INTO compras_proveedores (id, empresa_id, nombre_comercial, nit, dias_credito, activo) VALUES (?, ?, ?, ?, 30, 1)", [id, empresa, o.nombre ?? `Proveedor Sintético ${id}`, `NIT-${id}`]);
  await guardarConfigFiscal(empresa, entidad, id, actor, { regimenFiscal: "GENERAL", sujetoIsr: o.sujetoIsr ?? false });
  return id;
}
let nf = 0;
async function factura(proveedorId: number, o: { empresa?: number; entidad?: number; neto?: string; iva?: string; dias?: number; venc?: string | null } = {}) {
  const f = (await registrarFactura(o.empresa ?? 1, o.entidad ?? E1, actor, {
    proveedorId, serie: "S", numero: String(++nf), fechaDocumento: dia(o.dias ?? 0), fechaVencimiento: o.venc === undefined ? null : o.venc,
    baseNeto: o.neto ?? "1000.00", ivaMonto: o.iva ?? "0.00",
  })).factura;
  return f;
}
const pagar = (proveedorId: number, aplic: [number, string][], entidad = E1, empresa = 1) =>
  registrarPago(empresa, entidad, actor, { proveedorId, fechaPago: "2026-11-10", medioPago: "Transferencia", referencia: "TR-1", claveIdempotencia: clave(), aplicaciones: aplic.map(([facturaId, monto]) => ({ facturaId, monto })) });
const listar = (f: FiltrosAntiguedadCxp, entidad = E1, empresa = 1) => listarAntiguedadCxp(empresa, entidad, { pageSize: 100, ...f }, CORTE);
const suma = (xs: string[]) => xs.reduce((a, x) => a.plus(x), new Decimal(0)).toFixed(2);

describe.skipIf(!port)("MIL-CXP-01 antigüedad de saldos CxP / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    admin = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    expect(String((await admin.query<RowDataPacket[]>("SELECT VERSION() v"))[0][0].v)).toContain("11.8.9");
    await admin.query(`CREATE DATABASE ${db} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
    state.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database: db, multipleStatements: true, connectionLimit: 12, dateStrings: true });
    await state.pool.query(`
      CREATE TABLE usuarios(id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO usuarios VALUES(91),(92);
      CREATE TABLE compras_proveedores(id INT PRIMARY KEY,empresa_id INT NOT NULL,nombre_comercial VARCHAR(200) NOT NULL,nit VARCHAR(30) NULL,dias_credito INT NULL,activo TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uq_p(empresa_id,id)) ENGINE=InnoDB;
      INSERT INTO compras_proveedores VALUES(3,1,'Repuestos Uno','111-1',30,1),(4,1,'Llantas Dos','222-2',NULL,1),(9,2,'Proveedor de otra empresa',NULL,NULL,1);
      CREATE TABLE cont_entidades(id INT PRIMARY KEY,empresa_id INT NOT NULL,activa TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uq_e(empresa_id,id)) ENGINE=InnoDB;
      INSERT INTO cont_entidades VALUES(5,1,1),(6,1,1),(7,2,1);
      CREATE TABLE cont_cuentas(id INT PRIMARY KEY,empresa_id INT NOT NULL,entidad_id INT NULL,codigo VARCHAR(40) NOT NULL,nombre VARCHAR(200) NOT NULL,tipo VARCHAR(40) NOT NULL,activa TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uq_c(empresa_id,entidad_id,id)) ENGINE=InnoDB;
      CREATE TABLE cont_cxp(id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT NOT NULL,proveedor VARCHAR(200) NOT NULL,monto DECIMAL(14,2) NOT NULL,saldo DECIMAL(14,2) NOT NULL) ENGINE=InnoDB;
      CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT) ENGINE=InnoDB;`);
    await ejecutarArchivo("migrate-2026-11-cxp-m3a-base.sql");
    await ejecutarArchivo("migrate-2026-11-cxp-m3b1-pagos.sql");
  }, 90000);
  afterAll(async () => {
    await state.pool?.end();
    if (admin) { if (!/^cxp_ant_[a-f0-9]{32}$/.test(db)) throw Error("BD no desechable"); await admin.query(`DROP DATABASE ${db}`); await admin.end(); }
  });

  it("saldo = monto pagadero (total − ISR) − pagos; la retención NO cuenta como pago (el ejemplo confirmado: Q35,000 / ISR Q1,587.50 / pagadero Q33,412.50)", async () => {
    const p = await proveedor({ sujetoIsr: true });
    const f = await factura(p, { neto: "31250.00", iva: "3750.00", dias: 20 });
    await pagar(p, [[f.id, "10000.00"]]);
    const r = await listar({ proveedorId: p });
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0]).toMatchObject({ totalDocumento: "35000.00", retencionIsr: "1587.50", montoPagadero: "33412.50", pagado: "10000.00", saldo: "23412.50", tramo: "16-30" });
    expect(r.saldoTotal).toBe("23412.50");
    expect(r.moneda).toBe("GTQ");
  });

  it("pago total sale del reporte; pago REVERSADO vuelve a contar; factura ANULADA no adeuda", async () => {
    const p = await proveedor();
    const a = await factura(p, { neto: "500.00" }), b = await factura(p, { neto: "300.00" }), c = await factura(p, { neto: "200.00" });
    const pagoA = await pagar(p, [[a.id, "500.00"]]);
    expect((await listar({ proveedorId: p })).filas.map((x) => x.facturaId).sort()).toEqual([b.id, c.id].sort());
    await reversarPago(1, E1, pagoA.pago.id, actor, "Pago capturado por error (sintético)");
    expect((await listar({ proveedorId: p })).filas.map((x) => x.facturaId).sort()).toEqual([a.id, b.id, c.id].sort());
    await anularFactura(1, E1, c.id, actor, "Factura duplicada sintética");
    const r = await listar({ proveedorId: p });
    expect(r.filas.map((x) => x.facturaId).sort()).toEqual([a.id, b.id].sort());
    expect(r.saldoTotal).toBe("800.00");
  });

  it("centavos exactos con pagos parciales múltiples (0.10 + 0.20 sobre 0.30)", async () => {
    const p = await proveedor();
    const f = await factura(p, { neto: "0.30" });
    await pagar(p, [[f.id, "0.10"]]);
    expect((await listar({ proveedorId: p })).filas[0]).toMatchObject({ montoPagadero: "0.30", pagado: "0.10", saldo: "0.20" });
    await pagar(p, [[f.id, "0.20"]]);
    expect((await listar({ proveedorId: p })).totalReal).toBe(0);
  });

  it("fronteras de tramo desde el documento: 0/15/16/30/31/60/61/90/91 días coinciden con tramoDe()", async () => {
    const p = await proveedor();
    const dias = [0, 15, 16, 30, 31, 60, 61, 90, 91];
    for (const d of dias) await factura(p, { neto: "10.00", dias: d });
    const r = await listar({ proveedorId: p });
    expect((r.filas.map((f) => [f.diasDesdeDocumento, f.tramo]) as [number, string][]).sort((x, y) => x[0] - y[0])).toEqual(dias.map((d) => [d, tramoDe(d)]));
    expect(r.totalesPorTramo.map((t) => [t.tramo, t.facturas])).toEqual([["0-15", 2], ["16-30", 2], ["31-60", 2], ["61-90", 2], ["90+", 1]]);
    expect((await listar({ proveedorId: p, tramo: "31-60" })).totalReal).toBe(2);
  });

  it("vencimiento: sin fecha → «Sin vencimiento» (días vencidos null); vencida = vencimiento anterior al corte; el día del vencimiento aún no", async () => {
    const p = await proveedor();
    const sin = await factura(p, { neto: "10.00", dias: 40, venc: null });
    const vencida = await factura(p, { neto: "20.00", dias: 40, venc: venc(-10) }); // venció hace 10 días
    const hoy = await factura(p, { neto: "30.00", dias: 40, venc: venc(0) });
    const futura = await factura(p, { neto: "40.00", dias: 5, venc: venc(15) });
    const r = await listar({ proveedorId: p });
    const porId = new Map(r.filas.map((f) => [f.facturaId, f]));
    expect(porId.get(sin.id)).toMatchObject({ fechaVencimiento: null, diasVencidos: null, situacion: "SIN_VENCIMIENTO" });
    expect(porId.get(vencida.id)).toMatchObject({ diasVencidos: 10, situacion: "VENCIDA" });
    expect(porId.get(hoy.id)).toMatchObject({ diasVencidos: 0, situacion: "VIGENTE" });
    expect(porId.get(futura.id)).toMatchObject({ diasVencidos: 0, situacion: "VIGENTE" });
    expect(r.totalesPorSituacion).toEqual([
      { situacion: "VENCIDA", facturas: 1, saldo: "20.00" }, { situacion: "VIGENTE", facturas: 2, saldo: "70.00" }, { situacion: "SIN_VENCIMIENTO", facturas: 1, saldo: "10.00" },
    ]);
    expect((await listar({ proveedorId: p, situacion: "VENCIDA" })).filas.map((f) => f.facturaId)).toEqual([vencida.id]);
    expect((await listar({ proveedorId: p, situacion: "SIN_VENCIMIENTO" })).filas.map((f) => f.facturaId)).toEqual([sin.id]);
  });

  it("aislamiento: otra entidad de la misma empresa y otra empresa no se mezclan (aunque el id exista)", async () => {
    const p1 = await proveedor({ entidad: E1 });
    await guardarConfigFiscal(1, E1B, p1, actor, { regimenFiscal: "GENERAL", sujetoIsr: false });
    const p2 = await proveedor({ empresa: 2, entidad: E2 });
    const fa = await factura(p1, { neto: "11.00", entidad: E1 });
    const fb = await factura(p1, { neto: "22.00", entidad: E1B });
    const fz = await factura(p2, { neto: "33.00", empresa: 2, entidad: E2 });
    expect((await listar({ proveedorId: p1 }, E1)).filas.map((f) => f.facturaId)).toEqual([fa.id]);
    expect((await listar({ proveedorId: p1 }, E1B)).filas.map((f) => f.facturaId)).toEqual([fb.id]);
    expect((await listar({ proveedorId: p2 }, E2, 2)).filas.map((f) => f.facturaId)).toEqual([fz.id]);
    expect((await listar({ proveedorId: p2 }, E1, 1)).totalReal).toBe(0); // proveedor de otra empresa pedido desde la empresa 1
    expect((await listar({ proveedorId: p1 }, E2, 2)).totalReal).toBe(0);
    expect((await listar({ proveedorId: p1 }, E1, 2)).totalReal).toBe(0); // empresa 2 con entidad de la empresa 1
  });

  it("paginación: totalReal y totales no dependen de la página; las páginas suman exactamente el total", async () => {
    const p = await proveedor();
    for (let i = 0; i < 23; i++) await factura(p, { neto: "10.01", dias: i * 5 });
    const paginas = [];
    for (let n = 1; n <= 3; n++) paginas.push(await listarAntiguedadCxp(1, E1, { proveedorId: p, page: n, pageSize: 10 }, CORTE));
    expect(paginas.map((x) => x.filas.length)).toEqual([10, 10, 3]);
    expect(new Set(paginas.map((x) => x.totalReal))).toEqual(new Set([23]));
    expect(new Set(paginas.map((x) => x.saldoTotal))).toEqual(new Set(["230.23"]));
    const ids = paginas.flatMap((x) => x.filas.map((f) => f.facturaId));
    expect(new Set(ids).size).toBe(23);
    expect(suma(paginas.flatMap((x) => x.filas.map((f) => f.saldo)))).toBe("230.23");
  });

  it("importes en el máximo de DECIMAL(14,2): lista, totales y Excel conservan cada centavo", async () => {
    const p = await proveedor();
    // total_documento = neto + IVA ≤ 999,999,999,999.99; sin ISR (proveedor no sujeto).
    const a = await factura(p, { neto: "999999999999.00", iva: "0.99", dias: 10 });
    const b = await factura(p, { neto: "999999999999.00", iva: "0.99", dias: 11 });
    await pagar(p, [[a.id, "0.01"]]);
    const r = await listar({ proveedorId: p });
    const por = new Map(r.filas.map((f) => [f.facturaId, f]));
    expect(por.get(a.id)).toMatchObject({ montoPagadero: "999999999999.99", pagado: "0.01", saldo: "999999999999.98" });
    expect(por.get(b.id)).toMatchObject({ saldo: "999999999999.99" });
    expect(r.saldoTotal).toBe("1999999999999.97");
    const ex = await listarAntiguedadCxpParaExportar(1, E1, { proveedorId: p }, CORTE);
    if (!ex.ok) throw new Error(ex.error);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await antiguedadCxpAExcel(ex.filas, ex.totalesPorTramo, ex.totalesPorSituacion, ex.saldoTotal, ex.fechaCorte)) as never);
    const ws = wb.getWorksheet("Antigüedad CxP")!;
    expect([5, 6].map((n) => (ws.getRow(n).getCell(13).value as number).toFixed(2)).sort()).toEqual(["999999999999.98", "999999999999.99"]);
    expect((wb.getWorksheet("Totales")!.getRow(wb.getWorksheet("Totales")!.rowCount).getCell(3).value as number).toFixed(2)).toBe("1999999999999.97");
  });

  it("exportación: mismo conjunto y totales que la lista con los mismos filtros; el corte conservado cambia solo los días, no el saldo", async () => {
    const p = await proveedor();
    await factura(p, { neto: "40.00", dias: 15, venc: venc(0) });
    await factura(p, { neto: "60.00", dias: 70, venc: venc(-5) });
    const lista = await listar({ proveedorId: p });
    const hoy = await listarAntiguedadCxpParaExportar(1, E1, { proveedorId: p }, CORTE);
    const ayer = await listarAntiguedadCxpParaExportar(1, E1, { proveedorId: p }, "2026-11-29");
    if (!hoy.ok || !ayer.ok) throw new Error("export");
    expect(hoy.filas).toEqual(lista.filas);
    expect(hoy.totalesPorTramo).toEqual(lista.totalesPorTramo);
    expect(hoy.saldoTotal).toBe(lista.saldoTotal);
    expect(ayer.filas.map((f) => f.saldo)).toEqual(hoy.filas.map((f) => f.saldo));
    expect(ayer.filas.map((f) => f.diasDesdeDocumento)).toEqual(hoy.filas.map((f) => f.diasDesdeDocumento - 1));
    const filtrado = await listarAntiguedadCxpParaExportar(1, E1, { proveedorId: p, situacion: "VENCIDA" }, CORTE);
    if (!filtrado.ok) throw new Error("export");
    expect(filtrado.filas).toHaveLength(1);
  });

  it("concurrencia: pagos simultáneos no desfasan filas y totales de una misma lectura (instantánea consistente)", async () => {
    const p = await proveedor();
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) ids.push((await factura(p, { neto: "100.00", dias: i })).id);
    const pagos = ids.map((id) => pagar(p, [[id, "33.33"]]).catch(() => null));
    const lecturas = Promise.all(Array.from({ length: 8 }, () => listar({ proveedorId: p })));
    const [rs] = await Promise.all([lecturas, Promise.all(pagos)]);
    for (const r of rs) expect(suma(r.filas.map((f) => f.saldo))).toBe(r.saldoTotal);
    expect((await listar({ proveedorId: p })).saldoTotal).toBe(new Decimal(1000).minus(new Decimal("33.33").times(10)).toFixed(2));
  });

  it("MIGRACION_PENDIENTE: sin cxp_facturas → 503; sin las tablas de pagos → lectura con pagado 0.00 (exacto, no puede haber pagos). Solo en la BD desechable, restaurada.", async () => {
    const p = await proveedor();
    await factura(p, { neto: "70.00" });
    await q("RENAME TABLE cxp_pago_aplicaciones TO cxp_pago_aplicaciones_tmp, cxp_pagos TO cxp_pagos_tmp");
    try {
      const r = await listar({ proveedorId: p });
      expect(r.filas[0]).toMatchObject({ pagado: "0.00", saldo: "70.00" });
    } finally {
      await q("RENAME TABLE cxp_pago_aplicaciones_tmp TO cxp_pago_aplicaciones, cxp_pagos_tmp TO cxp_pagos");
    }
    await q("RENAME TABLE cxp_facturas TO cxp_facturas_tmp");
    try {
      await expect(listar({ proveedorId: p })).rejects.toMatchObject({ codigo: "MIGRACION_PENDIENTE", status: 503 });
    } finally {
      await q("RENAME TABLE cxp_facturas_tmp TO cxp_facturas");
    }
    expect((await listar({ proveedorId: p })).totalReal).toBe(1);
  });

  it("corte inválido se rechaza antes de tocar el SQL", async () => {
    await expect(listarAntiguedadCxp(1, E1, {}, "2026-11-30'; DROP TABLE cxp_facturas;--")).rejects.toMatchObject({ codigo: "CORTE_INVALIDO", status: 400 });
  });
});
