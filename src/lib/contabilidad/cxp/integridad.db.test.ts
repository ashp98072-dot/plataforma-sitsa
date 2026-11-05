import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { barrera, eliminarPropia, identificador, laboratorio, nuevaIdentidad, observarPool, sentencias, sha256, validarServidor } from "./__tests__/integridad-lab";

const state = vi.hoisted(() => ({ pool: null as Pool | null, facade: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => state.facade ?? state.pool,
  query: async (sql: string, params: unknown[] = []) => (await state.pool!.query(sql, params))[0],
}));
import { anularFactura, registrarFactura } from "./facturas";
import { guardarConfigFiscal } from "./proveedor-fiscal";
import { registrarPago, reversarPago } from "./pagos";
import { consultasIntegridad, exportarIntegridadCxp, obtenerIntegridadCxp } from "./integridad";
import { integridadAExcel } from "./integridad-excel";
import { LIMITE_LINEAS, type FiltrosIntegridad } from "./integridad-shared";

/** SOLO servidor loopback previamente autorizado. Ver procedimiento en docs/CXP-QA-MARIADB-MIL-CXP-05.md.
 * Sin LIQ_TEST_DB_PORT: suite omitida, NO integración aprobada. Con puerto: guardas obligatorias antes de conectar.
 * No lee .env, DB_HOST ni el pool productivo. No inicia servidores. No modifica migraciones/reglas productivas.
 */
const enabled = Boolean(process.env.LIQ_TEST_DB_PORT);
const identity = nuevaIdentidad();
const migrations = ["migrate-2026-11-cxp-m3a-base.sql", "migrate-2026-11-cxp-m3b1-pagos.sql"];
const actor = { id: 91, username: "qa-sintetico" };
let admin: mysql.Connection | undefined, created = false, cfg: ReturnType<typeof laboratorio>;
let sequence = 0;
const metrics: unknown[] = [];
const q = async (sql: string, params: unknown[] = []) => (await state.pool!.query<RowDataPacket[]>(sql, params))[0];
const report = (f: FiltrosIntegridad = {}, verPagos = true, empresa = 1, entidad = 5) => obtenerIntegridadCxp(empresa, entidad, f, { verPagos });
const exportData = (f: FiltrosIntegridad = {}, verPagos = true) => exportarIntegridadCxp(1, 5, f, { verPagos });
async function factura(proveedor = 3, monto = "100.00", empresa = 1, entidad = 5) {
  return (await registrarFactura(empresa, entidad, actor, { proveedorId: proveedor, serie: "QA", numero: String(++sequence), fechaDocumento: "2026-11-05", baseNeto: monto, ivaMonto: "0.00" })).factura;
}
const pago = (facturaId: number, monto: string, proveedor = 3) => registrarPago(1, 5, actor, {
  proveedorId: proveedor, fechaPago: "2026-11-05", medioPago: "QA", referencia: "SOLO SINTETICO", claveIdempotencia: randomUUID(), aplicaciones: [{ facturaId, monto }],
});
/** Sólo esta base NUEVA. Las anomalías históricas no atraviesan los servicios de escritura. FK/CHECK permanecen activos. */
async function pagoHistorico(facturas: [number, string][], total: string, proveedor = 3, empresa = 1, entidad = 5, reversed = false) {
  const [r] = await state.pool!.query<ResultSetHeader>(`INSERT INTO cxp_pagos
    (empresa_id,entidad_id,proveedor_id,fecha_pago,monto_total,clave_idempotencia,huella,creado_por,estado,reversado_por,reversado_en,motivo_reversion)
    VALUES (?,?,?,'2026-11-05',?,?,?,91,?,?,?,?)`,
  [empresa, entidad, proveedor, total, randomUUID(), "a".repeat(64), reversed ? "REVERSADO" : "REGISTRADO", reversed ? 91 : null, reversed ? "2026-11-05 12:00:00" : null, reversed ? "QA sintetico" : null]);
  for (let i = 0; i < facturas.length; i += 500) {
    const batch = facturas.slice(i, i + 500).map(([id, monto]) => [empresa, entidad, r.insertId, id, monto]);
    await state.pool!.query("INSERT INTO cxp_pago_aplicaciones (empresa_id,entidad_id,pago_id,factura_id,monto) VALUES ?", [batch]);
  }
  return r.insertId;
}
async function facturasMasivas(n: number) {
  for (let i = 0; i < n; i += 500) {
    const rows = Array.from({ length: Math.min(500, n - i) }, () => {
      const num = String(++sequence);
      return [1, 5, 3, "FACTURA", "QA", num, "QA", num, "2026-11-05", "1.00", "0.00", "1.00", "0.00", "0.00", "1.00", "QA_SINTETICO", "GENERAL", 0, 91];
    });
    await state.pool!.query(`INSERT INTO cxp_facturas
      (empresa_id,entidad_id,proveedor_id,tipo_documento,serie,numero,serie_norm,numero_norm,fecha_documento,base_neto,iva_monto,total_documento,isr_porcentaje,isr_monto,total_neto_pagar,regla_isr,regimen_fiscal_snapshot,sujeto_isr_snapshot,creado_por) VALUES ?`, [rows]);
  }
  return (await q("SELECT id FROM cxp_facturas WHERE empresa_id=1 AND entidad_id=5 ORDER BY id")).map(r => Number(r.id));
}
async function limpiar() {
  // Exclusivamente fixtures de nuestra base aleatoria; no TRUNCATE, no desactivar constraints.
  for (const table of ["cxp_pago_aplicaciones", "cxp_pagos", "cxp_facturas"]) await state.pool!.query(`DELETE FROM ${table}`);
}
async function reabrir(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}
const claveFila = (r: Awaited<ReturnType<typeof report>>["filas"][number]) => `${r.advertencia.codigo}:${r.facturaId ?? "-"}:${r.pago?.id ?? "-"}`;

