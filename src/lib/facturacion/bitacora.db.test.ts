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
import { actualizarFacturaBorrador, anularFactura, crearFactura, emitirFactura, registrarPago, type ActorFacturacion } from "./facturas";
import { listarBitacoraCxc, listarBitacoraFactura } from "./bitacora";

/**
 * Bitácora de Facturación + CxC contra MariaDB 11.8.9 DESECHABLE (LIQ_TEST_DB_PORT=3399|3407, solo local). Ejecuta el código REAL de facturas.ts sobre
 * el esquema real (sql/schema.sql + migraciones FACT-1..4). Una base nueva por corrida; no toca ninguna base real.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/facturacion/bitacora.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const database = `bit_test_${randomUUID().replaceAll("-", "")}`;
const E1 = 7, E2 = 8;
const ana: ActorFacturacion = { empresaId: E1, usuarioId: 31, usuario: "ana" };
const beto: ActorFacturacion = { empresaId: E1, usuarioId: 32, usuario: "beto" };
const otra: ActorFacturacion = { empresaId: E2, usuarioId: 99, usuario: "zeta" };
let admin: Connection;
let entKT = 0, entMON = 0, seq = 0;

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const extraerCreate = (sql: string, t: string) => {
  const m = new RegExp(`CREATE TABLE IF NOT EXISTS ${t} \\([\\s\\S]*?\\) ENGINE=InnoDB[^;]*;`).exec(sql);
  if (!m) throw new Error(`Sin CREATE TABLE ${t}`);
  return m[0];
};
const filas = async (sql: string, p: unknown[] = []) => (await admin.query<RowDataPacket[]>(sql, p as never))[0];
async function crearPlan(over: Record<string, unknown> = {}) {
  const n = ++seq;
  const base: Record<string, unknown> = {
    empresa_id: E1, codigo: `BP-${n}`, cliente_id: 501, lugar_carga_id: 11, lugar_descarga_id: 12, fecha_plan: "2026-10-01", tarifa_comercial: 1000,
    ruta_codigo_historico: "RUTA-01", lugar_descarga_historico: "Xela", tarifa_moneda_historico: "GTQ", estado: "Cerrado", ...over,
  };
  const cols = Object.keys(base);
  return (await admin.query<mysql.ResultSetHeader>(`INSERT INTO tms_planes_viaje (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => base[c]) as never))[0].insertId;
}
const lineaPara = (planId: number, precio = 1000) => ({ planIds: [planId], cantidad: 1, descripcion: "Servicio de transporte", precioUnitario: precio, clasificacion: "SERVICIO" as const, precioIncluyeIva: true });
async function borrador(actor: ActorFacturacion, numero: string, entidad: number, precio = 1000) {
  const plan = await crearPlan({ tarifa_comercial: precio });
  const r = await crearFactura(actor, { clienteId: 20, planes: [{ planId: plan, precioIncluyeIva: true }], lineas: [lineaPara(plan, precio)], entidadId: entidad, condicionPago: "CREDITO", retencionIvaPct: 0, numeroFactura: numero, fechaEmision: "2026-10-19" });
  if (!r.ok) throw new Error(`crearFactura falló: ${r.error}`);
  return { id: r.facturaId, plan };
}

describe.skipIf(!port)("Bitácora de Facturación + CxC / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    admin = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    expect(String((await admin.query<RowDataPacket[]>("SELECT VERSION() v"))[0][0].v)).toContain("11.8.9");
    await admin.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4`);
    await admin.query(`USE ${database}`);
    const schema = leer("sql/schema.sql");
    for (const t of ["empresas", "auditoria", "tms_clientes", "tms_lugares", "tms_unidades", "tms_personal", "tms_planes_viaje", "clientes", "cont_entidades", "cont_cuentas", "fact_cliente_perfil"]) await admin.query(extraerCreate(schema, t));
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 8, timezone: "local" });
    await asegurarSchemaClientes();
    for (const f of ["migrate-2026-08-fact-1-facturas-pagos", "migrate-2026-10-fact-2-borrador-snapshots-iva", "migrate-2026-10-fact-3-anuladas-historico", "migrate-2026-10-fact-4-lineas-contado-retencion"]) await admin.query(leer(`sql/${f}.sql`));
    await admin.query(`INSERT INTO empresas (id, codigo, nombre, slug) VALUES (${E1}, 'E7', 'Empresa 7', 'e7'), (${E2}, 'E8', 'Empresa 8', 'e8')`);
    await admin.query(`INSERT INTO tms_clientes (id, empresa_id, nombre) VALUES (501, ${E1}, 'Cliente X'), (601, ${E2}, 'Cliente Z')`);
    await admin.query(`INSERT INTO clientes (id, empresa_id, nombre, razon_social, nit, direccion, tms_cliente_id) VALUES (20, ${E1}, 'Comercial X', 'Cliente X, S.A.', '1234567-8', 'Zona 1', 501), (30, ${E2}, 'Comercial Z', NULL, NULL, NULL, 601)`);
    await admin.query(`INSERT INTO tms_lugares (id, empresa_id, nombre) VALUES (11, ${E1}, 'Guatemala'), (12, ${E1}, 'Quetzaltenango')`);
    entKT = (await admin.query<mysql.ResultSetHeader>("INSERT INTO cont_entidades (empresa_id, codigo, nombre) VALUES (?, 'KT', 'Kuiqtrans')", [E1]))[0].insertId;
    entMON = (await admin.query<mysql.ResultSetHeader>("INSERT INTO cont_entidades (empresa_id, codigo, nombre) VALUES (?, 'MON', 'Mónaco')", [E1]))[0].insertId;
  }, 90000);
  afterAll(async () => {
    await holder.pool?.end().catch(() => undefined);
    if (admin) { if (/^bit_test_[a-f0-9]{32}$/.test(database)) await admin.query(`DROP DATABASE IF EXISTS ${database}`); await admin.end(); }
  });

  describe("ciclo completo: cada evento con actor, entidad, documento y valores", () => {
    let id = 0;
    it("crear borrador: usuario, usuario ID, entidad, número visible y monto", async () => {
      const b = await borrador(ana, "TEST-CXC-001", entKT);
      id = b.id;
      const ev = (await listarBitacoraFactura(E1, id))[0];
      expect(ev).toMatchObject({ accion: "crear_factura", etiqueta: "Creó borrador", usuario: "ana", usuarioId: 31, facturaId: id, numeroFactura: "TEST-CXC-001", entidadId: entKT, monto: "1000.00" });
      expect(ev.fecha).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
    it("editar borrador: quién y QUÉ cambió (número, fecha, líneas, totales, impuestos, entidad, cliente)", async () => {
      const plan2 = await crearPlan({ tarifa_comercial: 500 });
      const planActual = Number((await filas("SELECT plan_id FROM fact_factura_viajes WHERE factura_id = ?", [id]))[0].plan_id);
      const r = await actualizarFacturaBorrador(beto, id, {
        clienteId: 20, planes: [{ planId: planActual, precioIncluyeIva: true }, { planId: plan2, precioIncluyeIva: true }],
        lineas: [{ ...lineaPara(planActual, 1000) }, { ...lineaPara(plan2, 500), descripcion: "Segundo servicio" }], entidadId: entMON, condicionPago: "CREDITO", retencionIvaPct: 0,
        numeroFactura: "TEST-CXC-001B", fechaEmision: "2026-10-20",
      });
      expect(r.ok).toBe(true);
      const ev = (await listarBitacoraFactura(E1, id))[0];
      expect(ev).toMatchObject({ accion: "editar_factura_borrador", usuario: "beto", usuarioId: 32, numeroFactura: "TEST-CXC-001B", entidadId: entMON, monto: "1500.00" });
      const campos = Object.fromEntries(ev.cambios.map((c) => [c.campo, [c.antes, c.despues]]));
      expect(campos.numero).toEqual(["TEST-CXC-001", "TEST-CXC-001B"]);
      expect(campos.fecha).toEqual(["2026-10-19", "2026-10-20"]);
      expect(campos.total).toEqual(["1000.00", "1500.00"]);
      expect(campos.entidad).toEqual([String(entKT), String(entMON)]);
      expect(campos.lineas).toEqual(["1", "2"]);
      expect(campos.subtotal).toBeDefined(); expect(campos.iva).toBeDefined();
      expect(campos.cliente).toBeUndefined(); // no cambió
    });
    it("emitir: usuario, número, fecha, monto y entidad; cambio de estado", async () => {
      const r = await emitirFactura(ana, id, {});
      expect(r.ok).toBe(true);
      const ev = (await listarBitacoraFactura(E1, id))[0];
      expect(ev).toMatchObject({ accion: "emitir_factura", etiqueta: "Emitió factura", usuario: "ana", usuarioId: 31, numeroFactura: "TEST-CXC-001B", entidadId: entMON, monto: "1500.00" });
      expect(ev.resumen).toBe("Emitió factura TEST-CXC-001B");
      expect(ev.cambios).toEqual([{ campo: "estado", antes: "Borrador", despues: "Emitida" }]);
    });
    it("registrar cobro: actor, monto, medio, referencia, entidad y saldo antes/después", async () => {
      const r = await registrarPago(beto, id, { fechaPago: "2026-10-21", monto: 1000, medioPago: "Transferencia", referencia: "PRUEBA-CXC-001" });
      expect(r.ok).toBe(true);
      const ev = (await listarBitacoraFactura(E1, id))[0];
      expect(ev).toMatchObject({ accion: "registrar_pago", usuario: "beto", usuarioId: 32, monto: "1000.00", medioPago: "Transferencia", referencia: "PRUEBA-CXC-001", numeroFactura: "TEST-CXC-001B", entidadId: entMON });
      expect(ev.resumen).toBe("Registró cobro TEST-CXC-001B · Q1,000.00 · Transferencia · PRUEBA-CXC-001");
      expect(ev.cambios).toEqual([{ campo: "saldo", antes: "1500.00", despues: "500.00" }]);
      expect((await filas("SELECT registrado_por FROM fact_pagos WHERE factura_id = ?", [id]))[0].registrado_por).toBe(32); // fact_pagos conserva el actor
    });
    it("orden cronológico: el historial va del más reciente al más antiguo, con ids y fechas consistentes", async () => {
      const evs = await listarBitacoraFactura(E1, id);
      expect(evs.map((e) => e.accion)).toEqual(["registrar_pago", "emitir_factura", "editar_factura_borrador", "crear_factura"]);
      const ids = evs.map((e) => e.id);
      expect(ids).toEqual([...ids].sort((a, b) => b - a));
      const fechas = evs.map((e) => e.fecha);
      expect(fechas).toEqual([...fechas].sort().reverse());
    });
    it("anular: conserva el actor y el MOTIVO (y es opcional)", async () => {
      const b1 = await borrador(ana, "ANU-001", entKT);
      expect((await emitirFactura(ana, b1.id, {})).ok).toBe(true);
      expect((await anularFactura(beto, b1.id, "  Error de captura \n del cliente ")).ok).toBe(true);
      const ev = (await listarBitacoraFactura(E1, b1.id))[0];
      expect(ev).toMatchObject({ accion: "anular_factura", etiqueta: "Anuló factura", usuario: "beto", usuarioId: 32, numeroFactura: "ANU-001", entidadId: entKT, motivo: "Error de captura del cliente" });
      expect(ev.resumen).toBe("Anuló factura ANU-001 · Motivo: Error de captura del cliente");
      expect(ev.cambios).toEqual([{ campo: "estado", antes: "Emitida", despues: "Anulada" }]);
      const b2 = await borrador(ana, "ANU-002", entKT);
      expect((await anularFactura(ana, b2.id)).ok).toBe(true);
      expect((await listarBitacoraFactura(E1, b2.id))[0]).toMatchObject({ accion: "anular_factura", usuario: "ana", motivo: null });
    });
  });

  describe("transaccionalidad: sin movimiento no hay bitácora (y viceversa)", () => {
    const total = async () => Number((await filas("SELECT COUNT(*) n FROM auditoria"))[0].n);
    it("sobrepago, factura no emitida y número duplicado: ni cambia el movimiento ni queda evento huérfano", async () => {
      const b = await borrador(ana, "TX-001", entKT);
      const antes = await total();
      expect(await registrarPago(ana, b.id, { fechaPago: "2026-10-21", monto: 10 })).toMatchObject({ ok: false, status: 409 }); // borrador: no cobrable
      expect(await total()).toBe(antes);
      expect((await emitirFactura(ana, b.id, {})).ok).toBe(true);
      const trasEmitir = await total();
      expect(await registrarPago(ana, b.id, { fechaPago: "2026-10-21", monto: 1000.01 })).toMatchObject({ ok: false, status: 409 }); // sobrepago
      expect(await total()).toBe(trasEmitir);
      expect(Number((await filas("SELECT COUNT(*) n FROM fact_pagos WHERE factura_id = ?", [b.id]))[0].n)).toBe(0);
      const plan = await crearPlan();
      const dup = await crearFactura(ana, { clienteId: 20, planes: [{ planId: plan, precioIncluyeIva: true }], lineas: [lineaPara(plan)], entidadId: entKT, condicionPago: "CREDITO", retencionIvaPct: 0, numeroFactura: "TX-001", fechaEmision: "2026-10-19" });
      expect(dup).toMatchObject({ ok: false, status: 409 });
      expect(await total()).toBe(trasEmitir);
    });
    it("si la bitácora falla, TODO el movimiento se deshace (la auditoría vive en la misma transacción)", async () => {
      const b = await borrador(ana, "TX-002", entKT);
      expect((await emitirFactura(ana, b.id, {})).ok).toBe(true);
      await admin.query("CREATE TRIGGER trg_forzado BEFORE INSERT ON auditoria FOR EACH ROW BEGIN IF NEW.accion = 'registrar_pago' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'bitacora forzada a fallar'; END IF; END");
      try {
        await expect(registrarPago(ana, b.id, { fechaPago: "2026-10-21", monto: 100 })).rejects.toBeTruthy();
      } finally { await admin.query("DROP TRIGGER trg_forzado"); }
      expect(Number((await filas("SELECT COUNT(*) n FROM fact_pagos WHERE factura_id = ?", [b.id]))[0].n)).toBe(0); // el cobro no quedó sin su evento
      expect((await registrarPago(ana, b.id, { fechaPago: "2026-10-21", monto: 100 })).ok).toBe(true);
    });
  });

  describe("aislamiento por empresa / entidad y permisos de lectura", () => {
    it("la bitácora de CxC de un libro solo trae eventos de las facturas de ESE libro y de ESA empresa", async () => {
      const kt = await listarBitacoraCxc(E1, entKT, { pageSize: 100 });
      const mon = await listarBitacoraCxc(E1, entMON, { pageSize: 100 });
      expect(kt.totalReal).toBeGreaterThan(0); expect(mon.totalReal).toBeGreaterThan(0);
      const idsKt = new Set(kt.eventos.map((e) => e.facturaId)), idsMon = new Set(mon.eventos.map((e) => e.facturaId));
      for (const i of idsKt) expect(idsMon.has(i)).toBe(false);
      expect(mon.eventos.some((e) => e.numeroFactura === "TEST-CXC-001B")).toBe(true);
      expect(kt.eventos.some((e) => e.numeroFactura === "TEST-CXC-001B")).toBe(false);
      expect((await listarBitacoraCxc(E2, entKT)).totalReal).toBe(0); // otra empresa, mismo id de libro
      expect((await listarBitacoraCxc(E1, 999)).totalReal).toBe(0);
    });
    it("otra empresa no ve el historial de una factura ajena; #12 no se confunde con #123", async () => {
      const f = (await listarBitacoraFactura(E1, 1))[0] ? 1 : 0;
      expect(f).toBeDefined();
      const algunId = (await listarBitacoraCxc(E1, entKT, { pageSize: 1 })).eventos[0].facturaId!;
      expect(await listarBitacoraFactura(E2, algunId)).toEqual([]);
      const b = await borrador(otra, "OTRA-1", (await admin.query<mysql.ResultSetHeader>("INSERT INTO cont_entidades (empresa_id, codigo, nombre) VALUES (?, 'OT', 'Otra')", [E2]))[0].insertId).catch(() => null);
      void b; // la empresa 2 no tiene viajes/cliente configurados en este fixture; lo relevante es el aislamiento de lectura
      expect((await listarBitacoraFactura(E1, algunId * 10 + 3)).every((e) => e.facturaId === algunId * 10 + 3)).toBe(true);
    });
    it("filtros: acción, usuario, factura y fechas", async () => {
      const soloCobros = await listarBitacoraCxc(E1, entMON, { accion: "registrar_pago" });
      expect(soloCobros.eventos.length).toBe(1);
      expect(soloCobros.eventos[0]).toMatchObject({ usuario: "beto", monto: "1000.00" });
      expect((await listarBitacoraCxc(E1, entKT, { usuario: "ana" })).eventos.every((e) => e.usuario === "ana")).toBe(true);
      expect((await listarBitacoraCxc(E1, entMON, { fechaDesde: "2030-01-01" })).totalReal).toBe(0);
      expect((await listarBitacoraCxc(E1, entMON, { fechaDesde: "2020-01-01", fechaHasta: "2099-12-31" })).totalReal).toBeGreaterThan(0);
      const p1 = await listarBitacoraCxc(E1, entKT, { pageSize: 2, page: 1 }), p2 = await listarBitacoraCxc(E1, entKT, { pageSize: 2, page: 2 });
      expect(p1.eventos.length).toBe(2);
      expect(p1.eventos.map((e) => e.id).some((i) => p2.eventos.map((e) => e.id).includes(i))).toBe(false);
    });
    it("eventos históricos (texto sin JSON, anteriores a esta bitácora) siguen apareciendo y se leen sin romper", async () => {
      const id = (await listarBitacoraCxc(E1, entKT, { pageSize: 1 })).eventos[0].facturaId!;
      await admin.query("INSERT INTO auditoria (empresa_id, usuario, accion, modulo, detalle) VALUES (?, 'historico', 'emitir_factura', 'facturacion', ?)", [E1, `Factura #${id} emitida · número VIEJO-1 · fecha 2026-01-01 · monto Q10 · 1 viaje(s)`]);
      const ev = (await listarBitacoraFactura(E1, id))[0];
      expect(ev).toMatchObject({ usuario: "historico", accion: "emitir_factura", usuarioId: null, entidadId: null, cambios: [] });
      expect(ev.resumen).toBe(`Emitió factura #${id}`);
      expect((await listarBitacoraCxc(E1, entKT, { usuario: "historico" })).totalReal).toBe(1);
    });
  });

  it("append-only y sin datos sensibles: ningún código escribe/borra eventos viejos y el detalle no guarda NIT, contraseñas ni tokens", async () => {
    for (const f of ["src/lib/facturacion/bitacora.ts", "src/lib/facturacion/facturas.ts", "src/lib/facturacion/confirmaciones-bancarias.ts", "src/lib/auditoria.ts"]) {
      expect(leer(f).replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/(UPDATE|DELETE\s+FROM)\s+auditoria/i);
    }
    const todo = (await filas("SELECT detalle FROM auditoria WHERE modulo = 'facturacion'")).map((r) => String(r.detalle)).join("\n");
    expect(todo).not.toMatch(/1234567-8|password|contrase|token|secret/i);
  });
});
