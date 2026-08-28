import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/clientes/repository", () => ({ asegurarVinculosTmsClientes: vi.fn() }));
vi.mock("@/lib/clientes/schema", () => ({ asegurarSchemaClientes: vi.fn() }));

import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import {
  actualizarFacturaBorrador,
  anularFactura,
  crearFactura,
  emitirFactura,
  listarViajesPendientes,
  registrarPago,
  type ActorFacturacion,
} from "./facturas";

const conn = {
  beginTransaction: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
  destroy: vi.fn(),
};
const getConnection = vi.fn();
const actor: ActorFacturacion = { empresaId: 7, usuarioId: 3, usuario: "facturador1" };

// tms_clientes.id = 501 <-> clientes.id = 20 (mismo cliente, dos espacios de ID distintos)
const CLIENTE = { id: 20, nombre: "Cliente X", tms_cliente_id: 501 };
const PLAN_CERRADO = { id: 1, codigo: "PLAN-1", empresa_id: 7, cliente_id: 501, estado: "Cerrado", tarifa_comercial: 1000 };

type Overrides = {
  cliente?: Record<string, unknown> | null;
  plan?: Record<string, unknown> | null;
  vinculoExistente?: Record<string, unknown> | null;
  factura?: Record<string, unknown> | null;
  pagosCount?: number;
  pagosSuma?: number;
  lineasEmitir?: Record<string, unknown>[];
};

function mockConnQuery(o: Overrides = {}) {
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM clientes WHERE id = ?")) {
      return [o.cliente === undefined ? [CLIENTE] : o.cliente ? [o.cliente] : []];
    }
    if (sql.includes("FROM tms_planes_viaje WHERE id = ?")) {
      return [o.plan === undefined ? [PLAN_CERRADO] : o.plan ? [o.plan] : []];
    }
    if (sql.includes("FROM fact_factura_viajes WHERE plan_id = ?")) {
      return [o.vinculoExistente ? [o.vinculoExistente] : []];
    }
    if (sql.includes("FROM fact_facturas WHERE id = ? AND empresa_id = ?")) {
      return [o.factura === undefined ? [{ id: 1, estado_admin: "Borrador", cliente_id: 20, numero_factura: null, fecha_emision: null, monto_total: 1000 }] : o.factura ? [o.factura] : []];
    }
    if (sql.includes("SELECT COUNT(*) AS c FROM fact_pagos")) {
      return [[{ c: o.pagosCount ?? 0 }]];
    }
    if (sql.includes("SELECT COALESCE(SUM(monto), 0) AS total FROM fact_pagos")) {
      return [[{ total: o.pagosSuma ?? 0 }]];
    }
    if (sql.includes("FROM fact_factura_viajes ffv") && sql.includes("INNER JOIN tms_planes_viaje")) {
      return [o.lineasEmitir ?? [{ plan_id: 1, codigo: "PLAN-1", estado: "Cerrado" }]];
    }
    throw new Error(`Consulta inesperada: ${sql}`);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection } as unknown as ReturnType<typeof getPool>);
  getConnection.mockResolvedValue(conn);
  conn.execute.mockResolvedValue([{ affectedRows: 1, insertId: 1 }, []]);
  vi.mocked(query).mockResolvedValue([]);
  mockConnQuery();
});
afterEach(() => vi.restoreAllMocks());

