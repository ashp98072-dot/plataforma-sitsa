import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { requireTenantRrhh } from "@/lib/tenant";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { DELETE, PATCH } from "./route";

/**
 * RRHH-PRESTACIONES-CODIGO-CONCEPTO — PATCH permite cambiar/asignar
 * codigoConcepto (nunca borrarlo a null) y audita antes/después dentro de
 * la misma transacción. DELETE/anulación NUNCA toca codigo_concepto —
 * solo reescribe tipo/notas/monto, igual que ya hacía antes de este PR.
 */

type Ctx = { params: Promise<{ slug: string; id: string }> };
const ctx: Ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };
const req = (method: string, body: unknown) =>
  new Request("https://local.test", {
    method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });

const conn = {
  beginTransaction: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};

const patchValido = { empleadoId: 7, tipo: "Bonificación anual julio", codigoConcepto: "BONO_14", monto: 500, fecha: "2026-09-01" };

function filaAntes(overrides: Partial<Record<string, unknown>> = {}) {
  return { tipo: "Bonificación anual julio", codigo_concepto: "AGUINALDO", monto: "500.00", fecha: "2026-09-01", ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 3 }, session: { username: "rrhh" } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  conn.query.mockResolvedValue([[filaAntes()], []]);
  conn.execute.mockResolvedValue([{ affectedRows: 1 }, []]);
});

describe("PATCH rrhh/prestaciones/[id] — codigoConcepto", () => {
  it("7. cambia un código válido por otro (AGUINALDO -> BONO_14)", async () => {
    const response = await PATCH(req("PATCH", patchValido), ctx);
    expect(response.status).toBe(200);
    expect(conn.execute).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["BONO_14"]));
  });

  it("8. código inválido -> 400, sin transacción", async () => {
    const response = await PATCH(req("PATCH", { ...patchValido, codigoConcepto: "INVENTADO" }), ctx);
    expect(response.status).toBe(400);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("9. histórico con codigo_concepto NULL: permite asignar un código explícito", async () => {
    conn.query.mockResolvedValue([[filaAntes({ codigo_concepto: null })], []]);
    const response = await PATCH(req("PATCH", patchValido), ctx);
    expect(response.status).toBe(200);
    expect(conn.execute).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["BONO_14"]));
  });

  it("10. no permite enviar codigoConcepto: null para borrar un código ya asignado", async () => {
    const response = await PATCH(req("PATCH", { ...patchValido, codigoConcepto: null }), ctx);
    expect(response.status).toBe(400);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("11. cambiar `tipo` sin enviar codigoConcepto NO cambia el código (COALESCE conserva el existente)", async () => {
    const { codigoConcepto: _omitido, ...sinCodigo } = patchValido;
    conn.query.mockResolvedValue([[filaAntes({ codigo_concepto: "COMISION" })], []]);
    const response = await PATCH(req("PATCH", { ...sinCodigo, tipo: "Nuevo label distinto" }), ctx);
    expect(response.status).toBe(200);
    // El parámetro de codigo_concepto pasado al UPDATE es NULL (COALESCE lo deja igual), no un texto inferido de `tipo`.
    const params = conn.execute.mock.calls[0][1] as unknown[];
    expect(params).toContain(null);
    expect(params).not.toContain("COMISION"); // no se reenvía el valor actual como si fuera nuevo: se deja que el propio SQL lo conserve.
  });

  it("14. PATCH audita antes/después dentro de la misma transacción, antes del commit", async () => {
    await PATCH(req("PATCH", patchValido), ctx);
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({
      empresaId: 3, usuario: "rrhh", accion: "editar_prestacion_rrhh", modulo: "rrhh",
    }));
    const detalle = JSON.parse(vi.mocked(registrarAuditoriaTx).mock.calls[0][1].detalle as string);
    expect(detalle.prestacionId).toBe(10);
    expect(detalle.antes).toMatchObject({ codigoConcepto: "AGUINALDO" });
    expect(detalle.despues).toMatchObject({ codigoConcepto: "BONO_14" });
    expect(vi.mocked(registrarAuditoriaTx).mock.invocationCallOrder[0]).toBeLessThan(conn.commit.mock.invocationCallOrder[0]);
  });

  it("16. tenant isolation: la fila 'antes' y el UPDATE filtran por empresa_id de la sesión", async () => {
    await PATCH(req("PATCH", patchValido), ctx);
    expect(conn.query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), [10, 3]);
    expect(conn.execute).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([10, 3]));
  });

  it("bloqueado (período Generada/Cerrada o anulada): revierte y no audita", async () => {
    conn.execute.mockResolvedValue([{ affectedRows: 0 }, []]);
    vi.mocked(query).mockResolvedValue([{ tipo: "Bonificación anual julio", en_planilla: 1 }] as never);
    const response = await PATCH(req("PATCH", patchValido), ctx);
    expect(response.status).toBe(409);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });
});

describe("DELETE (anulación) rrhh/prestaciones/[id] — preserva codigo_concepto", () => {
  it("12. anular preserva codigo_concepto aunque `tipo` cambie a 'Anulada · ...'", async () => {
    conn.query.mockResolvedValue([[{ codigo_concepto: "BONO_14" }], []]);
    const response = await DELETE(req("DELETE", { motivo: "Registrado por error" }), ctx);
    expect(response.status).toBe(200);
    // El UPDATE de anulación nunca menciona codigo_concepto en su SET.
    const [sql] = conn.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain("codigo_concepto");
  });

  it("15. anular genera auditoría con codigoConcepto preservado y motivo", async () => {
    conn.query.mockResolvedValue([[{ codigo_concepto: "BONO_14" }], []]);
    await DELETE(req("DELETE", { motivo: "Registrado por error" }), ctx);
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({
      empresaId: 3, usuario: "rrhh", accion: "anular_prestacion_rrhh", modulo: "rrhh",
    }));
    const detalle = JSON.parse(vi.mocked(registrarAuditoriaTx).mock.calls[0][1].detalle as string);
    expect(detalle).toMatchObject({ prestacionId: 10, codigoConcepto: "BONO_14", motivo: "Registrado por error" });
  });

  it("16. tenant isolation: la anulación filtra por empresa_id de la sesión", async () => {
    conn.query.mockResolvedValue([[{ codigo_concepto: null }], []]);
    await DELETE(req("DELETE", { motivo: "Registrado por error" }), ctx);
    expect(conn.query).toHaveBeenCalledWith(expect.any(String), [10, 3]);
    expect(conn.execute).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([10, 3]));
  });

  it("motivo inválido -> 400, sin transacción", async () => {
    const response = await DELETE(req("DELETE", { motivo: "no" }), ctx);
    expect(response.status).toBe(400);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("ya anulada: revierte y no audita de nuevo", async () => {
    conn.query.mockResolvedValue([[{ codigo_concepto: "BONO_14" }], []]);
    conn.execute.mockResolvedValue([{ affectedRows: 0 }, []]);
    vi.mocked(query).mockResolvedValue([{ tipo: "Anulada · Bonificación anual julio", en_planilla: 0 }] as never);
    const response = await DELETE(req("DELETE", { motivo: "Registrado por error" }), ctx);
    expect(response.status).toBe(409);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });
});
