import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/auth", () => ({ verificarPasswordUsuarioActual: vi.fn() }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn(), TEXTO_FIRMA_INTERNA: "Firma electrónica interna" }));

import { execute, getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { verificarPasswordUsuarioActual } from "@/lib/auth";
import { crearFirmaInterna } from "@/lib/firmas/firmas-internas";
import {
  autorizarViatico,
  liquidarViatico,
  registrarEntregaViatico,
  type DatosFirmaViatico,
} from "./viaticos";

/**
 * VIATICOS-FIRMA — pruebas de autorizarViatico/liquidarViatico
 * (transición + firma electrónica interna + auditoría, todo en la misma
 * transacción). registrarEntregaViatico (pago) queda deliberadamente SIN
 * firma — ver ticket, sección PAGO — y NO se modificó en este ticket; se
 * incluye una prueba de regresión mínima (23) para dejar constancia de
 * que sigue sin exigir contraseña.
 */

const conn = {
  beginTransaction: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
const getConnection = vi.fn();

const firma: DatosFirmaViatico = {
  usuarioId: 3,
  nombreFirmante: "Ana López",
  rolFirmante: "JefeOperaciones",
  password: "correcta123",
};

const VIATICO_PROGRAMADO = { id: 10, plan_id: 1, personal_id: 5, monto_asignado: "500.00", estado: "PROGRAMADO" };
const VIATICO_ENTREGADO = { id: 10, monto_asignado: "1000.00", estado: "ENTREGADO" };
const CTX_AUTORIZAR = { plan_codigo: "PLAN-1", personal_nombre: "Carlos Ruiz" };

type Overrides = {
  viatico?: Record<string, unknown> | null;
  ctx?: Record<string, unknown> | null;
};

function mockConnQuery(o: Overrides = {}) {
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM tms_viaticos WHERE id = ? AND empresa_id = ?")) {
      const v = "viatico" in o ? o.viatico : VIATICO_PROGRAMADO;
      return [v ? [v] : []];
    }
    if (sql.includes("FROM tms_planes_viaje pl, tms_personal tp")) {
      const c = "ctx" in o ? o.ctx : CTX_AUTORIZAR;
      return [c ? [c] : []];
    }
    throw new Error(`Consulta inesperada: ${sql}`);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection } as unknown as ReturnType<typeof getPool>);
  getConnection.mockResolvedValue(conn);
  conn.execute.mockResolvedValue([{ affectedRows: 1 }, []]);
  vi.mocked(verificarPasswordUsuarioActual).mockResolvedValue(true);
  vi.mocked(crearFirmaInterna).mockResolvedValue({
    id: 1, codigoFirma: "SIG-20260828-ABCD1234", fechaHoraServidor: new Date("2026-08-28T15:00:00Z"),
    hashPayload: "a".repeat(64), nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones",
  });
  mockConnQuery();
});
afterEach(() => vi.restoreAllMocks());

describe("autorizarViatico — PROGRAMADO -> AUTORIZADO con firma", () => {
  it("5) contraseña incorrecta: 401, NO crea firma, NO cambia estado (ningún UPDATE), NO registra auditoría transaccional — nunca abre la transacción", async () => {
    vi.mocked(verificarPasswordUsuarioActual).mockResolvedValue(false);
    const r = await autorizarViatico(7, 10, "jefe1", firma);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(401); expect(r.error).toContain("Contraseña incorrecta"); }
    expect(getConnection).not.toHaveBeenCalled();
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(conn.execute).not.toHaveBeenCalled(); // ningún UPDATE de estado
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("6) autorización EXITOSA crea la firma con accion=AUTORIZAR_VIATICO/modulo=VIATICOS/entidad_tipo=VIATICO", async () => {
    const r = await autorizarViatico(7, 10, "jefe1", firma);
    expect(r.ok).toBe(true);
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
      empresaId: 7, usuarioId: 3, accion: "AUTORIZAR_VIATICO", modulo: "VIATICOS",
      entidadTipo: "VIATICO", entidadId: 10,
      valoresRelevantes: expect.objectContaining({ viaticoId: 10, planId: 1, beneficiario: "Carlos Ruiz", montoAsignado: 500 }),
    }));
  });

  it("estado != PROGRAMADO rechaza (409) sin firmar", async () => {
    mockConnQuery({ viatico: { ...VIATICO_PROGRAMADO, estado: "AUTORIZADO" } });
    const r = await autorizarViatico(7, 10, "jefe1", firma);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("18) firma + transición + auditoría son atómicas: se hace commit UNA sola vez y solo tras firmar", async () => {
    await autorizarViatico(7, 10, "jefe1", firma);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    // La auditoría se registra DENTRO de la misma conexión/transacción (registrarAuditoriaTx con conn), nunca aparte.
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({
      empresaId: 7, accion: "autorizar_viatico", modulo: "tms",
    }));
  });

  it("20) el detalle de auditoría incluye el código de firma (trazabilidad cruzada)", async () => {
    await autorizarViatico(7, 10, "jefe1", firma);
    const detalle = vi.mocked(registrarAuditoriaTx).mock.calls[0][1].detalle;
    expect(detalle).toContain("SIG-20260828-ABCD1234");
  });

  it("viático inexistente -> 404, sin firmar", async () => {
    mockConnQuery({ viatico: null });
    const r = await autorizarViatico(7, 999, "jefe1", firma);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
    expect(crearFirmaInterna).not.toHaveBeenCalled();
  });
});