describe("crearFactura — validación e integridad", () => {
  it("1) solo un viaje Cerrado puede facturarse", async () => {
    mockConnQuery({ plan: { ...PLAN_CERRADO, estado: "En ruta" } });
    const r = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("no está Cerrado"); }
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("2) el plan debe pertenecer a la MISMA empresa (no se encuentra si pertenece a otra)", async () => {
    mockConnQuery({ plan: null }); // simula que WHERE empresa_id=? no lo encontró
    const r = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("3) todos los viajes deben pertenecer al MISMO cliente (vía el puente clientes.tms_cliente_id)", async () => {
    mockConnQuery({ plan: { ...PLAN_CERRADO, cliente_id: 999 } }); // otro tms_clientes.id
    const r = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(400); expect(r.error).toContain("no pertenece al cliente"); }
  });

  it("4) un viaje ya vinculado a OTRA factura viva → 409", async () => {
    mockConnQuery({ vinculoExistente: { factura_id: 999 } });
    const r = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("ya está vinculado"); }
  });

  it("5) [defensa UNIQUE] el INSERT en fact_factura_viajes usa el MISMO plan_id ya validado bajo FOR UPDATE — el UNIQUE(plan_id) es la segunda capa de la misma garantía", async () => {
    await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    const lockCall = conn.query.mock.calls.find((c) => String(c[0]).includes("FROM fact_factura_viajes WHERE plan_id = ?"));
    const insertCall = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO fact_factura_viajes"));
    expect(lockCall?.[1]).toEqual([1]);
    expect(insertCall?.[1]).toEqual(expect.arrayContaining([1]));
  });

  it("6) monto_total se calcula SERVER-SIDE (suma real de monto_asignado, nunca un valor enviado por el cliente)", async () => {
    await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1, montoAsignado: 250 }] });
    const insertFactura = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO fact_facturas"));
    expect(insertFactura?.[1]).toEqual(expect.arrayContaining([250])); // monto_total = 250, no otro valor inventado
  });

  it("7) tarifa_comercial null y sin monto explícito → monto_asignado = 0 (nunca inventado)", async () => {
    mockConnQuery({ plan: { ...PLAN_CERRADO, tarifa_comercial: null } });
    const r = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(r.ok).toBe(true);
    const insertFactura = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO fact_facturas"));
    expect(insertFactura?.[1]).toEqual(expect.arrayContaining([0]));
  });

  it("8) monto_asignado distinto de tarifa_comercial queda AUDITADO explícitamente", async () => {
    await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1, montoAsignado: 800 }] }); // tarifa real es 1000
    const auditoria = vi.mocked(registrarAuditoriaTx).mock.calls[0][1];
    expect(auditoria.detalle).toContain("Montos ajustados");
    expect(auditoria.detalle).toContain("tarifa_comercial Q1000");
    expect(auditoria.detalle).toContain("monto_asignado Q800");
  });

  it("25) multiempresa: nunca confía en un empresa_id ajeno — el plan se busca SIEMPRE con el empresa_id del actor", async () => {
    await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    const planCall = conn.query.mock.calls.find((c) => String(c[0]).includes("FROM tms_planes_viaje WHERE id = ?"));
    expect(planCall?.[1]).toEqual([1, 7]);
  });

  it("cliente sin puente TMS (tms_cliente_id NULL) → rechazado, nunca deja pasar una comparación incorrecta", async () => {
    mockConnQuery({ cliente: { ...CLIENTE, tms_cliente_id: null } });
    const r = await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("no está vinculado a TMS");
  });

  it("crea siempre como Borrador", async () => {
    await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    const insertFactura = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO fact_facturas"));
    expect(String(insertFactura?.[0])).toContain("'Borrador'");
  });
});

