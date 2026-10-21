import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireTenantRrhh: vi.fn(), repararSerieVacaciones: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones-reparacion-db", () => {
  class ReparacionBloqueadaError extends Error { constructor(msg: string, public plan: { bloqueos: unknown[] }) { super(msg); } }
  class ReparacionCambioError extends Error { constructor(public plan: unknown) { super("La información cambió desde la vista previa."); } }
  class ReparacionEmpleadoNoEncontradoError extends Error {}
  return { repararSerieVacaciones: m.repararSerieVacaciones, ReparacionBloqueadaError, ReparacionCambioError, ReparacionEmpleadoNoEncontradoError };
});

import { NextResponse } from "next/server";
import { ReparacionBloqueadaError, ReparacionCambioError, ReparacionEmpleadoNoEncontradoError } from "@/lib/rrhh/vacaciones-reparacion-db";
import { POST } from "./route";

const HUELLA = "a".repeat(32);
const ctx = (id = "3") => ({ params: Promise.resolve({ slug: "empresa-sintetica", id }) });
const post = (body: unknown) => new Request("http://local/api/x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh.ana" } });
  m.repararSerieVacaciones.mockResolvedValue({ aplicado: true, plan: { periodos: [1, 2, 3], consumidoPreservado: 5, saldoAntes: 20, saldoDespues: 30 } });
});

describe("POST empleados/[id]/vacaciones/reparacion", () => {
  it("exige RRHH · Vacaciones · editar y no ejecuta nada sin permiso", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });
    expect((await POST(post({ huella: HUELLA }), ctx())).status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("empresa-sintetica", "vacaciones", "editar");
    expect(m.repararSerieVacaciones).not.toHaveBeenCalled();
  });
  it("la empresa, el usuario y el colaborador salen del servidor: empresa_id/fechaAlta/usuario del cuerpo se IGNORAN", async () => {
    const r = await POST(post({ huella: HUELLA, empresa_id: 999, empresaId: 999, fechaAlta: "2000-01-01", usuario: "intruso", idEmpleado: 55 }), ctx());
    expect(r.status).toBe(200);
    expect(m.repararSerieVacaciones).toHaveBeenCalledWith(7, 3, { huella: HUELLA, usuario: "rrhh.ana" });
    expect(await r.json()).toMatchObject({ aplicado: true, periodos: 3, consumidoPreservado: 5, saldoAntes: 20, saldoDespues: 30 });
  });
  it("sin huella de la vista previa (o malformada), o id inválido ⇒ 400 y no ejecuta", async () => {
    for (const b of [{}, { huella: "x" }, { huella: 5 }, "no es json", null]) expect((await POST(post(b), ctx())).status).toBe(400);
    expect((await POST(post({ huella: HUELLA }), ctx("abc"))).status).toBe(400);
    expect(m.repararSerieVacaciones).not.toHaveBeenCalled();
  });
  it("serie ya correcta ⇒ 200 aplicado=false (no modificó nada)", async () => {
    m.repararSerieVacaciones.mockResolvedValue({ aplicado: false, plan: {} });
    const r = await POST(post({ huella: HUELLA }), ctx());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ aplicado: false, requiereReparacion: false });
  });
  it("bloqueo ⇒ 409 REPARACION_BLOQUEADA con los bloqueos; cambio desde el preview ⇒ 409 CAMBIO_DESDE_PREVIEW; inexistente ⇒ 404", async () => {
    m.repararSerieVacaciones.mockRejectedValueOnce(new ReparacionBloqueadaError("Detalle ajeno", { bloqueos: [{ codigo: "DETALLE_AJENO", mensaje: "x" }] } as never));
    const b = await POST(post({ huella: HUELLA }), ctx());
    expect(b.status).toBe(409);
    expect(await b.json()).toMatchObject({ codigo: "REPARACION_BLOQUEADA", bloqueos: [{ codigo: "DETALLE_AJENO" }] });
    m.repararSerieVacaciones.mockRejectedValueOnce(new ReparacionCambioError({} as never));
    const c = await POST(post({ huella: HUELLA }), ctx());
    expect(c.status).toBe(409);
    expect((await c.json()).codigo).toBe("CAMBIO_DESDE_PREVIEW");
    m.repararSerieVacaciones.mockRejectedValueOnce(new ReparacionEmpleadoNoEncontradoError());
    expect((await POST(post({ huella: HUELLA }), ctx())).status).toBe(404);
  });
  it("cualquier otro fallo ⇒ 500 genérico (sin detalles internos)", async () => {
    m.repararSerieVacaciones.mockRejectedValue(new Error("Duplicate entry uq_saldo_periodo"));
    const r = await POST(post({ huella: HUELLA }), ctx());
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("Duplicate");
  });
});
