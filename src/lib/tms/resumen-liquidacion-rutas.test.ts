import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  verOk: true,
  gastosOk: true,
  resumen: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({
  requireTenantProgramacionOTms: vi.fn(async (_slug: string, accion: string) => {
    if (accion !== "ver") throw new Error("la lectura debe pedir 'ver'");
    return m.verOk
      ? { session: { id: 11, username: "ana", rol: "Operaciones" }, empresa: { id: 7 } }
      : { error: NextResponse.json({ error: "Sin permiso." }, { status: 403 }) };
  }),
  requireTenantGastos: vi.fn(async (_slug: string, accion: string) => {
    if (accion !== "ver") throw new Error("los costos solo se leen con gastos:ver");
    return m.gastosOk
      ? { session: { id: 11, username: "ana", rol: "Operaciones" }, empresa: { id: 7 } }
      : { error: NextResponse.json({ error: "Sin permiso para ver en Gastos." }, { status: 403 }) };
  }),
}));
vi.mock("@/lib/tms/resumen-liquidacion", () => ({ obtenerResumenLiquidacionViaje: m.resumen }));

import { GET } from "../../app/api/empresas/[slug]/tms/planes/[id]/resumen-liquidacion/route";

const ctx = (id = "55") => ({ params: Promise.resolve({ slug: "acme", id }) });

beforeEach(() => {
  m.verOk = true;
  m.gastosOk = true;
  m.resumen.mockReset().mockResolvedValue({ plan: { id: 55 }, costosAutorizado: true, costos: {} });
});

describe("Resumen de liquidación · Fase 5 · endpoint (permisos, tenant y costos)", () => {
  it("sin permiso de lectura de viajes = 403 y no consulta nada", async () => {
    m.verOk = false;
    const r = await GET(new Request("http://x/api"), ctx());
    expect(r.status).toBe(403);
    expect(m.resumen).not.toHaveBeenCalled();
  });

  it("id inválido = 400", async () => {
    for (const id of ["abc", "0", "-3", "1.5"]) {
      expect((await GET(new Request("http://x/api"), ctx(id))).status, id).toBe(400);
    }
    expect(m.resumen).not.toHaveBeenCalled();
  });

  it("la empresa sale de la sesión aunque el cliente mande otra", async () => {
    await GET(new Request("http://x/api?empresaId=999&empresa_id=999"), ctx());
    expect(m.resumen).toHaveBeenCalledWith(7, 55, { incluirCostos: true });
  });

  it("con permiso de Gastos recibe los costos (incluirCostos = true)", async () => {
    const r = await GET(new Request("http://x/api"), ctx());
    expect(r.status).toBe(200);
    expect(m.resumen).toHaveBeenCalledWith(7, 55, { incluirCostos: true });
  });

  it("SIN permiso de Gastos: ve lo comercial, pero el servicio ni lee costos (backend, no UI)", async () => {
    m.gastosOk = false;
    m.resumen.mockResolvedValue({ plan: { id: 55 }, costosAutorizado: false, costos: null });
    const r = await GET(new Request("http://x/api"), ctx());
    expect(r.status).toBe(200);
    expect(m.resumen).toHaveBeenCalledWith(7, 55, { incluirCostos: false });
    expect(await r.json()).toMatchObject({ costosAutorizado: false, costos: null });
  });

  it("viaje de otra empresa / inexistente = 404", async () => {
    m.resumen.mockResolvedValue(null);
    const r = await GET(new Request("http://x/api"), ctx("9999"));
    expect(r.status).toBe(404);
  });

  it("solo expone GET: la ruta no escribe (ni POST/PUT/PATCH/DELETE)", async () => {
    const mod = (await import("../../app/api/empresas/[slug]/tms/planes/[id]/resumen-liquidacion/route")) as Record<string, unknown>;
    expect(Object.keys(mod).filter((k) => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
  });
});
