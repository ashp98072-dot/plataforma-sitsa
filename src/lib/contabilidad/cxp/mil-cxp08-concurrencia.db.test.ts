import { createHash, timingSafeEqual } from "node:crypto";
import mysql, { type Connection, type Pool, type RowDataPacket, type ResultSetHeader } from "mysql2/promise";
import Decimal from "decimal.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Inert by default, including when LIQ_TEST_DB_PORT is present. A later explicit
// authorization and a pre-provisioned, exclusively owned QA fixture are required.
const enabled = process.env.MIL_CXP08_AUTHORIZED_RUN === "YES_ISOLATED_QA";
const state = vi.hoisted(() => ({ facade: null as unknown }));
vi.mock("@/lib/db", () => ({ getPool: () => {
  if (!state.facade) throw Error("MIL-CXP-08: no authorized QA facade");
  return state.facade;
} }));
import { listarAntiguedadCxp, listarAntiguedadCxpParaExportar } from "./antiguedad";
import { obtenerEstadoCuentaCxp, exportarEstadoCuentaCxp } from "./estado-cuenta";

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
function required(name: string) {
  const value = process.env[name];
  if (!value) throw Error(`Required isolated-lab setting: ${name}`);
  return value;
}
function positive(name: string) {
  const value = required(name);
  if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) throw Error(`Invalid synthetic fixture ID: ${name}`);
  return Number(value);
}
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe.skipIf(!enabled)("MIL-CXP-08 future authorized MariaDB: two real connections, no migrations", () => {
  let writer: Connection | undefined, readerPool: Pool | undefined;
  let fixture: { company: number; entity: number; provider: number; invoice: number; payment: number };
  let writerId = 0;

  beforeAll(async () => {
    // All guard inputs are required before any socket is opened. Never read DB_*
    // or .env. No auto-provisioning, schema migration or adoption of other DBs.
    const alias = required("MIL_CXP08_LAB_ID");
    if (!/^qa-desechable-cxp08(?:-[a-z0-9-]+)?$/.test(alias)) throw Error("Invalid QA alias");
    const port = required("MIL_CXP08_PORT");
    if (!["3399", "3407"].includes(port)) throw Error("Only approved QA loopback ports are supported");
    const database = required("MIL_CXP08_DATABASE");
    if (!/^cxp_qa08_[a-f0-9]{32}$/.test(database)) throw Error("Invalid exclusive QA database name");
    const datadirHash = required("MIL_CXP08_DATADIR_SHA256");
    if (!/^[a-f0-9]{64}$/.test(datadirHash)) throw Error("Invalid authorized datadir fingerprint");
    const version = required("MIL_CXP08_VERSION");
    const ownerToken = required("MIL_CXP08_OWNER_TOKEN");
    if (ownerToken.length < 32) throw Error("Missing strong ownership marker");
    fixture = { company: positive("MIL_CXP08_COMPANY_ID"), entity: positive("MIL_CXP08_ENTITY_ID"),
      provider: positive("MIL_CXP08_PROVIDER_ID"), invoice: positive("MIL_CXP08_INVOICE_ID"), payment: positive("MIL_CXP08_PAYMENT_ID") };
    const cfg = { host: "127.0.0.1", port: Number(port), database,
      user: required("MIL_CXP08_DB_USER"), password: required("MIL_CXP08_DB_PASSWORD") };
    writer = await mysql.createConnection(cfg);
    const [identity] = await writer.query<RowDataPacket[]>("SELECT VERSION() version, @@port port, @@datadir datadir, DATABASE() db, CONNECTION_ID() id");
    const id = identity[0];
    if (!id || String(id.version) !== version || Number(id.port) !== Number(port) || String(id.db) !== database || sha(String(id.datadir)) !== datadirHash) throw Error("QA server identity mismatch");
    writerId = Number(id.id);
    const [owners] = await writer.query<RowDataPacket[]>("SELECT token FROM qa_ownership LIMIT 2");
    if (owners.length !== 1 || !timingSafeEqual(Buffer.from(sha(String(owners[0].token)), "hex"), Buffer.from(sha(ownerToken), "hex"))) throw Error("QA ownership mismatch");
    const tables = ["cxp_facturas", "cxp_pagos", "cxp_pago_aplicaciones", "cxp_proveedor_fiscal", "compras_proveedores", "cont_entidades"];
    const [engines] = await writer.query<RowDataPacket[]>(`SELECT TABLE_NAME name, ENGINE engine FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`, tables);
    if (engines.length !== tables.length || engines.some(r => r.engine !== "InnoDB")) throw Error("Pre-provisioned InnoDB schema required; no migration will be run");
    const [payments] = await writer.query<RowDataPacket[]>("SELECT estado, reversado_por, reversado_en, motivo_reversion FROM cxp_pagos WHERE empresa_id=? AND entidad_id=? AND proveedor_id=? AND id=?", [fixture.company, fixture.entity, fixture.provider, fixture.payment]);
    if (payments.length !== 1 || payments[0].estado !== "REGISTRADO" || payments[0].reversado_por != null || payments[0].reversado_en != null || payments[0].motivo_reversion != null) throw Error("QA fixture payment must start registered without reversal metadata");
    const [applications] = await writer.query<RowDataPacket[]>("SELECT factura_id, monto FROM cxp_pago_aplicaciones WHERE empresa_id=? AND entidad_id=? AND pago_id=?", [fixture.company, fixture.entity, fixture.payment]);
    if (applications.length !== 1 || Number(applications[0].factura_id) !== fixture.invoice || !new Decimal(String(applications[0].monto)).eq("20.02")) throw Error("QA fixture needs one exact 20.02 application to the designated invoice");
    readerPool = mysql.createPool({ ...cfg, connectionLimit: 1 });
  }, 30000);

  afterAll(async () => {
    state.facade = null;
    if (readerPool) await readerPool.end();
    if (writer) await writer.end();
  });

  for (const kind of ["antiquity", "statement"] as const) for (const exportMode of [false, true]) {
    it(`${kind} ${exportMode ? "export" : "page"}: committed writer between page and totals is invisible until the next report`, async () => {
      const ready = barrier(), resume = barrier();
      let paused = false, releases = 0, readerId = 0, changed = false;
      const traces: string[] = [];
      state.facade = { getConnection: async () => {
        const real = await readerPool!.getConnection();
        await real.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
        const [ids] = await real.query<RowDataPacket[]>("SELECT CONNECTION_ID() id"); readerId = Number(ids[0].id);
        return { query: async (sql: string, params?: unknown[]) => {
          traces.push(sql);
          const result = await real.query(sql, params);
          if (!paused && sql.includes("DATE_FORMAT(x.fecha_documento") && sql.includes("LIMIT ? OFFSET ?")) {
            paused = true; ready.resolve(); await resume.promise;
          }
          return result;
        }, release: () => { releases++; real.release(); } };
      } };
      const filters = { proveedorId: fixture.provider, incluirPagadas: true, incluirAnuladas: false, page: 1, pageSize: 100 };
      const report = async () => {
        if (kind === "antiquity") {
          if (!exportMode) return listarAntiguedadCxp(fixture.company, fixture.entity, filters, "2026-11-06");
          const r = await listarAntiguedadCxpParaExportar(fixture.company, fixture.entity, filters, "2026-11-06");
          if (!r.ok) throw Error("Fixture exceeds export limit"); return r;
        }
        const options = { verPagos: true, verFiscal: true };
        if (!exportMode) return obtenerEstadoCuentaCxp(fixture.company, fixture.entity, filters, options, "2026-11-06");
        const r = await exportarEstadoCuentaCxp(fixture.company, fixture.entity, filters, options, "2026-11-06");
        if (!r.ok) throw Error("Fixture exceeds export limit"); return r.datos;
      };
      const pending = report();
      const reached = Promise.race([ready.promise, pending.then(() => { throw Error("Page barrier not reached"); })]);
      try {
        await reached;
        expect(readerId).not.toBe(writerId);
        expect(traces.slice(0, 2)).toEqual(["SET TRANSACTION ISOLATION LEVEL REPEATABLE READ", "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"]);
        await writer!.beginTransaction();
        const [update] = await writer!.execute<ResultSetHeader>("UPDATE cxp_pagos SET estado='REVERSADO', reversado_por=creado_por, reversado_en=NOW(), motivo_reversion='MIL-CXP-08 synthetic fixture only' WHERE empresa_id=? AND entidad_id=? AND proveedor_id=? AND id=? AND estado='REGISTRADO'", [fixture.company, fixture.entity, fixture.provider, fixture.payment]);
        if (update.affectedRows !== 1) throw Error("Exclusive fixture changed unexpectedly");
        await writer!.commit(); changed = true; resume.resolve();
        const snapshot = await pending;
        const before = snapshot.filas.find(f => f.facturaId === fixture.invoice);
        if (!before) throw Error("Designated fixture invoice must be visible on the first page");
        const next = await report();
        const after = next.filas.find(f => f.facturaId === fixture.invoice);
        if (!after) throw Error("Fixture invoice unexpectedly disappeared");
        expect(new Decimal(before.pagado).minus(after.pagado).toFixed(2)).toBe("20.02");
        if ("totales" in snapshot && "totales" in next) {
          expect(new Decimal(snapshot.totales.registradas.pagado).minus(next.totales.registradas.pagado).toFixed(2)).toBe("20.02");
          for (const data of [snapshot, next]) for (const row of data.filas) {
            const sum = (row.pagos ?? []).filter(p => p.vigente).reduce((n, p) => n.plus(p.monto), new Decimal(0));
            expect(sum.toFixed(2)).toBe(row.pagado);
          }
          expect(snapshot.advertencias.some(a => a.codigo === "PAGADO_NO_COINCIDE_CON_LINEAS")).toBe(false);
        } else if ("saldoTotal" in snapshot && "saldoTotal" in next) {
          expect(new Decimal(next.saldoTotal).minus(snapshot.saldoTotal).toFixed(2)).toBe("20.02");
        }
        expect(releases).toBe(2);
      } finally {
        resume.resolve(); await pending.catch(() => undefined);
        await writer!.rollback();
        if (changed) {
          // Restore only the designated, exclusively owned synthetic fixture.
          // No table/schema changes, global cleanup or business-data reversals.
          const [restored] = await writer!.execute<ResultSetHeader>("UPDATE cxp_pagos SET estado='REGISTRADO', reversado_por=NULL, reversado_en=NULL, motivo_reversion=NULL WHERE empresa_id=? AND entidad_id=? AND proveedor_id=? AND id=? AND estado='REVERSADO' AND motivo_reversion='MIL-CXP-08 synthetic fixture only'", [fixture.company, fixture.entity, fixture.provider, fixture.payment]);
          if (restored.affectedRows !== 1) throw Error("Synthetic fixture recovery failed; custodial intervention required");
        }
      }
    }, 30000);
  }
});
