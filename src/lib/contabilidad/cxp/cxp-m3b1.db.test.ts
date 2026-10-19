import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => state.pool,
  query: async (sql: string, params: (string | number | boolean | Date | null)[] = []) => (await state.pool!.query(sql, params))[0],
}));
import { anularFactura, listarFacturas, obtenerFactura, registrarFactura } from "./facturas";
import { guardarConfigFiscal } from "./proveedor-fiscal";
import { listarPagos, obtenerPago, registrarPago, reversarPago } from "./pagos";

/**
 * CxP M-3B1 (pagos + retención ISR) contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407): aplica las migraciones REALES M-3A y M-3B1 sobre un esquema
 * mínimo y ejecuta los servicios.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/contabilidad/cxp/cxp-m3b1.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const db = `cxp_m3b1_${randomUUID().replaceAll("-", "")}`;
const actor = { id: 91, username: "conta" };
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
const E1 = 5, E1B = 6;
const fac = { proveedorId: 3, serie: "A", fechaDocumento: "2026-11-02", fechaVencimiento: "2026-12-02" };
let n = 0;
const clave = () => `clave-${++n}-${randomUUID().slice(0, 8)}`;
const pago = (over: Record<string, unknown>) => ({ proveedorId: 3, fechaPago: "2026-11-10", medioPago: "Transferencia", referencia: "TR-1", claveIdempotencia: clave(), ...over });
const nuevaFactura = async (numero: string, baseNeto: string, ivaMonto: string, extra: Record<string, unknown> = {}, entidad = E1) =>
  (await registrarFactura(1, entidad, actor, { ...fac, numero, baseNeto, ivaMonto, ...extra })).factura;
const cuentaPagos = async () => Number((await q("SELECT COUNT(*) n FROM cxp_pagos"))[0].n);
const cuentaAplic = async () => Number((await q("SELECT COUNT(*) n FROM cxp_pago_aplicaciones"))[0].n);

describe.skipIf(!port)("CxP M-3B1 pagos / MariaDB 11.8.9 SOLO LOCAL", () => {
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
    await guardarConfigFiscal(1, E1, 3, actor, { regimenFiscal: "GENERAL", sujetoIsr: true });
    await guardarConfigFiscal(1, E1, 4, actor, { regimenFiscal: "GENERAL", sujetoIsr: false });
    await guardarConfigFiscal(1, E1B, 3, actor, { regimenFiscal: "GENERAL", sujetoIsr: true });
    await guardarConfigFiscal(2, 7, 9, actor, { regimenFiscal: "GENERAL", sujetoIsr: true });
  }, 90000);
  afterAll(async () => {
    await state.pool?.end();
    if (admin) { if (!/^cxp_m3b1_[a-f0-9]{32}$/.test(db)) throw Error("BD no desechable"); await admin.query(`DROP DATABASE ${db}`); await admin.end(); }
  });

  describe("pagos parciales, totales y saldo (el ejemplo confirmado: Q35,000 / ISR Q1,587.50 / pagadero Q33,412.50)", () => {
    let f1: Awaited<ReturnType<typeof nuevaFactura>>;
    it("la retención NO se paga: monto pagadero = total − ISR; saldo inicial = monto pagadero", async () => {
      f1 = await nuevaFactura("100", "31250.00", "3750.00");
      expect(f1).toMatchObject({ totalDocumento: "35000.00", retencionIsr: "1587.50", montoPagadero: "33412.50", pagado: "0.00", saldo: "33412.50", estadoFinanciero: "PENDIENTE" });
    });
    it("pago parcial → PARCIAL; segundo pago → PAGADA con saldo 0; el total del pago es la suma de lo aplicado (el servidor lo calcula)", async () => {
      const r1 = await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f1.id, monto: "10000.00" }], montoTotal: "1.00" }));
      expect(r1.repetido).toBe(false);
      expect(r1.pago).toMatchObject({ estado: "REGISTRADO", montoTotal: "10000.00", proveedorNombre: "Repuestos Uno", aplicaciones: [{ facturaId: f1.id, monto: "10000.00" }] });
      expect(await obtenerFactura(1, E1, f1.id)).toMatchObject({ pagado: "10000.00", saldo: "23412.50", estadoFinanciero: "PARCIAL" });
      await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f1.id, monto: "23412.50" }] }));
      expect(await obtenerFactura(1, E1, f1.id)).toMatchObject({ pagado: "33412.50", saldo: "0.00", estadoFinanciero: "PAGADA", montoPagadero: "33412.50", totalDocumento: "35000.00" });
    });
    it("sobreaplicación accidental: ni un centavo más que el saldo; no escribe nada", async () => {
      const [p0, a0] = [await cuentaPagos(), await cuentaAplic()];
      await expect(registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f1.id, monto: "0.01" }] }))).rejects.toMatchObject({ status: 409, codigo: "SOBREAPLICACION" });
      expect([await cuentaPagos(), await cuentaAplic()]).toEqual([p0, a0]);
    });
    it("cobrar el total de la factura (Q35,000) no es posible: lo pagadero excluye la retención", async () => {
      const f = await nuevaFactura("101", "31250.00", "3750.00");
      await expect(registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f.id, monto: "35000.00" }] }))).rejects.toMatchObject({ codigo: "SOBREAPLICACION" });
      await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f.id, monto: "33412.50" }] }));
      expect((await obtenerFactura(1, E1, f.id))!.estadoFinanciero).toBe("PAGADA");
    });
  });

  describe("varios pagos / un pago a varias facturas", () => {
    it("un pago aplicado a varias facturas del proveedor; total = suma; cada factura baja su saldo", async () => {
      const a = await nuevaFactura("200", "10000.00", "1200.00"), b = await nuevaFactura("201", "5000.00", "600.00"); // pagaderos 10,700.00 y 5,350.00
      const r = await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: b.id, monto: "5350.00" }, { facturaId: a.id, monto: "700.00" }] }));
      expect(r.pago.montoTotal).toBe("6050.00");
      expect(r.pago.aplicaciones.map(x => x.facturaId)).toEqual([a.id, b.id].sort((x, y) => x - y));
      expect(await obtenerFactura(1, E1, a.id)).toMatchObject({ pagado: "700.00", saldo: "10000.00", estadoFinanciero: "PARCIAL" });
      expect(await obtenerFactura(1, E1, b.id)).toMatchObject({ pagado: "5350.00", saldo: "0.00", estadoFinanciero: "PAGADA" });
      // Varios pagos sobre la misma factura: suman exacto.
      await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: a.id, monto: "0.10" }] }));
      await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: a.id, monto: "0.20" }] }));
      expect(await obtenerFactura(1, E1, a.id)).toMatchObject({ pagado: "700.30", saldo: "9999.70" });
      expect((await listarPagos(1, E1, { facturaId: a.id })).total).toBe(3);
    });
    it("todo o nada: si UNA aplicación excede su saldo no se crea el pago ni ninguna aplicación", async () => {
      const a = await nuevaFactura("210", "1000.00", "120.00"), b = await nuevaFactura("211", "1000.00", "120.00"); // 1,120 c/u (no sujeto ISR: sin retención <2,800)
      const [p0, a0] = [await cuentaPagos(), await cuentaAplic()];
      await expect(registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: a.id, monto: "100.00" }, { facturaId: b.id, monto: "1120.01" }] }))).rejects.toMatchObject({ codigo: "SOBREAPLICACION" });
      expect([await cuentaPagos(), await cuentaAplic()]).toEqual([p0, a0]);
      expect((await obtenerFactura(1, E1, a.id))!.pagado).toBe("0.00");
    });
    it("el IVA no reduce lo pagadero y la retención sí: neto < Q2,800 sin ISR se paga completo", async () => {
      const f = await nuevaFactura("212", "2000.00", "240.00");
      expect(f).toMatchObject({ retencionIsr: "0.00", montoPagadero: "2240.00" });
      await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f.id, monto: "2240.00" }] }));
      expect((await obtenerFactura(1, E1, f.id))!.estadoFinanciero).toBe("PAGADA");
    });
  });

  describe("validaciones del pago", () => {
    it("proveedor distinto, factura anulada, factura inexistente, de otra entidad o de otra empresa", async () => {
      const f3 = await nuevaFactura("300", "1000.00", "120.00");
      const f4 = await nuevaFactura("301", "1000.00", "120.00", { proveedorId: 4 });
      await expect(registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f3.id, monto: "1.00" }, { facturaId: f4.id, monto: "1.00" }] }))).rejects.toMatchObject({ status: 409, codigo: "PROVEEDOR_DISTINTO" });
      const anulada = await nuevaFactura("302", "1000.00", "120.00");
      await anularFactura(1, E1, anulada.id, actor, "capturada por error");
      await expect(registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: anulada.id, monto: "1.00" }] }))).rejects.toMatchObject({ status: 409, codigo: "FACTURA_ANULADA" });
      await expect(registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: 999999, monto: "1.00" }] }))).rejects.toMatchObject({ status: 404, codigo: "FACTURA_NO_ENCONTRADA" });
      const enE1B = await nuevaFactura("303", "1000.00", "120.00", {}, E1B);
      await expect(registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: enE1B.id, monto: "1.00" }] }))).rejects.toMatchObject({ status: 404 }); // misma empresa, OTRA entidad
      const deE2 = (await registrarFactura(2, 7, actor, { proveedorId: 9, serie: "Z", numero: "1", fechaDocumento: "2026-11-02", baseNeto: "1000.00", ivaMonto: "120.00" })).factura;
      await expect(registrarPago(1, E1, actor, pago({ proveedorId: 9, aplicaciones: [{ facturaId: deE2.id, monto: "1.00" }] }))).rejects.toMatchObject({ status: 404 }); // otra empresa
      expect((await obtenerFactura(1, E1, f3.id))!.pagado).toBe("0.00");
    });
    it("entrada inválida: sin aplicaciones, monto 0/negativo/3 decimales, factura repetida, clave corta, fecha mala, entidad inexistente", async () => {
      const f = await nuevaFactura("310", "1000.00", "120.00");
      const ok = { facturaId: f.id, monto: "10.00" };
      await expect(registrarPago(1, E1, actor, pago({ aplicaciones: [] }))).rejects.toMatchObject({ codigo: "SIN_APLICACIONES" });
      for (const m of ["0", "-5", "10.001", "abc"]) await expect(registrarPago(1, E1, actor, pago({ aplicaciones: [{ ...ok, monto: m }] }))).rejects.toMatchObject({ status: 400 });
      await expect(registrarPago(1, E1, actor, pago({ aplicaciones: [ok, ok] }))).rejects.toMatchObject({ codigo: "FACTURA_REPETIDA" });
      await expect(registrarPago(1, E1, actor, pago({ aplicaciones: [ok], claveIdempotencia: "corta" }))).rejects.toMatchObject({ codigo: "CLAVE_INVALIDA" });
      await expect(registrarPago(1, E1, actor, pago({ aplicaciones: [ok], fechaPago: "2026-02-30" }))).rejects.toMatchObject({ codigo: "FECHA_INVALIDA" });
      await expect(registrarPago(1, 99, actor, pago({ aplicaciones: [ok] }))).rejects.toMatchObject({ status: 404, codigo: "ENTIDAD_NO_DISPONIBLE" });
    });
  });

  describe("idempotencia y concurrencia", () => {
    it("repetir EXACTAMENTE el mismo envío devuelve el pago original (no duplica); la misma clave con otro contenido es 409", async () => {
      const f = await nuevaFactura("400", "10000.00", "1200.00");
      const k = clave(), cuerpo = pago({ claveIdempotencia: k, aplicaciones: [{ facturaId: f.id, monto: "100.00" }] });
      const a = await registrarPago(1, E1, actor, cuerpo), b = await registrarPago(1, E1, actor, cuerpo);
      expect(b).toMatchObject({ repetido: true, pago: { id: a.pago.id } });
      expect((await obtenerFactura(1, E1, f.id))!.pagado).toBe("100.00");
      await expect(registrarPago(1, E1, actor, pago({ claveIdempotencia: k, aplicaciones: [{ facturaId: f.id, monto: "200.00" }] }))).rejects.toMatchObject({ status: 409, codigo: "CLAVE_REUTILIZADA" });
    });
    it("tres envíos simultáneos con la MISMA clave → un solo pago", async () => {
      const f = await nuevaFactura("401", "10000.00", "1200.00");
      const cuerpo = pago({ claveIdempotencia: clave(), aplicaciones: [{ facturaId: f.id, monto: "50.00" }] });
      const res = await Promise.allSettled([1, 2, 3].map(() => registrarPago(1, E1, actor, cuerpo)));
      expect(res.every(r => r.status === "fulfilled")).toBe(true);
      expect(new Set((res as PromiseFulfilledResult<{ pago: { id: number } }>[]).map(r => r.value.pago.id)).size).toBe(1);
      expect(await q("SELECT COUNT(*) n FROM cxp_pago_aplicaciones WHERE factura_id=?", [f.id]).then(r => Number(r[0].n))).toBe(1);
    });
    it("dos pagos DISTINTOS simultáneos por todo el saldo de la misma factura → solo uno se aplica (nunca sobreaplicada)", async () => {
      const f = await nuevaFactura("402", "10000.00", "1200.00"); // pagadero 10,700.00
      const res = await Promise.allSettled([1, 2, 3, 4].map(() => registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f.id, monto: "10700.00" }] }))));
      expect(res.filter(r => r.status === "fulfilled")).toHaveLength(1);
      for (const r of res.filter(r => r.status === "rejected") as PromiseRejectedResult[]) expect(r.reason).toMatchObject({ status: 409 });
      expect(await obtenerFactura(1, E1, f.id)).toMatchObject({ pagado: "10700.00", saldo: "0.00" });
    });
    it("pagos cruzados en orden inverso sobre las mismas dos facturas no se interbloquean", async () => {
      const a = await nuevaFactura("403", "10000.00", "1200.00"), b = await nuevaFactura("404", "10000.00", "1200.00");
      const res = await Promise.allSettled([
        registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: a.id, monto: "100.00" }, { facturaId: b.id, monto: "100.00" }] })),
        registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: b.id, monto: "100.00" }, { facturaId: a.id, monto: "100.00" }] })),
      ]);
      expect(res.every(r => r.status === "fulfilled")).toBe(true);
      expect((await obtenerFactura(1, E1, a.id))!.pagado).toBe("200.00");
    });
  });

  describe("reversión y anulación con trazabilidad", () => {
    it("reversar devuelve el saldo, conserva la fila con motivo/usuario/fecha, audita y no se puede repetir", async () => {
      const f = await nuevaFactura("500", "10000.00", "1200.00");
      const { pago: p } = await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f.id, monto: "10700.00" }] }));
      expect((await obtenerFactura(1, E1, f.id))!.estadoFinanciero).toBe("PAGADA");
      await expect(reversarPago(1, E1, p.id, actor, " ")).rejects.toMatchObject({ codigo: "MOTIVO_REQUERIDO" });
      const r = await reversarPago(1, E1, p.id, { id: 92, username: "otro" }, "Transferencia rechazada por el banco");
      expect(r).toMatchObject({ estado: "REVERSADO", reversadoPor: 92, motivoReversion: "Transferencia rechazada por el banco", montoTotal: "10700.00" });
      expect(r.reversadoEn).toBeTruthy();
      expect(r.aplicaciones).toHaveLength(1); // la traza se conserva
      expect(await obtenerFactura(1, E1, f.id)).toMatchObject({ pagado: "0.00", saldo: "10700.00", estadoFinanciero: "PENDIENTE" });
      await expect(reversarPago(1, E1, p.id, actor, "otra vez")).rejects.toMatchObject({ status: 409, codigo: "YA_REVERSADO" });
      const aud = await q("SELECT detalle FROM auditoria WHERE accion='cxp_reversar_pago' ORDER BY id DESC LIMIT 1");
      expect(JSON.parse(String(aud[0].detalle))).toMatchObject({ pagoId: p.id, usuarioId: 92, antes: "REGISTRADO", despues: "REVERSADO", aplicaciones: [{ facturaId: f.id, monto: "10700.00" }] });
      // Tras reversar se puede volver a pagar el saldo recuperado.
      await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f.id, monto: "10700.00" }] }));
      expect((await obtenerFactura(1, E1, f.id))!.estadoFinanciero).toBe("PAGADA");
    });
    it("no se puede anular una factura con pagos vigentes; reversado el pago sí; la anulada sigue sin liberar su serie+número", async () => {
      const f = await nuevaFactura("501", "10000.00", "1200.00");
      const { pago: p } = await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f.id, monto: "1.00" }] }));
      await expect(anularFactura(1, E1, f.id, actor, "intento con pago")).rejects.toMatchObject({ status: 409, codigo: "TIENE_PAGOS" });
      expect((await obtenerFactura(1, E1, f.id))!.estadoAdmin).toBe("REGISTRADA");
      await reversarPago(1, E1, p.id, actor, "pago mal aplicado");
      const a = await anularFactura(1, E1, f.id, actor, "capturada dos veces");
      expect(a).toMatchObject({ estadoAdmin: "ANULADA", estadoFinanciero: "ANULADA", saldo: "0.00" });
      await expect(registrarFactura(1, E1, actor, { ...fac, numero: "501", baseNeto: "10000.00", ivaMonto: "1200.00" })).rejects.toMatchObject({ codigo: "FACTURA_DUPLICADA", message: expect.stringContaining("no libera") });
      await expect(registrarFactura(1, E1B, actor, { ...fac, numero: "501", baseNeto: "10000.00", ivaMonto: "1200.00" })).rejects.toMatchObject({ codigo: "FACTURA_DUPLICADA" });
    });
    it("anular y pagar en paralelo sobre la misma factura nunca deja una factura anulada con pago vigente", async () => {
      for (let i = 0; i < 6; i++) {
        const f = await nuevaFactura(`carrera-${i}`, "10000.00", "1200.00");
        await Promise.allSettled([anularFactura(1, E1, f.id, actor, "anulación concurrente"), registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f.id, monto: "10.00" }] }))]);
      }
      const malas = await q(`SELECT COUNT(*) n FROM cxp_pago_aplicaciones a JOIN cxp_pagos p ON p.id=a.pago_id JOIN cxp_facturas f ON f.id=a.factura_id WHERE p.estado='REGISTRADO' AND f.estado_admin='ANULADA'`);
      expect(Number(malas[0].n)).toBe(0);
    });
    it("reversar el mismo pago en paralelo: uno gana", async () => {
      const f = await nuevaFactura("502", "10000.00", "1200.00");
      const { pago: p } = await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f.id, monto: "5.00" }] }));
      const res = await Promise.allSettled([reversarPago(1, E1, p.id, actor, "motivo uno"), reversarPago(1, E1, p.id, actor, "motivo dos")]);
      expect(res.filter(r => r.status === "fulfilled")).toHaveLength(1);
      expect((await obtenerFactura(1, E1, f.id))!.pagado).toBe("0.00");
    });
  });

  describe("aislamiento por empresa/entidad y auditoría", () => {
    it("otra entidad/empresa no ve, lista ni reversa el pago", async () => {
      const f = await nuevaFactura("600", "10000.00", "1200.00");
      const { pago: p } = await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f.id, monto: "10.00" }] }));
      expect(await obtenerPago(1, E1B, p.id)).toBeNull();
      expect(await obtenerPago(2, 7, p.id)).toBeNull();
      expect((await listarPagos(1, E1B)).total).toBe(0);
      expect((await listarPagos(2, 7)).total).toBe(0);
      await expect(reversarPago(1, E1B, p.id, actor, "intento otra entidad")).rejects.toMatchObject({ status: 404 });
      await expect(reversarPago(2, 7, p.id, actor, "intento otra empresa")).rejects.toMatchObject({ status: 404 });
      expect((await obtenerPago(1, E1, p.id))!.estado).toBe("REGISTRADO");
      // El listado de facturas de otra entidad no refleja estos pagos.
      expect((await listarFacturas(1, E1B)).facturas.every(x => x.pagado === "0.00")).toBe(true);
    });
    it("auditoría del registro: usuario, entidad, proveedor, aplicaciones y montos", async () => {
      const f = await nuevaFactura("601", "10000.00", "1200.00");
      const { pago: p } = await registrarPago(1, E1, actor, pago({ referencia: "CH-77", aplicaciones: [{ facturaId: f.id, monto: "123.45" }] }));
      const aud = await q("SELECT empresa_id, usuario, modulo, detalle FROM auditoria WHERE accion='cxp_registrar_pago' ORDER BY id DESC LIMIT 1");
      expect(aud[0]).toMatchObject({ empresa_id: 1, usuario: "conta", modulo: "contabilidad" });
      expect(JSON.parse(String(aud[0].detalle))).toMatchObject({ pagoId: p.id, entidadId: E1, usuarioId: 91, proveedorId: 3, montoTotal: "123.45", referencia: "CH-77", aplicaciones: [{ facturaId: f.id, monto: "123.45" }] });
    });
    it("listado con filtros y paginación", async () => {
      expect((await listarPagos(1, E1, { pageSize: 3 })).pagos).toHaveLength(3);
      expect((await listarPagos(1, E1, { estado: "REVERSADO" })).pagos.every(x => x.estado === "REVERSADO")).toBe(true);
      expect((await listarPagos(1, E1, { desde: "2030-01-01" })).total).toBe(0);
      expect((await listarPagos(1, E1, { proveedorId: 4 })).total).toBe(0);
    });
  });

  describe("restricciones de la base (defensa en profundidad)", () => {
    it("FK compuesta impide aplicar a una factura de otra entidad; CHECK impide montos ≤ 0 y reversiones sin motivo", async () => {
      const f = await nuevaFactura("700", "10000.00", "1200.00");
      const p = (await registrarPago(1, E1, actor, pago({ aplicaciones: [{ facturaId: f.id, monto: "1.00" }] }))).pago;
      const enE1B = await nuevaFactura("701", "1000.00", "120.00", {}, E1B);
      await expect(state.pool!.query("INSERT INTO cxp_pago_aplicaciones (empresa_id, entidad_id, pago_id, factura_id, monto) VALUES (1, ?, ?, ?, 1.00)", [E1, p.id, enE1B.id])).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
      await expect(state.pool!.query("INSERT INTO cxp_pago_aplicaciones (empresa_id, entidad_id, pago_id, factura_id, monto) VALUES (1, ?, ?, ?, 0)", [E1, p.id, f.id])).rejects.toMatchObject({ errno: 4025 });
      await expect(state.pool!.query("UPDATE cxp_pagos SET estado='REVERSADO' WHERE id=?", [p.id])).rejects.toMatchObject({ errno: 4025 });
      await expect(state.pool!.query("DELETE FROM cxp_pagos WHERE id=?", [p.id])).rejects.toMatchObject({ code: "ER_ROW_IS_REFERENCED_2" }); // nada se borra
      await expect(state.pool!.query("DELETE FROM cxp_facturas WHERE id=?", [f.id])).rejects.toMatchObject({ code: "ER_ROW_IS_REFERENCED_2" });
    });
    it("el postcheck M-3B1 certifica el estado final de TODOS los datos creados por estas pruebas", async () => {
      await ejecutarArchivo("postcheck-2026-11-cxp-m3b1-pagos.sql");
      const cuadre = await q(`SELECT COUNT(*) n FROM cxp_facturas f WHERE f.total_neto_pagar < COALESCE((SELECT SUM(a.monto) FROM cxp_pago_aplicaciones a JOIN cxp_pagos p ON p.id=a.pago_id WHERE a.factura_id=f.id AND p.estado='REGISTRADO'),0)`);
      expect(Number(cuadre[0].n)).toBe(0);
    });
    it("cont_cxp (histórico) sigue intacto", async () => {
      expect(await q("SELECT COUNT(*) n FROM cont_cxp")).toEqual([{ n: 0 }]);
    });
  });
});
