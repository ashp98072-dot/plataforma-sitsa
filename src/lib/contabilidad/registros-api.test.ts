import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/tenant", () => ({ requireTenantModulo: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { requireTenantModulo } from "@/lib/tenant";
import { getPool, query } from "@/lib/db";
import { indicesC2b, fksC2b } from "./__fixtures__/esquema-c2b";
import * as cuentas from "@/app/api/empresas/[slug]/contabilidad/cuentas/route";
import * as cxc from "@/app/api/empresas/[slug]/contabilidad/cxc/route";
import * as cxp from "@/app/api/empresas/[slug]/contabilidad/cxp/route";
const endpoints = [{ api: cuentas, tipo: "cuentas" }, { api: cxc, tipo: "cxc" }, { api: cxp, tipo: "cxp" }];
const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const conn = { query: vi.fn(), beginTransaction: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const request = (body = "{}") => new Request("http://localhost/api?entidad=9", { method: "POST", body });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantModulo).mockResolvedValue({ empresa: { id: 7 }, session: { username: "actor", id: 4, rol: "Contabilidad" } } as never);
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  conn.execute.mockResolvedValue([{ insertId: 11 }]);
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.STATISTICS")) return [indicesC2b];
    if (sql.includes("information_schema.KEY_COLUMN_USAGE")) return [fksC2b];
    if (sql.includes("FROM empresas")) return [[{ id: 7 }]];
    if (sql.includes("FROM cont_entidades")) return [[{ id: 9, activa: 1 }]];
    if (sql.includes("FROM cont_entidad_usuarios")) return [[{ activo: 1, puede_editar: 1 }]];
    return [[]];
  });
});
it.each(endpoints)("$tipo rechaza selección ausente sin consultar ni escribir", async ({ api }) => {
  expect((await api.GET(new Request("https://local.test/api"), ctx)).status).toBe(400);
  expect((await api.POST(new Request("https://local.test/api", { method: "POST", body: "{}" }), ctx)).status).toBe(400);
  expect(getPool).not.toHaveBeenCalled();
});
it.each(endpoints)("$tipo rechaza entidad ajena incluso enviando otro id en body", async ({ api }) => {
  conn.query.mockResolvedValueOnce([[{ id: 7 }]]).mockResolvedValueOnce([[]]);
  const body = { codigo: "001", nombre: "Caja", tipo: "Activo", cliente: "Prueba", proveedor: "Prueba", fecha: "2026-08-28", monto: 1, entidadId: 10 };
  expect((await api.POST(request(JSON.stringify(body)), ctx)).status).toBe(403);
  expect(conn.execute).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledOnce();
});
it.each(endpoints)("$tipo no escribe con C2B parcial", async ({ api }) => {
  const original = conn.query.getMockImplementation()!;
  conn.query.mockImplementation(async (sql: string, args: unknown[]) => sql.includes("information_schema.STATISTICS") ? [[]] : original(sql, args));
  const body = { codigo: "001", nombre: "Caja", tipo: "Activo", cliente: "Prueba", proveedor: "Prueba", fecha: "2026-08-28", monto: 1 };
  expect((await api.POST(request(JSON.stringify(body)), ctx)).status).toBe(503);
  expect(conn.execute).not.toHaveBeenCalled();
  expect(conn.commit).not.toHaveBeenCalled();
  expect(conn.rollback).toHaveBeenCalledOnce();
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
  expect(conn.query).toHaveBeenCalledWith(expect.stringContaining("empresa_id = ? AND entidad_id = ?"), [7, 9]);
  const body = { codigo: "001", nombre: "Caja", tipo: "Activo", cliente: "Prueba", proveedor: "Prueba", fecha: "2026-08-28", monto: 1, empresaId: 99 };
  const saved = await api.POST(request(JSON.stringify(body)), ctx);
  expect(saved.status).toBe(200);
  expect((await saved.json()).id).toBe(11);
  expect(conn.execute.mock.calls[0][1][0]).toBe(7);
  expect(requireTenantModulo).toHaveBeenLastCalledWith("prueba", "contabilidad", true);
});
it.each(endpoints)("$tipo controla error de consulta", async ({ api }) => {
  conn.query.mockRejectedValueOnce(new Error("SQL privado"));
  const res = await api.GET(request(), ctx);
  expect(res.status).toBe(500);
  expect(await res.text()).not.toContain("SQL privado");
});
