import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import Decimal from "decimal.js";

type Isolation = "READ COMMITTED" | "REPEATABLE READ";
const model = vi.hoisted(() => ({
  connection: vi.fn(), sessionDefault: "READ COMMITTED" as Isolation,
  version: 0, interleave: true, events: [] as string[],
  failAt: "" as string, documents: 1, missingPaymentsOnce: false,
}));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: model.connection }) }));
import { enInstantanea } from "./lectura-cxp";
import { listarAntiguedadCxp, listarAntiguedadCxpParaExportar } from "./antiguedad";
import { obtenerEstadoCuentaCxp, exportarEstadoCuentaCxp } from "./estado-cuenta";

// Deliberately an explicit MVCC MODEL, not a MariaDB engine or SQL interpreter.
// Its rules come from the MariaDB RC/RR contract; only the report/helper code is
// executed for real. A synthetic writer commits after the page read returns.
function reader() {
  const number = model.connection.mock.calls.length;
  let next: Isolation | undefined;
  let isolation: Isolation = model.sessionDefault;
  let snapshot = 0, active = false;
  const views: number[] = [];
  const release = vi.fn(() => model.events.push(`reader-${number}:release`));
  const query = vi.fn(async (sql: string, params: unknown[] = []): Promise<[Record<string, unknown>[]]> => {
    model.events.push(`reader-${number}:${sql}`);
    if (model.failAt && sql.includes(model.failAt)) throw new Error("synthetic query failure");
    if (sql === "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ") { next = "REPEATABLE READ"; return [[]]; }
    if (sql === "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY") {
      isolation = next ?? model.sessionDefault; next = undefined;
      snapshot = model.version; active = true; return [[]];
    }
    if (sql === "COMMIT") { active = false; return [[]]; }
    expect(sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE)\b/i);
    if (model.missingPaymentsOnce && sql.includes("cxp_pago")) {
      model.missingPaymentsOnce = false; model.version = 1;
      throw Object.assign(new Error("cxp_pago_aplicaciones missing in model"), { code: "ER_NO_SUCH_TABLE" });
    }
    const view = active && isolation === "REPEATABLE READ" ? snapshot : model.version;
    views.push(view);
    const withPayments = sql.includes("cxp_pago");
    const paid = !withPayments || view === 0 ? "0.00" : "20.02";
    const balance = new Decimal("100.01").minus(paid).toFixed(2);
    if (sql === "SELECT model_version") return [[{ version: view }]];
    if (sql.startsWith("SELECT id FROM cont_entidades")) {
      expect(params).toEqual([101, 11]); return [[{ id: 11 }]];
    }
    if (sql.startsWith("SELECT id, nombre_comercial")) {
      expect(params).toEqual([101, 1001]);
      return [[{ id: 1001, nombre_comercial: "SYNTHETIC-PROVIDER", nit: "QA-08", dias_credito: 30 }]];
    }
    if (sql.startsWith("SELECT regimen_fiscal")) {
      expect(params).toEqual([101, 11, 1001]); return [[{ regimen_fiscal: "GENERAL", sujeto_isr: 1 }]];
    }
    if (sql.includes("DATE_FORMAT(x.fecha_documento") && sql.includes("LIMIT ? OFFSET ?")) {
      expect(sql).toContain("x.empresa_id = ?"); expect(sql).toContain("x.entidad_id = ?");
      expect(params.slice(0, withPayments ? 4 : 2)).toEqual(withPayments ? [101, 11, 101, 11] : [101, 11]);
      const row = { id: 1, proveedor_id: 1001, proveedor: "SYNTHETIC-PROVIDER", serie: "QA", numero: "1",
        fecha_documento: "2026-11-01", fecha_vencimiento: null, dias: 5, dias_vencidos: null,
        situacion: "SIN_VENCIMIENTO", tramo: "0-15", total_documento: "110.01", isr_monto: "10.00",
        total_neto_pagar: "100.01", pagado: paid, estado_admin: "REGISTRADA", motivo_anulacion: null };
      const [limit, offset] = params.slice(-2) as number[];
      const rows = Array.from({ length: model.documents }, (_, i) => ({ ...row, id: i + 1, numero: String(i + 1), pagado: i === 0 ? paid : "0.00" })).slice(offset, offset + limit);
      if (model.interleave) {
        model.interleave = false;
        model.version = 1;
        model.events.push("MODEL-WRITER:commit-version-1-after-page");
      }
      return [rows];
    }
    if (sql.includes("AS tramo") && sql.includes("COUNT(*) AS facturas")) {
      return [[{ tramo: "0-15", situacion: "SIN_VENCIMIENTO", facturas: model.documents,
        saldo: model.documents === 1 ? balance : new Decimal("100.01").times(model.documents).minus(paid).toFixed(2) }]];
    }
    if (sql.includes("AS clase") && sql.includes("COUNT(*) AS n")) {
      return [[{ clase: "ABIERTA", situacion: "SIN_VENCIMIENTO", n: 1, td: "110.01", isr: "10.00",
        pag: "100.01", pagado: paid, saldo_pos: balance, exceso: "0.00" }]];
    }
    if (sql.startsWith("SELECT a.factura_id, a.pago_id")) {
      expect(params).toEqual([101, 11, 1]);
      return [view === 0 ? [] : [{ factura_id: 1, pago_id: 901, monto: paid, fecha_pago: "2026-11-06",
        medio_pago: "SYNTHETIC", referencia: "QA-08", estado: "REGISTRADO", reversado_en: null, motivo_reversion: null }]];
    }
    if (sql.includes("ORDER BY x.id LIMIT 51") || sql.includes("g.proveedor_id <> f.proveedor_id") || sql.includes("HAVING g.monto_total")) return [[]];
    throw new Error(`Unrecognized model SQL: ${sql.slice(0, 90)}`);
  });
  return { query, release, views, isActive: () => active };
}

