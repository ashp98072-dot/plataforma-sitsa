import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/tenant", () => ({ requireTenantModulo: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { requireTenantModulo } from "@/lib/tenant";
import { getPool, query } from "@/lib/db";
import * as cuentas from "@/app/api/empresas/[slug]/contabilidad/cuentas/route";
import * as cxc from "@/app/api/empresas/[slug]/contabilidad/cxc/route";
import * as cxp from "@/app/api/empresas/[slug]/contabilidad/cxp/route";
const endpoints = [{ api: cuentas, tipo: "cuentas" }, { api: cxc, tipo: "cxc" }, { api: cxp, tipo: "cxp" }];
const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const conn = { beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const request = (body = "{}") => new Request("http://localhost/api", { method: "POST", body });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantModulo).mockResolvedValue({ empresa: { id: 7 }, session: { username: "actor" } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  conn.execute.mockResolvedValue([{ insertId: 11 }]);
  vi.mocked(query).mockResolvedValue([]);
});
it.each(endpoints)("GET y POST de $tipo no omiten autorización", async ({ api }) => {
  for (const status of [401, 403]) {
    vi.mocked(requireTenantModulo).mockResolvedValue({ error: new Response(null, { status }) } as never);
    expect((await api.GET(request(), ctx)).status).toBe(status);
    expect((await api.POST(request(), ctx)).status).toBe(status);
  }
  expect(query).not.toHaveBeenCalled();
  expect(getPool).not.toHaveBeenCalled();
});
it.each(endpoints)("$tipo valida JSON y cuerpo antes de escribir", async ({ api }) => {
  for (const body of ["{", "{}", "null"]) expect((await api.POST(request(body), ctx)).status).toBe(400);
  expect(getPool).not.toHaveBeenCalled();
});
it.each(endpoints)("$tipo mantiene contrato y consulta aislada por empresa", async ({ api, tipo }) => {
  const res = await api.GET(request(), ctx);
  expect(await res.json()).toEqual({ [tipo]: [] });
  expect(res.headers.get("Cache-Control")).toContain("no-store");
  expect(query).toHaveBeenCalledWith(expect.stringContaining("empresa_id = ?"), [7]);
  const body = { codigo: "001", nombre: "Caja", tipo: "Activo", cliente: "Prueba", proveedor: "Prueba", fecha: "2026-08-28", monto: 1, empresaId: 99 };
  const saved = await api.POST(request(JSON.stringify(body)), ctx);
  expect(saved.status).toBe(200);
  expect((await saved.json()).id).toBe(11);
  expect(conn.execute.mock.calls[0][1][0]).toBe(7);
  expect(requireTenantModulo).toHaveBeenLastCalledWith("prueba", "contabilidad", true);
});
it.each(endpoints)("$tipo controla error de consulta", async ({ api }) => {
  vi.mocked(query).mockRejectedValueOnce(new Error("SQL privado"));
  const res = await api.GET(request(), ctx);
  expect(res.status).toBe(500);
  expect(await res.text()).not.toContain("SQL privado");
});
