import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantViaticosPagar: vi.fn() }));
vi.mock("@/lib/tms/viaticos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tms/viaticos")>("@/lib/tms/viaticos");
  return { ...actual, registrarEntregaViaticosMasiva: vi.fn() };
});

import { requireTenantViaticosPagar } from "@/lib/tenant";
import { registrarEntregaViaticosMasiva } from "@/lib/tms/viaticos";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

function req(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantViaticosPagar).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 8, username: "fact1", nombre: "Marta Ruiz", rol: "Facturador" } } as Awaited<ReturnType<typeof requireTenantViaticosPagar>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("POST /tms/viaticos/entrega-masiva", () => {
  it("1) exige EXACTAMENTE viaticos_pagar:editar (no amplía permisos)", async () => {
    await POST(req({ metodoPago: "EFECTIVO", ids: [10] }), ctx);
    expect(requireTenantViaticosPagar).toHaveBeenCalledWith("prueba", "editar");
  });

  it("sin permiso -> rechazo ANTES de tocar el body/la lib", async () => {
    vi.mocked(requireTenantViaticosPagar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantViaticosPagar>>);
    const res = await POST(req({ metodoPago: "EFECTIVO", ids: [10] }), ctx);
    expect(res.status).toBe(403);
    expect(registrarEntregaViaticosMasiva).not.toHaveBeenCalled();
  });

  it("4) ids vacíos -> 400, sin llamar a la lib", async () => {
    const res = await POST(req({ metodoPago: "EFECTIVO", ids: [] }), ctx);
    expect(res.status).toBe(400);
    expect(registrarEntregaViaticosMasiva).not.toHaveBeenCalled();
  });

  it("body malformado (metodoPago inválido) -> 400", async () => {
    const res = await POST(req({ metodoPago: "BANCO", ids: [10] }), ctx);
    expect(res.status).toBe(400);
    expect(registrarEntregaViaticosMasiva).not.toHaveBeenCalled();
  });

  it("body no es JSON -> 400, sin lanzar", async () => {
    const res = await POST(new Request("http://localhost/x", { method: "POST", body: "no-es-json" }), ctx);
    expect(res.status).toBe(400);
  });

  it("TRANSFERENCIA -> normaliza ids a items con la MISMA referencia para todos", async () => {
    vi.mocked(registrarEntregaViaticosMasiva).mockResolvedValue({ ok: true, procesados: 2, total: 300, metodoPago: "TRANSFERENCIA" });
    await POST(req({ metodoPago: "TRANSFERENCIA", ids: [10, 11], referenciaPago: "LOTE-001" }), ctx);
    expect(registrarEntregaViaticosMasiva).toHaveBeenCalledWith(7, {
      metodoPago: "TRANSFERENCIA",
      items: [{ id: 10, referenciaPago: "LOTE-001" }, { id: 11, referenciaPago: "LOTE-001" }],
    }, "fact1");
  });

  it("TRANSFERENCIA sin referenciaPago -> 400 (obligatoria en el schema)", async () => {
    const res = await POST(req({ metodoPago: "TRANSFERENCIA", ids: [10] }), ctx);
    expect(res.status).toBe(400);
    expect(registrarEntregaViaticosMasiva).not.toHaveBeenCalled();
  });

  it("2) CHEQUE -> pasa `items` con la referencia INDIVIDUAL de cada uno, nunca una compartida", async () => {
    vi.mocked(registrarEntregaViaticosMasiva).mockResolvedValue({ ok: true, procesados: 2, total: 300, metodoPago: "CHEQUE" });
    await POST(req({ metodoPago: "CHEQUE", items: [{ id: 10, referenciaPago: "CHQ-1001" }, { id: 11, referenciaPago: "CHQ-1002" }] }), ctx);
    expect(registrarEntregaViaticosMasiva).toHaveBeenCalledWith(7, {
      metodoPago: "CHEQUE",
      items: [{ id: 10, referenciaPago: "CHQ-1001" }, { id: 11, referenciaPago: "CHQ-1002" }],
    }, "fact1");
  });

  it("CHEQUE con un item sin referenciaPago -> 400 (min(1) en el schema)", async () => {
    const res = await POST(req({ metodoPago: "CHEQUE", items: [{ id: 10, referenciaPago: "" }] }), ctx);
    expect(res.status).toBe(400);
    expect(registrarEntregaViaticosMasiva).not.toHaveBeenCalled();
  });

  it("3) EFECTIVO sin referenciaPago -> ok, se normaliza a null en cada item", async () => {
    vi.mocked(registrarEntregaViaticosMasiva).mockResolvedValue({ ok: true, procesados: 1, total: 150, metodoPago: "EFECTIVO" });
    await POST(req({ metodoPago: "EFECTIVO", ids: [10] }), ctx);
    expect(registrarEntregaViaticosMasiva).toHaveBeenCalledWith(7, {
      metodoPago: "EFECTIVO",
      items: [{ id: 10, referenciaPago: null }],
    }, "fact1");
  });

  it("20) éxito -> devuelve {procesados, total, metodoPago}", async () => {
    vi.mocked(registrarEntregaViaticosMasiva).mockResolvedValue({ ok: true, procesados: 3, total: 450, metodoPago: "EFECTIVO" });
    const res = await POST(req({ metodoPago: "EFECTIVO", ids: [10, 11, 12] }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ procesados: 3, total: 450, metodoPago: "EFECTIVO" });
  });

  it("propaga el error + detalles de la lib (rollback total) con su status real", async () => {
    vi.mocked(registrarEntregaViaticosMasiva).mockResolvedValue({
      ok: false,
      error: "Hay viáticos que no se pueden procesar en este lote.",
      status: 409,
      detalles: ["El viático #10 ya no está autorizado (estado actual: LIQUIDADO)."],
    });
    const res = await POST(req({ metodoPago: "EFECTIVO", ids: [10] }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.detalles).toHaveLength(1);
    expect(body.detalles[0]).toContain("#10");
  });

  it("6) otro tenant: empresaId SIEMPRE viene de guard.empresa.id (sesión), nunca del body", async () => {
    vi.mocked(registrarEntregaViaticosMasiva).mockResolvedValue({ ok: true, procesados: 1, total: 150, metodoPago: "EFECTIVO" });
    await POST(req({ metodoPago: "EFECTIVO", ids: [10], empresaId: 999 }), ctx);
    expect(registrarEntregaViaticosMasiva).toHaveBeenCalledWith(7, expect.anything(), "fact1");
  });

  it("500 real: una excepción no controlada se captura y responde JSON {error}, nunca un 500 sin cuerpo", async () => {
    vi.mocked(registrarEntregaViaticosMasiva).mockRejectedValue(new Error("fallo real de DB"));
    const res = await POST(req({ metodoPago: "EFECTIVO", ids: [10] }), ctx);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });
});
