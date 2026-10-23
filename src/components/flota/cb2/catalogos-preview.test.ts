import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ guard: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: () => { throw new Error("Catálogo no abre transacciones"); } }));
import { GET } from "@/app/api/empresas/[slug]/flota/combustible/catalogos/route";
beforeEach(() => { m.guard.mockResolvedValue({ empresa: { id: 7 } }); m.query.mockResolvedValue([]); });
describe("catálogo usado para sugerir vehículos en preview", () => {
    it("solo lista pilotos activos de la empresa autenticada y declara la limitación de CB2", async () => {
        m.query.mockImplementation(async (sql: string) => sql.includes("FROM empleados") ? [{ id: 1, nombre: "José Chay" }] : []);
        const r = await GET(new Request("https://novalvion.com/api/catalogos?empresaId=99"), { params: Promise.resolve({ slug: "demo" }) });
        const data = await r.json();
        expect(data.pilotos).toEqual([{ id: 1, nombre: "José Chay" }]); expect(data.empleados).toEqual(data.pilotos); expect(data.limitacionPilotos).toContain("empleados activos");
        const [sql, args] = m.query.mock.calls.find(([sql]) => sql.includes("FROM empleados"))!;
        expect(args).toEqual([7]); expect(sql).toContain("estado = 'Activo'");
    });
    it("catálogo ausente declara indisponibilidad sin usar personal de otras empresas", async () => {
        m.query.mockImplementation(async (sql: string) => { if (sql.includes("FROM empleados")) throw new Error("Tabla no disponible"); return []; });
        const r = await GET(new Request("https://novalvion.com/api/catalogos"), { params: Promise.resolve({ slug: "demo" }) });
        expect(r.status).toBe(200); const data = await r.json();
        expect(data.empleados).toEqual([]); expect(data.empleadosDisponibles).toBe(false); expect(data.limitacionPilotos).toContain("no disponible");
        expect(m.query).toHaveBeenCalledTimes(4);
    });
    it("deriva empresa del guard, no de parámetros controlados por el navegador", async () => {
        const r = await GET(new Request("https://novalvion.com/api/catalogos?empresaId=99"), { params: Promise.resolve({ slug: "demo" }) });
        expect(r.status).toBe(200); expect(m.guard).toHaveBeenCalledWith("demo", "ver");
        expect(m.query).toHaveBeenCalledTimes(4);
        const vehiculos = m.query.mock.calls.find(([sql]) => sql.includes("FROM flota_vehiculos"))!;
        expect(vehiculos[1]).toEqual([7, 7]);
        expect(vehiculos[0]).toContain("empresa_id");
        for (const [sql, params] of m.query.mock.calls) { expect(sql).toMatch(/^SELECT/); expect(params.every((p: number) => p === 7)).toBe(true); }
        expect(r.headers.get("cache-control")).toBe("private, no-store");
    });
    it.each([401, 403, 404])("sin acceso (%s) no devuelve unidades ni consulta catálogos", async status => {
        m.guard.mockResolvedValue({ error: new Response(null, { status }) });
        expect((await GET(new Request("https://novalvion.com/api/catalogos"), { params: Promise.resolve({ slug: "otra" }) })).status).toBe(status);
        expect(m.query).not.toHaveBeenCalled();
    });
});
