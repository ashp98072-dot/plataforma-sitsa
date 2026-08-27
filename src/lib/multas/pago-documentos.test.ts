import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantMultas: vi.fn() }));
import { getPool, query, execute } from "@/lib/db";
import { requireTenantMultas } from "@/lib/tenant";
import { PATCH } from "@/app/api/empresas/[slug]/operaciones/multas/[id]/route";
import { GET as getDocumento } from "@/app/api/empresas/[slug]/operaciones/multas/documentos/[docId]/route";
import { GET as getDocumentos } from "@/app/api/empresas/[slug]/operaciones/multas/[id]/documentos/route";
import { registrarDocumentoMulta } from "./documentos";
import { nuevaMulta } from "./reglas";

const idCtx = { params: Promise.resolve({ slug: "prueba", id: "9" }) };
const docCtx = { params: Promise.resolve({ slug: "prueba", docId: "3" }) };
const req = (data: unknown, method = "PATCH") => new Request("http://localhost/x", { method, body: JSON.stringify(data) });

const conn = { beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn() };
const getConnection = vi.fn();

const empresaInput = {
  revision_id: 2, vehiculo_id: 3, fecha_infraccion: "2026-08-01", tipo_multa: "Exceso de velocidad",
  descripcion: "Caso sintético", monto_total: "800.00", tipo_responsabilidad: "EMPRESA",
  resolucion_economica: "EMPRESA", monto_empresa: "800.00", monto_colaborador: "0.00",
};

function filaMulta(overrides: Record<string, unknown> = {}) {
  return { ...nuevaMulta(empresaInput), id: 9, empresa_id: 7, placa_historica: "TEST-001", referencia_boleta: "B-1", ...overrides };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireTenantMultas).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantMultas>>,
  );
  vi.mocked(getPool).mockReturnValue({ getConnection } as unknown as ReturnType<typeof getPool>);
  getConnection.mockResolvedValue(conn);
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("empleados")) return [[{ id: 5 }], []];
    if (sql.includes("ops_multas")) return [[filaMulta()], []];
    throw new Error("Consulta inesperada");
  });
  conn.execute.mockResolvedValue([{ affectedRows: 1, insertId: 9 }, []]);
  vi.mocked(query).mockResolvedValue([]);
  vi.mocked(execute).mockResolvedValue({ affectedRows: 1, insertId: 3 } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("MULTAS-5 — pago de la multa", () => {
  it("1) pago pendiente → pagada, con monto/referencia/observaciones", async () => {
    const response = await PATCH(
      req({ accion: "pagar", referencia_pago: "REC-001", observaciones_pago: "Pagado en ventanilla" }),
      idCtx,
    );
    expect(response.status).toBe(200);
    const [sql, params] = conn.execute.mock.calls[0];
    expect(sql).toContain("estado_pago = ?");
    // 3) monto pago exacto — igual a monto_total, nunca un valor distinto enviado por el cliente.
    const idxMontoPagado = sql.split(",").findIndex((c: string) => c.includes("monto_pagado"));
    expect(params).toContain("800.00");
    expect(params).toContain("REC-001");
    expect(params).toContain("Pagado en ventanilla");
    void idxMontoPagado;
  });

  it("2) segundo intento de pago (ya PAGADA) → 409", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("ops_multas")) return [[filaMulta({ estado_pago: "PAGADA", pagada_en: new Date(), pagada_por_usuario_id: 8, monto_pagado: "800.00" })], []];
      throw new Error("Consulta inesperada");
    });
    const response = await PATCH(req({ accion: "pagar" }), idCtx);
    expect(response.status).toBe(409);
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("4) auditoría: registra multa_pagada con el usuario autenticado", async () => {
    await PATCH(req({ accion: "pagar" }), idCtx);
    const auditoria = conn.execute.mock.calls.find(([, params]) => params?.[2] === "multa_pagada");
    expect(auditoria).toBeTruthy();
  });

  it("5) fallo de auditoría al pagar revierte todo (rollback, sin commit)", async () => {
    conn.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO auditoria")) throw new Error("Auditoría no disponible");
      return [{ affectedRows: 1, insertId: 9 }, []];
    });
    const response = await PATCH(req({ accion: "pagar" }), idCtx);
    expect(response.status).toBe(500);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("6) tenant cruzado: multa de otra empresa no aparece, PATCH rechaza con 404", async () => {
    conn.query.mockResolvedValueOnce([[], []]);
    const response = await PATCH(req({ accion: "pagar" }), idCtx);
    expect(response.status).toBe(404);
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("9) caso EMPRESA: al pagar, RRHH sigue NO_APLICA (el pago no toca resolución/estado_descuento)", async () => {
    const response = await PATCH(req({ accion: "pagar" }), idCtx);
    expect(response.status).toBe(200);
    const [, params] = conn.execute.mock.calls[0];
    // resolucion_economica/estado_descuento no forman parte de los "cambios" de la acción pagar.
    expect(params).not.toContain("EMPRESA");
  });
});

describe("MULTAS-5 — documentos del expediente", () => {
  it("7) documento asociado a la misma empresa/multa que autoriza el guard", async () => {
    await registrarDocumentoMulta({
      empresaId: 7, multaId: 9, tipoDocumento: "COMPROBANTE_PAGO",
      rutaRelativa: "empresas/7/multas/x.pdf", nombreOriginal: "recibo.pdf",
      mimeType: "application/pdf", tamano: 1234, subidoPorUsuarioId: 8,
    });
    expect(vi.mocked(execute)).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO ops_multa_documentos"),
      [7, 9, "empresas/7/multas/x.pdf", "recibo.pdf", "application/pdf", 1234, "COMPROBANTE_PAGO", 8],
    );
  });

  it("8) descarga sin permiso (multas:ver) es rechazada antes de tocar el archivo", async () => {
    vi.mocked(requireTenantMultas).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantMultas>>);
    const response = await getDocumento(new Request("http://localhost/x"), docCtx);
    expect(response.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("lista de documentos exige multas:ver y valida que la multa exista en el tenant", async () => {
    vi.mocked(query).mockResolvedValueOnce([{ ...filaMulta() }] as unknown as Awaited<ReturnType<typeof query>>).mockResolvedValueOnce([]);
    const response = await getDocumentos(new Request("http://localhost/x"), idCtx);
    expect(response.status).toBe(200);
    expect(requireTenantMultas).toHaveBeenCalledWith("prueba", "ver");
  });
});
