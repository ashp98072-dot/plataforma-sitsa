import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as Pool | null, log: [] as string[] }));
vi.mock("@/lib/db", () => ({
  getPool: () => holder.pool,
  query: async (texto: string, params: unknown[] = []) => {
    if (!holder.pool) throw new Error("Sin conexión local fixture");
    holder.log.push(texto);
    return (await holder.pool.query(texto, params))[0];
  },
}));

import {
  listarClientesCxc,
  listarConfirmacionesCliente,
  listarCuentasPorCobrar,
  listarPagosCliente,
  listarParaExportar,
  resumenCliente,
} from "./cuentas-por-cobrar";
import { cuentasPorCobrarAExcel } from "./cuentas-por-cobrar-excel";
import { NOTA_EXPORTACION, ROTULO_SALDO_INFORMATIVO, type FiltrosCxc } from "./cuentas-por-cobrar-shared";

/**
 * M-2a (Cuentas por cobrar informativa) contra MariaDB 11.8.9 DESECHABLE. Se OMITE salvo que exista LIQ_TEST_DB_PORT
 * (3399 o 3407, solo local). Esquema mínimo propio: no ejecuta ninguna migración ni toca ninguna base real.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/facturacion/cuentas-por-cobrar.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const database = `cxc_test_${randomUUID().replaceAll("-", "")}`;
const E = 7; // empresa
const OTRA = 8;
const KT = 1;
const MON = 2;

const sql = async <T extends RowDataPacket = RowDataPacket>(t: string, p: unknown[] = []): Promise<T[]> => (await holder.pool!.query<T[]>(t, p))[0];
const ids = (filas: { facturaId: number }[]) => filas.map((f) => f.facturaId).sort((a, b) => a - b);
const cartera = (extra: Partial<FiltrosCxc> = {}): FiltrosCxc => ({ vista: "cartera", ...extra });
const historial = (extra: Partial<FiltrosCxc> = {}): FiltrosCxc => ({ vista: "historial", ...extra });

async function factura(o: {
  id: number; empresa?: number; cliente: number; numero: string; estado?: string; monto: string; entidad?: number | null;
  fecha?: string; condicion?: string | null; retPct?: number; retMonto?: string;
}) {
  await holder.pool!.execute(
    `INSERT INTO fact_facturas (id, empresa_id, cliente_id, numero_factura, fecha_emision, monto_total, estado_admin,
        cliente_nombre_snapshot, entidad_id, condicion_pago, retencion_iva_pct, retencion_iva_monto)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
    [o.id, o.empresa ?? E, o.cliente, o.numero, o.fecha ?? "2026-09-10", o.monto, o.estado ?? "Emitida", o.entidad === undefined ? KT : o.entidad,
      o.condicion ?? "CREDITO", o.retPct ?? 0, o.retMonto ?? "0.00"],
  );
}
const pago = (facturaId: number, monto: string, fecha: string, referencia: string | null = null, empresa = E) =>
  holder.pool!.execute(
    "INSERT INTO fact_pagos (empresa_id, factura_id, fecha_pago, monto, referencia, medio_pago, registrado_por) VALUES (?, ?, ?, ?, ?, 'Transferencia', 1)",
    [empresa, facturaId, fecha, monto, referencia],
  );

async function huella(): Promise<string> {
  const out: string[][] = [];
  for (const t of ["fact_facturas", "fact_pagos", "fact_pago_confirmaciones", "cont_cxc", "clientes", "cont_entidades"]) {
    out.push((await sql(`SELECT * FROM ${t}`)).map((r) => JSON.stringify(r)).sort());
  }
  return JSON.stringify(out);
}

describe.skipIf(!port)("CxC informativa (M-2a) / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    try {
      const [v] = await c.query<RowDataPacket[]>("SELECT VERSION() AS v");
      expect(String(v[0].v)).toContain("11.8.9");
      await c.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
      await c.query(`USE ${database}`);
      await c.query(`
        CREATE TABLE clientes(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200) NOT NULL, razon_social VARCHAR(250) NULL, nit VARCHAR(40) NULL) ENGINE=InnoDB;
        CREATE TABLE cont_entidades(id INT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(20) NOT NULL, nombre VARCHAR(200) NOT NULL, activa TINYINT(1) NOT NULL DEFAULT 1) ENGINE=InnoDB;
        CREATE TABLE fact_facturas(id INT PRIMARY KEY, empresa_id INT NOT NULL, cliente_id INT NOT NULL, numero_factura VARCHAR(60) NULL,
          fecha_emision DATE NULL, monto_total DECIMAL(14,2) NOT NULL DEFAULT 0, estado_admin ENUM('Borrador','Emitida','Anulada') NOT NULL DEFAULT 'Borrador',
          cliente_nombre_snapshot VARCHAR(250) NULL, entidad_id INT NULL, condicion_pago VARCHAR(10) NULL,
          retencion_iva_pct TINYINT UNSIGNED NOT NULL DEFAULT 0, retencion_iva_monto DECIMAL(14,2) NOT NULL DEFAULT 0,
          KEY idx_f_emp (empresa_id, estado_admin)) ENGINE=InnoDB;
        CREATE TABLE fact_pagos(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, factura_id INT NOT NULL, fecha_pago DATE NOT NULL,
          monto DECIMAL(14,2) NOT NULL, referencia VARCHAR(120) NULL, medio_pago VARCHAR(40) NULL, observaciones TEXT NULL, registrado_por INT NOT NULL,
          KEY idx_p_f (factura_id), KEY idx_p_e (empresa_id)) ENGINE=InnoDB;
        CREATE TABLE cont_cuentas_bancarias(id INT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NOT NULL, banco VARCHAR(120) NOT NULL, alias VARCHAR(120) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE fact_pago_confirmaciones(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NOT NULL, pago_id INT NULL,
          factura_id INT NOT NULL, cuenta_bancaria_id INT NOT NULL, monto DECIMAL(14,2) NOT NULL, fecha_acreditacion DATE NOT NULL,
          referencia VARCHAR(120) NOT NULL, estado VARCHAR(12) NOT NULL DEFAULT 'CONFIRMADA') ENGINE=InnoDB;
        CREATE TABLE cont_cxc(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NULL, cliente VARCHAR(200) NOT NULL,
          documento VARCHAR(80) NULL, fecha DATE NOT NULL, vencimiento DATE NULL, monto DECIMAL(14,2) NOT NULL DEFAULT 0, saldo DECIMAL(14,2) NOT NULL DEFAULT 0,
          estado VARCHAR(40) NOT NULL DEFAULT 'Pendiente') ENGINE=InnoDB;
        INSERT INTO clientes VALUES (1, 7, 'Cliente Alfa', 'Alfa, S.A.', '1111111'), (2, 7, 'Cliente Beta', NULL, '2222222'), (9, 8, 'Cliente Otro', NULL, '9999999');
        INSERT INTO cont_entidades VALUES (1, 7, 'KT', 'KuiqTrans', 1), (2, 7, 'MON', 'Logiservicios Monaco', 1);
        INSERT INTO cont_cuentas_bancarias VALUES (1, 7, 1, 'Banco Uno', 'Operativa');
      `);
    } finally {
      await c.end();
    }
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 6 });

    // F1 KT sin pagos · F2 KT parcial · F3 MON pagada · F4 KT anulada (cliente 2) · F5 histórica sin entidad (cliente 2)
    // F6 borrador · F7 KT con retención ESPERADA y confirmación bancaria pero SIN pagos · F8 otra empresa
    await factura({ id: 1, cliente: 1, numero: "FE-001", monto: "1000.00", fecha: "2026-09-01" });
    await factura({ id: 2, cliente: 1, numero: "FE-002", monto: "1000.00", fecha: "2026-09-02" });
    await factura({ id: 3, cliente: 1, numero: "F3-003", monto: "1000.00", entidad: MON, fecha: "2026-09-03" });
    await factura({ id: 4, cliente: 2, numero: "FE-004", monto: "500.00", estado: "Anulada", fecha: "2026-09-04" });
    await factura({ id: 5, cliente: 2, numero: "OLD-5", monto: "750.00", entidad: null, condicion: null, fecha: "2026-01-15" });
    await factura({ id: 6, cliente: 1, numero: "BOR-6", monto: "300.00", estado: "Borrador", fecha: "2026-09-06" });
    await factura({ id: 7, cliente: 1, numero: "FE-007", monto: "1000.00", fecha: "2026-09-07", retPct: 15, retMonto: "160.71" });
    await factura({ id: 8, empresa: OTRA, cliente: 9, numero: "ZZ-008", monto: "999.00", entidad: 1 });
    await pago(2, "400.00", "2026-09-20", "BOL-111");
    await pago(3, "600.00", "2026-09-15", "BOL-300");
    await pago(3, "400.00", "2026-09-25", "BOL-301");
    await holder.pool.execute(
      "INSERT INTO fact_pago_confirmaciones (empresa_id, entidad_id, pago_id, factura_id, cuenta_bancaria_id, monto, fecha_acreditacion, referencia, estado) VALUES (7, 1, NULL, 7, 1, 1000.00, '2026-09-30', 'DEP-777', 'CONFIRMADA')",
    );
    // cont_cxc con cifras DISTINTAS: jamás debe influir.
    await holder.pool.execute("INSERT INTO cont_cxc (empresa_id, entidad_id, cliente, documento, fecha, monto, saldo) VALUES (7, 1, 'Cliente Alfa', 'FE-001', '2026-09-01', 1000, 5555)");
    await holder.pool.execute("INSERT INTO cont_cxc (empresa_id, entidad_id, cliente, documento, fecha, monto, saldo) VALUES (7, 1, 'Cliente Alfa', 'FE-XXX', '2026-09-01', 8000, 8000)");
  });

  beforeEach(() => {
    holder.log.length = 0;
  });

  afterAll(async () => {
    await holder.pool?.end();
  });

  it("A. saldo informativo: 1000 sin pagos = 1000 · 1000 con 400 = 600 · 1000 con 1000 = 0 (y sale de la cartera)", async () => {
    const h = await listarCuentasPorCobrar(E, historial());
    const f = (id: number) => h.filas.find((x) => x.facturaId === id)!;
    expect(f(1)).toMatchObject({ montoOriginal: "1000.00", totalPagado: "0.00", saldoInformativo: "1000.00", estadoFinanciero: "SIN_PAGOS" });
    expect(f(2)).toMatchObject({ totalPagado: "400.00", saldoInformativo: "600.00", estadoFinanciero: "PARCIAL" });
    expect(f(3)).toMatchObject({ totalPagado: "1000.00", saldoInformativo: "0.00", estadoFinanciero: "PAGADA", cantidadPagos: 2 });
    const c = await listarCuentasPorCobrar(E, cartera());
    expect(ids(c.filas)).toEqual([1, 2, 5, 7]);
  });

  it("B. estados derivados, incluyendo ANULADA (sin saldo cobrable) e histórica sin entidad", async () => {
    const h = await listarCuentasPorCobrar(E, historial());
    expect(h.filas.find((x) => x.facturaId === 4)).toMatchObject({ estadoFinanciero: "ANULADA", saldoInformativo: null, estadoAdmin: "Anulada" });
    for (const [estado, esperado] of [["SIN_PAGOS", [1, 5, 7]], ["PARCIAL", [2]], ["PAGADA", [3]], ["ANULADA", [4]]] as const) {
      const r = await listarCuentasPorCobrar(E, historial({ estadoDerivado: estado }));
      expect(ids(r.filas), estado).toEqual([...esperado]);
    }
  });

  it("C. aislamiento: otra empresa no se ve; KT y Mónaco no se mezclan; «Sin entidad» no se asigna", async () => {
    const otra = await listarCuentasPorCobrar(OTRA, historial());
    expect(ids(otra.filas)).toEqual([8]);
    const propia = await listarCuentasPorCobrar(E, historial());
    expect(ids(propia.filas)).not.toContain(8);

    const kt = await listarCuentasPorCobrar(E, historial({ entidad: KT }));
    expect(ids(kt.filas)).toEqual([1, 2, 4, 7]);
    expect(kt.filas.every((f) => f.entidad === "KuiqTrans")).toBe(true);
    const mon = await listarCuentasPorCobrar(E, historial({ entidad: MON }));
    expect(ids(mon.filas)).toEqual([3]);
    const sin = await listarCuentasPorCobrar(E, historial({ entidad: "sin" }));
    expect(ids(sin.filas)).toEqual([5]);
    expect(sin.filas[0].entidad).toBe("Sin entidad");
    expect(sin.filas[0].entidadId).toBeNull();

    // Totales SEPARADOS por entidad (nunca una suma que mezcle KT y Mónaco).
    expect(propia.porEntidad.map((t) => [t.entidad, t.cantidad, t.saldoInformativo])).toEqual([
      ["KuiqTrans", 4, "2600.00"],
      ["Logiservicios Monaco", 1, "0.00"],
      ["Sin entidad", 1, "750.00"],
    ]);
  });

  it("D. cont_cxc NO participa: el SQL jamás lo nombra y cambiarlo no altera ninguna cifra", async () => {
    const antes = await listarCuentasPorCobrar(E, historial());
    expect(holder.log.some((s) => /cont_cxc/i.test(s))).toBe(false);
    await holder.pool!.execute("UPDATE cont_cxc SET saldo = 1, monto = 1 WHERE empresa_id = 7");
    const despues = await listarCuentasPorCobrar(E, historial());
    expect(despues).toEqual(antes);
    await resumenCliente(E, 1);
    await listarClientesCxc(E, {});
    expect(holder.log.some((s) => /cont_cxc/i.test(s))).toBe(false);
    await holder.pool!.execute("UPDATE cont_cxc SET saldo = monto WHERE empresa_id = 7");
  });

  it("E. confirmaciones bancarias: atributo informativo; no suman al pago ni reducen el saldo", async () => {
    const h = await listarCuentasPorCobrar(E, historial());
    const f7 = h.filas.find((x) => x.facturaId === 7)!;
    expect(f7.totalPagado).toBe("0.00");
    expect(f7.saldoInformativo).toBe("1000.00");
    expect(f7.estadoFinanciero).toBe("SIN_PAGOS");
    expect(f7.confirmacionBancaria).toMatchObject({ cantidadActivas: 1, totalConfirmado: "1000.00" });
    expect(f7.confirmacionBancaria.ultima).toMatchObject({ estado: "CONFIRMADA", referencia: "DEP-777", banco: "Banco Uno", fechaAcreditacion: "2026-09-30" });
    // Pago y confirmación coexisten sin mezclarse: F3 tiene pagos y ninguna confirmación.
    expect(h.filas.find((x) => x.facturaId === 3)!.confirmacionBancaria.cantidadActivas).toBe(0);
  });

  it("F. retención ESPERADA: se muestra aparte (con neto esperado) y no altera el saldo", async () => {
    const f7 = (await listarCuentasPorCobrar(E, historial({ numeroFactura: "FE-007" }))).filas[0];
    expect(f7.retencionEsperada).toEqual({ porcentaje: 15, monto: "160.71" });
    expect(f7.netoEsperado).toBe("839.29");
    expect(f7.saldoInformativo).toBe("1000.00");
    expect(f7.condicionPago).toBe("CREDITO");
    const f1 = (await listarCuentasPorCobrar(E, historial({ numeroFactura: "FE-001" }))).filas[0];
    expect(f1.retencionEsperada).toBeNull();
    expect(f1.netoEsperado).toBeNull();
  });

  it("G. paginación en backend: total y páginas correctos; orden estable", async () => {
    const p1 = await listarCuentasPorCobrar(E, historial({ page: 1, pageSize: 4 }));
    const p2 = await listarCuentasPorCobrar(E, historial({ page: 2, pageSize: 4 }));
    const p3 = await listarCuentasPorCobrar(E, historial({ page: 3, pageSize: 4 }));
    expect(p1.totalReal).toBe(6);
    expect(p1.filas).toHaveLength(4);
    expect(p2.filas).toHaveLength(2);
    expect(p3.filas).toHaveLength(0);
    expect(p3.totalReal).toBe(6);
    expect(new Set([...p1.filas, ...p2.filas].map((f) => f.facturaId)).size).toBe(6);
    // Historial: más reciente primero.
    expect(p1.filas[0].fechaEmision! >= p1.filas[1].fechaEmision!).toBe(true);
    // La cartera ordena de la más antigua a la más reciente.
    const c = await listarCuentasPorCobrar(E, cartera());
    expect(c.filas.map((f) => f.facturaId)).toEqual([5, 1, 2, 7]);
  });

  it("H. anti N+1: la cantidad de consultas NO depende del número de facturas de la página", async () => {
    holder.log.length = 0;
    await listarCuentasPorCobrar(E, historial({ page: 1, pageSize: 1 }));
    const una = holder.log.filter((s) => !/LIMIT 0/.test(s)).length;
    holder.log.length = 0;
    await listarCuentasPorCobrar(E, historial({ page: 1, pageSize: 100 }));
    const muchas = holder.log.filter((s) => !/LIMIT 0/.test(s)).length;
    expect(muchas).toBe(una);
    expect(una).toBeLessThanOrEqual(4); // principal + pagos + confirmaciones + totales
  });

  it("I. historial: la pagada y la anulada siguen visibles; alcances Todas/Abiertas/Pagadas/Anuladas", async () => {
    expect(ids((await listarCuentasPorCobrar(E, historial({ alcance: "todas" }))).filas)).toEqual([1, 2, 3, 4, 5, 7]);
    expect(ids((await listarCuentasPorCobrar(E, historial({ alcance: "abiertas" }))).filas)).toEqual([1, 2, 5, 7]);
    expect(ids((await listarCuentasPorCobrar(E, historial({ alcance: "pagadas" }))).filas)).toEqual([3]);
    expect(ids((await listarCuentasPorCobrar(E, historial({ alcance: "anuladas" }))).filas)).toEqual([4]);
    // El borrador nunca participa.
    expect(ids((await listarCuentasPorCobrar(E, historial())).filas)).not.toContain(6);
  });

  it("J. filtros: cliente, texto, número (comodines escapados), fechas y estado administrativo", async () => {
    expect(ids((await listarCuentasPorCobrar(E, historial({ clienteId: 2 }))).filas)).toEqual([4, 5]);
    expect(ids((await listarCuentasPorCobrar(E, historial({ textoCliente: "Alfa" }))).filas)).toEqual([1, 2, 3, 7]);
    expect(ids((await listarCuentasPorCobrar(E, historial({ textoCliente: "Beta" }))).filas)).toEqual([4, 5]);
    expect(ids((await listarCuentasPorCobrar(E, historial({ numeroFactura: "FE-00" }))).filas)).toEqual([1, 2, 4, 7]);
    expect((await listarCuentasPorCobrar(E, historial({ numeroFactura: "%" }))).filas).toHaveLength(0); // «%» literal, no comodín
    expect(ids((await listarCuentasPorCobrar(E, historial({ fechaDesde: "2026-09-02", fechaHasta: "2026-09-03" }))).filas)).toEqual([2, 3]);
    expect(ids((await listarCuentasPorCobrar(E, historial({ estadoAdmin: "Anulada" }))).filas)).toEqual([4]);
    expect((await listarCuentasPorCobrar(E, cartera({ estadoAdmin: "Anulada" }))).filas).toHaveLength(0);
  });

  it("K. vista por cliente: resumen POR ENTIDAD, pagos y confirmaciones; cliente ajeno = null", async () => {
    const r = (await resumenCliente(E, 1))!;
    expect(r.rotulo).toBe(ROTULO_SALDO_INFORMATIVO);
    const kt = r.porEntidad.find((x) => x.entidadId === KT)!;
    const mon = r.porEntidad.find((x) => x.entidadId === MON)!;
    expect(kt).toMatchObject({ totalFacturadoRegistrado: "3000.00", totalPagadoRegistrado: "400.00", saldoInformativoAbierto: "2600.00", cantidadFacturas: 3, abiertas: 3, pagadas: 0, anuladas: 0 });
    expect(mon).toMatchObject({ totalFacturadoRegistrado: "1000.00", totalPagadoRegistrado: "1000.00", saldoInformativoAbierto: "0.00", cantidadFacturas: 1, abiertas: 0, pagadas: 1 });
    expect(r.porEntidad).toHaveLength(2); // sin fila mezclada

    expect(await resumenCliente(E, 9)).toBeNull(); // cliente de otra empresa
    const solo = (await resumenCliente(E, 1, MON))!;
    expect(solo.porEntidad).toHaveLength(1);

    const pagos = await listarPagosCliente(E, 1, {});
    expect(pagos.totalReal).toBe(3);
    expect(pagos.filas.map((p) => p.referencia)).toEqual(["BOL-301", "BOL-111", "BOL-300"]);
    const conf = await listarConfirmacionesCliente(E, 1, {});
    expect(conf.totalReal).toBe(1);
    expect(conf.filas[0]).toMatchObject({ numeroFactura: "FE-007", monto: "1000.00", estado: "CONFIRMADA" });

    const indice = await listarClientesCxc(E, {});
    expect(indice.totalReal).toBe(4); // Alfa-KT, Alfa-MON, Beta-KT, Beta-sin entidad
    expect(indice.filas[0].saldoInformativoAbierto).toBe("2600.00");
  });

  it("L. exportación: EXACTAMENTE el conjunto filtrado, con rótulo y nota, importes numéricos", async () => {
    const r = await listarParaExportar(E, cartera({ entidad: KT }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(ids(r.filas)).toEqual([1, 2, 7]);
    const buf = await cuentasPorCobrarAExcel(r.filas);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Cuentas por cobrar")!;
    expect(ws.getRow(1).getCell(1).value).toBe(ROTULO_SALDO_INFORMATIVO);
    expect(ws.getRow(2).getCell(1).value).toBe(NOTA_EXPORTACION);
    expect(ws.getRow(4).values).toEqual([undefined, "Cliente", "Factura", "Entidad", "Fecha emisión", "Monto original", "Total pagado", "Saldo informativo", "Estado", "Condición de pago", "Retención esperada", "Neto esperado", "Último pago", "Referencia"]);
    expect(ws.rowCount).toBe(4 + 3);
    expect(typeof ws.getRow(5).getCell(7).value).toBe("number");
  });

  it("M. SOLO LECTURA: ninguna escritura en ninguna tabla y ningún INSERT/UPDATE/DELETE en el SQL emitido", async () => {
    const antes = await huella();
    holder.log.length = 0;
    await listarCuentasPorCobrar(E, cartera());
    await listarCuentasPorCobrar(E, historial({ alcance: "pagadas" }));
    await resumenCliente(E, 1);
    await listarClientesCxc(E, { textoCliente: "A" });
    await listarPagosCliente(E, 1, {});
    await listarConfirmacionesCliente(E, 1, {});
    await listarParaExportar(E, historial());
    expect(await huella()).toBe(antes);
    expect(holder.log.some((s) => /\b(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE)\b/i.test(s))).toBe(false);
  });
});
