import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantModulo: vi.fn() }));
import { getPool } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";
import { consultarPartida, totalizarPartida } from "./consulta-partida";
import { GET } from "@/app/api/empresas/[slug]/contabilidad/asientos/route";
const a = { entidadId: 9, usuarioId: 4, admin: false };
const conn = { query: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn() };
const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const req = (query = "entidad=9&id=12") => new Request("https://local.test/api?" + query);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as never);
  vi.mocked(requireTenantModulo).mockResolvedValue({ empresa: { id: 7 }, session: { id: 4, rol: "Contabilidad" } } as never);
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM empresas")) return [[{ id: 7 }]];
    if (sql.includes("FROM cont_entidades")) return [[{ id: 9, activa: 1 }]];
    if (sql.includes("FROM cont_entidad_usuarios")) return [[{ activo: 1, puede_editar: 0 }]];
    if (sql.includes("FROM cont_asientos")) return [[{ id: 12, numero: "PRUEBA", fecha: "2026-08-31" }]];
    if (sql.includes("FROM cont_asiento_detalle")) return [[{ id: 1, debe: "0.10", haber: "0.00" }, { id: 2, debe: "0.20", haber: "0.30" }]];
    throw new Error("Consulta inesperada");
  });
});
it("consulta con permiso de lectura y filtra cabecera, líneas y cuentas por ámbito", async () => {
  const out = await consultarPartida(7, a, "12");
  expect(out.totales).toEqual({ debe: "0.30", haber: "0.30", diferencia: "0.00" });
  const consultas = conn.query.mock.calls.slice(2);
  expect(consultas[0][1]).toEqual([7, 9, 12]);
  expect(consultas[0][0]).toContain("empresa_id = ? AND entidad_id = ? AND id = ?");
  expect(consultas[1][1]).toEqual([7, 9, 12]);
  expect(consultas[1][0]).toContain("d.empresa_id = ? AND d.entidad_id = ? AND d.asiento_id = ?");
  expect(consultas[1][0]).toContain("c.empresa_id = d.empresa_id AND c.entidad_id = d.entidad_id");
  expect(consultas[1][0]).not.toContain("activa = 1");
  expect(conn.commit).toHaveBeenCalledOnce();
  expect(conn.release).toHaveBeenCalledOnce();
  expect(conn.execute).not.toHaveBeenCalled();
});
it.each(["0", "-1", "1.5", "1e2", "2147483648", ""])("rechaza id inválido %s", async (id) => {
  await expect(consultarPartida(7, a, id)).rejects.toMatchObject({ status: 400 });
  expect(getPool).not.toHaveBeenCalled();
});
it("devuelve 404 si no hay partida en el ámbito sin leer líneas", async () => {
  const normal = conn.query.getMockImplementation()!;
  conn.query.mockImplementation(async (...args) => String(args[0]).includes("FROM cont_asientos") ? [[]] : normal(...args));
  expect((await GET(req(), ctx)).status).toBe(404);
  expect(conn.query.mock.calls.some(([s]) => String(s).includes("FROM cont_asiento_detalle"))).toBe(false);
  expect(conn.rollback).toHaveBeenCalledOnce();
});
it("revocación de entidad impide consultar", async () => {
  conn.query.mockResolvedValueOnce([[{ id: 7 }]]).mockResolvedValueOnce([[]]);
  expect((await GET(req(), ctx)).status).toBe(403);
  expect(conn.query).toHaveBeenCalledTimes(2);
});
it.each([401, 403])("guard de módulo deniega %s antes de obtener conexión", async (status) => {
  vi.mocked(requireTenantModulo).mockResolvedValue({ error: new Response(null, { status }) } as never);
  expect((await GET(req(), ctx)).status).toBe(status);
  expect(getPool).not.toHaveBeenCalled();
});
it.each(["id=12", "entidad=9&id=12&id=13", "entidad=9&entidad=10&id=12"])("rechaza consulta ambigua %s", async (query) => {
  expect((await GET(req(query), ctx)).status).toBe(400);
  expect(getPool).not.toHaveBeenCalled();
});
it("respuesta privada sin caché y sin exigir edición", async () => {
  const res = await GET(req(), ctx);
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  expect(requireTenantModulo).toHaveBeenCalledWith("prueba", "contabilidad");
});
it("error intermedio revierte y no filtra SQL", async () => {
  const normal = conn.query.getMockImplementation()!;
  conn.query.mockImplementation(async (...args) => {
    if (String(args[0]).includes("FROM cont_asiento_detalle")) throw new Error("SQL privado");
    return normal(...args);
  });
  const res = await GET(req(), ctx);
  expect(res.status).toBe(500);
  expect(await res.text()).not.toContain("SQL privado");
  expect(conn.rollback).toHaveBeenCalledOnce();
  expect(conn.release).toHaveBeenCalledOnce();
  expect(conn.commit).not.toHaveBeenCalled();
});
it("totales exactos grandes y diferencias no se ocultan", () => {
  expect(totalizarPartida([{ debe: "999999999999.99", haber: "0.00" }, { debe: "0.01", haber: "0.00" }])).toEqual({
    debe: "1000000000000.00", haber: "0.00", diferencia: "1000000000000.00",
  });
  expect(totalizarPartida([])).toEqual({ debe: "0.00", haber: "0.00", diferencia: "0.00" });
  expect(() => totalizarPartida([{ debe: "mal", haber: "0.00" }])).toThrow();
});