describe("liquidarViatico — ENTREGADO -> LIQUIDADO, regla crítica de diferencia === 0 exacto", () => {
  const firmaFacturador: DatosFirmaViatico = { usuarioId: 8, nombreFirmante: "Marta Ruiz", rolFirmante: "Facturador", password: "clave456" };

  it("11) gastos 900 + reintegro 100 sobre entregado 1000 -> diferencia 0, SÍ liquida", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    const r = await liquidarViatico(7, 10, { gastosComprobados: "900.00", reintegro: "100.00", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(true);
  });

  it("12) gastos 1000 + reintegro 0 sobre entregado 1000 -> diferencia 0, SÍ liquida", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    const r = await liquidarViatico(7, 10, { gastosComprobados: "1000.00", reintegro: "0", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(true);
  });

  it("13) gastos 950 + reintegro 0 sobre entregado 1000 -> diferencia 50 (pendiente), NO liquida, estado sigue ENTREGADO", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    const r = await liquidarViatico(7, 10, { gastosComprobados: "950.00", reintegro: "0", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("Pendiente por comprobar o reintegrar: Q50.00"); }
    expect(conn.execute).not.toHaveBeenCalled(); // ningún UPDATE se ejecutó
    expect(crearFirmaInterna).not.toHaveBeenCalled();
  });

  it("14) gastos 1000 + reintegro 100 sobre entregado 1000 -> diferencia -100, NO liquida (superan lo entregado)", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    const r = await liquidarViatico(7, 10, { gastosComprobados: "1000.00", reintegro: "100.00", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("superan el monto entregado"); }
  });

  it("15) decisión monetaria EXACTA, no float: 300.30 - 100.10 - 200.20 = 0.00 exacto (un float directo puede dar un residuo distinto de 0)", async () => {
    mockConnQuery({ viatico: { ...VIATICO_ENTREGADO, monto_asignado: "300.30" } });
    // Prueba de control: la resta directa en float NO da exactamente 0 —
    // confirma que el caso realmente ejercita el camino "exacto".
    expect(300.30 - 100.10 - 200.20).not.toBe(0);
    const r = await liquidarViatico(7, 10, { gastosComprobados: "100.10", reintegro: "200.20", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(true);
  });

  it("16) liquidación EXITOSA crea la firma con accion=LIQUIDAR_VIATICO y el payload con montoEntregado/gastos/reintegro/diferencia", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    await liquidarViatico(7, 10, { gastosComprobados: "900.00", reintegro: "100.00", observaciones: "ok" }, "fact1", firmaFacturador);
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
      accion: "LIQUIDAR_VIATICO", modulo: "VIATICOS", entidadTipo: "VIATICO", entidadId: 10,
      valoresRelevantes: expect.objectContaining({
        viaticoId: 10, montoEntregado: "1000.00", gastosComprobados: "900.00", reintegro: "100.00", diferencia: "0.00",
      }),
    }));
  });

  it("17) doble liquidación bloqueada: el segundo intento ya no encuentra ENTREGADO -> 409, sin nueva firma", async () => {
    mockConnQuery({ viatico: { ...VIATICO_ENTREGADO, estado: "LIQUIDADO" } });
    const r = await liquidarViatico(7, 10, { gastosComprobados: "1000.00", reintegro: "0", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(crearFirmaInterna).not.toHaveBeenCalled();
  });

  it("18) atomicidad: commit único tras firmar, rollback si la diferencia no es 0", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    await liquidarViatico(7, 10, { gastosComprobados: "950.00", reintegro: "0", observaciones: null }, "fact1", firmaFacturador);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("monto/formato inválido se rechaza ANTES de verificar contraseña o abrir conexión", async () => {
    const r = await liquidarViatico(7, 10, { gastosComprobados: "no-es-numero", reintegro: "0", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(verificarPasswordUsuarioActual).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("5) contraseña incorrecta: 401, NO crea firma, NO cambia estado, NO registra auditoría transaccional — nunca abre la transacción", async () => {
    vi.mocked(verificarPasswordUsuarioActual).mockResolvedValue(false);
    const r = await liquidarViatico(7, 10, { gastosComprobados: "900.00", reintegro: "100.00", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(401); expect(r.error).toContain("Contraseña incorrecta"); }
    expect(getConnection).not.toHaveBeenCalled();
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(conn.execute).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe("23) registrarEntregaViatico (pago) — regresión: NUNCA exige firma/contraseña", () => {
  beforeEach(() => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as never);
  });

  it("registra la entrega solo con método/referencia/observaciones — sin password ni firma en su firma de función", async () => {
    const r = await registrarEntregaViatico(7, 10, { metodoPago: "EFECTIVO", referenciaPago: null, observaciones: null }, "fact1");
    expect(r.ok).toBe(true);
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(verificarPasswordUsuarioActual).not.toHaveBeenCalled();
    // No usa transacción propia (execute() directo) — mismo patrón preexistente, sin cambios de este ticket.
    expect(getConnection).not.toHaveBeenCalled();
  });

  it('exige referencia para TRANSFERENCIA/CHEQUE (regla preexistente, sin cambios)', async () => {
    const r = await registrarEntregaViatico(7, 10, { metodoPago: "CHEQUE", referenciaPago: null, observaciones: null }, "fact1");
    expect(r.ok).toBe(false);
  });
});
