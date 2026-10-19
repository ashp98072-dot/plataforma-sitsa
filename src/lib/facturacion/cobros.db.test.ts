import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => holder.pool,
  query: async (sql: string, params: unknown[] = []) => (await holder.pool!.query(sql, params))[0],
  execute: async (sql: string, params: unknown[] = []) => (await holder.pool!.execute(sql, params as never))[0],
}));

import { asegurarSchemaClientes } from "@/lib/clientes/schema";
import { registrarPago, anularFactura } from "./facturas";
import { anularCobro, clientesConSaldo, facturasPendientesCliente, listarCobros, obtenerCobro, registrarCobro, type ActorCobro } from "./cobros";
import { anularConfirmacionBancaria, confirmarIngresoBancario } from "./confirmaciones-bancarias";
import { listarBitacoraFactura } from "./bitacora";
import { listarCuentasPorCobrar } from "./cuentas-por-cobrar";

/**
 * CxC-1 (cobro multi-factura + anulación) contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407, solo local). Usa la MIGRACIÓN REAL
 * sql/migrate-2026-10-cxc-cobros-multifactura.sql (aplicada dos veces: idempotente) sobre el esquema real (schema.sql + FACT-1..4 + PR B) y los
 * servicios reales (cobros.ts, registrarPago legado, confirmaciones bancarias, bitácora, CxC informativa).
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/facturacion/cobros.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const database = `cobros_test_${randomUUID().replaceAll("-", "")}`;
const E1 = 7, E2 = 8;
const ana: ActorCobro = { empresaId: E1, usuarioId: 31, usuario: "ana" };
const beto: ActorCobro = { empresaId: E1, usuarioId: 32, usuario: "beto" };
const zeta: ActorCobro = { empresaId: E2, usuarioId: 99, usuario: "zeta" };
let admin: Connection;
let KT = 0, MON = 0, OTRA = 0;
let fid = 100;

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const extraerCreate = (sql: string, t: string) => {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`).exec(sql);
  if (!m) throw new Error(`Sin CREATE TABLE ${t}`);
  return m[0];
};
const filas = async (sql: string, p: unknown[] = []) => (await admin.query<RowDataPacket[]>(sql, p as never))[0];
const k = () => `clave-${randomUUID()}`;
async function factura(o: { cliente?: number; empresa?: number; entidad?: number; monto?: string; estado?: string; moneda?: string } = {}) {
  const id = ++fid;
  await admin.query(
    `INSERT INTO fact_facturas (id, empresa_id, cliente_id, numero_factura, fecha_emision, monto_total, estado_admin, creado_por, moneda, entidad_id, condicion_pago)
     VALUES (?, ?, ?, ?, '2026-10-01', ?, ?, 31, ?, ?, 'CREDITO')`,
    [id, o.empresa ?? E1, o.cliente ?? 20, `F-${id}`, o.monto ?? "1000.00", o.estado ?? "Emitida", o.moneda ?? "GTQ", o.entidad ?? KT]);
  return id;
}
const entrada = (aplicaciones: [number, string][], over: Record<string, unknown> = {}) => ({
  clienteId: 20, fechaCobro: "2026-10-10", medioPago: "Transferencia", referencia: "BOL-1", observaciones: null, claveIdempotencia: k(),
  aplicaciones: aplicaciones.map(([facturaId, monto]) => ({ facturaId, monto })), ...over,
});
const saldo = async (id: number) => {
  const r = await filas(`SELECT f.monto_total - COALESCE((SELECT SUM(x.monto) FROM (
      SELECT factura_id, monto FROM fact_pagos UNION ALL
      SELECT a.factura_id, a.monto FROM fact_cobro_aplicaciones a JOIN fact_cobros c ON c.id = a.cobro_id AND c.estado = 'VIGENTE') x WHERE x.factura_id = f.id), 0) AS s
    FROM fact_facturas f WHERE f.id = ?`, [id]);
  return String(r[0].s);
};
const conteo = async (t: string) => Number((await filas(`SELECT COUNT(*) n FROM ${t}`))[0].n);

describe.skipIf(!port)("CxC-1 cobro multi-factura / MariaDB 11.8.9 SOLO LOCAL", { timeout: 60000 }, () => {
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
    // La migración REAL de CxC-1, dos veces (idempotente).
    await admin.query(leer("sql/migrate-2026-10-cxc-cobros-multifactura.sql"));
    await admin.query(leer("sql/migrate-2026-10-cxc-cobros-multifactura.sql"));
    await admin.query(`INSERT INTO empresas (id, codigo, nombre, slug) VALUES (${E1}, 'E7', 'Empresa 7', 'e7'), (${E2}, 'E8', 'Empresa 8', 'e8')`);
    await admin.query(`INSERT INTO usuarios (id, username, password_hash, salt) VALUES (31, 'ana', 'x', 's'), (32, 'beto', 'x', 's'), (99, 'zeta', 'x', 's')`);
    await admin.query(`INSERT INTO tms_clientes (id, empresa_id, nombre) VALUES (501, ${E1}, 'Cliente X'), (502, ${E1}, 'Cliente Y'), (601, ${E2}, 'Cliente Z')`);
    await admin.query(`INSERT INTO clientes (id, empresa_id, nombre, razon_social, nit, direccion, tms_cliente_id) VALUES (20, ${E1}, 'Comercial X', 'Cliente X, S.A.', '1234567-8', 'Zona 1', 501), (21, ${E1}, 'Comercial Y', 'Cliente Y', '7654321-0', 'Zona 2', 502), (30, ${E2}, 'Comercial Z', NULL, NULL, NULL, 601)`);
    KT = (await admin.query<mysql.ResultSetHeader>("INSERT INTO cont_entidades (empresa_id, codigo, nombre) VALUES (?, 'KT', 'Kuiqtrans')", [E1]))[0].insertId;
    MON = (await admin.query<mysql.ResultSetHeader>("INSERT INTO cont_entidades (empresa_id, codigo, nombre) VALUES (?, 'MON', 'Mónaco')", [E1]))[0].insertId;
    OTRA = (await admin.query<mysql.ResultSetHeader>("INSERT INTO cont_entidades (empresa_id, codigo, nombre) VALUES (?, 'OTR', 'Otra')", [E2]))[0].insertId;
  }, 120000);
  afterAll(async () => {
    await holder.pool?.end();
    if (admin) { if (!/^cobros_test_[a-f0-9]{32}$/.test(database)) throw Error("BD no desechable"); await admin.query(`DROP DATABASE ${database}`); await admin.end(); }
  });

  it("migración idempotente: tablas, columna cobro_id y FKs presentes; el DDL de schema.sql coincide", async () => {
    expect((await filas("SHOW COLUMNS FROM fact_pago_confirmaciones LIKE 'cobro_id'")).length).toBe(1);
    const fks = (await filas("SELECT CONSTRAINT_NAME n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()")).map((r) => r.n);
    for (const n of ["fk_fcobro_entidad", "fk_fcobro_cliente", "fk_fcobro_actor", "fk_fcobro_anulador", "fk_fcapl_cobro", "fk_fcapl_factura", "fk_fpc_cobro"]) expect(fks).toContain(n);
    const mig = leer("sql/migrate-2026-10-cxc-cobros-multifactura.sql"), sch = leer("sql/schema.sql");
    const lf = (t: string) => t.split(String.fromCharCode(13)).join("");
    for (const t of ["fact_cobros", "fact_cobro_aplicaciones"]) expect(lf(extraerCreate(sch, t))).toBe(lf(extraerCreate(mig, t)));
  });

  describe("registrar", () => {
    it("1 cobro → 1 factura: cabecera VIGENTE, aplicación, saldo 0 y total calculado por el servidor", async () => {
      const f = await factura({ monto: "500.00" });
      const r = await registrarCobro(ana, KT, entrada([[f, "500.00"]]));
      expect(r.repetido).toBe(false);
      expect(r.cobro).toMatchObject({ estado: "VIGENTE", montoTotal: "500.00", clienteId: 20, entidadId: KT, empresaId: E1, creadoPor: "ana", moneda: "GTQ" });
      expect(r.cobro.aplicaciones).toEqual([{ facturaId: f, numeroFactura: `F-${f}`, monto: "500.00" }]);
      expect(await saldo(f)).toBe("0.00");
    });
    it("1 cobro → varias facturas (parciales): total = suma; cada saldo baja solo lo aplicado", async () => {
      const [a, b, c] = [await factura({ monto: "1000.00" }), await factura({ monto: "300.00" }), await factura({ monto: "200.00" })];
      const r = await registrarCobro(ana, KT, entrada([[a, "400.00"], [b, "300.00"], [c, "0.01"]]));
      expect(r.cobro.montoTotal).toBe("700.01");
      expect(await saldo(a)).toBe("600.00"); expect(await saldo(b)).toBe("0.00"); expect(await saldo(c)).toBe("199.99");
      expect(await conteo("fact_cobro_aplicaciones")).toBeGreaterThanOrEqual(3);
    });
    it("varias aplicaciones a la misma factura en cobros distintos, junto con un pago legado", async () => {
      const f = await factura({ monto: "1000.00" });
      await admin.query("INSERT INTO fact_pagos (empresa_id, factura_id, fecha_pago, monto, registrado_por) VALUES (?, ?, '2026-10-02', '250.00', 31)", [E1, f]);
      await registrarCobro(ana, KT, entrada([[f, "300.00"]]));
      await registrarCobro(beto, KT, entrada([[f, "450.00"]]));
      expect(await saldo(f)).toBe("0.00");
      await expect(registrarCobro(ana, KT, entrada([[f, "0.01"]]))).rejects.toMatchObject({ codigo: "SOBREAPLICACION", status: 409 });
    });
    it("cliente distinto, entidad distinta, empresa distinta, factura no emitida y moneda mezclada: rechazados sin escribir nada", async () => {
      const fx = await factura({ cliente: 20 }), fy = await factura({ cliente: 21 }), fm = await factura({ entidad: MON }), fb = await factura({ estado: "Borrador" }), fa = await factura({ estado: "Anulada" });
      const fz = await factura({ empresa: E2, cliente: 30, entidad: OTRA }), fusd = await factura({ moneda: "USD" });
      const antes = [await conteo("fact_cobros"), await conteo("fact_cobro_aplicaciones")];
      await expect(registrarCobro(ana, KT, entrada([[fx, "10.00"], [fy, "10.00"]]))).rejects.toMatchObject({ codigo: "CLIENTE_DISTINTO" });
      await expect(registrarCobro(ana, KT, entrada([[fm, "10.00"]]))).rejects.toMatchObject({ codigo: "ENTIDAD_DISTINTA" });
      await expect(registrarCobro(ana, KT, entrada([[fz, "10.00"]], { clienteId: 30 }))).rejects.toMatchObject({ codigo: "FACTURA_NO_ENCONTRADA", status: 404 }); // factura de OTRA empresa
      await expect(registrarCobro(zeta, KT, entrada([[fx, "10.00"]]))).rejects.toMatchObject({ status: 404 }); // empresa 8 con la entidad de la empresa 7
      await expect(registrarCobro(ana, OTRA, entrada([[fx, "10.00"]]))).rejects.toMatchObject({ status: 404 }); // entidad de otra empresa
      await expect(registrarCobro(ana, KT, entrada([[fb, "10.00"]]))).rejects.toMatchObject({ codigo: "FACTURA_NO_EMITIDA" });
      await expect(registrarCobro(ana, KT, entrada([[fa, "10.00"]]))).rejects.toMatchObject({ codigo: "FACTURA_NO_EMITIDA" });
      await expect(registrarCobro(ana, KT, entrada([[fx, "10.00"], [fusd, "10.00"]]))).rejects.toMatchObject({ codigo: "MONEDA_DISTINTA" });
      expect([await conteo("fact_cobros"), await conteo("fact_cobro_aplicaciones")]).toEqual(antes);
    });
    it("entradas inválidas: sin facturas, repetidas, monto cero/negativo/flotante/exceso de decimales, fecha o clave inválidas", async () => {
      const f = await factura();
      const malas: Record<string, unknown>[] = [
        entrada([]), entrada([[f, "10.00"], [f, "5.00"]]), entrada([[f, "0"]]), entrada([[f, "-5"]]), entrada([[f, "10.005"]]), entrada([[f, "1e3"]]), entrada([[f, "10.00"]], { fechaCobro: "2026-02-30" }),
        entrada([[f, "10.00"]], { claveIdempotencia: "corta" }), entrada([[f, "10.00"]], { clienteId: 0 }),
      ];
      for (const m of malas) await expect(registrarCobro(ana, KT, m as never)).rejects.toMatchObject({ codigo: "DATOS_INVALIDOS", status: 400 });
    });
    it("idempotencia: mismo envío = mismo cobro (sin duplicar); misma clave con otro contenido = 409", async () => {
      const f = await factura({ monto: "100.00" });
      const e = entrada([[f, "40.00"]]);
      const a = await registrarCobro(ana, KT, e), b = await registrarCobro(ana, KT, e);
      expect(b.repetido).toBe(true); expect(b.cobro.id).toBe(a.cobro.id);
      expect(await saldo(f)).toBe("60.00");
      await expect(registrarCobro(ana, KT, { ...e, aplicaciones: [{ facturaId: f, monto: "41.00" }] })).rejects.toMatchObject({ codigo: "CLAVE_REUTILIZADA" });
      expect(Number((await filas("SELECT COUNT(*) n FROM fact_cobros WHERE clave_idempotencia = ?", [e.claveIdempotencia]))[0].n)).toBe(1);
    });
    it("concurrencia: dos cobros simultáneos que juntos sobrepasan el saldo → exactamente uno se aplica", async () => {
      const f = await factura({ monto: "1000.00" });
      const r = await Promise.allSettled([registrarCobro(ana, KT, entrada([[f, "700.00"]])), registrarCobro(beto, KT, entrada([[f, "700.00"]]))]);
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(r.filter((x) => x.status === "rejected")).toHaveLength(1);
      expect(await saldo(f)).toBe("300.00");
    });
    it("concurrencia: el mismo envío dos veces a la vez no duplica", async () => {
      const f = await factura({ monto: "100.00" });
      const e = entrada([[f, "30.00"]]);
      const r = await Promise.allSettled([registrarCobro(ana, KT, e), registrarCobro(ana, KT, e)]);
      expect(r.every((x) => x.status === "fulfilled")).toBe(true);
      expect(await saldo(f)).toBe("70.00");
      expect(Number((await filas("SELECT COUNT(*) n FROM fact_cobros WHERE clave_idempotencia = ?", [e.claveIdempotencia]))[0].n)).toBe(1);
    });
    it("convivencia con fact_pagos: el pago legado respeta lo aplicado por cobros y no se duplican saldos", async () => {
      const f = await factura({ monto: "1000.00" });
      await registrarCobro(ana, KT, entrada([[f, "600.00"]]));
      const pasa = await registrarPago({ empresaId: E1, usuarioId: 31, usuario: "ana" }, f, { fechaPago: "2026-10-12", monto: 400 });
      expect(pasa.ok).toBe(true);
      const excede = await registrarPago({ empresaId: E1, usuarioId: 31, usuario: "ana" }, f, { fechaPago: "2026-10-12", monto: 0.01 });
      expect(excede).toMatchObject({ ok: false, status: 409 });
      expect(await saldo(f)).toBe("0.00");
    });
  });

  describe("anular", () => {
    it("anula el cobro completo con motivo: conserva cabecera y aplicaciones, restaura saldos y deja de afectar", async () => {
      const [a, b] = [await factura({ monto: "1000.00" }), await factura({ monto: "500.00" })];
      const { cobro } = await registrarCobro(ana, KT, entrada([[a, "400.00"], [b, "500.00"]]));
      expect([await saldo(a), await saldo(b)]).toEqual(["600.00", "0.00"]);
      const anulado = await anularCobro(beto, KT, cobro.id, "Depósito rechazado por el banco");
      expect(anulado).toMatchObject({ estado: "ANULADO", anuladoPor: "beto", motivoAnulacion: "Depósito rechazado por el banco", montoTotal: "900.00" });
      expect(anulado.aplicaciones).toHaveLength(2);
      expect([await saldo(a), await saldo(b)]).toEqual(["1000.00", "500.00"]);
      expect(Number((await filas("SELECT COUNT(*) n FROM fact_cobro_aplicaciones WHERE cobro_id = ?", [cobro.id]))[0].n)).toBe(2); // se conservan
      expect((await obtenerCobro(E1, KT, cobro.id))!.estado).toBe("ANULADO");
      // Tras anular se puede volver a cobrar el saldo recuperado.
      await registrarCobro(ana, KT, entrada([[b, "500.00"]]));
      expect(await saldo(b)).toBe("0.00");
    });
    it("doble anulación rechazada; motivo obligatorio; cobro ajeno (otra entidad/empresa) no existe", async () => {
      const f = await factura({ monto: "100.00" });
      const { cobro } = await registrarCobro(ana, KT, entrada([[f, "100.00"]]));
      await expect(anularCobro(ana, KT, cobro.id, "  ")).rejects.toMatchObject({ codigo: "MOTIVO_REQUERIDO", status: 400 });
      await expect(anularCobro(ana, KT, cobro.id, "ab")).rejects.toMatchObject({ codigo: "MOTIVO_REQUERIDO" });
      await expect(anularCobro(ana, MON, cobro.id, "otra entidad")).rejects.toMatchObject({ status: 404 });
      await expect(anularCobro(zeta, OTRA, cobro.id, "otra empresa")).rejects.toMatchObject({ status: 404 });
      expect((await obtenerCobro(E1, KT, cobro.id))!.estado).toBe("VIGENTE");
      await anularCobro(ana, KT, cobro.id, "Capturado por error");
      await expect(anularCobro(ana, KT, cobro.id, "otra vez")).rejects.toMatchObject({ codigo: "YA_ANULADO", status: 409 });
      expect(await saldo(f)).toBe("100.00");
    });
    it("con confirmación bancaria ACTIVA vinculada se bloquea la anulación (sin anular en cascada); al anular la confirmación, ya se puede", async () => {
      const f = await factura({ monto: "800.00" });
      const { cobro } = await registrarCobro(ana, KT, entrada([[f, "800.00"]]));
      const cuenta = Number((await admin.query<mysql.ResultSetHeader>("INSERT INTO cont_cuentas (empresa_id, entidad_id, codigo, nombre, tipo) VALUES (?, ?, ?, 'Banco', 'Activo')", [E1, KT, `1${f}`]))[0].insertId);
      const banco = Number((await admin.query<mysql.ResultSetHeader>("INSERT INTO cont_cuentas_bancarias (empresa_id, entidad_id, cuenta_id, banco, alias, moneda, activa) VALUES (?, ?, ?, 'Banco Uno', 'Operativa', 'GTQ', 1)", [E1, KT, cuenta]))[0].insertId);
      const conf = await confirmarIngresoBancario({ empresaId: E1, usuarioId: 31, usuario: "ana" }, f, {
        pagoId: null, cobroId: cobro.id, cuentaBancariaId: banco, monto: "800.00", fechaAcreditacion: "2026-10-11", referencia: "DEP-9", observaciones: null, idempotencyKey: randomUUID(),
      });
      expect((await obtenerCobro(E1, KT, cobro.id))!.confirmacionActiva).toBe(true);
      await expect(anularCobro(ana, KT, cobro.id, "Quiero anularlo")).rejects.toMatchObject({ codigo: "CONFIRMACION_ACTIVA", status: 409 });
      expect((await obtenerCobro(E1, KT, cobro.id))!.estado).toBe("VIGENTE");
      expect(Number((await filas("SELECT COUNT(*) n FROM fact_pago_confirmaciones WHERE id = ? AND estado = 'CONFIRMADA'", [conf.id]))[0].n)).toBe(1); // la confirmación NO se tocó
      await anularConfirmacionBancaria({ empresaId: E1, usuarioId: 31, usuario: "ana" }, f, conf.id, "Depósito rebotado");
      await anularCobro(ana, KT, cobro.id, "Depósito rebotado");
      expect(await saldo(f)).toBe("800.00");
    });
    it("una confirmación no puede vincularse a un cobro anulado ni a un cobro que no incluye la factura", async () => {
      const [f, g] = [await factura({ monto: "100.00" }), await factura({ monto: "100.00" })];
      const { cobro } = await registrarCobro(ana, KT, entrada([[f, "100.00"]]));
      const banco = Number((await filas("SELECT id FROM cont_cuentas_bancarias LIMIT 1"))[0].id);
      const base = { pagoId: null, cuentaBancariaId: banco, monto: "100.00", fechaAcreditacion: "2026-10-11", referencia: "R", observaciones: null };
      await expect(confirmarIngresoBancario({ empresaId: E1, usuarioId: 31, usuario: "ana" }, g, { ...base, cobroId: cobro.id, idempotencyKey: randomUUID() })).rejects.toThrow(/cobro informado/);
      await anularCobro(ana, KT, cobro.id, "Error de captura");
      await expect(confirmarIngresoBancario({ empresaId: E1, usuarioId: 31, usuario: "ana" }, f, { ...base, cobroId: cobro.id, idempotencyKey: randomUUID() })).rejects.toThrow(/cobro informado/);
    });
    it("la factura con un cobro VIGENTE no se puede anular; con el cobro anulado sí", async () => {
      const f = await factura({ monto: "100.00" });
      const { cobro } = await registrarCobro(ana, KT, entrada([[f, "100.00"]]));
      const r1 = await anularFactura({ empresaId: E1, usuarioId: 31, usuario: "ana" }, f, "intento");
      expect(r1).toMatchObject({ ok: false, status: 409 });
      await anularCobro(ana, KT, cobro.id, "Corrección");
      const r2 = await anularFactura({ empresaId: E1, usuarioId: 31, usuario: "ana" }, f, "ya sin cobros");
      expect(r2.ok).toBe(true);
    });
  });

  describe("lectura, auditoría y sin efectos contables", () => {
    it("historial con aplicaciones, filtros por estado y por cliente; clientes y facturas pendientes del libro", async () => {
      const f = await factura({ cliente: 21, monto: "50.00" });
      const { cobro } = await registrarCobro(ana, KT, entrada([[f, "20.00"]], { clienteId: 21 }));
      const h = await listarCobros(E1, KT, { clienteId: 21 });
      expect(h.cobros.map((c) => c.id)).toContain(cobro.id);
      expect(h.cobros.every((c) => c.clienteId === 21 && c.entidadId === KT)).toBe(true);
      expect((await listarCobros(E1, MON, { clienteId: 21 })).cobros).toEqual([]);
      expect((await listarCobros(E2, KT)).cobros).toEqual([]);
      const pend = await facturasPendientesCliente(E1, KT, 21);
      expect(pend.find((x) => x.facturaId === f)).toMatchObject({ total: "50.00", cobrado: "20.00", saldo: "30.00" });
      expect((await clientesConSaldo(E1, KT)).find((c) => c.clienteId === 21)).toBeTruthy();
      expect(await facturasPendientesCliente(E2, KT, 21)).toEqual([]);
      await anularCobro(ana, KT, cobro.id, "Prueba");
      expect((await facturasPendientesCliente(E1, KT, 21)).find((x) => x.facturaId === f)!.saldo).toBe("50.00");
      expect((await listarCobros(E1, KT, { estado: "ANULADO" })).cobros.some((c) => c.id === cobro.id)).toBe(true);
    });
    it("auditoría: evento por factura (saldo antes→después, actor, entidad) y resumen del cobro con facturas, montos y motivo", async () => {
      const [a, b] = [await factura({ monto: "300.00" }), await factura({ monto: "200.00" })];
      const { cobro } = await registrarCobro(ana, KT, entrada([[a, "100.00"], [b, "200.00"]], { referencia: "BOL-77" }));
      await anularCobro(beto, KT, cobro.id, "Boleta duplicada");
      const ev = await listarBitacoraFactura(E1, a);
      const acciones = ev.map((e) => e.accion);
      expect(acciones.slice(0, 2)).toEqual(["anular_cobro_multiple", "registrar_cobro_multiple"]);
      const reg = ev[1], anu = ev[0];
      expect(reg).toMatchObject({ usuarioId: 31, entidadId: KT, monto: "100.00", referencia: "BOL-77" });
      expect(reg.cambios.find((c) => c.campo === "saldo")).toEqual({ campo: "saldo", antes: "300.00", despues: "200.00" });
      expect(anu).toMatchObject({ usuarioId: 32, motivo: "Boleta duplicada" });
      expect(anu.cambios.find((c) => c.campo === "saldo")).toEqual({ campo: "saldo", antes: "200.00", despues: "300.00" });
      const aud = await filas("SELECT accion, usuario, modulo, detalle FROM auditoria WHERE accion IN ('cxc_registrar_cobro','cxc_anular_cobro') AND detalle LIKE ? ORDER BY id", [`%"cobroId":${cobro.id},%`]);
      expect(aud.map((x) => x.accion)).toEqual(["cxc_registrar_cobro", "cxc_anular_cobro"]);
      const d0 = JSON.parse(String(aud[0].detalle)), d1 = JSON.parse(String(aud[1].detalle));
      expect(d0).toMatchObject({ entidadId: KT, usuarioId: 31, clienteId: 20, montoTotal: "300.00", aplicaciones: [{ facturaId: a, monto: "100.00" }, { facturaId: b, monto: "200.00" }] });
      expect(d1).toMatchObject({ usuarioId: 32, motivo: "Boleta duplicada", antes: "VIGENTE", despues: "ANULADO" });
      expect(aud[0].usuario).toBe("ana"); expect(aud[1].usuario).toBe("beto");
    });
    it("la CxC informativa (M-2a) y el saldo de Facturación usan la misma definición: cuentan cobros vigentes y no los anulados", async () => {
      const f = await factura({ cliente: 20, monto: "1000.00" });
      const { cobro } = await registrarCobro(ana, KT, entrada([[f, "250.00"]]));
      const r1 = await listarCuentasPorCobrar(E1, { vista: "historial", entidad: KT, numeroFactura: `F-${f}` });
      expect(r1.filas[0]).toMatchObject({ facturaId: f, totalPagado: "250.00", saldoInformativo: "750.00" });
      await anularCobro(ana, KT, cobro.id, "Prueba de saldos");
      const r2 = await listarCuentasPorCobrar(E1, { vista: "historial", entidad: KT, numeroFactura: `F-${f}` });
      expect(r2.filas[0]).toMatchObject({ totalPagado: "0.00", saldoInformativo: "1000.00" });
    });
    it("no genera pólizas ni toca fact_pagos al cobrar o anular", async () => {
      const pagos = await conteo("fact_pagos");
      const f = await factura({ monto: "10.00" });
      const { cobro } = await registrarCobro(ana, KT, entrada([[f, "10.00"]]));
      await anularCobro(ana, KT, cobro.id, "Sin póliza");
      expect(await conteo("fact_pagos")).toBe(pagos);
      expect(Number((await filas("SELECT COUNT(*) n FROM auditoria WHERE accion LIKE '%asiento%'"))[0].n)).toBe(0);
    });
    it("postcheck: ninguna inconsistencia (ámbito, sumas, sobreaplicación, confirmaciones de cobros anulados)", async () => {
      const sql = leer("sql/postcheck-2026-10-cxc-cobros-multifactura.sql");
      const selects = sql.split(/;\s*\n/).map((s) => s.replace(/--[^\n]*/g, "").trim()).filter((s) => /^SELECT/i.test(s) && /HAVING|WHERE/i.test(s) && !/information_schema/i.test(s));
      expect(selects.length).toBe(4);
      for (const s of selects) expect(await filas(s), s.slice(0, 80)).toEqual([]);
    });
  });
});
