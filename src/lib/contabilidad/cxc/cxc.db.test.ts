import { randomUUID } from "crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => holder.pool,
  query: async (texto: string, params: unknown[] = []) => (await holder.pool!.query(texto, params))[0],
}));

import { listarCobrosCxc, listarDocumentosCxc, registrarCobroCxc } from "./cxc";
import type { FiltrosCxc } from "@/lib/facturacion/cuentas-por-cobrar-shared";

/**
 * Contabilidad → CxC contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407, solo local). Esquema mínimo propio; ninguna migración.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/contabilidad/cxc/cxc.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const database = `cxc_pant_${randomUUID().replaceAll("-", "")}`;
const E = 7, OTRA = 8, KT = 1, MON = 2, ENT_OTRA = 3;
const actor = { empresaId: E, usuarioId: 91, usuario: "conta" };
const sql = async <T extends RowDataPacket = RowDataPacket>(t: string, p: unknown[] = []): Promise<T[]> => (await holder.pool!.query<T[]>(t, p))[0];
const docs = (entidad: number, extra: Partial<FiltrosCxc> = {}, empresa = E) => listarDocumentosCxc(empresa, entidad, { vista: "historial", alcance: "todas", ...extra });
const ids = (r: { filas: { facturaId: number }[] }) => r.filas.map((f) => f.facturaId).sort((a, b) => a - b);
const cobro = (facturaId: number, monto: number, entidad = KT, a = actor) => registrarCobroCxc(a, entidad, { facturaId, fechaPago: "2026-10-05", monto, medioPago: "Transferencia", referencia: `R-${facturaId}-${monto}` });
const fila = async (entidad: number, id: number) => (await docs(entidad)).filas.find((f) => f.facturaId === id)!;

async function factura(o: { id: number; empresa?: number; cliente: number; numero: string; estado?: string; monto: string; entidad?: number | null; fecha?: string }) {
  await holder.pool!.execute(
    `INSERT INTO fact_facturas (id, empresa_id, cliente_id, numero_factura, fecha_emision, monto_total, estado_admin, cliente_nombre_snapshot, entidad_id, condicion_pago, retencion_iva_pct, retencion_iva_monto)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, 'CREDITO', 0, 0)`,
    [o.id, o.empresa ?? E, o.cliente, o.numero, o.fecha ?? "2026-09-10", o.monto, o.estado ?? "Emitida", o.entidad === undefined ? KT : o.entidad]);
}
const pagoDirecto = (facturaId: number, monto: string, fecha: string, empresa = E) =>
  holder.pool!.execute("INSERT INTO fact_pagos (empresa_id, factura_id, fecha_pago, monto, referencia, medio_pago, registrado_por) VALUES (?, ?, ?, ?, 'BOL', 'Transferencia', 1)", [empresa, facturaId, fecha, monto]);
const huellaLegado = async () => JSON.stringify(await sql("SELECT * FROM cont_cxc ORDER BY id"));

describe.skipIf(!port)("Contabilidad → CxC / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    try {
      expect(String((await c.query<RowDataPacket[]>("SELECT VERSION() AS v"))[0][0].v)).toContain("11.8.9");
      await c.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
      await c.query(`USE ${database}`);
      await c.query(`
        CREATE TABLE clientes(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200) NOT NULL, razon_social VARCHAR(250) NULL, nit VARCHAR(40) NULL) ENGINE=InnoDB;
        CREATE TABLE cont_entidades(id INT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(20) NOT NULL, nombre VARCHAR(200) NOT NULL, activa TINYINT(1) NOT NULL DEFAULT 1) ENGINE=InnoDB;
        CREATE TABLE fact_facturas(id INT PRIMARY KEY, empresa_id INT NOT NULL, cliente_id INT NOT NULL, numero_factura VARCHAR(60) NULL,
          fecha_emision DATE NULL, monto_total DECIMAL(14,2) NOT NULL DEFAULT 0, estado_admin ENUM('Borrador','Emitida','Anulada') NOT NULL DEFAULT 'Borrador',
          cliente_nombre_snapshot VARCHAR(250) NULL, entidad_id INT NULL, condicion_pago VARCHAR(10) NULL,
          retencion_iva_pct TINYINT UNSIGNED NOT NULL DEFAULT 0, retencion_iva_monto DECIMAL(14,2) NOT NULL DEFAULT 0, KEY idx_f_emp (empresa_id, estado_admin)) ENGINE=InnoDB;
        CREATE TABLE fact_pagos(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, factura_id INT NOT NULL, fecha_pago DATE NOT NULL,
          monto DECIMAL(14,2) NOT NULL, referencia VARCHAR(120) NULL, medio_pago VARCHAR(40) NULL, observaciones TEXT NULL, registrado_por INT NOT NULL,
          creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, KEY idx_p_f (factura_id), KEY idx_p_e (empresa_id)) ENGINE=InnoDB;
        CREATE TABLE cont_cuentas_bancarias(id INT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NOT NULL, banco VARCHAR(120) NOT NULL, alias VARCHAR(120) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE fact_pago_confirmaciones(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NOT NULL, pago_id INT NULL,
          factura_id INT NOT NULL, cuenta_bancaria_id INT NOT NULL, monto DECIMAL(14,2) NOT NULL, fecha_acreditacion DATE NOT NULL, referencia VARCHAR(120) NOT NULL, estado VARCHAR(12) NOT NULL DEFAULT 'CONFIRMADA') ENGINE=InnoDB;
        CREATE TABLE cont_cxc(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NULL, cliente VARCHAR(200) NOT NULL,
          documento VARCHAR(80) NULL, fecha DATE NOT NULL, vencimiento DATE NULL, monto DECIMAL(14,2) NOT NULL DEFAULT 0, saldo DECIMAL(14,2) NOT NULL DEFAULT 0, estado VARCHAR(40) NOT NULL DEFAULT 'Pendiente') ENGINE=InnoDB;
        CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT) ENGINE=InnoDB;
        INSERT INTO clientes VALUES (1, 7, 'Cliente Alfa', 'Alfa, S.A.', '1111111'), (2, 7, 'Cliente Beta', NULL, '2222222'), (9, 8, 'Cliente Otro', NULL, '9999999');
        INSERT INTO cont_entidades VALUES (1, 7, 'KT', 'KuiqTrans', 1), (2, 7, 'MON', 'Logiservicios Monaco', 1), (3, 8, 'OTR', 'Otra empresa', 1), (4, 7, 'OFF', 'Inactiva', 0);
      `);
    } finally { await c.end(); }
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 8 });
    // F1 KT sin cobros · F2 KT parcial (400) · F3 MON pagada · F4 KT anulada · F5 histórica sin entidad · F6 borrador · F7 KT · F8 otra empresa
    await factura({ id: 1, cliente: 1, numero: "FE-001", monto: "1000.00", fecha: "2026-09-01" });
    await factura({ id: 2, cliente: 1, numero: "FE-002", monto: "1000.00", fecha: "2026-09-02" });
    await factura({ id: 3, cliente: 1, numero: "F3-003", monto: "1000.00", entidad: MON, fecha: "2026-09-03" });
    await factura({ id: 4, cliente: 2, numero: "FE-004", monto: "500.00", estado: "Anulada", fecha: "2026-09-04" });
    await factura({ id: 5, cliente: 2, numero: "OLD-5", monto: "750.00", entidad: null, fecha: "2026-01-15" });
    await factura({ id: 6, cliente: 1, numero: "BOR-6", monto: "300.00", estado: "Borrador", fecha: "2026-09-06" });
    await factura({ id: 7, cliente: 2, numero: "FE-007", monto: "250.50", fecha: "2026-09-07" });
    await factura({ id: 8, empresa: OTRA, cliente: 9, numero: "ZZ-008", monto: "999.00", entidad: ENT_OTRA });
    await pagoDirecto(2, "400.00", "2026-09-20");
    await pagoDirecto(3, "600.00", "2026-09-15");
    await pagoDirecto(3, "400.00", "2026-09-25");
    // Registros manuales LEGADOS con cifras distintas: jamás deben influir en los saldos reales y deben sobrevivir intactos.
    await holder.pool.execute("INSERT INTO cont_cxc (empresa_id, entidad_id, cliente, documento, fecha, monto, saldo) VALUES (7, 1, 'Cliente Alfa', 'FE-001', '2026-09-01', 1000, 5555), (7, 1, 'Manual', 'X', '2026-09-01', 8000, 8000)");
  }, 60000);
  afterAll(async () => {
    await holder.pool?.end();
    if (/^cxc_pant_[a-f0-9]{32}$/.test(database)) {
      const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "" });
      await c.query(`DROP DATABASE IF EXISTS ${database}`); await c.end();
    }
  });

  describe("listado de documentos reales", () => {
    it("solo facturas Emitidas/Anuladas de la empresa y del LIBRO seleccionado; sin borradores, sin otra entidad, sin otra empresa, sin facturas sin entidad", async () => {
      expect(ids(await docs(KT))).toEqual([1, 2, 4, 7]);
      expect(ids(await docs(MON))).toEqual([3]);
    });
    it("entidad inexistente, inactiva o de OTRA empresa: 404 «Entidad no disponible» y no lista nada", async () => {
      for (const ent of [ENT_OTRA, 4, 99]) await expect(docs(ent)).rejects.toMatchObject({ status: 404, message: "Entidad no disponible." });
      await expect(docs(ENT_OTRA, {}, OTRA)).resolves.toMatchObject({ totalReal: 1 }); // la otra empresa sí ve su propia entidad
      expect(ids(await docs(ENT_OTRA, {}, OTRA))).toEqual([8]);
    });
    it("el filtro de entidad que mande el cliente se ignora: manda el libro seleccionado", async () => {
      expect(ids(await docs(KT, { entidad: MON }))).toEqual([1, 2, 4, 7]);
      expect(ids(await docs(KT, { entidad: "sin" }))).toEqual([1, 2, 4, 7]);
    });
    it("saldo = total − cobros (cont_cxc NO participa); cobrado, situación y anulada sin saldo", async () => {
      expect(await fila(KT, 1)).toMatchObject({ montoOriginal: "1000.00", totalPagado: "0.00", saldoInformativo: "1000.00", estadoFinanciero: "SIN_PAGOS" });
      expect(await fila(KT, 2)).toMatchObject({ totalPagado: "400.00", saldoInformativo: "600.00", estadoFinanciero: "PARCIAL", cantidadPagos: 1 });
      expect(await fila(MON, 3)).toMatchObject({ totalPagado: "1000.00", saldoInformativo: "0.00", estadoFinanciero: "PAGADA", cantidadPagos: 2 });
      expect(await fila(KT, 4)).toMatchObject({ estadoAdmin: "Anulada", estadoFinanciero: "ANULADA", saldoInformativo: null });
    });
    it("totales del libro por entidad: facturado, cobrado y saldo no mezclan entidades ni anuladas", async () => {
      const kt = (await docs(KT)).porEntidad;
      expect(kt).toHaveLength(1);
      expect(kt[0]).toMatchObject({ entidadId: KT, montoOriginal: "2250.50", totalPagado: "400.00", saldoInformativo: "1850.50" });
      expect((await docs(MON)).porEntidad[0]).toMatchObject({ entidadId: MON, montoOriginal: "1000.00", totalPagado: "1000.00", saldoInformativo: "0.00" });
    });
    it("filtros: situación (abiertas/pagadas/anuladas), cliente, documento, fechas, paginación", async () => {
      expect(ids(await docs(KT, { alcance: "abiertas" }))).toEqual([1, 2, 7]);
      expect(ids(await docs(KT, { alcance: "anuladas" }))).toEqual([4]);
      expect(ids(await docs(KT, { alcance: "pagadas" }))).toEqual([]);
      expect(ids(await docs(MON, { alcance: "pagadas" }))).toEqual([3]);
      expect(ids(await docs(KT, { textoCliente: "beta" }))).toEqual([4, 7]);
      expect(ids(await docs(KT, { textoCliente: "Alfa, S.A." }))).toEqual([1, 2]);
      expect(ids(await docs(KT, { numeroFactura: "FE-00" }))).toEqual([1, 2, 4, 7]);
      expect(ids(await docs(KT, { numeroFactura: "007" }))).toEqual([7]);
      expect(ids(await docs(KT, { fechaDesde: "2026-09-02", fechaHasta: "2026-09-04" }))).toEqual([2, 4]);
      expect(ids(await docs(KT, { numeroFactura: "%" }))).toEqual([]); // comodines escapados
      const p1 = await docs(KT, { pageSize: 2, page: 1 }), p2 = await docs(KT, { pageSize: 2, page: 2 });
      expect(p1.totalReal).toBe(4); expect([...ids(p1), ...ids(p2)].sort()).toEqual([1, 2, 4, 7]);
    });
  });

  describe("cobros: parcial, múltiples, sobrepago, pagada, anulada", () => {
    it("cobro parcial y varios cobros: el saldo baja exacto y la situación pasa de Sin cobros a Parcial y a Pagada", async () => {
      expect((await cobro(1, 300)).ok).toBe(true);
      expect(await fila(KT, 1)).toMatchObject({ totalPagado: "300.00", saldoInformativo: "700.00", estadoFinanciero: "PARCIAL" });
      expect((await cobro(1, 200.5)).ok).toBe(true);
      expect(await fila(KT, 1)).toMatchObject({ totalPagado: "500.50", saldoInformativo: "499.50", cantidadPagos: 2 });
      expect((await cobro(1, 499.5)).ok).toBe(true);
      expect(await fila(KT, 1)).toMatchObject({ totalPagado: "1000.00", saldoInformativo: "0.00", estadoFinanciero: "PAGADA", cantidadPagos: 3 });
    });
    it("sobrepago rechazado (409) y no escribe; factura ya pagada no admite más", async () => {
      const antes = (await sql("SELECT COUNT(*) n FROM fact_pagos"))[0].n;
      const r = await cobro(2, 600.01);
      expect(r).toMatchObject({ ok: false, status: 409 });
      expect(r.ok === false && r.error).toMatch(/excede el saldo/);
      expect(await cobro(1, 0.01)).toMatchObject({ ok: false, status: 409 });
      expect((await sql("SELECT COUNT(*) n FROM fact_pagos"))[0].n).toBe(antes);
      expect((await fila(KT, 2)).saldoInformativo).toBe("600.00");
      expect((await cobro(2, 600)).ok).toBe(true);
      expect((await fila(KT, 2)).estadoFinanciero).toBe("PAGADA");
    });
    it("factura anulada, monto no positivo: se rechazan", async () => {
      expect(await cobro(4, 10)).toMatchObject({ ok: false, status: 409 });
      expect(await cobro(7, 0)).toMatchObject({ ok: false, status: 400 });
      expect(await cobro(7, -5)).toMatchObject({ ok: false, status: 400 });
    });
    it("aislamiento: factura de otra entidad, SIN entidad, borrador, otra empresa o inexistente → 404 y nada se escribe", async () => {
      const antes = (await sql("SELECT COUNT(*) n FROM fact_pagos"))[0].n;
      for (const id of [3, 5, 8, 999]) expect(await cobro(id, 1), String(id)).toMatchObject({ ok: false, status: 404 });
      expect(await cobro(3, 1, MON)).toMatchObject({ ok: false, status: 409 }); // en SU libro existe, pero ya está pagada
      expect(await cobro(6, 1)).toMatchObject({ ok: false, status: 409 }); // borrador: no cobrable
      await expect(cobro(8, 1, ENT_OTRA)).rejects.toMatchObject({ status: 404 }); // entidad de otra empresa para esta sesión
      expect(await cobro(8, 1, ENT_OTRA, { ...actor, empresaId: OTRA })).toMatchObject({ ok: true }); // la otra empresa sí cobra lo suyo
      expect((await sql("SELECT COUNT(*) n FROM fact_pagos"))[0].n).toBe(Number(antes) + 1);
      expect((await sql("SELECT COUNT(*) n FROM fact_pagos WHERE factura_id IN (3,5,6)"))[0].n).toBe(2); // solo los 2 cobros originales de F3
    });
    it("dos cobros simultáneos por todo el saldo: solo uno entra (nunca sobrepagada)", async () => {
      const res = await Promise.all([1, 2, 3, 4].map(() => cobro(7, 250.5)));
      expect(res.filter((r) => r.ok)).toHaveLength(1);
      expect(await fila(KT, 7)).toMatchObject({ totalPagado: "250.50", saldoInformativo: "0.00", estadoFinanciero: "PAGADA" });
    });
    it("auditoría de Facturación (registrar_pago) con el usuario de la sesión", async () => {
      const a = await sql("SELECT empresa_id, usuario, modulo, accion FROM auditoria WHERE accion='registrar_pago' ORDER BY id DESC LIMIT 1");
      expect(a[0]).toMatchObject({ empresa_id: E, usuario: "conta", modulo: "facturacion", accion: "registrar_pago" });
      expect((await sql("SELECT registrado_por FROM fact_pagos WHERE factura_id=7"))[0].registrado_por).toBe(91);
    });
  });

  describe("pestaña Cobros", () => {
    it("lista solo los cobros reales de las facturas del libro (más recientes primero) con total y filtros", async () => {
      const kt = await listarCobrosCxc(E, KT);
      expect(kt.cobros.every((c) => [1, 2, 7].includes(c.facturaId))).toBe(true);
      expect(kt.cobros.some((c) => c.facturaId === 3 || c.facturaId === 8)).toBe(false);
      expect(kt.totalCobrado).toBe("2250.50"); // F1 1000 + F2 400+600 + F7 250.50
      const mon = await listarCobrosCxc(E, MON);
      expect(mon.cobros.map((c) => c.monto)).toEqual(["400.00", "600.00"]); // por fecha desc
      expect(mon.totalCobrado).toBe("1000.00");
      expect((await listarCobrosCxc(E, KT, { textoCliente: "beta" })).cobros.map((c) => c.facturaId)).toEqual([7]);
      expect((await listarCobrosCxc(E, KT, { numeroFactura: "FE-002" })).cobros.every((c) => c.facturaId === 2)).toBe(true);
      expect((await listarCobrosCxc(E, KT, { fechaDesde: "2026-10-05", fechaHasta: "2026-10-05" })).totalReal).toBeGreaterThan(0);
      expect((await listarCobrosCxc(E, KT, { fechaDesde: "2030-01-01" })).totalReal).toBe(0);
      expect((await listarCobrosCxc(E, KT, { pageSize: 2 })).cobros).toHaveLength(2);
    });
    it("otra empresa / entidad ajena no ve estos cobros", async () => {
      await expect(listarCobrosCxc(E, ENT_OTRA)).rejects.toMatchObject({ status: 404 });
      const otra = await listarCobrosCxc(OTRA, ENT_OTRA);
      expect(otra.cobros.map((c) => c.facturaId)).toEqual([8]);
    });
  });

  it("cont_cxc (registro manual legado) quedó EXACTAMENTE igual y nunca se mezcló con los saldos reales", async () => {
    expect(await sql("SELECT COUNT(*) n FROM cont_cxc")).toEqual([{ n: 2 }]);
    expect(await huellaLegado()).toContain("5555"); // la cifra del legado (saldo 5555) nunca afectó el saldo real
    expect((await fila(KT, 1)).montoOriginal).toBe("1000.00");
  });
});
