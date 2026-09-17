import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { requireTenantRrhh } from "@/lib/tenant";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { GET, POST } from "./route";

/**
 * RRHH-PRESTACIONES-CODIGO-CONCEPTO — POST exige codigoConcepto (catálogo
 * cerrado, ver src/lib/rrhh/prestaciones.ts) y audita dentro de la misma
 * transacción que el INSERT. GET expone codigoConcepto (camelCase) además
 * del snake_case crudo, incluyendo NULL histórico sin romper.
 */

type Ctx = { params: Promise<{ slug: string }> };
const ctx: Ctx = { params: Promise.resolve({ slug: "prueba" }) };
const req = (body: unknown) =>
  new Request("https://local.test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const conn = {
  beginTransaction: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};

const bodyValido = { empleadoId: 7, tipo: "Bonificación anual julio", codigoConcepto: "BONO_14", monto: 500, fecha: "2026-09-01" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 3 }, session: { username: "rrhh" } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  conn.execute.mockResolvedValue([{ affectedRows: 1, insertId: 50 }, []]);
});

describe("POST rrhh/prestaciones — codigoConcepto obligatorio y validado", () => {
  it("1. crea con AGUINALDO", async () => {
    const response = await POST(req({ ...bodyValido, codigoConcepto: "AGUINALDO" }), ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: 50 });
    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO rrhh_prestaciones"),
      expect.arrayContaining(["AGUINALDO"]),
    );
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("2. crea con BONO_14", async () => {
    const response = await POST(req(bodyValido), ctx);
    expect(response.status).toBe(200);
    expect(conn.execute).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["BONO_14"]));
  });

  it("3. código desconocido -> 400, no escribe ni audita", async () => {
    const response = await POST(req({ ...bodyValido, codigoConcepto: "INVENTADO" }), ctx);
    expect(response.status).toBe(400);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it("4. sin codigoConcepto -> 400", async () => {
    const { codigoConcepto: _omitido, ...sinCodigo } = bodyValido;
    const response = await POST(req(sinCodigo), ctx);
    expect(response.status).toBe(400);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("codigoConcepto null explícito -> 400 (no es lo mismo que omitirlo)", async () => {
    const response = await POST(req({ ...bodyValido, codigoConcepto: null }), ctx);
    expect(response.status).toBe(400);
  });

  it("13. CREATE genera auditoría con prestacionId/empleadoId/tipo/codigoConcepto/monto/fecha, dentro de la transacción", async () => {
    await POST(req(bodyValido), ctx);
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({
      empresaId: 3, usuario: "rrhh", accion: "crear_prestacion_rrhh", modulo: "rrhh",
    }));
    const detalle = JSON.parse(vi.mocked(registrarAuditoriaTx).mock.calls[0][1].detalle as string);
    expect(detalle).toMatchObject({
      prestacionId: 50, empleadoId: 7, tipo: bodyValido.tipo, codigoConcepto: "BONO_14", monto: 500, fecha: "2026-09-01",
    });
    // La auditoría ocurre ANTES del commit (misma transacción).
    expect(vi.mocked(registrarAuditoriaTx).mock.invocationCallOrder[0]).toBeLessThan(conn.commit.mock.invocationCallOrder[0]);
  });

  it("17. no hay fuzzy matching: el texto de `tipo` nunca determina codigoConcepto — se guarda exactamente el código enviado", async () => {
    await POST(req({ ...bodyValido, tipo: "Aguinaldo de fin de año", codigoConcepto: "OTRO" }), ctx);
    expect(conn.execute).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(["OTRO"]));
  });

  it("16. empleado de otra empresa: no crea, hace rollback, no audita (tenant isolation)", async () => {
    conn.execute.mockResolvedValue([{ affectedRows: 0 }, []]);
    const response = await POST(req(bodyValido), ctx);
    expect(response.status).toBe(400);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it("si falla la auditoría, revierte toda la transacción (no queda prestación sin rastro)", async () => {
    vi.mocked(registrarAuditoriaTx).mockRejectedValue(new Error("auditoría caída"));
    const response = await POST(req(bodyValido), ctx);
    expect(response.status).toBe(500);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("sin sesión/permiso no llega a abrir transacción", async () => {
    vi.mocked(requireTenantRrhh).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const response = await POST(req(bodyValido), ctx);
    expect(response.status).toBe(403);
    expect(getPool).not.toHaveBeenCalled();
  });
});

describe("GET rrhh/prestaciones — expone codigoConcepto", () => {
  it("5. devuelve codigoConcepto junto a los demás campos", async () => {
    vi.mocked(query).mockResolvedValue([
      { id: 1, tipo: "Bono 14", codigo_concepto: "BONO_14", codigoConcepto: "BONO_14", monto: "500.00", emp_codigo: "E7", emp_nombre: "Empleado" },
    ] as never);
    const response = await GET(new Request("https://local.test"), ctx);
    const body = await response.json();
    expect(body.prestaciones[0]).toMatchObject({ codigoConcepto: "BONO_14" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("codigo_concepto AS codigoConcepto"), [3]);
  });

  it("6. histórico sin clasificar: codigoConcepto null no rompe la respuesta", async () => {
    vi.mocked(query).mockResolvedValue([
      { id: 2, tipo: "Bono viejo", codigo_concepto: null, codigoConcepto: null, monto: "100.00", emp_codigo: "E7", emp_nombre: "Empleado" },
    ] as never);
    const response = await GET(new Request("https://local.test"), ctx);
    expect(response.status).toBe(200);
    expect((await response.json()).prestaciones[0].codigoConcepto).toBeNull();
  });

  it("16. tenant isolation: GET filtra por empresa_id de la sesión", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await GET(new Request("https://local.test"), ctx);
    expect(query).toHaveBeenCalledWith(expect.any(String), [3]);
  });
});