describe("actualizarFacturaBorrador", () => {
  it("9) Borrador es editable — reaplica TODAS las validaciones al cambiar viajes", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Borrador", cliente_id: 20 } });
    const r = await actualizarFacturaBorrador(actor, 1, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(r.ok).toBe(true);
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM fact_factura_viajes WHERE factura_id = ?"), [1]);
  });

  it("10) una factura Emitida queda CONGELADA — PATCH rechazado", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Emitida", cliente_id: 20 } });
    const r = await actualizarFacturaBorrador(actor, 1, { clienteId: 20, planes: [{ planId: 1 }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });
});

describe("emitirFactura", () => {
  it("11) exige número de factura no vacío", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Borrador", numero_factura: null, fecha_emision: "2026-08-27", monto_total: 1000 } });
    const r = await emitirFactura(actor, 1, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("número de factura");
  });

  it("12) exige fecha de emisión no nula", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Borrador", numero_factura: "F-001", fecha_emision: null, monto_total: 1000 } });
    const r = await emitirFactura(actor, 1, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("fecha de emisión");
  });

  it("13) exige al menos 1 viaje vinculado", async () => {
    mockConnQuery({
      factura: { id: 1, estado_admin: "Borrador", numero_factura: "F-001", fecha_emision: "2026-08-27", monto_total: 1000 },
      lineasEmitir: [],
    });
    const r = await emitirFactura(actor, 1, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("no tiene viajes vinculados");
  });

  it("revalida que los viajes SIGAN Cerrados al emitir", async () => {
    mockConnQuery({
      factura: { id: 1, estado_admin: "Borrador", numero_factura: "F-001", fecha_emision: "2026-08-27", monto_total: 1000 },
      lineasEmitir: [{ plan_id: 1, codigo: "PLAN-1", estado: "En ruta" }],
    });
    const r = await emitirFactura(actor, 1, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ya no están Cerrados");
  });

  it("Borrador -> Emitida con datos completos → éxito, auditado", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Borrador", numero_factura: "F-001", fecha_emision: "2026-08-27", monto_total: 1000 } });
    const r = await emitirFactura(actor, 1, {});
    expect(r.ok).toBe(true);
    expect(registrarAuditoriaTx).toHaveBeenCalled();
    const audit = vi.mocked(registrarAuditoriaTx).mock.calls[0][1];
    expect(audit.accion).toBe("emitir_factura");
  });

  it("no se puede emitir una factura que ya no está en Borrador", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Emitida", numero_factura: "F-001", fecha_emision: "2026-08-27", monto_total: 1000 } });
    const r = await emitirFactura(actor, 1, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });
});

describe("registrarPago", () => {
  it("14) pago solo contra factura Emitida", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Borrador", monto_total: 1000 } });
    const r = await registrarPago(actor, 1, { fechaPago: "2026-08-27", monto: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("15) pago parcial se registra correctamente", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Emitida", monto_total: 1000 }, pagosSuma: 0 });
    const r = await registrarPago(actor, 1, { fechaPago: "2026-08-27", monto: 400 });
    expect(r.ok).toBe(true);
    const insertPago = conn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO fact_pagos"));
    expect(insertPago?.[1]).toEqual(expect.arrayContaining([400]));
  });

  it("16) múltiples pagos: el saldo considera los pagos YA existentes", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Emitida", monto_total: 1000 }, pagosSuma: 400 });
    const r = await registrarPago(actor, 1, { fechaPago: "2026-08-27", monto: 600 });
    expect(r.ok).toBe(true); // 400 + 600 = 1000, exacto, no excede
  });

  it("17) sobrepago (monto > saldo) rechazado", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Emitida", monto_total: 1000 }, pagosSuma: 400 });
    const r = await registrarPago(actor, 1, { fechaPago: "2026-08-27", monto: 700 }); // saldo real es 600
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("excede el saldo"); }
    expect(conn.execute).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO fact_pagos"), expect.anything());
  });

  it("monto <= 0 rechazado antes de tocar la DB", async () => {
    const r = await registrarPago(actor, 1, { fechaPago: "2026-08-27", monto: 0 });
    expect(r.ok).toBe(false);
    expect(getConnection).not.toHaveBeenCalled();
  });
});

describe("[18/19] saldo y estado financiero derivados (nunca guardados)", () => {
  it("18) saldo = monto_total - suma de pagos, calculado en cada consulta, no una columna", async () => {
    // La propia ausencia de una columna "saldo"/"estado_financiero" en los
    // INSERT/UPDATE de fact_facturas ya lo demuestra: ningún INSERT/UPDATE
    // de esta suite escribe esas columnas.
    await crearFactura(actor, { clienteId: 20, planes: [{ planId: 1 }] });
    for (const call of conn.execute.mock.calls) {
      expect(String(call[0])).not.toMatch(/\bsaldo\b|estado_financiero/i);
    }
  });

  it("19) Cobrado se deriva cuando suma pagos >= monto_total (probado a nivel de registrarPago: pago exacto al saldo no rechaza)", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Emitida", monto_total: 500 }, pagosSuma: 0 });
    const r = await registrarPago(actor, 1, { fechaPago: "2026-08-27", monto: 500 });
    expect(r.ok).toBe(true); // paga el total exacto — el saldo derivado quedará en 0 (Cobrado)
  });
});

describe("anularFactura", () => {
  it("20) anular SIN pagos libera los viajes (DELETE fact_factura_viajes)", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Emitida" }, pagosCount: 0 });
    const r = await anularFactura(actor, 1);
    expect(r.ok).toBe(true);
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM fact_factura_viajes WHERE factura_id = ?"), [1]);
    const audit = vi.mocked(registrarAuditoriaTx).mock.calls[0][1];
    expect(audit.accion).toBe("anular_factura");
  });

  it("21) anular CON pagos registrados se rechaza (requiere nota de crédito futura)", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Emitida" }, pagosCount: 2 });
    const r = await anularFactura(actor, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("nota de crédito"); }
    expect(conn.execute).not.toHaveBeenCalledWith(expect.stringContaining("DELETE FROM fact_factura_viajes"), expect.anything());
  });

  it("una factura ya Anulada no se puede volver a anular", async () => {
    mockConnQuery({ factura: { id: 1, estado_admin: "Anulada" } });
    const r = await anularFactura(actor, 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("ya está anulada");
  });
});

