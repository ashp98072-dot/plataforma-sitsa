import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  verOk: true,
  editarOk: true,
  listar: vi.fn(),
  crear: vi.fn(),
  anular: vi.fn(),
  guardEditarLlamadas: [] as string[],
}));

vi.mock("@/lib/tenant", () => ({
  requireTenantProgramacionOTms: vi.fn(async (_slug: string, accion: string) => {
    if (accion !== "ver") throw new Error("la lectura debe pedir 'ver'");
    return m.verOk
      ? { session: { id: 11, username: "ana", rol: "Operaciones" }, empresa: { id: 7 } }
      : { error: NextResponse.json({ error: "Sin permiso." }, { status: 403 }) };
  }),
  requireTenantViajesCargosAdicionales: vi.fn(async (_slug: string, accion: string) => {
    m.guardEditarLlamadas.push(accion);
    return m.editarOk
      ? { session: { id: 11, username: "ana", rol: "Operaciones" }, empresa: { id: 7 } }
      : { error: NextResponse.json({ error: "Sin permiso para gestionar cargos adicionales." }, { status: 403 }) };
  }),
}));
vi.mock("@/lib/tms/cargos-adicionales", () => ({
  listarCerradosPendientesLiquidacion: m.listar,
  crearCargoAdicional: m.crear,
  anularCargoAdicional: m.anular,
  obtenerVistaCargosPlan: vi.fn(),
  editarCargoAdicional: vi.fn(),
  reactivarCargoAdicional: vi.fn(),
  resumenCargosDePlanes: vi.fn(async () => new Map()),
}));

import { GET as getCerrados } from "../../app/api/empresas/[slug]/tms/planes/cargos-cerrados-pendientes/route";
import { POST as postCargo } from "../../app/api/empresas/[slug]/tms/planes/[id]/cargos/route";
import { POST as postAnular } from "../../app/api/empresas/[slug]/tms/planes/[id]/cargos/[cargoId]/anular/route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const ctxPlan = { params: Promise.resolve({ slug: "acme", id: "55" }) };
const ctxCargo = { params: Promise.resolve({ slug: "acme", id: "55", cargoId: "9" }) };
const json = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  m.verOk = true;
  m.editarOk = true;
  m.guardEditarLlamadas.length = 0;
  m.listar.mockReset().mockResolvedValue({ filas: [], truncado: false, limite: 200, diasLiquidados: 30 });
  m.crear.mockReset().mockResolvedValue({ cargo: { id: 1 }, evento: "CREADO", idempotente: false });
  m.anular.mockReset().mockResolvedValue({ cargo: { id: 9 }, evento: "ANULADO", idempotente: false });
});

describe("Cargos adicionales · Fase 4 · permisos y tenant de los endpoints (comportamiento)", () => {
  it("lista de cerrados: sin permiso de lectura = 403 y no consulta nada", async () => {
    m.verOk = false;
    const r = await getCerrados(new Request("http://x/api"), ctx);
    expect(r.status).toBe(403);
    expect(m.listar).not.toHaveBeenCalled();
  });

  it("lista de cerrados: la empresa sale de la sesión, aunque el cliente mande otra", async () => {
    const r = await getCerrados(new Request("http://x/api?empresaId=999&empresa_id=999&planId=1"), ctx);
    expect(r.status).toBe(200);
    expect(m.listar).toHaveBeenCalledWith(7, { incluirLiquidados: false });
  });

  it("lista de cerrados: incluirLiquidados solo con el valor exacto 1", async () => {
    await getCerrados(new Request("http://x/api?incluirLiquidados=1"), ctx);
    expect(m.listar).toHaveBeenLastCalledWith(7, { incluirLiquidados: true });
    await getCerrados(new Request("http://x/api?incluirLiquidados=true"), ctx);
    expect(m.listar).toHaveBeenLastCalledWith(7, { incluirLiquidados: false });
  });

  it("crear cargo: sin el permiso propio = 403 y no escribe; con permiso usa sesión (nunca el cuerpo)", async () => {
    m.editarOk = false;
    const sin = await postCargo(json({ concepto: "Espera", monto: "10", claveEnvio: "a".repeat(20) }), ctxPlan);
    expect(sin.status).toBe(403);
    expect(m.crear).not.toHaveBeenCalled();

    m.editarOk = true;
    const ok = await postCargo(json({ concepto: "Espera", monto: "10", claveEnvio: "a".repeat(20) }), ctxPlan);
    expect(ok.status).toBe(201);
    expect(m.guardEditarLlamadas).toEqual(["editar", "editar"]);
    expect(m.crear).toHaveBeenCalledWith({ empresaId: 7, usuarioId: 11, usuario: "ana" }, expect.objectContaining({ planId: 55, concepto: "Espera" }));
  });

  it("crear cargo: el cuerpo no puede traer empresa, usuario ni otros campos (esquema estricto)", async () => {
    for (const extra of [{ empresaId: 1 }, { usuarioId: 1 }, { creadoPor: 1 }, { activo: false }, { version: 9 }]) {
      const r = await postCargo(json({ concepto: "Espera", monto: "10", claveEnvio: "a".repeat(20), ...extra }), ctxPlan);
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
    expect(m.crear).not.toHaveBeenCalled();
  });

  it("anular: exige permiso, expectedVersion y motivo; identifica viaje y cargo desde la URL", async () => {
    m.editarOk = false;
    expect((await postAnular(json({ expectedVersion: 1, motivo: "Error de captura" }), ctxCargo)).status).toBe(403);
    expect(m.anular).not.toHaveBeenCalled();
    m.editarOk = true;
    expect((await postAnular(json({ motivo: "Error de captura" }), ctxCargo)).status).toBe(400);
    expect((await postAnular(json({ expectedVersion: 1, motivo: "Error de captura", empresaId: 2 }), ctxCargo)).status).toBe(400);
    const ok = await postAnular(json({ expectedVersion: 3, motivo: "Error de captura" }), ctxCargo);
    expect(ok.status).toBe(200);
    expect(m.anular).toHaveBeenCalledWith(
      { empresaId: 7, usuarioId: 11, usuario: "ana" },
      { planId: 55, cargoId: 9, versionEsperada: 3, motivo: "Error de captura" },
    );
  });
});