let readers: ReturnType<typeof reader>[];
beforeEach(() => {
  vi.clearAllMocks(); model.version = 0; model.interleave = true; model.events = [];
  model.sessionDefault = "READ COMMITTED"; model.failAt = ""; model.documents = 1; model.missingPaymentsOnce = false;
  readers = [];
  model.connection.mockImplementation(async () => { const r = reader(); readers.push(r); return r; });
});
const cut = "2026-11-06";
const filter = { proveedorId: 1001, page: 1, pageSize: 1, incluirPagadas: false, incluirAnuladas: false };
const capabilities = { verPagos: true, verFiscal: true };

describe("MIL-CXP-08: current transaction boundary, modeled interleaving only", () => {
  it("current default helper inherits READ COMMITTED and can read two modeled versions", async () => {
    const versions = await enInstantanea(async c => {
      const [a] = await c.query("SELECT model_version");
      model.version = 1;
      const [b] = await c.query("SELECT model_version");
      return [a, b];
    });
    expect(versions).toEqual([[{ version: 0 }], [{ version: 1 }]]);
    expect(readers[0].query.mock.calls[0][0]).toBe("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    expect(readers[0].release).toHaveBeenCalledOnce();
  });
  it("existing opt-in pins RR for only that transaction in the model", async () => {
    const versions = await enInstantanea(async c => {
      const [a] = await c.query("SELECT model_version"); model.version = 1;
      const [b] = await c.query("SELECT model_version"); return [a, b];
    }, { lecturaRepetible: true });
    expect(versions).toEqual([[{ version: 0 }], [{ version: 0 }]]);
    expect(readers[0].query.mock.calls[0][0]).toBe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    expect(model.sessionDefault).toBe("READ COMMITTED");
    const next = await enInstantanea(async c => (await c.query("SELECT model_version"))[0]);
    expect(next).toEqual([{ version: 1 }]);
  });

  for (const exportMode of [false, true]) for (const defaultLevel of ["READ COMMITTED", "REPEATABLE READ"] as const) {
    it(`antiquity ${exportMode ? "export" : "page"}: forces RR over default ${defaultLevel}, writer between page and totals`, async () => {
      model.sessionDefault = defaultLevel;
      const response = exportMode ? await listarAntiguedadCxpParaExportar(101, 11, filter, cut) : await listarAntiguedadCxp(101, 11, filter, cut);
      if ("ok" in response && !response.ok) throw Error("unexpected export limit");
      expect(response.filas[0].saldo).toBe("100.01");
      expect(response.saldoTotal).toBe("100.01");
      expect(readers).toHaveLength(1);
      expect(readers[0].query.mock.calls.slice(0, 2).map(([sql]) => sql)).toEqual(["SET TRANSACTION ISOLATION LEVEL REPEATABLE READ", "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"]);
      expect(readers[0].isActive()).toBe(false); expect(readers[0].release).toHaveBeenCalledOnce();
    });
    it(`statement ${exportMode ? "export" : "page"}: forces RR over default ${defaultLevel}, totals/details after modeled writer`, async () => {
      model.sessionDefault = defaultLevel;
      const r = exportMode ? await exportarEstadoCuentaCxp(101, 11, filter, capabilities, cut) : await obtenerEstadoCuentaCxp(101, 11, filter, capabilities, cut);
      if ("ok" in r && !r.ok) throw Error("unexpected export limit");
      const response = "datos" in r ? r.datos : r;
      expect(response.filas[0].pagado).toBe("0.00");
      expect(response.totales.registradas.pagado).toBe("0.00");
      expect(response.filas[0].pagos).toHaveLength(0);
      expect(response.advertencias.some(a => a.codigo === "PAGADO_NO_COINCIDE_CON_LINEAS")).toBe(false);
      expect(readers[0].query.mock.calls.slice(0, 2).map(([sql]) => sql)).toEqual(["SET TRANSACTION ISOLATION LEVEL REPEATABLE READ", "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"]);
      expect(readers[0].release).toHaveBeenCalledOnce();
    });
  }

  it("pages across separate requests do not share a snapshot even under inherited RR", async () => {
    model.sessionDefault = "REPEATABLE READ";
    const first = await listarAntiguedadCxp(101, 11, filter, cut);
    const next = await listarAntiguedadCxp(101, 11, filter, cut);
    expect(first.saldoTotal).toBe("100.01"); expect(next.saldoTotal).toBe("79.99");
    expect(readers).toHaveLength(2);
  });
  it("second page under inherited RR shares its view with global totals, not just page totals", async () => {
    model.documents = 2; model.sessionDefault = "REPEATABLE READ";
    const secondPage = await listarAntiguedadCxp(101, 11, { ...filter, page: 2 }, cut);
    expect(secondPage.filas.map(f => f.facturaId)).toEqual([2]);
    expect(secondPage.filas[0].saldo).toBe("100.01");
    expect(secondPage.totalReal).toBe(2); expect(secondPage.saldoTotal).toBe("200.02");
    expect(new Set(readers[0].views)).toEqual(new Set([0]));
    const pageQuery = readers[0].query.mock.calls.find(([sql]) => sql.includes("LIMIT ? OFFSET ?"))!;
    expect(pageQuery[1]?.slice(-2)).toEqual([1, 1]);
  });
  it("REGRESSION H-02 MODEL: antiquity under RC keeps page and totals in one view", async () => {
    const r = await listarAntiguedadCxp(101, 11, filter, cut);
    expect(r.saldoTotal).toBe(r.filas[0].saldo);
  });
  it("REGRESSION H-02 MODEL: statement under RC keeps aggregate and details in one view", async () => {
    const r = await obtenerEstadoCuentaCxp(101, 11, filter, capabilities, cut);
    expect(r.totales.registradas.pagado).toBe(r.filas[0].pagado);
    expect(r.filas[0].pagos).toHaveLength(0);
  });
  it("statement without payment/fiscal capability does not query those details", async () => {
    await obtenerEstadoCuentaCxp(101, 11, filter, { verPagos: false, verFiscal: false }, cut);
    expect(readers[0].query.mock.calls.some(([sql]) => sql.startsWith("SELECT a.factura_id, a.pago_id") || sql.includes("cxp_proveedor_fiscal"))).toBe(false);
  });
  it("real helper commits and releases a modeled connection on callback failure", async () => {
    model.failAt = "COUNT(*) AS facturas";
    await expect(listarAntiguedadCxp(101, 11, filter, cut)).rejects.toThrow("synthetic query failure");
    expect(readers[0].query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(readers[0].isActive()).toBe(false); expect(readers[0].release).toHaveBeenCalledOnce();
  });
  it("captures model evidence without representing it as a database reproduction", async () => {
    const r = await obtenerEstadoCuentaCxp(101, 11, filter, capabilities, cut);
    mkdirSync("docs/MIL-CXP-08/FASE-2", { recursive: true });
    writeFileSync("docs/MIL-CXP-08/FASE-2/evidencia-modelo.json", JSON.stringify({
      realDatabase: false, realConnections: false, fixture: "synthetic versions 0 and 1",
      inheritedIsolation: model.sessionDefault, pagePaid: r.filas[0].pagado,
      totalPaid: r.totales.registradas.pagado, details: r.filas[0].pagos,
      warnings: r.advertencias, events: model.events,
      limitation: "Report/helper code executed against a deterministic MVCC model; not proof of MariaDB behavior or deployed isolation",
    }, null, 2) + "\n");
    expect(r.filas[0].pagado).toBe(r.totales.registradas.pagado);
  });

  for (const report of ["antiquity", "statement"] as const) for (const exportMode of [false, true]) {
    it(`${report} ${exportMode ? "export" : "page"}: missing payments retries in a new RR transaction and releases both connections`, async () => {
      model.missingPaymentsOnce = true;
      const response = report === "antiquity"
        ? exportMode ? await listarAntiguedadCxpParaExportar(101, 11, filter, cut) : await listarAntiguedadCxp(101, 11, filter, cut)
        : exportMode ? await exportarEstadoCuentaCxp(101, 11, filter, capabilities, cut) : await obtenerEstadoCuentaCxp(101, 11, filter, capabilities, cut);
      if ("ok" in response && !response.ok) throw Error("unexpected export limit");
      const data = "datos" in response ? response.datos : response;
      expect(data.filas[0].pagado).toBe("0.00"); expect(data.filas[0].saldo).toBe("100.01");
      expect(readers).toHaveLength(2);
      for (const r of readers) {
        expect(r.query.mock.calls.slice(0, 2).map(([sql]) => sql)).toEqual(["SET TRANSACTION ISOLATION LEVEL REPEATABLE READ", "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"]);
        expect(r.query.mock.calls.at(-1)?.[0]).toBe("COMMIT"); expect(r.release).toHaveBeenCalledOnce(); expect(r.isActive()).toBe(false);
      }
      expect(new Set(readers[1].views)).toEqual(new Set([1]));
      expect(readers[1].query.mock.calls.some(([sql]) => sql.includes("cxp_pago"))).toBe(false);
    });
    for (const failAt of ["SET TRANSACTION", "START TRANSACTION", "COMMIT"]) {
      it(`${report} ${exportMode ? "export" : "page"}: ${failAt} error propagates and connection is released without retry`, async () => {
        model.failAt = failAt;
        const invoke = () => report === "antiquity"
          ? exportMode ? listarAntiguedadCxpParaExportar(101, 11, filter, cut) : listarAntiguedadCxp(101, 11, filter, cut)
          : exportMode ? exportarEstadoCuentaCxp(101, 11, filter, capabilities, cut) : obtenerEstadoCuentaCxp(101, 11, filter, capabilities, cut);
        await expect(invoke()).rejects.toThrow("synthetic query failure");
        expect(readers).toHaveLength(1); expect(readers[0].release).toHaveBeenCalledOnce();
        if (failAt !== "COMMIT") {
          expect(readers[0].query.mock.calls.some(([sql]) => sql === "COMMIT")).toBe(false);
          expect(readers[0].isActive()).toBe(false);
        }
      });
    }
  }
});