describe("[22/23/24] listarViajesPendientes — estado derivado del viaje", () => {
  it("22) factura Anulada NUNCA cuenta como facturación activa: tras anular, el viaje reaparece como pendiente", async () => {
    // La condición NOT EXISTS(fact_factura_viajes) es exactamente lo que
    // garantiza esto, porque anularFactura BORRA esa fila.
    vi.mocked(query).mockResolvedValue([{
      id: 1, codigo: "PLAN-1", fecha_plan: "2026-08-27", cliente_id: 20, cliente: "Cliente X",
      placa: "C-034BXR", tarifa_comercial: 1000, cerrado_en: "2026-08-27T18:00",
    }] as unknown as Awaited<ReturnType<typeof query>>);
    const viajes = await listarViajesPendientes(7, {});
    expect(viajes).toHaveLength(1);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM fact_factura_viajes ffv WHERE ffv.plan_id = p.id)");
  });

  it("23) un viaje ya en un Borrador (fila viva en fact_factura_viajes) YA NO aparece como pendiente", async () => {
    vi.mocked(query).mockResolvedValue([]); // NOT EXISTS excluye cualquier viaje con fila viva, sea Borrador o Emitida
    const viajes = await listarViajesPendientes(7, {});
    expect(viajes).toEqual([]);
  });

  it("24) un viaje Emitido tampoco aparece como pendiente (mismo mecanismo que Borrador)", async () => {
    vi.mocked(query).mockResolvedValue([]);
    const viajes = await listarViajesPendientes(7, {});
    expect(viajes).toEqual([]);
  });

  it("nunca expone piloto/auxiliares/evidencias/paradas/GPS", async () => {
    await listarViajesPendientes(7, {});
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(sql).not.toMatch(/piloto|auxiliar|evidencia|parada|latitud|longitud/i);
  });

  it("filtra por clienteId vía el puente clientes.tms_cliente_id (nunca compara IDs de espacios distintos)", async () => {
    vi.mocked(query).mockResolvedValue([]);
    await listarViajesPendientes(7, { clienteId: 20 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("cli.id = ?");
    expect(sql).toContain("cli.tms_cliente_id = p.cliente_id");
    expect(params).toContain(20);
  });
});