describe.skipIf(!enabled)("MIL-CXP-05 integración REAL / MariaDB 11.8.9 desechable autorizado", () => {
  beforeAll(async () => {
    cfg = laboratorio(process.env); // Valida TODO antes de abrir socket.
    admin = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password });
    const [server] = await admin.query<RowDataPacket[]>("SELECT VERSION() v, @@port p, @@datadir d");
    validarServidor(String(server[0].v), Number(server[0].p), String(server[0].d), cfg);
    metrics.push({ lab: cfg.alias, version: String(server[0].v), port: cfg.port, datadirSha256: cfg.fingerprint, database: identity.db });
    await admin.query(`CREATE DATABASE ${identificador(identity.db)} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
    created = true;
    // Marcador creado antes del pool/migraciones para poder limpiar aun si fallan.
    await admin.query(`CREATE TABLE ${identificador(identity.db)}.qa_ownership(token CHAR(36) PRIMARY KEY) ENGINE=InnoDB`);
    await admin.query(`INSERT INTO ${identificador(identity.db)}.qa_ownership VALUES (?)`, [identity.token]);
    state.pool = mysql.createPool({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: identity.db, connectionLimit: 8, dateStrings: true, multipleStatements: true });
    expect((await q("SELECT DATABASE() d"))[0].d).toBe(identity.db);
    await state.pool.query(`
      CREATE TABLE usuarios(id INT PRIMARY KEY) ENGINE=InnoDB; INSERT INTO usuarios VALUES(91),(92);
      CREATE TABLE compras_proveedores(id INT PRIMARY KEY,empresa_id INT NOT NULL,nombre_comercial VARCHAR(200) NOT NULL,nit VARCHAR(30) NULL,dias_credito INT NULL,activo TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uq_p(empresa_id,id)) ENGINE=InnoDB;
      INSERT INTO compras_proveedores VALUES(3,1,'=QA formula sintetica','111-1',30,1),(4,1,'Proveedor Dos','222-2',NULL,1),(9,2,'Proveedor otra empresa',NULL,NULL,1);
      CREATE TABLE cont_entidades(id INT PRIMARY KEY,empresa_id INT NOT NULL,activa TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uq_e(empresa_id,id)) ENGINE=InnoDB;
      INSERT INTO cont_entidades VALUES(5,1,1),(6,1,1),(7,2,1);
      CREATE TABLE cont_cuentas(id INT PRIMARY KEY,empresa_id INT NOT NULL,entidad_id INT NULL,codigo VARCHAR(40) NOT NULL,nombre VARCHAR(200) NOT NULL,tipo VARCHAR(40) NOT NULL,activa TINYINT NOT NULL DEFAULT 1,UNIQUE KEY uq_c(empresa_id,entidad_id,id)) ENGINE=InnoDB;
      CREATE TABLE cont_cxp(id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT NOT NULL,proveedor VARCHAR(200) NOT NULL,monto DECIMAL(14,2) NOT NULL,saldo DECIMAL(14,2) NOT NULL) ENGINE=InnoDB;
      CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT,usuario VARCHAR(100),accion VARCHAR(100),modulo VARCHAR(100),detalle TEXT) ENGINE=InnoDB;`);
    const c = await state.pool.getConnection();
    try {
      for (const file of migrations) {
        const text = readFileSync(`sql/${file}`, "utf8");
        for (const s of sentencias(text)) await c.query(s);
        metrics.push({ migration: file, sha256: sha256(text), applied: true });
      }
    } finally { c.release(); }
    for (const [empresa, entidad, proveedor] of [[1,5,3], [1,5,4], [1,6,3], [2,7,9]]) {
      await guardarConfigFiscal(empresa, entidad, proveedor, actor, { regimenFiscal: "GENERAL", sujetoIsr: false });
    }
  }, 90000);
  beforeEach(async () => { state.facade = null; if (state.pool) await limpiar(); });
  afterAll(async () => {
    state.facade = null;
    try {
      await state.pool?.end();
      if (admin) metrics.push({ cleanup: await eliminarPropia(admin, identity, created) });
    } finally {
      await admin?.end();
      // Evidencia sintética para conservar junto con el resultado de Vitest; sin credenciales/datadir en claro.
      console.info("MIL_CXP05_EVIDENCE", JSON.stringify(metrics));
    }
  }, 30000);

  it("entidad vacía: contadores cero y limitación explícita, no certificación", async () => {
    const r = await report();
    expect(r).toMatchObject({ facturasEnAmbito: 0, facturasRevisadas: 0, totalAdvertencias: 0, facturasConAnomalias: 0, filas: [], pagosDisponibles: true });
    expect(r.limitaciones).toContain(LIMITE_LINEAS);
  });

  it("servicios reales: sin pago, parcial, total, reversado y anulada sin pago no producen anomalías", async () => {
    await factura();
    const parcial = await factura(), completa = await factura(), reversada = await factura(), anulada = await factura();
    await pago(parcial.id, "30.25"); await pago(completa.id, "100.00");
    const p = await pago(reversada.id, "100.00");
    await reversarPago(1, 5, p.pago.id, actor, "QA reverso sintetico");
    await anularFactura(1, 5, anulada.id, actor, "QA anulacion sintetica");
    const r = await report();
    expect(r).toMatchObject({ facturasEnAmbito: 5, facturasRevisadas: 5, totalAdvertencias: 0, filas: [] });
    expect((await q("SELECT estado FROM cxp_pagos WHERE id=?", [p.pago.id]))[0].estado).toBe("REVERSADO");
  });

  it("historia sintética: cuatro categorías, varias por factura, pago sin aplicaciones y contadores globales", async () => {
    const f = await factura();
    await anularFactura(1, 5, f.id, actor, "QA historica");
    const otro = await pagoHistorico([[f.id, "110.01"]], "120.01", 4);
    const vacio = await pagoHistorico([], "7.25");
    const r = await report();
    expect(r.totalAdvertencias).toBe(5);
    expect(r.facturasConAnomalias).toBe(1);
    expect(r.porCodigo).toEqual({ SOBREAPLICACION: 1, PAGO_VIGENTE_EN_ANULADA: 1, PAGO_DE_OTRO_PROVEEDOR: 1, PAGO_DESCUADRADO: 2 });
    expect(r.filas.map(claveFila).sort()).toEqual([
      `SOBREAPLICACION:${f.id}:-`, `PAGO_VIGENTE_EN_ANULADA:${f.id}:-`, `PAGO_DE_OTRO_PROVEEDOR:${f.id}:${otro}`, `PAGO_DESCUADRADO:-:${otro}`, `PAGO_DESCUADRADO:-:${vacio}`,
    ].sort());
    expect(r.filas.find(x => x.advertencia.codigo === "SOBREAPLICACION")).toMatchObject({ montoPagadero: "100.00", pagado: "110.01", excesoAplicado: "10.01" });
    expect(r.filas.find(x => x.pago?.id === vacio)).toMatchObject({ facturaId: null, pago: { montoTotal: "7.25", sumaAplicaciones: "0.00" } });
    expect((await report({ estado: "ANULADA" })).totalAdvertencias).toBe(4); // sin aplicaciones no pertenece al filtro de factura
    expect((await report({ estado: "REGISTRADA" })).totalAdvertencias).toBe(0);
    expect((await report({ codigo: "SOBREAPLICACION" })).porCodigo).toEqual({ SOBREAPLICACION: 1 });
    expect((await report({ proveedorId: 4 })).filas.map(claveFila).sort()).toEqual([`PAGO_DESCUADRADO:-:${otro}`]); // el cruce pertenece al proveedor de la factura
  });

  it("importe DECIMAL exacto y reversos excluidos del vigente aun con hallazgo estructural", async () => {
    const f = await factura(3, "9999999999.99");
    await pagoHistorico([[f.id, "10000000000.00"]], "10000000000.00");
    const rev = await pagoHistorico([[f.id, "0.03"]], "0.03", 4, 1, 5, true);
    const r = await report();
    expect(r.totalAdvertencias).toBe(2);
    expect(r.filas.find(x => x.advertencia.codigo === "SOBREAPLICACION")).toMatchObject({ montoPagadero: "9999999999.99", pagado: "10000000000.00", excesoAplicado: "0.01" });
    expect(r.filas.find(x => x.pago?.id === rev)).toMatchObject({ pagado: "10000000000.00", pago: { estado: "REVERSADO", montoAplicado: "0.03" } });
  });

  it("proveedores, empresas y entidades aislados; inexistente/ajeno falla cerrado", async () => {
    const scopes = [[1,5,3], [1,5,4], [1,6,3], [2,7,9]];
    const ids: number[] = [];
    for (const [empresa, entidad, proveedor] of scopes) {
      const f = await factura(proveedor, "100.00", empresa, entidad); ids.push(f.id);
      await pagoHistorico([[f.id, "101.00"]], "101.00", proveedor, empresa, entidad);
    }
    expect((await report()).filas.map(x => x.facturaId)).toEqual(ids.slice(0, 2));
    expect((await report({ proveedorId: 4 })).filas.map(x => x.facturaId)).toEqual([ids[1]]);
    expect((await report({}, true, 1, 6)).filas.map(x => x.facturaId)).toEqual([ids[2]]);
    expect((await report({}, true, 2, 7)).filas.map(x => x.facturaId)).toEqual([ids[3]]);
    for (const proveedorId of [999999, 9]) await expect(report({ proveedorId })).rejects.toMatchObject({ status: 404, codigo: "PROVEEDOR_NO_DISPONIBLE" });
    await expect(report({}, true, 1, 7)).rejects.toMatchObject({ status: 404, codigo: "ENTIDAD_NO_DISPONIBLE" });
  });

  it("orden/paginación estable de advertencias, contadores no limitados a página y Excel completo filtrado", async () => {
    const ids = await facturasMasivas(7);
    await pagoHistorico(ids.map(id => [id, "2.00"]), "14.00");
    const first = await report({ pageSize: 2 });
    const combined = [...first.filas];
    for (const page of [2,3,4]) {
      const r = await report({ pageSize: 2, page });
      expect(r.totalAdvertencias).toBe(7); expect(r.porCodigo.SOBREAPLICACION).toBe(7);
      combined.push(...r.filas);
    }
    expect(combined.map(x => x.facturaId)).toEqual(ids);
    expect(new Set(combined.map(claveFila)).size).toBe(7);
    expect((await report({ pageSize: 2 })).filas).toEqual(first.filas);
    const data = await exportData({ proveedorId: 3, codigo: "SOBREAPLICACION", estado: "REGISTRADA" });
    expect(data.totalAdvertencias).toBe(7); expect(data.filas).toHaveLength(7);
    const wb = await reabrir(await integridadAExcel(data));
    const ws = wb.getWorksheet("Integridad CxP")!, summary = wb.getWorksheet("Resumen")!;
    expect(ws.rowCount).toBe(10); expect(summary.getCell("B9").value).toBe(7);
    expect(summary.getCell("B6").value).toBe(7);
    expect(ws.getCell("E4").value).toBe("'=QA formula sintetica");
    expect(ws.getCell("G4").value).toBe(1); expect(ws.getCell("H4").value).toBe(2); expect(ws.getCell("I4").value).toBe(1);
    expect(ws.getCell("E4").type).toBe(ExcelJS.ValueType.String);
    expect(JSON.stringify(summary.model)).toContain(LIMITE_LINEAS);
  });

  it("Excel del motor conserva céntimos y omite columnas/contadores/detalles de pagos sin permiso", async () => {
    const f = await factura(3, "9999999999.99");
    await pagoHistorico([[f.id, "10000000000.00"]], "10000000000.01", 4);
    const full = await exportData(), restricted = await exportData({}, false);
    expect(full.totalAdvertencias).toBe(3); expect(restricted.totalAdvertencias).toBe(1);
    expect(restricted.filas.every(x => x.pago === undefined)).toBe(true);
    expect(restricted.porCodigo.PAGO_DESCUADRADO).toBeUndefined();
    const wb = await reabrir(await integridadAExcel(restricted));
    const ws = wb.getWorksheet("Integridad CxP")!;
    expect(ws.columnCount).toBe(11); expect(ws.rowCount).toBe(4);
    for (const [col, expected] of [[7, "9999999999.99"], [8, "10000000000.00"], [9, "0.01"]] as const) {
      expect(new Decimal(String(ws.getRow(4).getCell(col).value)).toFixed(2)).toBe(expected);
    }
    expect(JSON.stringify(wb.getWorksheet("Resumen")!.model)).not.toContain("PAGO_DESCUADRADO");
    const authorized = (await reabrir(await integridadAExcel(full))).getWorksheet("Integridad CxP")!;
    expect(authorized.columnCount).toBe(16);
    expect(authorized.getRow(4).getCell(12).value).toEqual(expect.any(Number)); // fila de pago, orden por código
    await expect(exportData({ codigo: "PAGO_DESCUADRADO" }, false)).rejects.toMatchObject({ status: 403 });
    await expect(report({ codigo: "PAGADO_NO_COINCIDE_CON_LINEAS" })).rejects.toMatchObject({ status: 422, codigo: "ANOMALIA_NO_EVALUABLE" });
  });

  it("instantánea consistente y READ ONLY reales con escritor independiente y sesión por defecto READ COMMITTED", async () => {
    const f = await factura();
    const ready = barrera(), resume = barrera();
    let releases = 0, observed = false, readerId = 0;
    const readerPool = mysql.createPool({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: identity.db, connectionLimit: 1 });
    state.facade = observarPool(readerPool, async (c, sql) => {
      if (sql.startsWith("START TRANSACTION")) {
        const [id] = await c.query<RowDataPacket[]>("SELECT CONNECTION_ID() id"); readerId = Number(id[0].id);
        await expect(c.query("UPDATE qa_ownership SET token=token")).rejects.toMatchObject({ errno: 1792 });
      }
      if (!observed && sql.startsWith("SELECT COUNT(*) AS n, COUNT(DISTINCT")) {
        observed = true; ready.abrir(); await resume.esperar;
      }
      if (sql === "COMMIT") await c.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    }, () => { releases++; }, async c => { await c.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED"); });
    const pending = report();
    // Evita rechazo no observado si el motor falla antes de alcanzar la barrera.
    const reached = Promise.race([ready.esperar, pending.then(() => { throw Error("No se alcanzó barrera de conteo"); })]);
    try {
      await reached;
      const writer = await state.pool!.getConnection();
      try {
        const [id] = await writer.query<RowDataPacket[]>("SELECT CONNECTION_ID() id"); expect(Number(id[0].id)).not.toBe(readerId);
        await writer.query(`INSERT INTO cxp_pagos (empresa_id,entidad_id,proveedor_id,fecha_pago,monto_total,clave_idempotencia,huella,creado_por) VALUES (1,5,3,'2026-11-05','101.00',?,?,91)`, [randomUUID(), "b".repeat(64)]);
        const [idPago] = await writer.query<RowDataPacket[]>("SELECT LAST_INSERT_ID() id");
        await writer.query("INSERT INTO cxp_pago_aplicaciones (empresa_id,entidad_id,pago_id,factura_id,monto) VALUES (1,5,?,?,101.00)", [idPago[0].id, f.id]);
      } finally { writer.release(); }
      resume.abrir();
      const snapshot = await pending;
      expect(snapshot).toMatchObject({ totalAdvertencias: 0, filas: [], facturasEnAmbito: 1 });
      expect(Object.values(snapshot.porCodigo).every(n => n === 0)).toBe(true);
      expect(releases).toBe(1);
      state.facade = null;
      expect((await report()).totalAdvertencias).toBe(1);
      metrics.push({ concurrency: "independent writer committed after totals; reader READ COMMITTED default overridden; same snapshot counts/rows", readOnlyErrno: 1792 });
    } finally { resume.abrir(); await pending.catch(() => undefined); state.facade = null; await readerPool.end(); }
  }, 30000);

  it("libera conexión y termina transacción después de error durante lectura SQL", async () => {
    let releases = 0, connectionId = 0;
    const isolated = mysql.createPool({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: identity.db, connectionLimit: 1 });
    state.facade = observarPool(isolated, async (c, sql) => {
      if (sql.startsWith("SELECT COUNT(*) AS n, COUNT(DISTINCT")) {
        const [id] = await c.query<RowDataPacket[]>("SELECT CONNECTION_ID() id"); connectionId = Number(id[0].id);
        // Error del motor, no respuesta SQL simulada.
        await c.query("SELECT columna_qa_inexistente FROM qa_ownership");
      }
    }, () => { releases++; });
    try {
      await expect(report()).rejects.toMatchObject({ code: "ER_BAD_FIELD_ERROR" });
      expect(releases).toBe(1);
      const c = await isolated.getConnection();
      try {
        const [r] = await c.query<RowDataPacket[]>("SELECT CONNECTION_ID() id, @@in_transaction tx");
        expect(Number(r[0].id)).toBe(connectionId); expect(Number(r[0].tx)).toBe(0);
      } finally { c.release(); }
    } finally { state.facade = null; await isolated.end(); }
  }, 30000);

  it("volúmenes progresivos: tiempos, tamaño XLSX y EXPLAIN del SQL real (sin umbral productivo)", async () => {
    for (const n of [10,100,1000]) {
      await limpiar();
      const ids = await facturasMasivas(n);
      await pagoHistorico(ids.map(id => [id, "2.00"]), new Decimal(n).mul(2).toFixed(2));
      const t0 = performance.now(), r = await report(); const queryMs = performance.now() - t0;
      const t1 = performance.now(), data = await exportData(), buffer = await integridadAExcel(data); const exportMs = performance.now() - t1;
      expect(r.totalAdvertencias).toBe(n); expect(data.filas).toHaveLength(n);
      expect((await reabrir(buffer)).getWorksheet("Integridad CxP")!.rowCount).toBe(n + 3);
      const sql = consultasIntegridad(1, 5, {}, true, true);
      const plans: Record<string, unknown> = {};
      for (const [label, statement, params] of [
        ["reviewed", sql.reviewedSql, sql.reviewedParams],
        ["totals", `SELECT COUNT(*) AS n, COUNT(DISTINCT factura_id) AS facturas FROM (${sql.sql}) hallazgos`, sql.params],
        ["codes", `SELECT codigo, COUNT(*) AS n FROM (${sql.sql}) hallazgos GROUP BY codigo`, sql.params],
        ["rows", `SELECT * FROM (${sql.sql}) hallazgos ORDER BY codigo, factura_id, pago_id LIMIT ? OFFSET ?`, [...sql.params, 100, 0]],
      ] as const) plans[label] = await q(`EXPLAIN ${statement}`, [...params]);
      const counts = (await q("SELECT (SELECT COUNT(*) FROM cxp_facturas) facturas,(SELECT COUNT(*) FROM cxp_pagos) pagos,(SELECT COUNT(*) FROM cxp_pago_aplicaciones) aplicaciones"))[0];
      expect(Number(counts.facturas)).toBe(n); expect(Number(counts.pagos)).toBe(1); expect(Number(counts.aplicaciones)).toBe(n);
      metrics.push({ ...counts, advertencias: r.totalAdvertencias, queryMs, exportMs, xlsxBytes: buffer.length, explain: plans });
    }
  }, 120000);

  it("límite real 10.000 exporta completo; 10.001 rechaza antes de cargar filas, sin truncar", async () => {
    const ids = await facturasMasivas(10000);
    await pagoHistorico(ids.map(id => [id, "2.00"]), "20000.00");
    const data = await exportData({ codigo: "SOBREAPLICACION" });
    expect(data.totalAdvertencias).toBe(10000); expect(data.filas).toHaveLength(10000);
    const buffer = await integridadAExcel(data);
    expect((await reabrir(buffer)).getWorksheet("Integridad CxP")!.rowCount).toBe(10003);
    const extra = await factura(3, "1.00"); await pagoHistorico([[extra.id, "2.00"]], "2.00");
    let loadedRows = false, releases = 0;
    state.facade = observarPool(state.pool!, async (_c, sql) => { if (sql.startsWith("SELECT * FROM (")) loadedRows = true; }, () => { releases++; });
    try { await expect(exportData({ codigo: "SOBREAPLICACION" })).rejects.toMatchObject({ status: 422, codigo: "LIMITE_EXPORTACION" }); }
    finally { state.facade = null; }
    expect(loadedRows).toBe(false); expect(releases).toBe(1);
    expect((await report({ codigo: "SOBREAPLICACION", pageSize: 1 })).totalAdvertencias).toBe(10001);
    metrics.push({ boundary: { accepted: 10000, rejected: 10001, xlsxBytes: buffer.length, loadedRowsOnRejection: loadedRows } });
  }, 120000);

  // Elimina SOLO tablas recién creadas aquí; restaura con la migración real incluso si falla la aserción.
  it("M-3B1 ausente: revisión incompleta explícita, nunca cero hallazgos presentado como aprobación", async () => {
    await factura();
    await state.pool!.query("DROP TABLE cxp_pago_aplicaciones");
    await state.pool!.query("DROP TABLE cxp_pagos");
    try {
      const r = await report();
      expect(r).toMatchObject({ facturasEnAmbito: 1, facturasRevisadas: 0, pagosDisponibles: false, totalAdvertencias: 0, filas: [], porCodigo: {} });
      expect(r.limitaciones.join(" ")).toContain("no se completó la revisión");
      const data = await exportData();
      const wb = await reabrir(await integridadAExcel(data));
      expect(JSON.stringify(wb.getWorksheet("Resumen")!.model)).toContain("no se completó la revisión");
    } finally {
      const c = await state.pool!.getConnection();
      try { for (const sql of sentencias(readFileSync(`sql/${migrations[1]}`, "utf8"))) await c.query(sql); }
      finally { c.release(); }
    }
  });
});
