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
import { anularFactura, obtenerFactura, registrarFactura } from "./facturas";
import { guardarConfigFiscal } from "./proveedor-fiscal";
import { registrarPago, reversarPago } from "./pagos";
import { obtenerAplicado } from "./aplicaciones";
import { listarAntiguedadCxp } from "./antiguedad";
import { exportarEstadoCuentaCxp, obtenerEstadoCuentaCxp, type OpcionesEstado } from "./estado-cuenta";
import { estadoCuentaAExcel } from "./estado-cuenta-excel";
import type { FiltrosEstadoCuenta } from "./estado-cuenta-shared";

/**
 * MIL-CXP-02 (estado de cuenta por proveedor, ACTUAL) contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407, solo local, datos SINTÉTICOS).
 * Aplica las migraciones REALES M-3A y M-3B1 y usa los servicios reales (registrarFactura, registrarPago, reversarPago, anularFactura).
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/contabilidad/cxp/estado-cuenta.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const db = `cxp_est_${randomUUID().replaceAll("-", "")}`;
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
const TODO: OpcionesEstado = { verPagos: true, verFiscal: true };
const SOLO_FACTURAS: OpcionesEstado = { verPagos: false, verFiscal: false };
const dia = (n: number) => new Date(Date.UTC(2026, 10, 30) - n * 86_400_000).toISOString().slice(0, 10); // fecha con n días de antigüedad al corte
const venc = (n: number) => new Date(Date.UTC(2026, 10, 30) + n * 86_400_000).toISOString().slice(0, 10);
let seq = 0;
const clave = () => `clave-${++seq}-${randomUUID().slice(0, 8)}`;
let provSeq = 100;
async function proveedor(o: { empresa?: number; entidad?: number; sujetoIsr?: boolean; sinConfig?: boolean } = {}): Promise<number> {
  const id = ++provSeq, empresa = o.empresa ?? 1, entidad = o.entidad ?? E1;
  await state.pool!.query("INSERT INTO compras_proveedores (id, empresa_id, nombre_comercial, nit, dias_credito, activo) VALUES (?, ?, ?, ?, 30, 1)", [id, empresa, `Proveedor Sintético ${id}`, `NIT-${id}`]);
  if (!o.sinConfig) await guardarConfigFiscal(empresa, entidad, id, actor, { regimenFiscal: "GENERAL", sujetoIsr: o.sujetoIsr ?? false });
  return id;
}
let nf = 0;
async function factura(proveedorId: number, o: { empresa?: number; entidad?: number; neto?: string; iva?: string; dias?: number; venc?: string | null } = {}) {
  return (await registrarFactura(o.empresa ?? 1, o.entidad ?? E1, actor, {
    proveedorId, serie: "S", numero: String(++nf), fechaDocumento: dia(o.dias ?? 0), fechaVencimiento: o.venc === undefined ? null : o.venc, baseNeto: o.neto ?? "1000.00", ivaMonto: o.iva ?? "0.00",
  })).factura;
}
const pagar = (proveedorId: number, aplic: [number, string][], extra: { medio?: string; referencia?: string } = {}, entidad = E1, empresa = 1) =>
  registrarPago(empresa, entidad, actor, { proveedorId, fechaPago: "2026-11-10", medioPago: extra.medio ?? "Transferencia", referencia: extra.referencia ?? "TR-1", claveIdempotencia: clave(), aplicaciones: aplic.map(([facturaId, monto]) => ({ facturaId, monto })) });
const estado = (proveedorId: number, f: Partial<FiltrosEstadoCuenta> = {}, op: OpcionesEstado = TODO, entidad = E1, empresa = 1) =>
  obtenerEstadoCuentaCxp(empresa, entidad, { proveedorId, incluirPagadas: false, incluirAnuladas: false, pageSize: 100, ...f }, op, CORTE);
const suma = (xs: string[]) => xs.reduce((a, x) => a.plus(x), new Decimal(0)).toFixed(2);
const huella = () => randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");

describe.skipIf(!port)("MIL-CXP-02 estado de cuenta por proveedor / MariaDB 11.8.9 SOLO LOCAL", () => {
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
    // Columnas bancarias/de contacto del proveedor (existen en producción; el esquema mínimo de la prueba no las trae): solo en esta BD desechable.
    await state.pool.query("ALTER TABLE compras_proveedores ADD COLUMN banco VARCHAR(150) NULL, ADD COLUMN numero_cuenta VARCHAR(100) NULL, ADD COLUMN tipo_cuenta VARCHAR(80) NULL, ADD COLUMN titular_cuenta VARCHAR(200) NULL, ADD COLUMN correo VARCHAR(200) NULL");
  }, 90000);
  afterAll(async () => {
    await state.pool?.end();
    if (admin) { if (!/^cxp_est_[a-f0-9]{32}$/.test(db)) throw Error("BD no desechable"); await admin.query(`DROP DATABASE ${db}`); await admin.end(); }
  });

  it("proveedor SIN movimientos: lista vacía, totales en cero, sin advertencias; sin configuración fiscal en la entidad también responde (régimen null)", async () => {
    const p = await proveedor();
    const r = await estado(p, { incluirPagadas: true, incluirAnuladas: true });
    expect(r.filas).toEqual([]);
    expect(r.totalReal).toBe(0);
    expect(r.totales).toMatchObject({ registradas: { facturas: 0, saldoExigible: "0.00", pagado: "0.00" }, abiertas: { facturas: 0, saldo: "0.00" }, anuladas: { facturas: 0 } });
    expect(r.advertencias).toEqual([]);
    expect(r.proveedor).toMatchObject({ id: p, nit: `NIT-${p}`, diasCredito: 30, regimenFiscal: "GENERAL", sujetoIsr: false });
    const sinConfig = await proveedor({ sinConfig: true });
    expect((await estado(sinConfig)).proveedor).toMatchObject({ id: sinConfig, regimenFiscal: null, sujetoIsr: null });
  });

  it("abiertas por defecto; pagadas y anuladas solo si se piden; anulada: saldo exigible 0.00 con importes informativos aparte; pagada: saldo 0.00", async () => {
    const p = await proveedor({ sujetoIsr: true });
    const pend = await factura(p, { neto: "1000.00", dias: 5 });
    const parc = await factura(p, { neto: "2000.00", dias: 6 });
    const pagada = await factura(p, { neto: "500.00", dias: 7 });
    const rev = await factura(p, { neto: "400.00", dias: 8 });
    const anul = await factura(p, { neto: "300.00", dias: 9 });
    const isr = await factura(p, { neto: "31250.00", iva: "3750.00", dias: 10 });
    await pagar(p, [[parc.id, "750.00"]]);
    await pagar(p, [[pagada.id, "500.00"]]);
    const pr = await pagar(p, [[rev.id, "400.00"]]);
    await reversarPago(1, E1, pr.pago.id, actor, "Pago capturado por error (sintético)");
    await pagar(p, [[isr.id, "10000.00"]]);
    await anularFactura(1, E1, anul.id, actor, "Factura duplicada (sintética)");

    const abiertas = await estado(p);
    expect(abiertas.filas.map((f) => f.facturaId)).toEqual([isr.id, rev.id, parc.id, pend.id]); // por fecha del documento ASCENDENTE (D4): 10, 8, 6 y 5 días de antigüedad
    expect(abiertas.filas.every((f) => f.estado === "ABIERTA")).toBe(true);
    const por = new Map(abiertas.filas.map((f) => [f.facturaId, f]));
    expect(por.get(rev.id)).toMatchObject({ pagado: "0.00", saldo: "400.00", estadoFinanciero: "PENDIENTE" }); // pago reversado: no suma
    expect(por.get(parc.id)).toMatchObject({ pagado: "750.00", saldo: "1250.00", estadoFinanciero: "PARCIAL" });
    expect(por.get(isr.id)).toMatchObject({ totalDocumento: "35000.00", retencionIsr: "1587.50", montoPagadero: "33412.50", pagado: "10000.00", saldo: "23412.50" });
    expect(abiertas.totales.registradas.saldoExigible).toBe(suma(["1000.00", "1250.00", "400.00", "23412.50"]));
    expect(abiertas.totales.pagadas.facturas).toBe(0);
    expect(abiertas.totales.anuladas.facturas).toBe(0);

    const conPagadas = await estado(p, { incluirPagadas: true });
    const fp = conPagadas.filas.find((f) => f.facturaId === pagada.id)!;
    expect(fp).toMatchObject({ estado: "PAGADA", estadoFinanciero: "PAGADA", saldo: "0.00", pagado: "500.00", montoPagadero: "500.00" });
    expect(conPagadas.filas.some((f) => f.facturaId === anul.id)).toBe(false);
    expect(conPagadas.totales.pagadas.facturas).toBe(1);
    expect(conPagadas.totales.registradas.saldoExigible).toBe(abiertas.totales.registradas.saldoExigible); // pagadas no cambian el saldo exigible

    const conAnuladas = await estado(p, { incluirAnuladas: true });
    const fa = conAnuladas.filas.find((f) => f.facturaId === anul.id)!;
    expect(fa).toMatchObject({ estado: "ANULADA", estadoFinanciero: "ANULADA", saldo: "0.00", situacion: null, diasVencidos: null, montoPagadero: "300.00", totalDocumento: "300.00", motivoAnulacion: "Factura duplicada (sintética)" });
    expect(conAnuladas.totales.anuladas).toEqual({ facturas: 1, totalDocumento: "300.00", retencionIsr: "0.00", montoPagadero: "300.00" });
    expect(conAnuladas.totales.registradas.saldoExigible).toBe(abiertas.totales.registradas.saldoExigible); // las anuladas NO suman
    expect(conAnuladas.totales.registradas.totalDocumento).toBe(abiertas.totales.registradas.totalDocumento);

    const todo = await estado(p, { incluirPagadas: true, incluirAnuladas: true });
    expect(todo.filas).toHaveLength(6);
    expect(todo.totalReal).toBe(6);
    expect(todo.totales.registradas.facturas + todo.totales.anuladas.facturas).toBe(6);
  });

  it("orden por fecha del documento ascendente y filtros desde/hasta INCLUSIVOS sobre la fecha del documento (no reconstruyen saldos)", async () => {
    const p = await proveedor();
    const a = await factura(p, { neto: "10.00", dias: 30 }), b = await factura(p, { neto: "20.00", dias: 20 }), c = await factura(p, { neto: "30.00", dias: 10 });
    expect((await estado(p)).filas.map((f) => f.facturaId)).toEqual([a.id, b.id, c.id]);
    expect((await estado(p, { desde: dia(20), hasta: dia(10) })).filas.map((f) => f.facturaId)).toEqual([b.id, c.id]); // extremos inclusivos
    expect((await estado(p, { desde: dia(20), hasta: dia(20) })).filas.map((f) => f.facturaId)).toEqual([b.id]);
    expect((await estado(p, { desde: dia(5) })).filas).toHaveLength(0);
    const parcial = await estado(p, { desde: dia(20) });
    expect(parcial.totales.registradas.saldoExigible).toBe("50.00"); // totales = conjunto filtrado
  });

  it("totales del CONJUNTO FILTRADO (no de la página): las páginas suman exactamente el total y los totales no cambian al paginar", async () => {
    const p = await proveedor();
    for (let i = 0; i < 23; i++) await factura(p, { neto: "10.01", dias: i });
    const paginas = [];
    for (let n = 1; n <= 3; n++) paginas.push(await obtenerEstadoCuentaCxp(1, E1, { proveedorId: p, incluirPagadas: true, incluirAnuladas: true, page: n, pageSize: 10 }, TODO, CORTE));
    expect(paginas.map((x) => x.filas.length)).toEqual([10, 10, 3]);
    expect(new Set(paginas.map((x) => x.totalReal))).toEqual(new Set([23]));
    expect(new Set(paginas.map((x) => JSON.stringify(x.totales)))).toHaveProperty("size", 1);
    expect(paginas[0].totales.registradas).toMatchObject({ facturas: 23, saldoExigible: "230.23", totalDocumento: "230.23" });
    const ids = paginas.flatMap((x) => x.filas.map((f) => f.facturaId));
    expect(new Set(ids).size).toBe(23);
    expect(suma(paginas.flatMap((x) => x.filas.map((f) => f.saldo)))).toBe("230.23");
  });

  it("COMPARA contra obtenerFactura, obtenerAplicado y MIL-CXP-01 para exactamente el mismo conjunto de facturas (abiertas, pagadas y anuladas)", async () => {
    const p = await proveedor({ sujetoIsr: true });
    const f1 = await factura(p, { neto: "31250.00", iva: "3750.00", dias: 20, venc: venc(-5) });
    const f2 = await factura(p, { neto: "2800.00", iva: "336.00", dias: 40, venc: venc(0) });
    const f3 = await factura(p, { neto: "999.99", dias: 70, venc: venc(10) });
    const f4 = await factura(p, { neto: "500.00", dias: 91 });
    const f5 = await factura(p, { neto: "700.00", dias: 15 });
    const f6 = await factura(p, { neto: "250.00", dias: 3 });
    await pagar(p, [[f1.id, "10000.00"], [f2.id, "2996.00"]]);
    await pagar(p, [[f3.id, "0.01"]]);
    const rv = await pagar(p, [[f4.id, "500.00"]]);
    await reversarPago(1, E1, rv.pago.id, actor, "Reverso sintético");
    await pagar(p, [[f5.id, "700.00"]]);
    await anularFactura(1, E1, f6.id, actor, "Anulada sintética");

    const todo = await estado(p, { incluirPagadas: true, incluirAnuladas: true });
    const ids = todo.filas.map((f) => f.facturaId);
    expect(ids.sort((a, b) => a - b)).toEqual([f1.id, f2.id, f3.id, f4.id, f5.id, f6.id].sort((a, b) => a - b));
    const aplicado = await obtenerAplicado(1, E1, ids);
    for (const f of todo.filas) {
      const ref = (await obtenerFactura(1, E1, f.facturaId))!;
      expect(f.pagado, `${f.documento} pagado vs obtenerAplicado`).toBe(aplicado.get(f.facturaId));
      expect(f.pagado, `${f.documento} pagado vs obtenerFactura`).toBe(ref.pagado);
      expect(f.saldo, `${f.documento} saldo vs obtenerFactura`).toBe(ref.saldo);
      expect(f.montoPagadero).toBe(ref.montoPagadero);
      expect(f.retencionIsr).toBe(ref.retencionIsr);
      expect(f.totalDocumento).toBe(ref.totalDocumento);
      expect(f.estadoFinanciero).toBe(ref.estadoFinanciero);
    }
    // MIL-CXP-01 (antigüedad) para el mismo proveedor y corte: exactamente las ABIERTAS, mismos saldos, mismos totales y misma situación de vencimiento
    const ant = await listarAntiguedadCxp(1, E1, { proveedorId: p, pageSize: 100 }, CORTE);
    const abiertas = todo.filas.filter((f) => f.estado === "ABIERTA");
    expect(ant.filas.map((f) => f.facturaId).sort((a, b) => a - b)).toEqual(abiertas.map((f) => f.facturaId).sort((a, b) => a - b));
    for (const a of ant.filas) {
      const f = abiertas.find((x) => x.facturaId === a.facturaId)!;
      expect([a.saldo, a.pagado, a.montoPagadero, a.situacion, a.diasVencidos, a.diasDesdeDocumento]).toEqual([f.saldo, f.pagado, f.montoPagadero, f.situacion, f.diasVencidos, f.diasDesdeDocumento]);
    }
    expect(ant.saldoTotal).toBe(todo.totales.abiertas.saldo);
    expect(ant.saldoTotal).toBe(todo.totales.registradas.saldoExigible);
    expect(ant.totalesPorSituacion.map((t) => [t.situacion, t.facturas, t.saldo])).toEqual(todo.totales.porSituacion.map((t) => [t.situacion, t.facturas, t.saldo]));
    // pagadas: saldo 0.00; anuladas: saldo exigible 0.00 (no figuran en antigüedad)
    expect(todo.filas.filter((f) => f.estado === "PAGADA").every((f) => f.saldo === "0.00")).toBe(true);
    expect(todo.filas.filter((f) => f.estado === "ANULADA").every((f) => f.saldo === "0.00" && !ant.filas.some((a) => a.facturaId === f.facturaId))).toBe(true);
    expect(todo.advertencias).toEqual([]);
  });

  it("D2: líneas de pagos (referencia, medio, reverso y motivo) SOLO con permiso de Pagos; sin él el servidor ni las consulta ni las envía", async () => {
    const p = await proveedor();
    const f1 = await factura(p, { neto: "800.00", dias: 12 }), f2 = await factura(p, { neto: "300.00", dias: 11 });
    await pagar(p, [[f1.id, "200.00"]], { medio: "MEDIO-SECRETO-X", referencia: "REF-SECRETA-X" });
    const rv = await pagar(p, [[f1.id, "100.00"], [f2.id, "50.00"]], { medio: "MEDIO-SECRETO-X", referencia: "REF-REVERSADA-X" });
    await reversarPago(1, E1, rv.pago.id, actor, "MOTIVO-SECRETO-X");

    const con = await estado(p, {}, { verPagos: true, verFiscal: false });
    expect(con.pagosVisibles).toBe(true);
    const l1 = con.filas.find((f) => f.facturaId === f1.id)!.pagos!;
    expect(l1.map((l) => [l.estado, l.vigente, l.monto, l.referencia])).toEqual([["REGISTRADO", true, "200.00", "REF-SECRETA-X"], ["REVERSADO", false, "100.00", "REF-REVERSADA-X"]]);
    expect(l1[1]).toMatchObject({ motivoReversion: "MOTIVO-SECRETO-X" });
    expect(l1[1].reversadoEn).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(suma(l1.filter((l) => l.vigente).map((l) => l.monto))).toBe(con.filas.find((f) => f.facturaId === f1.id)!.pagado); // vigentes = pagado; reversados no suman
    expect(con.filas.find((f) => f.facturaId === f2.id)!.pagos).toEqual([expect.objectContaining({ estado: "REVERSADO", vigente: false })]);

    const sin = await estado(p, {}, SOLO_FACTURAS);
    expect(sin.pagosVisibles).toBe(false);
    expect(sin.filas.every((f) => !("pagos" in f))).toBe(true);
    const texto = JSON.stringify(sin);
    for (const secreto of ["MEDIO-SECRETO-X", "REF-SECRETA-X", "REF-REVERSADA-X", "MOTIVO-SECRETO-X", "reversadoEn", "motivoReversion"]) expect(texto).not.toContain(secreto);
    // los saldos son los mismos con o sin permiso de Pagos (el agregado pertenece a las facturas)
    expect(sin.filas.map((f) => [f.facturaId, f.pagado, f.saldo])).toEqual(con.filas.map((f) => [f.facturaId, f.pagado, f.saldo]));
    expect(sin.totales).toEqual(con.totales);
  });

  it("D6: régimen solo con permiso fiscal y si hay configuración; NUNCA datos bancarios ni de contacto del proveedor", async () => {
    const p = await proveedor({ sujetoIsr: true });
    await q("UPDATE compras_proveedores SET banco = 'BANCO-SECRETO', numero_cuenta = 'CUENTA-SECRETA-123', tipo_cuenta = 'TIPO-SECRETO', titular_cuenta = 'TITULAR-SECRETO', correo = 'secreto@x.test' WHERE empresa_id = 1 AND id = ?", [p]);
    await factura(p, { neto: "10.00" });
    const con = await estado(p, {}, TODO);
    expect(con.proveedor).toEqual({ id: p, nombre: `Proveedor Sintético ${p}`, nit: `NIT-${p}`, diasCredito: 30, regimenFiscal: "GENERAL", sujetoIsr: true });
    const sinFiscal = await estado(p, {}, { verPagos: true, verFiscal: false });
    expect(sinFiscal.proveedor).toMatchObject({ regimenFiscal: null, sujetoIsr: null, nit: `NIT-${p}`, diasCredito: 30 });
    for (const r of [con, sinFiscal]) for (const secreto of ["BANCO-SECRETO", "CUENTA-SECRETA-123", "TIPO-SECRETO", "TITULAR-SECRETO", "secreto@x.test"]) expect(JSON.stringify(r)).not.toContain(secreto);
    await q("UPDATE compras_proveedores SET nit = NULL, dias_credito = NULL WHERE empresa_id = 1 AND id = ?", [p]);
    expect((await estado(p)).proveedor).toMatchObject({ nit: null, diasCredito: null }); // solo se muestra lo registrado
  });

  it("INTEGRIDAD: sobreaplicación, pago vigente en anulada, pago de otro proveedor y pago descuadrado → ADVERTENCIAS verificables; los importes originales no se modifican", async () => {
    // 1) sobreaplicación insertada a mano (el servicio la impide)
    const p1 = await proveedor();
    const f = await factura(p1, { neto: "100.00", dias: 4 });
    await pagar(p1, [[f.id, "100.00"]]);
    const ins = (await q("INSERT INTO cxp_pagos (empresa_id, entidad_id, proveedor_id, fecha_pago, monto_total, medio_pago, referencia, clave_idempotencia, huella, creado_por) VALUES (1, ?, ?, '2026-11-10', 10.00, 'Manual', 'EXCESO', ?, ?, 91)", [E1, p1, clave(), huella()])) as unknown as { insertId: number };
    await q("INSERT INTO cxp_pago_aplicaciones (empresa_id, entidad_id, pago_id, factura_id, monto) VALUES (1, ?, ?, ?, 10.00)", [E1, ins.insertId, f.id]);
    const r1 = await estado(p1, { incluirPagadas: true });
    const w1 = r1.advertencias.find((a) => a.codigo === "SOBREAPLICACION")!;
    expect(w1).toMatchObject({ facturaId: f.id, detalle: { montoPagadero: "100.00", pagado: "110.00", exceso: "10.00" } });
    expect(r1.filas[0]).toMatchObject({ pagado: "110.00", saldo: "-10.00", estado: "PAGADA", montoPagadero: "100.00" }); // crudo: no se normaliza
    expect(r1.totales.registradas.saldoExigible).toBe("0.00"); // el exceso no compensa saldos de otras facturas
    expect((await estado(p1, { incluirPagadas: true }, SOLO_FACTURAS)).advertencias.map((a) => a.codigo)).toContain("SOBREAPLICACION");

    // 2) factura ANULADA que conserva pagos vigentes (forzada a mano)
    const p2 = await proveedor();
    const g = await factura(p2, { neto: "50.00" });
    await pagar(p2, [[g.id, "20.00"]]);
    await q("UPDATE cxp_facturas SET estado_admin = 'ANULADA', anulado_por = 91, anulado_en = NOW(), motivo_anulacion = 'Forzada (sintética)' WHERE empresa_id = 1 AND entidad_id = ? AND id = ?", [E1, g.id]);
    const r2 = await estado(p2, { incluirAnuladas: true });
    expect(r2.advertencias).toEqual([expect.objectContaining({ codigo: "PAGO_VIGENTE_EN_ANULADA", facturaId: g.id })]);
    expect(r2.filas[0]).toMatchObject({ estado: "ANULADA", saldo: "0.00", pagado: "20.00", montoPagadero: "50.00" });

    // 3) y 4) pago descuadrado y pago aplicado a factura de otro proveedor (datos de pagos: solo con permiso de Pagos)
    const pa = await proveedor(), pb = await proveedor();
    const fa = await factura(pa, { neto: "40.00" }), fb = await factura(pb, { neto: "60.00" });
    const pay = await pagar(pa, [[fa.id, "40.00"]]);
    await q("UPDATE cxp_pagos SET monto_total = 45.00 WHERE empresa_id = 1 AND entidad_id = ? AND id = ?", [E1, pay.pago.id]);
    const cruzado = (await q("INSERT INTO cxp_pagos (empresa_id, entidad_id, proveedor_id, fecha_pago, monto_total, medio_pago, referencia, clave_idempotencia, huella, creado_por) VALUES (1, ?, ?, '2026-11-10', 5.00, 'Manual', 'CRUZADO', ?, ?, 91)", [E1, pa, clave(), huella()])) as unknown as { insertId: number };
    await q("INSERT INTO cxp_pago_aplicaciones (empresa_id, entidad_id, pago_id, factura_id, monto) VALUES (1, ?, ?, ?, 5.00)", [E1, cruzado.insertId, fb.id]);
    const conPagos = await estado(pa, {}, TODO), delOtro = await estado(pb, {}, TODO), sinPagos = await estado(pa, {}, SOLO_FACTURAS);
    expect(conPagos.advertencias.map((a) => a.codigo).sort()).toEqual(["PAGO_DESCUADRADO", "PAGO_DE_OTRO_PROVEEDOR"]);
    expect(conPagos.advertencias.find((a) => a.codigo === "PAGO_DESCUADRADO")).toMatchObject({ pagoId: pay.pago.id, detalle: { montoTotal: "45.00", sumaAplicaciones: "40.00" } });
    expect(delOtro.advertencias.map((a) => a.codigo)).toContain("PAGO_DE_OTRO_PROVEEDOR");
    expect(sinPagos.advertencias).toEqual([]); // sin permiso de Pagos no se consultan ni se informan datos de pagos
  });

  it("aislamiento: otra entidad de la misma empresa, otra empresa, proveedor ajeno → sin cruces ni fugas", async () => {
    const p1 = await proveedor({ entidad: E1 });
    await guardarConfigFiscal(1, E1B, p1, actor, { regimenFiscal: "GENERAL", sujetoIsr: false });
    const p2 = await proveedor({ empresa: 2, entidad: E2 });
    const fa = await factura(p1, { neto: "11.00", entidad: E1 }), fb = await factura(p1, { neto: "22.00", entidad: E1B });
    const fz = await factura(p2, { neto: "33.00", empresa: 2, entidad: E2 });
    await pagar(p1, [[fb.id, "2.00"]], {}, E1B);
    expect((await estado(p1, {}, TODO, E1)).filas.map((f) => f.facturaId)).toEqual([fa.id]);
    const b = await estado(p1, {}, TODO, E1B);
    expect(b.filas.map((f) => [f.facturaId, f.saldo])).toEqual([[fb.id, "20.00"]]);
    expect(b.filas[0].pagos).toHaveLength(1);
    expect((await estado(p1, {}, TODO, E1)).filas[0].pagos).toEqual([]); // el pago de E1B no aparece en E1
    expect((await estado(p2, {}, TODO, E2, 2)).filas.map((f) => f.facturaId)).toEqual([fz.id]);
    await expect(estado(p2, {}, TODO, E1, 1)).rejects.toMatchObject({ status: 404, codigo: "PROVEEDOR_NO_DISPONIBLE" }); // proveedor de otra empresa
    await expect(estado(p1, {}, TODO, E2, 2)).rejects.toMatchObject({ status: 404, codigo: "PROVEEDOR_NO_DISPONIBLE" });
    await expect(estado(p1, {}, TODO, E2, 1)).rejects.toMatchObject({ status: 404, codigo: "ENTIDAD_NO_DISPONIBLE" }); // entidad de otra empresa
    await expect(estado(p1, {}, TODO, E1, 2)).rejects.toMatchObject({ status: 404, codigo: "ENTIDAD_NO_DISPONIBLE" });
    await expect(estado(p1, {}, TODO, 9999, 1)).rejects.toMatchObject({ status: 404, codigo: "ENTIDAD_NO_DISPONIBLE" });
    await expect(estado(987654, {}, TODO)).rejects.toMatchObject({ status: 404, codigo: "PROVEEDOR_NO_DISPONIBLE" });
  });

  it("precisión: centavos exactos (0.1 + 0.2), máximo DECIMAL(14,2) y sumas gigantes sin Number", async () => {
    const p = await proveedor();
    const a = await factura(p, { neto: "0.10", dias: 2 }), b = await factura(p, { neto: "0.20", dias: 1 });
    expect((await estado(p)).totales.registradas).toMatchObject({ totalDocumento: "0.30", montoPagadero: "0.30", saldoExigible: "0.30" });
    await pagar(p, [[a.id, "0.04"]]);
    expect((await estado(p)).totales.registradas).toMatchObject({ pagado: "0.04", saldoExigible: "0.26" });
    const q2 = await proveedor();
    const m1 = await factura(q2, { neto: "999999999999.00", iva: "0.99", dias: 10 }), m2 = await factura(q2, { neto: "999999999999.00", iva: "0.99", dias: 11 });
    await pagar(q2, [[m1.id, "0.01"]]);
    const r = await estado(q2);
    expect(r.filas.find((f) => f.facturaId === m1.id)).toMatchObject({ montoPagadero: "999999999999.99", pagado: "0.01", saldo: "999999999999.98" });
    expect(r.filas.find((f) => f.facturaId === m2.id)).toMatchObject({ saldo: "999999999999.99" });
    expect(r.totales.registradas.saldoExigible).toBe("1999999999999.97");
    expect(b.id).toBeGreaterThan(0);
  });

  it("concurrencia: pagos simultáneos no desfasan filas, líneas y totales de una misma lectura (instantánea consistente)", async () => {
    const p = await proveedor();
    const ids: number[] = [];
    for (let i = 0; i < 10; i++) ids.push((await factura(p, { neto: "100.00", dias: i })).id);
    const pagos = ids.map((id) => pagar(p, [[id, "33.33"]]).catch(() => null));
    const lecturas = Promise.all(Array.from({ length: 8 }, () => estado(p, {}, TODO)));
    const [rs] = await Promise.all([lecturas, Promise.all(pagos)]);
    for (const r of rs) {
      expect(suma(r.filas.map((f) => f.saldo))).toBe(r.totales.registradas.saldoExigible);
      expect(suma(r.filas.map((f) => f.pagado))).toBe(r.totales.registradas.pagado);
      for (const f of r.filas) expect(suma((f.pagos ?? []).filter((l) => l.vigente).map((l) => l.monto)), f.documento).toBe(f.pagado);
      expect(r.advertencias).toEqual([]);
    }
    expect((await estado(p)).totales.registradas.saldoExigible).toBe(new Decimal(1000).minus(new Decimal("33.33").times(10)).toFixed(2));
  });

  it("exportación: mismo conjunto, totales y permisos que la pantalla; hoja «Pagos» solo con permiso; sin permiso el archivo no contiene datos de pagos", async () => {
    const p = await proveedor({ sujetoIsr: true });
    const f1 = await factura(p, { neto: "31250.00", iva: "3750.00", dias: 20, venc: venc(-5) }), f2 = await factura(p, { neto: "400.00", dias: 8 }), f3 = await factura(p, { neto: "300.00", dias: 9 });
    await pagar(p, [[f1.id, "10000.00"]], { referencia: "REF-XLSX-SECRETA", medio: "MEDIO-XLSX-SECRETO" });
    const rv = await pagar(p, [[f2.id, "400.00"]], { referencia: "REF-XLSX-REV" });
    await reversarPago(1, E1, rv.pago.id, actor, "MOTIVO-XLSX-SECRETO");
    await anularFactura(1, E1, f3.id, actor, "Anulada sintética");
    const filtros = { proveedorId: p, incluirPagadas: true, incluirAnuladas: true };
    for (const op of [TODO, SOLO_FACTURAS, { verPagos: true, verFiscal: false }]) {
      const pantalla = await estado(p, { incluirPagadas: true, incluirAnuladas: true }, op);
      const ex = await exportarEstadoCuentaCxp(1, E1, filtros, op, CORTE);
      if (!ex.ok) throw new Error(ex.error);
      expect(ex.datos.filas).toEqual(pantalla.filas);
      expect(ex.datos.totales).toEqual(pantalla.totales);
      expect(ex.datos.proveedor).toEqual(pantalla.proveedor);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await estadoCuentaAExcel(ex.datos)) as never);
      expect(wb.worksheets.map((w) => w.name)).toEqual(op.verPagos ? ["Estado de cuenta", "Pagos", "Resumen"] : ["Estado de cuenta", "Resumen"]);
      const texto: string[] = []; wb.eachSheet((ws) => ws.eachRow((r) => r.eachCell((c) => texto.push(String(c.value ?? "")))));
      const plano = texto.join("\n");
      for (const secreto of ["REF-XLSX-SECRETA", "MEDIO-XLSX-SECRETO", "REF-XLSX-REV", "MOTIVO-XLSX-SECRETO"]) {
        if (op.verPagos) expect(plano).toContain(secreto); else expect(plano).not.toContain(secreto);
      }
      const ws = wb.getWorksheet("Estado de cuenta")!;
      const filasXlsx: unknown[][] = []; ws.eachRow((row, n) => { if (n > 8) filasXlsx.push(row.values as unknown[]); });
      expect(filasXlsx).toHaveLength(pantalla.filas.length);
      pantalla.filas.forEach((f, i) => {
        const v = filasXlsx[i];
        expect([v[1], v[2], (v[10] as number).toFixed(2), (v[11] as number).toFixed(2)]).toEqual([f.documento, f.fechaDocumento, f.pagado, f.saldo]);
      });
    }
  });

  it("MIGRACION_PENDIENTE: sin tablas de pagos el estado funciona con pagado 0.00 y sin líneas; sin cxp_facturas → 503. Solo en la BD desechable, restauradas.", async () => {
    const p = await proveedor();
    await factura(p, { neto: "70.00" });
    await q("RENAME TABLE cxp_pago_aplicaciones TO cxp_pago_aplicaciones_tmp, cxp_pagos TO cxp_pagos_tmp");
    try {
      const r = await estado(p, {}, TODO);
      expect(r.filas[0]).toMatchObject({ pagado: "0.00", saldo: "70.00", pagos: [] });
      expect(r.totales.registradas.saldoExigible).toBe("70.00");
    } finally {
      await q("RENAME TABLE cxp_pago_aplicaciones_tmp TO cxp_pago_aplicaciones, cxp_pagos_tmp TO cxp_pagos");
    }
    await q("RENAME TABLE cxp_facturas TO cxp_facturas_tmp");
    try {
      await expect(estado(p)).rejects.toMatchObject({ codigo: "MIGRACION_PENDIENTE", status: 503 });
    } finally {
      await q("RENAME TABLE cxp_facturas_tmp TO cxp_facturas");
    }
    expect((await estado(p)).totalReal).toBe(1);
  });

  it("corte inválido se rechaza antes de tocar el SQL; el corte conservado cambia solo los días, no los saldos", async () => {
    const p = await proveedor();
    await factura(p, { neto: "50.00", dias: 15, venc: venc(-3) });
    await expect(obtenerEstadoCuentaCxp(1, E1, { proveedorId: p, incluirPagadas: false, incluirAnuladas: false }, TODO, "2026-11-30'; DROP TABLE cxp_facturas;--")).rejects.toMatchObject({ codigo: "CORTE_INVALIDO", status: 400 });
    const hoy = await obtenerEstadoCuentaCxp(1, E1, { proveedorId: p, incluirPagadas: false, incluirAnuladas: false }, TODO, "2026-11-30");
    const ayer = await obtenerEstadoCuentaCxp(1, E1, { proveedorId: p, incluirPagadas: false, incluirAnuladas: false }, TODO, "2026-11-29");
    expect([hoy.filas[0].diasDesdeDocumento, ayer.filas[0].diasDesdeDocumento]).toEqual([15, 14]);
    expect([hoy.filas[0].diasVencidos, ayer.filas[0].diasVencidos]).toEqual([3, 2]);
    expect(ayer.filas[0].saldo).toBe(hoy.filas[0].saldo);
    expect(ayer.fechaCorte).toBe("2026-11-29");
  });
});
