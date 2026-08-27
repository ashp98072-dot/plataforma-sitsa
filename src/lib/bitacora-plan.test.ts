import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantProgramacionOTms: vi.fn() }));

import { query } from "@/lib/db";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarAuditoriaPlan } from "@/lib/auditoria";
import { GET } from "@/app/api/empresas/[slug]/tms/planes/[id]/bitacora/route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "123" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>,
  );
  vi.mocked(query).mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("OPS-AJUSTES — bitácora del viaje (reutiliza auditoria, sin tabla nueva)", () => {
  it("filtra por empresa, módulo tms, y el plan exacto (sin confundir #123 con #1234)", async () => {
    await listarAuditoriaPlan(7, 123);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("modulo = 'tms'");
    expect(sql).toContain("detalle LIKE ?");
    expect(params).toEqual([7, "Plan #123 %"]);
  });

  it("GET .../bitacora exige permiso de lectura de Programación/TMS antes de tocar la DB", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantProgramacionOTms>>);
    const response = await GET(new Request("http://localhost/x"), ctx);
    expect(response.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("GET .../bitacora responde 200 con los eventos filtrados por el plan del tenant del guard", async () => {
    vi.mocked(query).mockResolvedValue([
      { id: 1, usuario: "ops1", accion: "editar_ruta", modulo: "tms", detalle: "Plan #123 CODE · piloto Juan → Pedro; motivo: Piloto indispuesto", creado_en: "2026-08-27 10:00:00" },
    ] as unknown as Awaited<ReturnType<typeof query>>);
    const response = await GET(new Request("http://localhost/x"), ctx);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.eventos).toHaveLength(1);
    expect(data.eventos[0].detalle).toContain("piloto Juan → Pedro");
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([7, "Plan #123 %"]);
  });
});
